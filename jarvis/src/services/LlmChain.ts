/**
 * Shared LLM chain for the research/Oracle subsystem.
 *
 * Extracted from src/app/api/chat/route.ts so the research-llm endpoint
 * and any other internal callers can use the same NVIDIA -> OpenRouter
 * -> Groq fallback chain instead of hardcoding NVIDIA only.
 *
 * Multi-model rotation on 429/404 because free-tier rate limits are
 * per-model, not per-account. Note also that Groq rejects max_tokens
 * above 4096, so every provider's request is clamped (see
 * MAX_TOKENS_BY_PROVIDER) — an over-limit request is a hard 400 that
 * would otherwise abort the whole call and downgrade a report.
 */

import { NextResponse } from "next/server";

// OpenRouter free tier — re-verified live Oct 2026. The old "free tier is
// unavailable" note was stale: the catalogue rotated and these slugs answer
// 200 (the leading NVIDIA Nemotron model is the most reliable of the set).
// Keeping OpenRouter populated matters because it is the only non-Groq
// fallback — when every Groq model is rate-limited it carries the run.
const OPENROUTER_FALLBACK_MODELS: string[] = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "qwen/qwen3.8-27b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

// Groq free tier — verified live Aug 2026.
//   allam-2-7b              → 200, raw output. ✓
//   openai/gpt-oss-120b     → 200, wraps output in  thinking blocks; the
//                              loose JSON parser strips those, so it's safe
//                              for research.
//   openai/gpt-oss-20b      → 200, may route to reasoning/empty content;
//                              kept as a last resort (empty output just
//                              falls through to the next model).
//   qwen/qwen3.6-27b        → 404 ("does not exist or no access") — removed.
//   groq/compound-mini      → 404 ("does not exist or no access") — removed;
//                              it used to burn a slot on every failure.
//   llama-3.x, gemma2-9b,
//   mixtral-8x7b            → 404 / decommissioned (Aug 2026).
const GROQ_FALLBACK_MODELS = [
  "allam-2-7b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

// NVIDIA NIM free catalogue — re-verified live Oct 2026. These are now the
// primary provider (tried first): the Nemotron-3 family answers reliably and
// gives the chain a non-Groq path so a Groq rate-limit storm can't take the
// research pipeline down. Updated only after a live 200/JSON test.
const NVIDIA_MODELS: string[] = [
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/nemotron-3-ultra-550b-a55b",
];

/**
 * Per-provider output ceilings. Groq rejects max_tokens > 4096 with an
 * HTTP 400, and a 400 fails the WHOLE call — which is how an 8000-token
 * synthesis request silently downgraded every report to a placeholder.
 */
const MAX_TOKENS_BY_PROVIDER = {
  nvidia: 4096,
  openrouter: 4096,
  groq: 4000,
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ChainResult {
  content: string;
  provider: string;
  model: string;
}

/** One full pass over NVIDIA -> OpenRouter -> Groq. */
async function runChainOnce(
  prompt: string,
  maxTokens: number,
  temperature: number,
  skipNvidia: boolean
): Promise<ChainResult | null> {
  const nvMax = Math.min(maxTokens, MAX_TOKENS_BY_PROVIDER.nvidia);
  const orMax = Math.min(maxTokens, MAX_TOKENS_BY_PROVIDER.openrouter);
  const groqMax = Math.min(maxTokens, MAX_TOKENS_BY_PROVIDER.groq);

  // ── 1. NVIDIA (3s budget — short because the catalogue is unreliable) ──
  if (!skipNvidia) {
    const nvidiaKey = process.env.NVIDIA_API_KEY;
    if (nvidiaKey && nvidiaKey.trim() !== "" && nvidiaKey !== "your-api-key-here") {
      for (const model of NVIDIA_MODELS) {
        try {
          const c = new AbortController();
          // 8s: the large Nemotron models can be slow on the free tier, and a
          // 3s budget used to abort a response that was about to arrive.
          const t = setTimeout(() => c.abort(), 8000);
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
              max_tokens: nvMax,
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

  // ── 2. OpenRouter (5s per model) ──
  const orKey = process.env.OPENROUTER_API_KEY;
  if (orKey && orKey.trim() !== "" && orKey !== "your-api-key-here") {
    for (const model of OPENROUTER_FALLBACK_MODELS) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 8000);
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
            max_tokens: orMax,
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
          // 400/404 = dead slug, 429 = rate-limited. Either way, move on
          // rather than burning the full timeout on this model.
          if ([400, 404, 429].includes(res.status)) continue;
        }
      } catch (e: any) {
        console.warn(`[LLM chain] OpenRouter ${model} failed: ${e?.name || e?.message}`);
      }
    }
  }

  // ── 3. Groq (5s per model, rotates through the list) ──
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey.trim() !== "" && groqKey !== "your-api-key-here") {
    for (const model of GROQ_FALLBACK_MODELS) {
      try {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), 6000);
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${groqKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            max_tokens: groqMax,
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
          if ([400, 404, 429].includes(res.status)) continue;
        }
      } catch (e: any) {
        console.warn(`[LLM chain] Groq ${model} failed: ${e?.name || e?.message}`);
      }
    }
  }

  return null;
}

/**
 * Run a single prompt through the full chain. Returns the model
 * content string on success, or null if every provider failed.
 *
 * Designed for short structured outputs (classification, plan
 * generation, fact extraction, synthesis). For longer chat-style
 * exchanges, use the chat route directly.
 *
 * Free-tier rate limits are per-model and reset within seconds, so a
 * failed first pass is retried once after a short delay before giving up.
 */
export async function runLlmChain(prompt: string, opts?: {
  maxTokens?: number;
  temperature?: number;
  // Skip NVIDIA entirely (e.g. when the env says it's known-broken).
  skipNvidia?: boolean;
}): Promise<ChainResult | null> {
  const maxTokens = opts?.maxTokens ?? 2048;
  const temperature = opts?.temperature ?? 0.2;
  const skipNvidia = opts?.skipNvidia ?? false;

  let result = await runChainOnce(prompt, maxTokens, temperature, skipNvidia);
  if (result) return result;

  await sleep(1500);
  result = await runChainOnce(prompt, maxTokens, temperature, skipNvidia);
  if (result) return result;

  console.error("[LLM chain] Every provider failed after retry");
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
          "Tried NVIDIA, then the OpenRouter free models, then Groq — every one was rate-limited or errored. Check the server logs for per-model HTTP codes.",
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
