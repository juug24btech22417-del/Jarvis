import { NextRequest, NextResponse } from "next/server";
import { analyzeSnippet, MODE_LABELS } from "@/lib/agent/explainSnippet";
import { publishClipboardEvent } from "@/lib/composio/eventBus";

// OS-wide clipboard capture.
//
// The PowerShell clipboard watcher (scripts/clipboard-watcher.ps1) POSTs every
// new copy it sees anywhere on the laptop. We analyse it *here* (server-side,
// so it works even while the browser tab is in the background), publish the
// result to the SSE bus for the in-browser offer, and return a short summary
// the watcher shows as a Windows toast.
//
// Body: { text: string, source?: string }        → analyse + broadcast
//       { text, source, action: "probe" }        → ASK FIRST: validate the clip
//                                                  and say whether it is worth
//                                                  analysing, without spending a
//                                                  single LLM token. The OS
//                                                  watcher shows an "Ask JARVIS?"
//                                                  prompt from this and only
//                                                  POSTs the real clip when the
//                                                  user clicks it.
//       { action: "suppress", text }            → remember text so a copy we made
//                                                  ourselves (e.g. the overlay's
//                                                  Copy button) is never analysed
//                                                  back.
export const runtime = "nodejs";
export const maxDuration = 30;

// Tunables come from the environment so nothing is baked in; the fallbacks
// only apply when the env var is absent.
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const MIN_LEN = num(process.env.CLIPBOARD_MIN_CHARS, 3);
const MAX_LEN = num(process.env.CLIPBOARD_MAX_CHARS, 8000);
/** Identical clips inside this window are treated as one (dedupe). */
const DEDUPE_MS = num(process.env.CLIPBOARD_DEDUPE_MS, 20_000);
/** Suppressed clips stay suppressed for this long. */
const SUPPRESS_MS = num(process.env.CLIPBOARD_SUPPRESS_MS, 60_000);

type Stamp = { text: string; at: number };
const recent: Stamp[] = [];
const suppressed: Stamp[] = [];

function prune(list: Stamp[], ttl: number) {
  const cutoff = Date.now() - ttl;
  while (list.length && list[0].at < cutoff) list.shift();
}

function remember(list: Stamp[], text: string) {
  list.push({ text, at: Date.now() });
  if (list.length > 40) list.shift();
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawText = typeof body?.text === "string" ? body.text : "";
  const source = typeof body?.source === "string" ? body.source.slice(0, 200) : "";

  // Suppress channel — used before we write to the clipboard ourselves.
  if (body?.action === "suppress") {
    const t = rawText.trim();
    if (t) remember(suppressed, t);
    return NextResponse.json({ success: true });
  }

  const text = rawText.trim();
  if (text.length < MIN_LEN) {
    return NextResponse.json({ success: false, skipped: "too-short" });
  }
  if (text.length > MAX_LEN) {
    return NextResponse.json({ success: false, skipped: "too-large" });
  }

  prune(suppressed, SUPPRESS_MS);
  prune(recent, DEDUPE_MS);

  // Never analyse our own output, and collapse a duplicated copy event.
  if (suppressed.some((s) => s.text === text)) {
    return NextResponse.json({ success: false, skipped: "suppressed" });
  }

  // Probe: the OS watcher is only asking "is this worth offering?". Validate
  // and answer yes/no cheaply — no LLM call, no SSE broadcast, and crucially
  // no `recent` entry, so the follow-up analyse POST is never deduped away.
  if (body?.action === "probe") {
    if (recent.some((r) => r.text === text)) {
      return NextResponse.json({ success: true, proceed: false, skipped: "duplicate" });
    }
    return NextResponse.json({
      success: true,
      proceed: true,
      chars: text.length,
      preview: text.slice(0, 280),
      source,
    });
  }

  if (recent.some((r) => r.text === text)) {
    return NextResponse.json({ success: false, skipped: "duplicate" });
  }
  // Same text re-copied after the dedupe window is a genuine new request.
  remember(recent, text);
  // Drop it from suppression now that it has been processed.
  for (let i = suppressed.length - 1; i >= 0; i--) {
    if (suppressed[i].text === text) suppressed.splice(i, 1);
  }

  const analysis = await analyzeSnippet(text);

  publishClipboardEvent({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text,
    source,
    analysis: analysis as unknown as Record<string, any>,
    at: Date.now(),
  });

  // The payload is what the OS popup renders next to the cursor, so it
  // carries the full answer (not just the headline). Capped to keep the
  // HTTP response small; the full result is still on the SSE bus.
  return NextResponse.json({
    success: true,
    source,
    mode: analysis.mode,
    modeLabel: MODE_LABELS[analysis.mode].verb,
    category: analysis.category,
    urgency: analysis.urgency,
    summary: analysis.summary,
    answer: analysis.answer.slice(0, 4000),
    code: analysis.code.slice(0, 4000),
    language: analysis.language,
    soundbite: analysis.soundbite,
    hasCode: Boolean(analysis.code),
  });
}
