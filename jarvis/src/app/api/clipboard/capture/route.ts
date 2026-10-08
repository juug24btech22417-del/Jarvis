import { NextRequest, NextResponse } from "next/server";
import { analyzeSnippet, MODE_LABELS } from "@/lib/agent/explainSnippet";
import { buildOffer, KIND_ACTIONS, KIND_META, type ClipKind } from "@/lib/agent/clipboardDetect";
import { runClipAction } from "@/lib/agent/clipboardActions";
import { publishClipboardEvent } from "@/lib/composio/eventBus";

// OS-wide clipboard capture.
//
// The PowerShell clipboard watcher (scripts/clipboard-watcher.ps1) POSTs every
// new copy it sees anywhere on the laptop. Three things can happen:
//
//   action: "probe"  → WHAT IS THIS? Detection only (question / code / error /
//                      url / video / repo / message / SQL / JSON / command /
//                      equation / image), plus the exact buttons that kind
//                      should show. Zero model calls, so the watcher can put a
//                      smart card next to the cursor the instant you copy.
//   action: "act"    → the user clicked one of those buttons. Run exactly that
//                      action (fix / explain / optimize / test / summarize /
//                      reply / OCR…) — one model call, one finished result.
//   (no action)      → legacy auto path: analyse the clip end-to-end and
//                      broadcast it to the in-browser overlay.
//
// Body: { text, source?, action?: "probe" | "act", id?, kind?, image? }
//       { action: "suppress", text }   → remember text so a copy we made
//                                        ourselves (the popup's own Copy /
//                                        Apply buttons) is never analysed back.
// GET  → the kind/action catalog, so any client (including PowerShell) renders
//        exactly the same buttons without duplicating the heuristics.
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
/** Base64 image ceiling (~6 MB of PNG) — bigger than any screenshot we need. */
const MAX_IMAGE_CHARS = num(process.env.CLIPBOARD_MAX_IMAGE_CHARS, 8_000_000);

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

const KNOWN_KINDS = Object.keys(KIND_META) as ClipKind[];

function coerceKind(v: unknown): ClipKind | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  return (KNOWN_KINDS as string[]).includes(s) ? (s as ClipKind) : undefined;
}

/** The full catalog: every kind with its card label and its buttons. */
export function GET() {
  return NextResponse.json({
    success: true,
    kinds: KNOWN_KINDS.map((kind) => ({
      kind,
      label: KIND_META[kind].label,
      noun: KIND_META[kind].noun,
      actions: KIND_ACTIONS[kind],
    })),
    fallback: "text",
  });
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
  const image = typeof body?.image === "string" ? body.image : "";
  const kindHint = coerceKind(body?.kind);

  // Suppress channel — used before we write to the clipboard ourselves.
  if (body?.action === "suppress") {
    const t = rawText.trim();
    if (t) remember(suppressed, t);
    return NextResponse.json({ success: true });
  }

  const text = rawText.trim();

  // An image clip carries no text; a kind hint of "image" is the only signal.
  const isImage = kindHint === "image" || (Boolean(image) && !text);
  if (!isImage) {
    if (text.length < MIN_LEN) {
      return NextResponse.json({ success: false, skipped: "too-short" });
    }
    if (text.length > MAX_LEN) {
      return NextResponse.json({ success: false, skipped: "too-large" });
    }
  } else if (image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json({ success: false, skipped: "image-too-large" });
  }

  prune(suppressed, SUPPRESS_MS);
  prune(recent, DEDUPE_MS);

  // Never analyse our own output, and collapse a duplicated copy event.
  if (text && suppressed.some((s) => s.text === text)) {
    return NextResponse.json({ success: false, skipped: "suppressed" });
  }

  // ── Probe: "what did I copy, and what can I offer?" — no model call ──
  if (body?.action === "probe") {
    if (text && recent.some((r) => r.text === text)) {
      return NextResponse.json({ success: true, proceed: false, skipped: "duplicate" });
    }
    const offer = buildOffer(text, source, kindHint);
    return NextResponse.json({ success: true, proceed: true, offer, ...offer });
  }

  // ── Act: run the one action the user clicked ──
  if (body?.action === "act" || body?.action === "run") {
    const actionId = String(body?.id ?? body?.actionId ?? "").trim();
    if (!actionId) {
      return NextResponse.json({ error: "Missing action id" }, { status: 400 });
    }
    const result = await runClipAction({
      text,
      actionId,
      kind: kindHint ?? buildOffer(text, source).kind,
      source,
      image: image || undefined,
    });
    return NextResponse.json({ success: true, result });
  }

  if (text && recent.some((r) => r.text === text)) {
    return NextResponse.json({ success: false, skipped: "duplicate" });
  }
  // Same text re-copied after the dedupe window is a genuine new request.
  if (text) remember(recent, text);
  // Drop it from suppression now that it has been processed.
  for (let i = suppressed.length - 1; i >= 0; i--) {
    if (suppressed[i].text === text) suppressed.splice(i, 1);
  }

  const analysis = await analyzeSnippet(text);
  const detection = buildOffer(text, source, kindHint);

  publishClipboardEvent({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text,
    source,
    analysis: { ...analysis, detection } as unknown as Record<string, any>,
    detection: detection as unknown as Record<string, any>,
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
    detection,
  });
}
