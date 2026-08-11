/**
 * Shared LLM chain for the research/Oracle subsystem.
 *
 * Extracted from src/app/api/chat/route.ts so the research-llm endpoint
 * and any other internal callers can use the same NVIDIA -> OpenRouter
 * -> Groq fallback chain instead of hardcoding NVIDIA only.
 *
 * Per memory: NVIDIA NIM is currently unreliable; OpenRouter and Groq
 * are the working fallbacks. Multi-model rotation on 429/404 because
 * free-tier rate limits are per-model, not per-account.
 */

import { NextResponse } from "next/server";

const OPENROUTER_FALLBACK_MODELS = [
  "meta/llama-3.1-8b-instruct",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-3-27b-it:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
];

const GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "gemma2-9b-it",
  "mixtral-8x7b-32768",
];

// NVIDIA's current free-tier catalogue — kept narrow on purpose. We
// spent the budget on a single model that exists; if it's down we
// drop to OpenRouter / Groq immediately rather than burning 8s on
// five dead models.
const NVIDIA_MODELS = [
  "meta/llama-3.1-8b-instruct",
];

/**
 * Run a single prompt through the full chain. Returns the model
 * content string on success, or null if every provider failed.
 *
 * Designed for short structured outputs (classification, plan
 * generation, fact extraction, synthesis). For longer chat-style
 * exchanges, use the chat route directly.
 */
export async function runLlmChain(prompt: string, opts?: {
  maxTokens?: number;
  temperature?: number;
  // Skip NVIDIA entirely (e.g. when the env says it's known-broken).
  skipNvidia?: boolean;
}): Promise<{ content: string; provider: string; model: string } | null> {
  const maxTokens = opts?.maxTokens ?? 2048;
  const temperature = opts?.temperature ?? 0.2;
  const skipNvidia = opts?.skipNvidia ?? false;

  // ── 1. NVIDIA (3s budget — short because the catalogue is unreliable) ──
  if (!skipNvidia) {
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (nvidiaKey && nvidiaKey.trim() !== "" && nvidiaKey !== "your-api-key-here") {
      for (const model of NVIDIA_MODELS) {
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 3000);
          const res = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${nvidiaKey}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: prompt }],
              temperature,
              max_tokens: maxTokens,
              stream: false,
            }),
            signal: c.signal,
          });
          clearTimeout(t);

          if (res.ok) {
            const data = await res.json();
            const content = data.choices?.[0]?.message?.content?.trim();
            if (content) {
              console.log(`[LLM chain] Served via NVIDIA ${model}`);
              return { content, provider: "nvidia", model };
            }
          } else {
            const errText = await res.text().catch(() => "");
            console.warn(`[LLM chain] NVIDIA ${model} → HTTP ${res.status}: ${errText.slice(0, 120)}`);
          }
        } catch (e: any) {
          console.warn(`[LLM chain] NVIDIA ${model} failed: ${e?.name || e?.message}`);
        }
      }
    }
  }

  // ── 2. OpenRouter (5s per model, rotates through 5) ──
  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey && orKey.trim() !== "" && orKey !== "your-api-key-here") {
    for (const model of OPENROUTER_FALLBACK_MODELS) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 5000);
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${orKey}`,
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "JARVIS AI Assistant",
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
            temperature,
          }),
          signal: c.signal,
        });
        clearTimeout(t);

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) {
            console.log(`[LLM chain] Served via OpenRouter ${model}`);
            return { content, provider: "openrouter", model };
          }
        } else {
          const errText = await res.text().catch(() => "");
          console.warn(`[LLM chain] OpenRouter ${model} → HTTP ${res.status}: ${errText.slice(0, 120)}`);
          if (res.status === 429 || res.status === 404) continue; // try next
        }
      } catch (e: any) {
        console.warn(`[LLM chain] OpenRouter ${model} failed: ${e?.name || e?.message}`);
      }
    }
  }

  // ── 3. Groq (5s per model, rotates through 4) ──
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey.trim() !== "" && groqKey !== "your-api-key-here") {
    for (const model of GROQ_FALLBACK_MODELS) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 5000);
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: maxTokens,
            temperature,
          }),
          signal: c.signal,
        });
        clearTimeout(t);

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content?.trim();
          if (content) {
            console.log(`[LLM chain] Served via Groq ${model}`);
            return { content, provider: "groq", model };
          }
        } else {
          const errText = await res.text().catch(() => "");
          console.warn(`[LLM chain] Groq ${model} → HTTP ${res.status}: ${errText.slice(0, 120)}`);
          if (res.status === 429) continue;
        }
      } catch (e: any) {
        console.warn(`[LLM chain] Groq ${model} failed: ${e?.name || e?.message}`);
      }
    }
  }

  console.error("[LLM chain] Every provider failed");
  return null;
}

/**
 * Convenience wrapper that turns a chain result into a NextResponse.
 * Returns 502 with details when the chain is exhausted, 200 with
 * { content, provider, model } on success.
 */
export async function runLlmChainAsResponse(
  prompt: string,
  opts?: Parameters<typeof runLlmChain>[1]
): Promise<NextResponse> {
  const result = await runLlmChain(prompt, opts);
  if (!result) {
    return NextResponse.json(
      {
        error: "All LLM providers failed",
        details:
          "Tried NVIDIA, then 5 OpenRouter free models, then 4 Groq models. Every one was rate-limited or errored. Check the server logs for per-model HTTP codes.",
      },
      { status: 502 }
    );
  }
  return NextResponse.json({
    success: true,
    content: result.content,
    provider: result.provider,
    model: result.model,
  });
}
