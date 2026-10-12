// Client half of the overlay's streaming protocol.
//
// The route answers with newline-delimited JSON while the model is still
// writing, so the first words are on screen in a few hundred milliseconds
// instead of after a whole completion:
//
//     {"type":"start"}                      → a provider accepted the request
//     {"type":"delta","text":"…"}           → a fragment of the answer
//     {"type":"meta","meta":{…}}            → confidence / facts / topic
//     {"type":"done","text":"…"}            → full answer, stream over
//     {"type":"error","message":"…"}        → nothing usable
//
// A non-streaming (or non-NDJSON) response is still handled — the fallback is
// the plain JSON the route returns when streaming is impossible, so the overlay
// degrades instead of breaking.

import type { BriefTurn, DensityId, ModeId, StyleId } from "./modes";
import type { Meta, Turn } from "./contextBrain";

export interface AskBody {
  question: string;
  mode: ModeId;
  density: DensityId;
  style: StyleId;
  persona?: string;
  facts?: string[];
  summary?: string;
  recent?: BriefTurn[];
  expandOf?: { question: string; answer: string };
  triggeredBy?: string;
  /** Skip the model entirely when the answer must be instant (never used for
   * real answers; kept for tests). */
  noStream?: boolean;
}

export interface StreamHandlers {
  onStart?: () => void;
  /** Milliseconds until the first fragment arrived. */
  onFirstToken?: (ms: number) => void;
  onDelta?: (text: string) => void;
  onMeta?: (meta: Meta) => void;
  onDone?: (result: { text: string; meta: Meta | null }) => void;
  onError?: (message: string) => void;
}

interface StreamEvent {
  type: "start" | "delta" | "meta" | "done" | "error";
  text?: string;
  message?: string;
  meta?: Meta | null;
}

async function readNdjson(res: Response, onEvent: (e: StreamEvent) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) {
    const data = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
    if (data.answer) onEvent({ type: "done", text: data.answer });
    else onEvent({ type: "error", message: data.error || "no response body" });
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        onEvent(JSON.parse(trimmed) as StreamEvent);
      } catch {
        /* a torn line — the next read completes it */
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer.trim()) as StreamEvent);
    } catch {
      /* ignore */
    }
  }
}

async function postNdjson(url: string, body: unknown, handlers: StreamHandlers, signal?: AbortSignal) {
  const started = performance.now();
  let first = true;
  let text = "";
  let meta: Meta | null = null;
  let failed: string | null = null;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    handlers.onError?.(data.error || `HTTP ${res.status}`);
    return { text: "", meta: null, ok: false };
  }

  await readNdjson(res, (e) => {
    if (e.type === "start") {
      handlers.onStart?.();
      return;
    }
    if (e.type === "delta" && e.text) {
      if (first) {
        first = false;
        handlers.onFirstToken?.(Math.round(performance.now() - started));
      }
      text += e.text;
      handlers.onDelta?.(e.text);
      return;
    }
    if (e.type === "meta" && e.meta) {
      meta = e.meta;
      handlers.onMeta?.(e.meta);
      return;
    }
    if (e.type === "done") {
      if (!text && e.text) text = e.text;
      if (e.meta) {
        meta = e.meta;
        handlers.onMeta?.(e.meta);
      }
      return;
    }
    if (e.type === "error") {
      failed = e.message || "stream failed";
      handlers.onError?.(failed);
    }
  });

  if (failed) return { text, meta, ok: false };
  handlers.onDone?.({ text, meta });
  return { text, meta, ok: true };
}

/** Ask the overlay route for an answer, streaming. */
export function streamAsk(body: AskBody, handlers: StreamHandlers, signal?: AbortSignal) {
  return postNdjson("/api/overlay/ask", body, handlers, signal);
}

export interface SummarizeBody {
  intent: "summary" | "compact";
  turns?: Turn[];
  exchanges?: Array<{ question: string; answer: string; at?: number }>;
  mode?: ModeId;
  facts?: string[];
  summary?: string;
}

/** Summarise the conversation (user-facing, streamed). */
export function streamSummarize(body: SummarizeBody, handlers: StreamHandlers, signal?: AbortSignal) {
  return postNdjson("/api/overlay/summarize", body, handlers, signal);
}

/**
 * Compact the rolling window: fold the turns that have scrolled out into a
 * summary plus durable facts. This is the background half of the context brain
 * — it never blocks an answer, and a failure just means the window stays as it
 * is.
 */
export async function compactContext(body: SummarizeBody): Promise<{ summary: string; facts: string[] } | null> {
  try {
    const res = await fetch("/api/overlay/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, intent: "compact" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { summary?: string; facts?: string[] };
    if (!data.summary && !data.facts?.length) return null;
    return { summary: data.summary || "", facts: data.facts || [] };
  } catch {
    return null;
  }
}

export interface TranscribeResult {
  ok: boolean;
  text: string;
  language?: string;
  duration?: number;
  /** True when the transcript was discarded as a known Whisper hallucination. */
  filtered?: boolean;
  /** Why it failed — shown in the HUD, because "it hears nothing" is not a
   * diagnosable symptom and a missing key should not look like silence. */
  error?: string;
}

/** Upload one audio round for transcription. */
export async function transcribeChunk(
  blob: Blob,
  opts: { mode?: ModeId; kind?: "system" | "mic"; signal?: AbortSignal } = {}
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", blob, "chunk.webm");
  if (opts.mode) form.append("mode", opts.mode);
  if (opts.kind) form.append("kind", opts.kind);
  try {
    const res = await fetch("/api/overlay/transcribe", { method: "POST", body: form, signal: opts.signal });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      text?: string;
      filtered?: boolean;
      language?: string;
      duration?: number;
    };
    if (!res.ok || !data.success) {
      return { ok: false, text: "", error: data.error || `HTTP ${res.status}` };
    }
    return {
      ok: true,
      text: (data.text || "").trim(),
      language: data.language,
      duration: data.duration,
      filtered: data.filtered,
    };
  } catch (e) {
    return { ok: false, text: "", error: e instanceof Error ? e.message : String(e) };
  }
}
