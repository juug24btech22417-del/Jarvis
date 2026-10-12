// Streaming, first-token-wins variant of the agent LLM chain.
//
// WHY NOT `agentLlm`
// ------------------
// `agentLlm` (llm.ts) resolves the WHOLE completion, then hands it back. For a
// planner that is right. For an overlay sitting in front of a live call it is
// the difference between "the answer appears while they are still asking" and
// "the answer appears after the moment has passed".
//
// So this version:
//   • asks every configured provider in the existing preference order,
//   • staggers the starts (350ms) so the fastest one wins on its own,
//   • keeps whichever provider produces the FIRST TOKEN,
//   • aborts the losers so their streams are not paid for or left open,
//   • falls back to the non-streaming chain if not one provider streams.
//
// The provider order is Groq first (fastest time-to-first-token for these
// models), then Gemini, then OpenRouter, then NVIDIA — the same set of keys
// llm.ts uses, so the overlay adds no new configuration.

import {
  GEMINI_PLANNER_MODEL,
  GROQ_PLANNER_MODELS,
  OPENROUTER_PLANNER_MODELS,
} from "./types";
import { agentLlm } from "./llm";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const STAGGER_MS = 350;
/** How long a single provider gets to produce its first token. */
const FIRST_TOKEN_MS = 12_000;

export interface StreamLlmOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  label?: string;
}

export interface StreamLlmResult {
  provider: string;
  firstTokenMs: number;
  /** Deltas of the answer. Single-consumer: iterate it once. */
  deltas: AsyncGenerator<string>;
  /** Abort the winning stream (used when the user moves on to a new question). */
  abort: () => void;
  /** Release the watchdog timer once the stream has been fully consumed. */
  close: () => void;
}

interface Candidate {
  provider: string;
  url: string;
  key: string;
  model: string;
  headers?: Record<string, string>;
}

function candidates(): Candidate[] {
  const out: Candidate[] = [];
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey && groqKey !== "your_groq_api_key_here") {
    for (const model of GROQ_PLANNER_MODELS) {
      out.push({ provider: `groq/${model}`, url: GROQ_URL, key: groqKey, model });
    }
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && geminiKey !== "your_gemini_api_key_here") {
    out.push({ provider: `gemini/${GEMINI_PLANNER_MODEL}`, url: GEMINI_URL, key: geminiKey, model: GEMINI_PLANNER_MODEL });
  }
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (openrouterKey && openrouterKey !== "your_openrouter_api_key_here") {
    for (const model of OPENROUTER_PLANNER_MODELS) {
      out.push({
        provider: `openrouter/${model}`,
        url: OPENROUTER_URL,
        key: openrouterKey,
        model,
        headers: { "HTTP-Referer": "http://localhost:3000", "X-Title": "JARVIS AI Assistant" },
      });
    }
  }
  const nimKey = process.env.NVIDIA_API_KEY;
  if (nimKey && nimKey !== "your_nvidia_api_key_here") {
    out.push({ provider: `nvidia/${NIM_MODEL}`, url: NIM_URL, key: nimKey, model: NIM_MODEL });
  }
  return out;
}

/** Read OpenAI-compatible SSE and yield the text deltas. */
async function* sseDeltas(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no response body");
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") return;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string }; text?: string }>;
          };
          const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.text ?? "";
          if (delta) yield delta;
        } catch {
          /* keep-alive or provider-specific noise */
        }
      }
    }
  } finally {
    if (!signal.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* stream already gone */
      }
    }
  }
}

/** Open one candidate and wait for its first token. */
async function firstToken(c: Candidate, opts: StreamLlmOptions, delayMs: number) {
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 45_000);
  const guard = setTimeout(() => controller.abort(), FIRST_TOKEN_MS);
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.key}`,
        "Content-Type": "application/json",
        ...(c.headers || {}),
      },
      body: JSON.stringify({
        model: c.model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        max_tokens: opts.maxTokens ?? 800,
        temperature: opts.temperature ?? 0.3,
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}${detail ? `: ${detail.slice(0, 100)}` : ""}`);
    }
    const iter = sseDeltas(res, controller.signal);
    const first = await iter.next();
    if (first.done || !first.value) throw new Error("empty stream");
    clearTimeout(guard);
    return { candidate: c, iter, first: first.value, controller, timer };
  } catch (e) {
    clearTimeout(guard);
    clearTimeout(timer);
    controller.abort();
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** Staggered starts: the head of the list gets a free run before the next one
 * starts, so a healthy primary is never raced against. */
function staggerProbe(c: Candidate, opts: StreamLlmOptions, index: number) {
  return firstToken(c, opts, index * STAGGER_MS);
}

/**
 * Stream an answer. Resolves as soon as ONE provider has emitted its first
 * token; the remaining providers are aborted.
 */
export async function streamLlm(opts: StreamLlmOptions): Promise<StreamLlmResult> {
  const startedAt = Date.now();
  const list = candidates();
  if (!list.length) {
    // No streaming provider configured — the non-streaming chain may still
    // have a key (it reads the same env, so this is really the "no keys at
    // all" case) and gives a clearer error.
    const text = await agentLlm({ ...opts, label: opts.label ?? "overlay-stream" });
    return singleShot(text, "fallback");
  }

  const probes = list.map((c, i) => staggerProbe(c, opts, i));
  let winner: Awaited<ReturnType<typeof firstToken>>;
  try {
    winner = await Promise.any(probes);
  } catch {
    // Every provider failed to START streaming. Fall back to the buffered chain
    // so the user still gets an answer (just later) instead of an error.
    const text = await agentLlm({ ...opts, label: `${opts.label ?? "overlay"}-fallback` });
    return singleShot(text, "buffered");
  }

  // Abort every losing probe: their sockets and their spend stop here.
  for (const p of probes) {
    void p.then(
      (r) => {
        if (r !== winner) {
          r.controller.abort();
          clearTimeout(r.timer);
        }
      },
      () => {}
    );
  }

  const { candidate, iter, first, controller, timer } = winner;
  const firstTokenMs = Date.now() - startedAt;

  async function* deltas(): AsyncGenerator<string> {
    yield first;
    for (;;) {
      const { done, value } = await iter.next();
      if (done) break;
      if (value) yield value;
    }
  }

  return {
    provider: candidate.provider,
    firstTokenMs,
    deltas: deltas(),
    abort: () => {
      clearTimeout(timer);
      controller.abort();
    },
    close: () => clearTimeout(timer),
  };
}

/** A provider that cannot stream (or the buffered fallback): one delta. */
function singleShot(text: string, provider: string): StreamLlmResult {
  let consumed = false;
  async function* deltas(): AsyncGenerator<string> {
    if (consumed) return;
    consumed = true;
    yield text;
  }
  return {
    provider,
    firstTokenMs: 0,
    deltas: deltas(),
    abort: () => {},
    close: () => {},
  };
}

/** Convenience for callers that want the whole answer and do not stream it
 * anywhere (context compaction). Consumes the stream and joins it. */
export async function streamLlmText(opts: StreamLlmOptions): Promise<{ text: string; provider: string }> {
  const stream = await streamLlm(opts);
  let out = "";
  for await (const delta of stream.deltas) out += delta;
  stream.close();
  return { text: out.trim(), provider: stream.provider };
}
