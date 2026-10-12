"use client";

// Stealth overlay — a hands-free answer pane that is INVISIBLE TO SCREEN SHARE.
//
// The window shell that makes it capture-exempt is overlay/main.js (Electron):
// Windows only applies WDA_EXCLUDEFROMCAPTURE from the process that OWNS the
// window, so the HUD is its own app and this page renders inside it. The page
// never assumes it is safe — the shell measures, and the badge shows the answer.
//
// WHAT THIS PAGE IS NOW
// ---------------------
// It is the UI half of a small pipeline, and each half is deliberately separate
// so a slow one can never freeze the others:
//
//   capture   src/lib/overlay/audio.ts   — AudioWorklet VAD + MediaRecorder, off
//                                          the render path; silent rounds are
//                                          never uploaded
//   upload    src/lib/overlay/queue.ts   — bounded queue, drops stale audio
//                                          instead of backing up
//   inference src/app/api/overlay/*      — server process: Whisper + the model
//                                          chain, streamed back as it is written
//   UI        this file                  — text deltas buffered to one render per
//                                          frame; audio meters write to the DOM
//                                          directly, never through React state
//
// Behaviour that makes it feel smart rather than eager:
//   • a LIVE CONTEXT BRAIN keeps the last turns, a rolling summary and durable
//     facts, so "what about the second option?" has a second option to refer to
//   • PROACTIVE TRIGGERS classify each heard line (question / follow-up /
//     decision / claim / term) and the user decides per kind whether it is
//     ignored, prepared in the background, or answered outright
//   • INTERRUPTION HANDLING cancels the in-flight answer when a newer question
//     arrives, keeps the partial one as CUT OFF, and marks older answers STALE
//     so the newest answer is always in the reading position
//   • ANSWER CONTROL: mode, density (one line / brief / deep) and style, plus
//     DEEPEN and REPEAT on the answer itself, and a confidence chip

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaptureSession,
  describeMediaError,
  type CaptureKind,
} from "@/lib/overlay/audio";
import {
  currentExchange,
  detectTopicShift,
  markStale,
  nextTopicLabel,
  rollingWindow,
  splitStreamingAnswer,
  turnsToCompact,
  uid,
  updateFacts,
  type Exchange,
  type Meta,
  type Turn,
} from "@/lib/overlay/contextBrain";
import {
  DENSITIES,
  DENSITY_BY_ID,
  MODE_BY_ID,
  MODES,
  STYLES,
  STYLE_BY_ID,
  type DensityId,
  type ModeId,
  type StyleId,
} from "@/lib/overlay/modes";
import { createBoundedQueue } from "@/lib/overlay/queue";
import {
  modeForDigit,
  resolveCommand,
  SHORTCUTS,
  type CommandId,
} from "@/lib/overlay/shortcuts";
import { compactContext, streamAsk, streamSummarize, transcribeChunk } from "@/lib/overlay/stream";
import { dedupeAgainst, speakerLabel } from "@/lib/overlay/transcript";
import {
  DEFAULT_TRIGGERS,
  detect,
  forAction,
  pickPrimary,
  TRIGGER_META,
  TRIGGER_ORDER,
  type Detection,
  type TriggerKind,
  type TriggerSettings,
} from "@/lib/overlay/triggers";
import { GlassButton, GlassIcon, GlassSheet, GlassToggle, GLASS, GLASS_SHEEN, LevelMeter, NO_DRAG } from "@/components/overlay/glass";

declare global {
  interface Window {
    /** Injected by overlay/preload.js inside the protected Electron shell. */
    jarvisOverlay?: {
      host: "electron";
      setOpacity(value: number): Promise<{ ok: boolean; opacity?: number }>;
      getStatus(): Promise<{ ok: boolean; value: number | null; name: string }>;
      /** Window geometry in DIP, plus the display scale factor. */
      getBounds(): Promise<{ x: number; y: number; width: number; height: number; scale: number } | null>;
      /** Resize the window from the page's grip; the top-left corner stays put. */
      setSize(size: { width: number; height: number }): Promise<{ ok: boolean; width?: number; height?: number }>;
      /** Resize and reposition — used by the north/west edges, which have to move
       * the window origin so the edge under the cursor follows the cursor. */
      setBounds(box: { x: number; y: number; width: number; height: number }): Promise<{ ok: boolean }>;
      onStatus(cb: (status: { ok: boolean; value: number | null; name: string }) => void): () => void;
      hide(): void;
      focus(): void;
      onFocus(cb: () => void): () => void;
      /** Global shortcuts registered by the shell arrive here. */
      onCommand(cb: (command: string) => void): () => void;
      copy(text: string): Promise<{ ok: boolean }>;
      close(): void;
    };
  }
}

type Protection = "checking" | "protected" | "off";

/**
 * The eight resize directions, named the way CSS names them: `n` is the top
 * edge, `sw` the bottom-left corner. `w`/`n` drags move the window origin, the
 * rest only change its size.
 */
type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** The shell's floor (electron's minWidth/minHeight). Kept in sync in both
 * places so a drag never disagrees with the window about how small is small. */
const MIN_W = 160;
const MIN_H = 120;

/** One entry per handle: where it sits, and which way it resizes. */
const RESIZE_HANDLES: Array<{
  dir: ResizeDir;
  className: string;
  cursor: string;
  label: string;
}> = [
  { dir: "n", className: "top-0 left-3 right-3 h-1.5", cursor: "cursor-ns-resize", label: "Resize from the top edge" },
  { dir: "s", className: "bottom-0 left-3 right-3 h-1.5", cursor: "cursor-ns-resize", label: "Resize from the bottom edge" },
  { dir: "w", className: "left-0 top-3 bottom-3 w-1.5", cursor: "cursor-ew-resize", label: "Resize from the left edge" },
  { dir: "e", className: "right-0 top-3 bottom-3 w-1.5", cursor: "cursor-ew-resize", label: "Resize from the right edge" },
  { dir: "nw", className: "top-0 left-0 w-3.5 h-3.5", cursor: "cursor-nwse-resize", label: "Resize from the top-left corner" },
  { dir: "ne", className: "top-0 right-0 w-3.5 h-3.5", cursor: "cursor-nesw-resize", label: "Resize from the top-right corner" },
  { dir: "sw", className: "bottom-0 left-0 w-3.5 h-3.5", cursor: "cursor-nesw-resize", label: "Resize from the bottom-left corner" },
  { dir: "se", className: "bottom-0 right-0 w-3.5 h-3.5", cursor: "cursor-nwse-resize", label: "Resize from the bottom-right corner" },
];
type Sheet = null | "menu" | "privacy" | "brain" | "keys";

interface PrepSuggestion {
  id: string;
  kind: TriggerKind;
  reason: string;
  text: string;
  status: "loading" | "ready" | "failed";
  answer: string;
  confidence?: Meta["confidence"];
}

/** One piece of a rendered answer: prose, or a fenced code block. */
type Segment = { kind: "text" | "code"; lang?: string; content: string };

/**
 * Split an answer into prose and code by its ``` fences.
 *
 * Line-based on purpose: answers stream in and the closing fence often has not
 * arrived yet, so anything inside an unterminated fence still renders as code
 * instead of dumping a stray ``` into the paragraph.
 */
function splitFences(raw: string): Segment[] {
  const segments: Segment[] = [];
  let buffer: string[] = [];
  let kind: "text" | "code" = "text";
  let lang: string | undefined;

  const flush = (tail: string) => {
    if (kind === "code") segments.push({ kind, lang, content: tail.replace(/\n$/, "") });
    else if (tail.trim()) segments.push({ kind: "text", content: tail });
  };

  for (const line of raw.split("\n")) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      flush(buffer.join("\n"));
      buffer = [];
      if (kind === "text") {
        kind = "code";
        lang = fence[1].trim() || undefined;
      } else {
        kind = "text";
        lang = undefined;
      }
      continue;
    }
    buffer.push(line);
  }
  flush(buffer.join("\n"));
  return segments;
}

/** Four words explaining why the model decided to speak up unasked. */
function triggerReason(kind: TriggerKind): string {
  return TRIGGER_META[kind].blurb;
}

const CONFIDENCE_TONE: Record<string, { label: string; cls: string }> = {
  high: { label: "CONFIDENT", cls: "border-accent-green/40 text-accent-green/90 bg-accent-green/10" },
  medium: { label: "FAIRLY SURE", cls: "border-reactor-core/40 text-reactor-core/90 bg-reactor-core/10" },
  low: { label: "CHECK THIS", cls: "border-accent-amber/50 text-accent-amber bg-accent-amber/10" },
};

export default function StealthOverlayPage() {
  // ── Shell / window ───────────────────────────────────────────────────────
  const [protection, setProtection] = useState<Protection>("checking");
  const [protectDetail, setProtectDetail] = useState("");
  const [inShell, setInShell] = useState(false);
  const [opacity, setOpacity] = useState(0.85);
  const opacityTimer = useRef<number | null>(null);

  // ── Brain ────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<ModeId>("general");
  const [density, setDensity] = useState<DensityId>("brief");
  const [style, setStyle] = useState<StyleId>("quick");
  const [triggers, setTriggers] = useState<TriggerSettings>(DEFAULT_TRIGGERS);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [facts, setFacts] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [topic, setTopic] = useState("");
  const [prep, setPrep] = useState<PrepSuggestion[]>([]);

  // ── Session ──────────────────────────────────────────────────────────────
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sourceState, setSourceState] = useState<{ system: boolean; mic: boolean }>({ system: false, mic: false });
  const [speaking, setSpeaking] = useState(false);
  const [status, setStatus] = useState("standing by");
  const [latency, setLatency] = useState<{ ms: number; provider: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [counts, setCounts] = useState({ heard: 0, silent: 0, filtered: 0, dropped: 0, failed: 0 });

  // ── Panes ────────────────────────────────────────────────────────────────
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [sheet, setSheet] = useState<Sheet>(null);
  // Which handle is being dragged, or null. Drives the handle highlight and
  // suppresses the HUD's hover chrome so a resize does not also open a panel.
  const [resizing, setResizing] = useState<ResizeDir | null>(null);
  const [openStale, setOpenStale] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const questionInput = useRef<HTMLInputElement | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<CaptureSession | null>(null);
  const queueRef = useRef<ReturnType<typeof createBoundedQueue<{ kind: CaptureKind; blob: Blob }>> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastAskedRef = useRef<string>("");
  const lastHeardRef = useRef<string>("");
  const lastQuestionRef = useRef<string>("");
  const askedRef = useRef<string[]>([]);
  const compactingRef = useRef(false);
  const prepPrefetchRef = useRef(0);
  const systemBarRef = useRef<HTMLDivElement | null>(null);
  const micBarRef = useRef<HTMLDivElement | null>(null);
  const systemDotRef = useRef<HTMLSpanElement | null>(null);
  const micDotRef = useRef<HTMLSpanElement | null>(null);
  /** Text deltas for the in-flight answer, flushed once per frame. */
  const streamRef = useRef<{ id: string | null; raw: string; frame: number }>({ id: null, raw: "", frame: 0 });

  /** Latest values for the callbacks that must not re-subscribe (capture
   * handlers, the global key handler, shell commands). Assigned every render. */
  const latest = useRef({ mode, density, style, triggers, turns, facts, summary, topic, exchanges, busy, listening, muted, context, protection });
  latest.current = { mode, density, style, triggers, turns, facts, summary, topic, exchanges, busy, listening, muted, context, protection };

  const chooseMode = useCallback((id: ModeId) => {
    const spec = MODE_BY_ID[id];
    setMode(id);
    // A mode carries its own sensible default length — picking MEETING should
    // not then require an extra decision about density.
    setDensity(spec.density);
    setStatus(`${spec.label} mode — ${spec.tagline.toLowerCase()}`);
  }, []);

  const resetBrain = useCallback(() => {
    setExchanges([]);
    setTurns([]);
    setFacts([]);
    setSummary("");
    setTopic("");
    setPrep([]);
    setOpenStale({});
    lastAskedRef.current = "";
    lastHeardRef.current = "";
    lastQuestionRef.current = "";
    askedRef.current = [];
    streamRef.current = { id: null, raw: "", frame: 0 };
  }, []);

  // ── Shell wiring ─────────────────────────────────────────────────────────
  useEffect(() => {
    const host = typeof window !== "undefined" ? window.jarvisOverlay : undefined;
    setInShell(!!host);
    if (!host) {
      setProtection("off");
      setProtectDetail("plain browser window — screen capture cannot be blocked here. Launch with launch-jarvis-overlay.bat");
      return;
    }
    const apply = (s: { ok: boolean; value: number | null; name: string }) => {
      const safe = !!s.ok && (s.value === 0x11 || s.value === 0x01);
      setProtection(safe ? "protected" : "off");
      setProtectDetail(s.name);
    };
    void host
      .getStatus()
      .then(apply)
      .catch((e) => setProtectDetail(String(e)));
    return host.onStatus(apply);
  }, []);

  // ── Resizing ─────────────────────────────────────────────────────────────
  // A 4px window border on an always-on-top HUD sitting behind a call is a
  // terrible target, so the handles below drive the window directly: one
  // setBounds per animation frame, never one per pointer event.
  //
  // All eight directions share this engine. The three that matter behave like
  // the edges they name: `e`/`s` grow right and down, `w`/`n` have to move the
  // window origin so the edge under the cursor is the edge that follows it —
  // which is why this talks to setBounds and not just setSize.
  const resizeRef = useRef<{
    dir: ResizeDir;
    x: number;
    y: number;
    bx: number;
    by: number;
    width: number;
    height: number;
    scale: number;
    frame: number;
    pending: { x: number; y: number; width: number; height: number } | null;
  } | null>(null);

  const startResize = useCallback(async (e: React.PointerEvent<HTMLDivElement>, dir: ResizeDir) => {
    const host = window.jarvisOverlay;
    if (!host?.getBounds || !host.setBounds) return;
    const bounds = await host.getBounds();
    if (!bounds) return;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // A synthetic pointer (tests, an odd input device) cannot be captured;
      // the drag still works, it just does not follow the cursor outside the
      // grip.
    }
    resizeRef.current = {
      dir,
      x: e.screenX,
      y: e.screenY,
      bx: bounds.x,
      by: bounds.y,
      width: bounds.width,
      height: bounds.height,
      scale: bounds.scale || 1,
      frame: 0,
      pending: null,
    };
    setResizing(dir);
  }, []);

  const moveResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = resizeRef.current;
    if (!s || !window.jarvisOverlay?.setBounds) return;
    // screenX is in physical pixels; setBounds wants DIP. On a 150% display the
    // two differ, and the window would drift away from the cursor without this.
    const dx = (e.screenX - s.x) / s.scale;
    const dy = (e.screenY - s.y) / s.scale;
    let { width, height } = s;
    let x = s.bx;
    let y = s.by;
    if (s.dir.includes("e")) width = s.width + dx;
    if (s.dir.includes("s")) height = s.height + dy;
    if (s.dir.includes("w")) {
      width = s.width - dx;
      x = s.bx + dx;
    }
    if (s.dir.includes("n")) {
      height = s.height - dy;
      y = s.by + dy;
    }
    // Same floor as the shell's minWidth/minHeight. Clamping the ORIGIN too is
    // what stops the window from sliding sideways once an edge hits the floor.
    if (width < MIN_W) {
      if (s.dir.includes("w")) x += width - MIN_W;
      width = MIN_W;
    }
    if (height < MIN_H) {
      if (s.dir.includes("n")) y += height - MIN_H;
      height = MIN_H;
    }
    s.pending = { x, y, width, height };
    if (!s.frame) {
      s.frame = window.requestAnimationFrame(() => {
        const cur = resizeRef.current;
        if (!cur) return;
        cur.frame = 0;
        const box = cur.pending;
        if (!box) return;
        void window.jarvisOverlay?.setBounds(box).catch(() => {});
      });
    }
  }, []);

  const endResize = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null;
    setResizing(null);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* never captured */
    }
  }, []);

  /** Double-click the grip: back to the size the shell was built around. */
  const resetSize = useCallback(() => {
    void window.jarvisOverlay?.setSize({ width: 460, height: 720 }).catch(() => {});
  }, []);

  const applyOpacity = useCallback((value: number) => {
    setOpacity(value);
    if (opacityTimer.current) window.clearTimeout(opacityTimer.current);
    opacityTimer.current = window.setTimeout(() => {
      void window.jarvisOverlay?.setOpacity(value).catch(() => {});
    }, 120);
  }, []);

  useEffect(() => {
    if (inShell) applyOpacity(opacity);
    // The window is created at 0.85; keep the slider honest on first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inShell]);

  useEffect(() => window.jarvisOverlay?.onFocus(() => questionInput.current?.focus()), []);

  // ── Answering ────────────────────────────────────────────────────────────
  const patchExchange = useCallback((id: string, patch: Partial<Exchange>) => {
    setExchanges((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  /** One render per animation frame, whatever the token rate is. Without this
   * a long answer re-renders the whole HUD hundreds of times. */
  const scheduleFlush = useCallback(() => {
    const s = streamRef.current;
    if (s.frame) return;
    s.frame = window.requestAnimationFrame(() => {
      s.frame = 0;
      const id = streamRef.current.id;
      if (!id) return;
      const { body } = splitStreamingAnswer(streamRef.current.raw);
      patchExchange(id, { answer: body });
    });
  }, [patchExchange]);

  const runAsk = useCallback(
    async (opts: {
      question?: string;
      triggeredBy?: string;
      density?: DensityId;
      style?: StyleId;
      mode?: ModeId;
      expandOf?: { question: string; answer: string };
      replaceId?: string;
      repeated?: boolean;
      summaryCard?: boolean;
    }) => {
      const q = (opts.question ?? "").trim();
      if (!q && !opts.expandOf) return;
      const s = latest.current;

      // Interruption handling: the newer question wins. The in-flight request is
      // cancelled — its partial text is already on screen and stays there,
      // labelled as cut off, instead of vanishing.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const id = opts.replaceId ?? uid(opts.summaryCard ? "sum" : "x");
      const previous = currentExchange(s.exchanges);
      const shifted = !!q && detectTopicShift(s.topic, q);
      const nextTopic = nextTopicLabel(s.topic, q || previous?.question || "");

      if (opts.replaceId) {
        patchExchange(opts.replaceId, { answer: "", confidence: undefined, missing: [] });
      } else {
        const placeholder: Exchange = {
          id,
          question: opts.summaryCard ? "Summary of this conversation" : q,
          answer: "",
          mode: opts.mode ?? s.mode,
          density: opts.density ?? s.density,
          style: opts.style ?? s.style,
          at: Date.now(),
          topic: nextTopic,
          repeated: opts.repeated,
          expanded: !!opts.expandOf,
        };
        // Older answers move out of the reading position and are tagged STALE
        // when the subject actually changed (not merely on the second sentence
        // of the same topic, which would make the tag meaningless).
        setExchanges((prev) => [
          placeholder,
          ...prev.map((e) => (e.id === id ? e : { ...e, stale: true, staleReason: shifted ? "topic changed" : "older answer" })),
        ]);
        setTopic(nextTopic);
      }

      streamRef.current = { id, raw: "", frame: 0 };
      setLiveId(id);
      setBusy(true);
      setStatus(opts.summaryCard ? "summarising…" : opts.expandOf ? "going deeper…" : "answering…");
      if (q) lastAskedRef.current = q;
      if (q && !askedRef.current.includes(q)) askedRef.current = [...askedRef.current, q].slice(-40);

      const body = {
        question: q || previous?.question || "",
        mode: opts.mode ?? s.mode,
        density: opts.density ?? s.density,
        style: opts.style ?? s.style,
        facts: s.facts.length ? s.facts : undefined,
        summary: s.summary || undefined,
        recent: rollingWindow(s.turns).map((t) => ({ role: t.role, text: t.text })),
        persona: s.context.trim() || undefined,
        expandOf: opts.expandOf,
        triggeredBy: opts.triggeredBy,
      };

      const finish = (patch: Partial<Exchange>) => {
        streamRef.current = { id: null, raw: "", frame: 0 };
        patchExchange(id, patch);
        setLiveId(null);
        setBusy(false);
      };

      try {
        await streamAsk(
          body,
          {
            onStart: () => setStatus(opts.summaryCard ? "summarising…" : "answering…"),
            onFirstToken: (ms) => setLatency({ ms, provider: "" }),
            onDelta: (text) => {
              streamRef.current.raw += text;
              scheduleFlush();
            },
            onDone: ({ text, meta }) => {
              const { body: clean, meta: parsed } = splitStreamingAnswer(text, false);
              const info = meta ?? parsed;
              const finalText = opts.replaceId ? text : clean || text;
              if (!finalText.trim()) {
                // A proactive answer the model declined (SKIP) — drop the card
                // rather than show an empty one.
                setExchanges((prev) => prev.filter((e) => e.id !== id));
                streamRef.current = { id: null, raw: "", frame: 0 };
                setLiveId(null);
                setBusy(false);
                setStatus("standing by");
                return;
              }
              finish({
                answer: splitStreamingAnswer(finalText, false).body || finalText,
                confidence: info?.confidence,
                missing: info?.missing,
                topic: info?.topic || undefined,
              });
              if (opts.summaryCard) setStatus("summary ready");
              else setStatus("standing by");

              if (info?.facts?.length) setFacts((f) => updateFacts(f, info.facts));
              if (info?.topic) setTopic(info.topic);

              // Background compaction: fold what has scrolled out of the window
              // into the summary so the next question stays cheap without
              // forgetting the call. Never blocks the UI.
              if (!compactingRef.current && turnsToCompact(latest.current.turns) > 0) {
                compactingRef.current = true;
                const older = latest.current.turns.slice(0, latest.current.turns.length - 10);
                void compactContext({
                  intent: "compact",
                  turns: older,
                  summary: latest.current.summary,
                  mode: latest.current.mode,
                })
                  .then((r) => {
                    if (!r) return;
                    if (r.summary) setSummary(r.summary);
                    if (r.facts.length) setFacts((f) => updateFacts(f, r.facts));
                  })
                  .finally(() => {
                    compactingRef.current = false;
                  });
              }
            },
            onError: (message) => {
              setStatus(`error: ${message.slice(0, 80)}`);
              // Keep whatever streamed in, flagged, instead of a blank card.
              const partial = splitStreamingAnswer(streamRef.current.raw, false).body;
              if (partial.trim()) finish({ answer: partial, partial: true });
              else {
                setExchanges((prev) => prev.filter((e) => e.id !== id));
                streamRef.current = { id: null, raw: "", frame: 0 };
                setLiveId(null);
                setBusy(false);
              }
            },
          },
          ctrl.signal
        );
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          const partial = splitStreamingAnswer(streamRef.current.raw, false).body;
          streamRef.current = { id: null, raw: "", frame: 0 };
          if (partial.trim()) finish({ answer: partial, partial: true, stale: true });
          else setExchanges((prev) => prev.filter((x) => x.id !== id));
          setLiveId(null);
          setBusy(false);
          return;
        }
        finish({ answer: "", partial: true, stale: true });
        setStatus(`error: ${String(e).slice(0, 80)}`);
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        requestAnimationFrame(() => answerRef.current?.scrollTo({ top: 0 }));
      }
    },
    [patchExchange, scheduleFlush]
  );

  // ── Proactive triggers ───────────────────────────────────────────────────
  const prefetch = useCallback(
    (d: Detection) => {
      // Two is enough: a third suggestion is noise, and each one is a model call.
      if (prepPrefetchRef.current >= 2) return;
      const id = uid("prep");
      setPrep((prev) => [
        ...prev.slice(-3),
        { id, kind: d.kind, reason: d.reason, text: d.text, status: "loading", answer: "" },
      ]);
      prepPrefetchRef.current++;
      const s = latest.current;
      void streamAsk(
        {
          question: d.text,
          mode: s.mode,
          density: "line",
          style: "quick",
          facts: s.facts.length ? s.facts : undefined,
          summary: s.summary || undefined,
          recent: rollingWindow(s.turns).map((t) => ({ role: t.role, text: t.text })),
          persona: s.context.trim() || undefined,
          triggeredBy: triggerReason(d.kind),
        },
        {
          onDone: ({ text, meta }) => {
            const { body, meta: parsed } = splitStreamingAnswer(text, false);
            const clean = body || text;
            setPrep((prev) =>
              prev.map((p) =>
                p.id === id
                  ? clean.trim()
                    ? { ...p, status: "ready", answer: clean, confidence: (meta ?? parsed)?.confidence }
                    : { ...p, status: "failed" }
                  : p
              )
            );
          },
          onError: () => setPrep((prev) => prev.map((p) => (p.id === id ? { ...p, status: "failed" } : p))),
        }
      ).finally(() => {
        prepPrefetchRef.current = Math.max(0, prepPrefetchRef.current - 1);
      });
    },
    []
  );

  const onHeard = useCallback(
    (kind: CaptureKind, rawText: string) => {
      const text = dedupeAgainst(lastHeardRef.current, rawText);
      if (!text) return;
      lastHeardRef.current = text;

      const turn: Turn = {
        id: uid("t"),
        role: kind === "mic" ? "you" : "them",
        text,
        at: Date.now(),
        via: kind,
      };
      const withTurn = [...latest.current.turns, turn];
      setTurns(withTurn);
      setCounts((c) => ({ ...c, heard: c.heard + 1 }));
      requestAnimationFrame(() => transcriptRef.current?.scrollTo({ top: 1e6 }));

      const s = latest.current;
      const detections = detect(text, { topic: s.topic, asked: askedRef.current, listening: s.listening });
      if (!detections.length) return;

      // `auto` kinds are answered outright; `prep` kinds are prepared quietly
      // and wait for a click. One auto answer at a time: a second question while
      // one is streaming would just race itself.
      const auto = forAction(detections, s.triggers, "auto");
      const primary = pickPrimary(auto);
      if (primary && !s.busy) {
        void runAsk({ question: primary.text, triggeredBy: triggerReason(primary.kind) });
      }
      for (const d of forAction(detections, s.triggers, "prep").slice(0, 1)) {
        if (d.score >= 0.45) prefetch(d);
      }
    },
    [prefetch, runAsk]
  );

  // ── Listening ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!listening) {
      sessionRef.current?.stop();
      sessionRef.current = null;
      return;
    }
    let cancelled = false;
    setStatus("opening the ears…");

    const queue = createBoundedQueue<{ kind: CaptureKind; blob: Blob }>(
      async ({ kind, blob }) => {
        const result = await transcribeChunk(blob, { mode: latest.current.mode, kind });
        if (!result.ok) {
          // A transport or key failure, not silence: say WHAT failed, once,
          // instead of an overlay that looks like it hears nothing at all.
          setCounts((c) => {
            if (c.failed === 0) {
              const detail = (result.error || "unknown error").slice(0, 90);
              setStatus(`transcription failing: ${detail}`);
            }
            return { ...c, failed: c.failed + 1 };
          });
          return;
        }
        if (result.filtered) {
          setCounts((c) => ({ ...c, filtered: c.filtered + 1 }));
          return;
        }
        onHeard(kind, result.text);
      },
      { concurrency: 2, maxPending: 3, onDrop: () => setCounts((c) => ({ ...c, dropped: c.dropped + 1 })) }
    );
    queueRef.current = queue;

    const paint = (el: HTMLDivElement | null, level: number) => {
      if (el) el.style.transform = `scaleX(${level.toFixed(3)})`;
    };
    const paintDot = (el: HTMLSpanElement | null, live: boolean) => {
      if (!el) return;
      el.className = `w-1.5 h-1.5 rounded-full transition-colors duration-150 ${
        live ? "bg-accent-green shadow-[0_0_8px_#00FF9D]" : "bg-white/25"
      }`;
    };

    const session = new CaptureSession({
      chunkMs: 5000,
      minSpeechMs: 420,
      handlers: {
        onStatus: (text) => setStatus(text),
        onLevel: (kind, level, live) => {
          if (kind === "system") {
            paint(systemBarRef.current, level);
            paintDot(systemDotRef.current, live);
          } else {
            paint(micBarRef.current, level);
            paintDot(micDotRef.current, live);
          }
          setSpeaking(live);
        },
        onChunk: (kind, blob) => queue.push({ kind, blob }),
        onSkipped: () => setCounts((c) => ({ ...c, silent: c.silent + 1 })),
        onError: (message) => setStatus(message),
        onStarted: (state) => {
          setSourceState(state);
          setMuted(false);
        },
        // An ear can die mid-call (device unplugged, Bluetooth mic taken over).
        // The indicator has to stop claiming it is listening on something that
        // stopped producing audio.
        onEars: (state) => setSourceState(state),
      },
    });
    sessionRef.current = session;

    void session
      .start()
      .then((res) => {
        if (cancelled) {
          session.stop();
          return;
        }
        setSourceState({ system: res.system, mic: res.mic });
        if (res.errors.length && !res.system && !res.mic) {
          setStatus(`nothing to listen to — ${res.errors.join("; ")}`);
          setListening(false);
          return;
        }
        if (res.errors.length) {
          setStatus(`${res.mic || res.system ? "listening" : "not listening"} — ${res.errors.join("; ")}`);
        }
      })
      .catch((e) => {
        setStatus(`capture failed: ${describeMediaError(e)}`);
        setListening(false);
      });

    return () => {
      cancelled = true;
      queue.clear();
      session.stop();
      sessionRef.current = null;
    };
  }, [listening, onHeard]);

  const toggleListen = useCallback(() => {
    setListening((v) => {
      if (v) {
        setStatus("standing by");
        setSourceState({ system: false, mic: false });
        setSpeaking(false);
      } else {
        setStatus("opening the ears…");
      }
      return !v;
    });
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((v) => {
      const next = !v;
      sessionRef.current?.setMuted(next);
      return next;
    });
  }, []);

  // ── Actions ──────────────────────────────────────────────────────────────
  const clearPane = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setExchanges([]);
    setQuestion("");
    setPrep([]);
    setOpenStale({});
    streamRef.current = { id: null, raw: "", frame: 0 };
    setLiveId(null);
    setBusy(false);
    setStatus(latest.current.listening ? "cleared — still listening" : "standing by");
  }, []);

  const clearHistory = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetBrain();
    setCounts({ heard: 0, silent: 0, filtered: 0, dropped: 0, failed: 0 });
    setContext("");
    setQuestion("");
    setLiveId(null);
    setBusy(false);
    queueRef.current?.clear();
    setStatus(latest.current.listening ? "history cleared — still listening" : "standing by");
  }, [resetBrain]);

  const copyText = useCallback(async (key: string, text: string) => {
    const flash = () => {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    };
    try {
      if (window.jarvisOverlay?.copy) {
        const res = await window.jarvisOverlay.copy(text);
        if (res?.ok) return flash();
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return flash();
      }
      throw new Error("no clipboard api");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:-1000px;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (ok) return flash();
      } catch {
        /* fall through */
      }
      setStatus("clipboard blocked — select the text instead");
    }
  }, []);

  const showPrep = useCallback(
    (p: PrepSuggestion) => {
      if (!p.answer.trim()) {
        // Still loading, or the model declined: answer it for real, now.
        void runAsk({ question: p.text, triggeredBy: triggerReason(p.kind) });
        return;
      }
      const id = uid("x");
      setExchanges((prev) => [
        {
          id,
          question: p.text,
          answer: p.answer,
          mode: latest.current.mode,
          density: "line",
          style: "quick",
          at: Date.now(),
          confidence: p.confidence,
          topic: latest.current.topic,
        },
        ...prev.map((e) => ({ ...e, stale: true, staleReason: "older answer" })),
      ]);
      setPrep((prev) => prev.filter((x) => x.id !== p.id));
      setStatus("standing by");
    },
    [runAsk]
  );

  const deepen = useCallback(
    (ex: Exchange) => {
      void runAsk({
        question: ex.question,
        expandOf: { question: ex.question, answer: ex.answer },
        density: "deep",
        mode: latest.current.mode,
        replaceId: ex.id,
      });
    },
    [runAsk]
  );

  const repeatLast = useCallback(() => {
    const last = latest.current.exchanges[0];
    const q = last?.question || lastQuestionRef.current;
    if (!q) {
      setStatus("nothing to repeat yet");
      return;
    }
    void runAsk({ question: q, density: "line", repeated: true });
  }, [runAsk]);

  const summarize = useCallback(async () => {
    const s = latest.current;
    if (!s.turns.length && !s.exchanges.length) {
      setStatus("nothing to summarise yet — start listening first");
      return;
    }
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = uid("sum");
    streamRef.current = { id, raw: "", frame: 0 };
    setLiveId(id);
    setBusy(true);
    setStatus("summarising…");
    setExchanges((prev) => [
      {
        id,
        question: "Summary of this conversation",
        answer: "",
        mode: s.mode,
        density: "brief",
        style: "quick",
        at: Date.now(),
      },
      ...prev.map((e) => ({ ...e, stale: true, staleReason: "older answer" })),
    ]);

    try {
      await streamSummarize(
        {
          intent: "summary",
          mode: s.mode,
          turns: s.turns,
          exchanges: s.exchanges.slice(0, 8).map((e) => ({ question: e.question, answer: e.answer })),
          summary: s.summary || undefined,
        },
        {
          onFirstToken: (ms) => setLatency({ ms, provider: "" }),
          onDelta: (text) => {
            streamRef.current.raw += text;
            scheduleFlush();
          },
          onDone: ({ text }) => {
            const { body: clean } = splitStreamingAnswer(text, false);
            const final = clean || text;
            if (!final.trim()) {
              setExchanges((prev) => prev.filter((e) => e.id !== id));
            } else {
              patchExchange(id, { answer: final });
            }
            streamRef.current = { id: null, raw: "", frame: 0 };
            setLiveId(null);
            setBusy(false);
            setStatus("summary ready");
          },
          onError: (message) => {
            setStatus(`summary failed: ${message.slice(0, 70)}`);
            setExchanges((prev) => prev.filter((e) => e.id !== id));
            streamRef.current = { id: null, raw: "", frame: 0 };
            setLiveId(null);
            setBusy(false);
          },
        },
        ctrl.signal
      );
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setStatus(`summary failed: ${String(e).slice(0, 70)}`);
      setBusy(false);
      setLiveId(null);
    }
  }, [patchExchange, scheduleFlush]);

  const askNow = useCallback(() => {
    const q = question.trim();
    if (q) {
      setQuestion("");
      setTurns((prev) => [...prev, { id: uid("t"), role: "you", text: q, at: Date.now(), via: "typed" }]);
      void runAsk({ question: q });
      return;
    }
    // Nothing typed: answer the strongest pending suggestion, else the last
    // detected question. This is the "I need it NOW" key mid-call.
    const pending = prep.find((p) => p.text);
    const last = latest.current.exchanges.find((e) => !e.stale) ?? latest.current.exchanges[0];
    const q2 = pending?.text || last?.question;
    if (!q2) {
      questionInput.current?.focus();
      setStatus("nothing pending — type or say something first");
      return;
    }
    void runAsk({ question: q2, triggeredBy: "you asked for it now" });
  }, [prep, question, runAsk]);

  const cycleDensity = useCallback(() => {
    const order = DENSITIES.map((d) => d.id);
    const next = order[(order.indexOf(latest.current.density) + 1) % order.length];
    setDensity(next);
    setStatus(`answer length: ${DENSITY_BY_ID[next].label.toLowerCase()}`);
  }, []);

  const runCommand = useCallback(
    (cmd: CommandId) => {
      switch (cmd) {
        case "toggle-listen":
          toggleListen();
          break;
        case "toggle-mute":
          toggleMute();
          break;
        case "ask-now":
          askNow();
          break;
        case "repeat":
          repeatLast();
          break;
        case "expand": {
          const cur = currentExchange(latest.current.exchanges);
          if (cur) deepen(cur);
          break;
        }
        case "summarize":
          void summarize();
          break;
        case "cycle-density":
          cycleDensity();
          break;
        case "clear-all":
          clearHistory();
          break;
        case "focus-ask":
          if (question.trim()) askNow();
          else {
            window.jarvisOverlay?.focus();
            questionInput.current?.focus();
          }
          break;
        case "toggle-privacy":
          setSheet((s) => (s === "privacy" ? null : "privacy"));
          break;
        case "toggle-context":
          setSheet((s) => (s === "brain" ? null : "brain"));
          break;
        case "help":
          setSheet((s) => (s === "keys" ? null : "keys"));
          break;
        case "hide":
          window.jarvisOverlay?.hide();
          break;
        case "close":
          window.jarvisOverlay?.close();
          break;
      }
    },
    [askNow, clearHistory, cycleDensity, deepen, question, repeatLast, summarize, toggleListen, toggleMute]
  );

  const commandRef = useRef(runCommand);
  commandRef.current = runCommand;

  // Commands from the shell's global shortcuts (they work while the call app has
  // focus), plus the in-window key map and "type to ask".
  useEffect(() => {
    const off = window.jarvisOverlay?.onCommand?.((command) => commandRef.current(command as CommandId));
    return () => off?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");

      const cmd = resolveCommand(e);
      if (cmd) {
        // Escape and the Alt combos work while typing too; Ctrl+Enter always
        // means "send".
        e.preventDefault();
        e.stopPropagation();
        commandRef.current(cmd);
        return;
      }
      const modeIndex = modeForDigit(e);
      if (modeIndex !== null && MODES[modeIndex]) {
        e.preventDefault();
        chooseMode(MODES[modeIndex].id);
        return;
      }
      if (typing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Type to ask: focus is usually in the call app, so the first keystroke
      // lands here instead of nowhere.
      const input = questionInput.current;
      if (!input) return;
      if (e.key.length === 1) {
        e.preventDefault();
        input.focus();
        setQuestion((q) => q + e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        input.focus();
        setQuestion((q) => q.slice(0, -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        form.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [chooseMode]);

  // A gentle nudge if the user is listening and nothing has been heard yet — the
  // most common "it's not working" is simply an empty room.
  useEffect(() => {
    if (!listening) return;
    const t = window.setTimeout(() => {
      if (counts.heard === 0 && counts.silent === 0) {
        setStatus("listening — speak, or play audio, and it will appear below");
      }
    }, 8000);
    return () => window.clearTimeout(t);
  }, [listening, counts.heard, counts.silent]);

  // ── Test seam ────────────────────────────────────────────────────────────
  // Present only with `?test=1`, which the e2e script adds to the shell's URL
  // (scratch/overlay_e2e.mjs). It exposes the same entry points the capture
  // pipeline uses, so the whole brain — triggers, prefetch, stale marking,
  // facts, compaction — can be driven end-to-end on a machine with no
  // microphone. In a normal launch it does not exist at all.
  const testSeam = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("test");
  useEffect(() => {
    if (!testSeam) return;
    const seam = {
      hear: (kind: CaptureKind, text: string) => onHeard(kind, text),
      ask: runAsk,
      brain: () => ({
        facts: latest.current.facts,
        summary: latest.current.summary,
        topic: latest.current.topic,
        turns: latest.current.turns.length,
        exchanges: latest.current.exchanges,
        triggers: latest.current.triggers,
        status,
      }),
      setTriggers: (t: TriggerSettings) => setTriggers(t),
      setMode: (m: ModeId) => chooseMode(m),
      setDensity: (d: DensityId) => setDensity(d),
      setStyle: (st: StyleId) => setStyle(st),
    };
    (window as unknown as { jarvisOverlayTest?: typeof seam }).jarvisOverlayTest = seam;
    return () => {
      delete (window as unknown as { jarvisOverlayTest?: typeof seam }).jarvisOverlayTest;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testSeam, onHeard, runAsk, chooseMode, status]);

  const current = exchanges[0];
  const stale = exchanges.slice(1);
  const protectedOk = protection === "protected";
  const liveConfidence = current?.confidence ? CONFIDENCE_TONE[current.confidence] : null;
  const styleSpec = STYLE_BY_ID[style];
  const activePrep = useMemo(() => prep.filter((p) => p.status !== "failed"), [prep]);

  return (
    <div className="relative h-screen w-screen flex flex-col overflow-hidden bg-transparent text-text-primary font-rajdhani">
      {/* Ambient wash so the frosted panels sit on something, not on the flat
          window colour. Purely decorative and pointer-transparent. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_-15%,rgba(0,212,255,0.12),transparent_62%)]" />

      {/* ── Header: drag handle + status + privacy ───────────────────────── */}
      <header
        className={`relative z-20 flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.08] bg-black/25 backdrop-blur-xl ${
          inShell ? "[-webkit-app-region:drag] cursor-move" : ""
        }`}
        title={inShell ? "Drag here to move the overlay" : undefined}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            protectedOk ? "bg-accent-green" : protection === "off" ? "bg-accent-red" : "bg-reactor-core animate-pulse"
          }`}
          style={{ boxShadow: `0 0 10px ${protectedOk ? "#00FF9D" : protection === "off" ? "#FF2D55" : "#00D4FF"}` }}
          title={protectDetail}
        />
        <span className="font-orbitron text-[10px] tracking-[0.42em] pl-[0.42em] glow-text text-reactor-core select-none">
          JARVIS
        </span>

        {/* Privacy indicator: what is being captured RIGHT NOW, at a glance. */}
        <GlassButton
          size="xs"
          onClick={() => setSheet((s) => (s === "privacy" ? null : "privacy"))}
          active={muted || listening}
          tone={muted ? "danger" : listening ? "success" : "neutral"}
          title={
            muted
              ? "Muted — nothing is being captured (Alt+M)"
              : listening
              ? `Capturing: ${sourceState.system ? "system audio " : ""}${sourceState.mic ? "microphone" : ""}`.trim()
              : "Not capturing anything — click for the privacy panel (Alt+P)"
          }
          className="ml-1"
        >
          <span className="flex items-center gap-1">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                muted ? "bg-accent-red" : speaking ? "bg-accent-green" : listening ? "bg-reactor-core animate-pulse" : "bg-white/25"
              }`}
            />
            {muted ? "MUTED" : listening ? `${sourceState.system ? "SYS" : ""}${sourceState.system && sourceState.mic ? "+" : ""}${sourceState.mic ? "MIC" : ""}` : "IDLE"}
          </span>
        </GlassButton>

        <input
          type="range"
          min={25}
          max={100}
          value={Math.round(opacity * 100)}
          onChange={(e) => applyOpacity(Number(e.target.value) / 100)}
          title={`HUD opacity ${Math.round(opacity * 100)}%`}
          className={`${NO_DRAG} ml-auto w-16 h-1 appearance-none rounded-full bg-reactor-core/20 accent-reactor-core cursor-pointer`}
        />

        <span
          className={`font-rajdhani text-[9px] tracking-[0.14em] px-2 py-0.5 rounded-full border select-none ${
            protectedOk
              ? "border-accent-green/40 text-accent-green bg-accent-green/10"
              : protection === "off"
              ? "border-accent-red/50 text-accent-red bg-accent-red/10"
              : "border-reactor-core/30 text-text-secondary/70"
          }`}
          title={protectDetail || "Capture exemption state"}
        >
          {protectedOk ? "SAFE" : protection === "off" ? "EXPOSED" : "…"}
        </span>

        {inShell && (
          <GlassIcon onClick={() => window.jarvisOverlay?.close()} title="Close the overlay (Ctrl+Shift+H hides it instead)">
            ✕
          </GlassIcon>
        )}
      </header>

      {/* ── Toolbar: mode, length, style ──────────────────────────────────── */}
      <div className="relative z-10 flex items-center gap-1.5 px-3 py-2">
        <GlassButton size="sm" onClick={() => setSheet((s) => (s === "menu" ? null : "menu"))} active={sheet === "menu"} title="Listening modes (Alt+1..7)">
          {MODE_BY_ID[mode].label} ▾
        </GlassButton>

        <div className={`${NO_DRAG} flex items-center rounded-full border border-white/[0.12] bg-white/[0.05] p-0.5`}>
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setDensity(d.id);
                setStatus(`answer length: ${d.label.toLowerCase()}`);
              }}
              title={`${d.label} — ${d.instruction.slice(0, 90)}…`}
              className={`h-6 px-2 rounded-full font-rajdhani text-[9px] tracking-[0.12em] transition-colors ${
                density === d.id ? "bg-reactor-core/25 text-reactor-core" : "text-text-secondary/60 hover:text-text-primary"
              }`}
            >
              {d.short}
            </button>
          ))}
        </div>

        <GlassButton
          size="sm"
          onClick={() => {
            const order = STYLES.map((s) => s.id);
            const next = order[(order.indexOf(style) + 1) % order.length];
            setStyle(next);
            setStatus(`style: ${STYLE_BY_ID[next].label.toLowerCase()} — ${STYLE_BY_ID[next].tagline.toLowerCase()}`);
          }}
          title={`${styleSpec.tagline} (click to cycle)`}
        >
          {styleSpec.label}
        </GlassButton>

        <div className="ml-auto flex items-center gap-1.5">
          <GlassIcon onClick={() => setSheet((s) => (s === "brain" ? null : "brain"))} title="Context brain — facts, summary, attached notes (Alt+C)" active={sheet === "brain"}>
            ⧉
          </GlassIcon>
          <GlassIcon onClick={() => setSheet((s) => (s === "keys" ? null : "keys"))} title="Keyboard shortcuts (Alt+K)" active={sheet === "keys"}>
            ⌘
          </GlassIcon>
        </div>
      </div>

      {/* ── Sheets ───────────────────────────────────────────────────────── */}
      {sheet === "menu" && (
        <div className="relative z-30 px-3">
          <GlassSheet title="LISTENING MODE" onClose={() => setSheet(null)}>
            {MODES.map((m, i) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  chooseMode(m.id);
                  setSheet(null);
                }}
                className={`${NO_DRAG} w-full flex items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                  mode === m.id ? "border-reactor-core/50 bg-reactor-core/10" : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07]"
                }`}
              >
                <span className="font-orbitron text-[8px] text-text-secondary/40 mt-0.5">Alt+{i + 1}</span>
                <span className="min-w-0">
                  <span className="block font-rajdhani text-[11px] tracking-wide text-text-primary">{m.label}</span>
                  <span className="block font-rajdhani text-[10px] leading-snug text-text-secondary/60">{m.tagline}</span>
                </span>
                {mode === m.id && <span className="ml-auto font-rajdhani text-[9px] text-reactor-core">ACTIVE</span>}
              </button>
            ))}
          </GlassSheet>
        </div>
      )}

      {sheet === "privacy" && (
        <div className="relative z-30 px-3">
          <GlassSheet
            title="PRIVACY & CAPTURE"
            onClose={() => setSheet(null)}
            footer={
              <div className="flex items-center gap-1.5">
                <GlassButton onClick={toggleMute} active={muted} tone={muted ? "danger" : "neutral"} className="flex-1" title="Mute/unmute the ears (Alt+M)">
                  {muted ? "◼ MUTED — tap to unmute" : "● MUTE EVERYTHING"}
                </GlassButton>
                <GlassButton onClick={clearHistory} tone="danger" title="Wipe transcript, answers, facts and summary (Alt+X)">
                  CLEAR HISTORY
                </GlassButton>
              </div>
            }
          >
            <div className={`${GLASS} p-2.5 space-y-1.5`}>
              <div className="font-rajdhani text-[10px] tracking-[0.16em] text-text-secondary/50">CAPTURE RIGHT NOW</div>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${sourceState.system && !muted ? "bg-accent-green" : "bg-white/20"}`} />
                <span className="font-rajdhani text-[10px] text-text-primary/80 w-24">SYSTEM AUDIO</span>
                {sourceState.system && !muted ? <LevelMeter label="" barRef={systemBarRef} dotRef={systemDotRef} /> : <span className="font-rajdhani text-[9px] text-text-secondary/40">off</span>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${sourceState.mic && !muted ? "bg-accent-green" : "bg-white/20"}`} />
                <span className="font-rajdhani text-[10px] text-text-primary/80 w-24">MICROPHONE</span>
                {sourceState.mic && !muted ? <LevelMeter label="" barRef={micBarRef} dotRef={micDotRef} /> : <span className="font-rajdhani text-[9px] text-text-secondary/40">off</span>}
              </div>
              <div className="font-rajdhani text-[9px] leading-snug text-text-secondary/55 pt-1 border-t border-white/[0.06]">
                Silent rounds are dropped on this machine by voice-activity detection ({counts.silent} skipped), so only
                speech is uploaded. Audio goes to Groq Whisper for transcription; questions go to the model chain.
                Nothing is stored on disk by this page. The window itself is{" "}
                <span className={protectedOk ? "text-accent-green" : "text-accent-red"}>
                  {protectedOk ? "exempt from screen capture" : "NOT exempt from screen capture"}
                </span>
                .
              </div>
            </div>

            <div className={`${GLASS} p-2.5`}>
              <div className="font-rajdhani text-[10px] tracking-[0.16em] text-text-secondary/50 mb-1.5">THIS SESSION</div>
              <div className="grid grid-cols-2 gap-1.5 font-rajdhani text-[10px] text-text-secondary/70">
                <span>rounds with speech</span>
                <span className="text-right text-text-primary/85">{counts.heard}</span>
                <span>silent rounds skipped</span>
                <span className="text-right text-text-primary/85">{counts.silent}</span>
                <span>noise filtered out</span>
                <span className="text-right text-text-primary/85">{counts.filtered}</span>
                <span>failed uploads</span>
                <span className="text-right text-text-primary/85">{counts.failed}</span>
                <span>chunks dropped (backlog)</span>
                <span className="text-right text-text-primary/85">{counts.dropped}</span>
                <span>facts remembered</span>
                <span className="text-right text-text-primary/85">{facts.length}</span>
              </div>
            </div>

            <div className={`${GLASS} p-2.5 space-y-1.5`}>
              <div className="font-rajdhani text-[10px] tracking-[0.16em] text-text-secondary/50">WHEN IT SPEAKS UP ON ITS OWN</div>
              {TRIGGER_ORDER.map((kind) => (
                <div key={kind} className="flex items-center gap-2">
                  <span className="font-rajdhani text-[10px] text-text-primary/80 w-28" title={TRIGGER_META[kind].blurb}>
                    {TRIGGER_META[kind].label}
                  </span>
                  <div className={`${NO_DRAG} flex items-center rounded-full border border-white/[0.12] bg-white/[0.05] p-0.5 ml-auto`}>
                    {(["off", "prep", "auto"] as const).map((action) => (
                      <button
                        key={action}
                        type="button"
                        onClick={() => setTriggers((t) => ({ ...t, [kind]: action }))}
                        title={
                          action === "off"
                            ? "Ignore this kind completely"
                            : action === "prep"
                            ? "Prepare the answer quietly; show a chip, answer when clicked"
                            : "Answer immediately"
                        }
                        className={`h-5 px-1.5 rounded-full font-rajdhani text-[9px] tracking-[0.1em] transition-colors ${
                          triggers[kind] === action ? "bg-reactor-core/25 text-reactor-core" : "text-text-secondary/50 hover:text-text-primary"
                        }`}
                      >
                        {action.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="font-rajdhani text-[9px] leading-snug text-text-secondary/45 pt-1 border-t border-white/[0.06]">
                PREP is the useful middle: the answer is written before you click, so SHOW is instant, but nothing
                interrupts until you ask for it.
              </div>
            </div>
          </GlassSheet>
        </div>
      )}

      {sheet === "brain" && (
        <div className="relative z-30 px-3">
          <GlassSheet
            title="CONTEXT BRAIN"
            onClose={() => setSheet(null)}
            footer={
              <GlassButton onClick={clearHistory} tone="danger" title="Forget everything (Alt+X)">
                FORGET EVERYTHING
              </GlassButton>
            }
          >
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Attached to every question: your CV, the job description, the product brief, notes…"
              className={`${NO_DRAG} w-full h-24 resize-none rounded-xl border border-white/[0.12] bg-black/25 px-3 py-2 font-rajdhani text-[11px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-reactor-core/50`}
            />
            <div className={`${GLASS} p-2.5`}>
              <div className="font-rajdhani text-[10px] tracking-[0.16em] text-text-secondary/50 mb-1">CURRENT TOPIC</div>
              <div className="font-rajdhani text-[11px] text-text-primary/85">{topic || "— nothing yet —"}</div>
            </div>
            <div className={`${GLASS} p-2.5`}>
              <div className="font-rajdhani text-[10px] tracking-[0.16em] text-text-secondary/50 mb-1">FACTS IT REMEMBERS</div>
              {facts.length ? (
                <ul className="space-y-1">
                  {facts.map((f, i) => (
                    <li key={i} className="font-rajdhani text-[10px] leading-snug text-text-primary/80 flex gap-1.5">
                      <span className="text-reactor-core/60">•</span>
                      {f}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="font-rajdhani text-[10px] text-text-secondary/40">
                  Learned automatically as the conversation goes — names, numbers, roles, decisions.
                </div>
              )}
            </div>
            <div className={`${GLASS} p-2.5`}>
              <div className="font-rajdhani text-[10px] tracking-[0.16em] text-text-secondary/50 mb-1">ROLLING SUMMARY</div>
              <div className="font-rajdhani text-[10px] leading-snug text-text-primary/80 whitespace-pre-wrap">
                {summary || "— the older part of the conversation will be compacted in here —"}
              </div>
            </div>
            <div className={`${GLASS} p-2.5`}>
              <div className="font-rajdhani text-[10px] tracking-[0.16em] text-text-secondary/50 mb-1">
                TRANSCRIPT SENT TO THE MODEL ({rollingWindow(turns).length} of {turns.length} turns)
              </div>
              <div className="font-rajdhani text-[10px] leading-snug text-text-secondary/60 max-h-28 overflow-y-auto">
                {rollingWindow(turns).length ? (
                  rollingWindow(turns).map((t) => (
                    <div key={t.id}>
                      <span className="text-reactor-core/60">{t.role === "them" ? "THEM" : "YOU"}:</span> {t.text}
                    </div>
                  ))
                ) : (
                  <span className="text-text-secondary/40">nothing heard yet</span>
                )}
              </div>
            </div>
          </GlassSheet>
        </div>
      )}

      {sheet === "keys" && (
        <div className="relative z-30 px-3">
          <GlassSheet title="KEYBOARD" onClose={() => setSheet(null)}>
            <div className="font-rajdhani text-[9px] leading-snug text-text-secondary/50">
              The Ctrl+Shift+… shortcuts are registered by the overlay window itself, so they work while the call app
              has focus. The Alt+… ones work when the overlay is focused. Anything else you type goes straight into
              the ask box.
            </div>
            {SHORTCUTS.map((s) => (
              <div key={s.id} className="flex items-start gap-2">
                <span className="font-mono text-[9px] text-reactor-core/85 w-[6.6rem] shrink-0 pt-0.5">{s.shell || s.inPage}</span>
                <span className="min-w-0">
                  <span className="block font-rajdhani text-[10px] text-text-primary/85">{s.label}</span>
                  <span className="block font-rajdhani text-[9px] leading-snug text-text-secondary/50">{s.detail}</span>
                </span>
              </div>
            ))}
            <div className="font-rajdhani text-[9px] leading-snug text-text-secondary/50 pt-1 border-t border-white/[0.06]">
              In-window equivalents: Esc hide · Alt+L listen · Alt+M mute · Alt+A answer now · Alt+R repeat · Alt+E
              deeper · Alt+S summary · Alt+D length · Alt+P privacy · Alt+C context · Alt+K this list · Alt+X forget ·
              Alt+1..7 mode.
            </div>
          </GlassSheet>
        </div>
      )}

      {/* ── Answer stage ─────────────────────────────────────────────────── */}
      <div className="relative z-0 flex-1 min-h-0 px-3 pb-2">
        <div className={`${GLASS} ${GLASS_SHEEN} h-full flex flex-col overflow-hidden`}>
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
            <span className="w-1 h-1 rounded-full bg-reactor-core glow-text" />
            <span className="font-orbitron text-[8px] tracking-[0.28em] text-reactor-core/80">
              {busy ? "ANSWER · STREAMING" : current?.question === "Summary of this conversation" ? "SUMMARY" : "ANSWER"}
            </span>
            {liveConfidence && !busy && (
              <span className={`font-rajdhani text-[8px] tracking-[0.12em] px-1.5 py-0.5 rounded-full border ${liveConfidence.cls}`} title={current?.missing?.length ? `Not known: ${current.missing.join("; ")}` : "How sure the model is"}>
                {liveConfidence.label}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1">
              {latency && (
                <span className="font-rajdhani text-[8px] text-text-secondary/40" title="Time to the first word of the answer">
                  {latency.ms}ms
                </span>
              )}
              {busy ? (
                <span className="flex gap-1 pr-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="w-1 h-1 rounded-full bg-reactor-core animate-ping" style={{ animationDelay: `${i * 200}ms` }} />
                  ))}
                </span>
              ) : current?.answer ? (
                <>
                  <GlassButton size="xs" onClick={() => current && deepen(current)} title="Expand into the deep version (Alt+E)">
                    DEEPER
                  </GlassButton>
                  <GlassButton size="xs" onClick={repeatLast} title="Re-answer the last question, shorter (Alt+R)">
                    REPEAT
                  </GlassButton>
                  <GlassButton size="xs" onClick={() => current && void copyText("all", current.answer)} title="Copy the whole answer">
                    {copied === "all" ? "COPIED" : "COPY"}
                  </GlassButton>
                </>
              ) : null}
            </div>
          </div>

          <div ref={answerRef} className="flex-1 min-h-0 overflow-y-auto px-3.5 pb-3 overscroll-contain">
            {current?.answer ? (
              <AnswerBody
                text={current.answer}
                id={current.id}
                streaming={liveId === current.id}
                copied={copied}
                onCopy={copyText}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
                <div className="w-11 h-11 rounded-full border border-reactor-core/25 flex items-center justify-center">
                  <div className="w-4 h-4 rounded-full bg-reactor-core/25 animate-pulse" />
                </div>
                <p className="text-text-secondary/60 text-[11px] leading-relaxed">
                  {busy
                    ? "Working on it…"
                    : listening
                    ? "Listening. A question you are asked gets answered here; anything else waits as a suggestion."
                    : "Press LISTEN to follow the call, or type a question below."}
                </p>
              </div>
            )}

            {/* Everything older: kept, dimmed, one click away. */}
            {stale.length > 0 && (
              <div className="mt-3 space-y-1.5 border-t border-white/[0.07] pt-2">
                <div className="font-rajdhani text-[9px] tracking-[0.18em] text-text-secondary/40">EARLIER</div>
                {stale.map((ex) => {
                  const open = !!openStale[ex.id];
                  return (
                    <div key={ex.id} className="rounded-xl border border-white/[0.07] bg-white/[0.025] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenStale((m) => ({ ...m, [ex.id]: !m[ex.id] }))}
                        className={`${NO_DRAG} w-full flex items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-white/[0.05]`}
                      >
                        <span className="font-rajdhani text-[10px] text-text-secondary/70 truncate flex-1">{ex.question}</span>
                        {ex.partial && <span className="font-rajdhani text-[8px] text-accent-amber/80 border border-accent-amber/40 rounded-full px-1.5">CUT OFF</span>}
                        {ex.repeated && <span className="font-rajdhani text-[8px] text-reactor-core/70 border border-reactor-core/30 rounded-full px-1.5">REPEAT</span>}
                        <span className="font-rajdhani text-[8px] text-text-secondary/40 border border-white/10 rounded-full px-1.5 uppercase">
                          {ex.staleReason || "older"}
                        </span>
                        <span className="font-rajdhani text-[9px] text-text-secondary/40">{open ? "▴" : "▾"}</span>
                      </button>
                      {open && (
                        <div className="px-2.5 pb-2">
                          <AnswerBody text={ex.answer} id={ex.id} streaming={false} copied={copied} onCopy={copyText} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Prepared suggestions ─────────────────────────────────────────── */}
      {activePrep.length > 0 && (
        <div className="relative z-10 px-3 pb-1.5 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {activePrep.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => showPrep(p)}
              title={`${p.reason} — click to show the answer${p.status === "loading" ? " (still being prepared)" : ""}`}
              className={`${NO_DRAG} shrink-0 flex items-center gap-1.5 max-w-[70%] h-7 px-2.5 rounded-full border font-rajdhani text-[10px] transition-colors ${
                p.status === "ready"
                  ? "border-accent-green/40 bg-accent-green/10 text-accent-green/90 hover:bg-accent-green/20"
                  : "border-white/[0.12] bg-white/[0.05] text-text-secondary/70"
              }`}
            >
              <span className="tracking-[0.14em] text-[8px] opacity-70">{TRIGGER_META[p.kind].label}</span>
              <span className="truncate">{p.text.replace(/^Explain "?|"? in this context$/g, "") || p.text}</span>
              <span className="ml-1 text-[8px] tracking-[0.14em]">{p.status === "ready" ? "SHOW" : "…"}</span>
            </button>
          ))}
          <GlassIcon onClick={() => setPrep([])} title="Dismiss these suggestions">
            ✕
          </GlassIcon>
        </div>
      )}

      {/* ── Transcript ───────────────────────────────────────────────────── */}
      <div className="relative z-10 px-3 pb-1.5">
        <div ref={transcriptRef} className={`${GLASS} h-[64px] overflow-y-auto px-2.5 py-1.5 space-y-0.5`}>
          {turns.length ? (
            turns.slice(-9).map((t) => (
              <div key={t.id} className="font-rajdhani text-[10px] leading-snug text-text-secondary/75">
                <span className={`mr-1.5 ${t.role === "you" ? "text-accent-green/70" : "text-reactor-core/55"}`}>
                  {t.via === "typed" ? "YOU (typed)" : speakerLabel(t.via ?? "system")}
                </span>
                {t.text}
              </div>
            ))
          ) : (
            <div className="font-rajdhani text-[10px] text-text-secondary/35">
              {listening ? (muted ? "muted — nothing is being captured" : "listening… speech appears here") : "transcript idle"}
            </div>
          )}
        </div>
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/[0.08] bg-black/25 backdrop-blur-xl px-3 pt-2 pb-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <GlassButton
            onClick={toggleListen}
            active={listening}
            tone={listening ? "success" : "neutral"}
            className="flex-1"
            title={listening ? "Stop listening (Alt+L)" : "Follow the call — system audio plus your mic (Alt+L)"}
          >
            {listening ? `◼ STOP · ${sourceState.system ? (sourceState.mic ? "SYS+MIC" : "SYS") : "MIC"}` : "◉ LISTEN"}
          </GlassButton>

          <GlassButton onClick={toggleMute} active={muted} tone={muted ? "danger" : "neutral"} disabled={!listening} title="Mute the ears — nothing is captured while muted (Alt+M)">
            {muted ? "UNMUTE" : "MUTE"}
          </GlassButton>

          <GlassButton onClick={() => void summarize()} disabled={busy || (!turns.length && !exchanges.length)} title="What was decided, owned and left open (Alt+S)">
            SUMMARY
          </GlassButton>

          <GlassButton onClick={clearPane} disabled={!exchanges.length && !question} title="Clear the answers on screen — the transcript and memory stay (Alt+X forgets everything)">
            CLEAR
          </GlassButton>
        </div>

        <form
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            const q = question.trim();
            if (!q) return;
            setQuestion("");
            setTurns((prev) => [...prev, { id: uid("t"), role: "you", text: q, at: Date.now(), via: "typed" }]);
            void runAsk({ question: q });
          }}
          className="flex items-center gap-1.5"
        >
          <input
            ref={questionInput}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything — a question, code, an explanation…"
            autoFocus
            className={`${NO_DRAG} flex-1 h-9 rounded-full border border-white/[0.12] bg-white/[0.05] px-3.5 font-rajdhani text-[12px] text-text-primary placeholder:text-text-secondary/30 focus:outline-none focus:border-reactor-core/50`}
          />
          <GlassButton type="submit" active disabled={busy} title="Send (Enter, or Ctrl+Shift+Space from anywhere)">
            {busy ? "…" : "ASK"}
          </GlassButton>
        </form>

        <div className="flex items-center gap-2 px-1">
          <span className="font-rajdhani text-[9px] text-text-secondary/55 tracking-wide truncate flex-1">{status}</span>
          {listening && (
            <span className="font-rajdhani text-[9px] text-text-secondary/35 shrink-0" title="Rounds with speech · silent rounds skipped by VAD · chunks dropped under backlog">
              {counts.heard} heard · {counts.silent} silent · {counts.dropped} dropped
            </span>
          )}
          {!protectedOk && protection === "off" && (
            <span className="font-rajdhani text-[9px] text-accent-red/80 shrink-0">not capture-safe</span>
          )}
        </div>
      </footer>

      {/* ── Resize handles ─────────────────────────────────────────────── */}
      {/* All eight edges and corners, so the HUD can be taken to any size from
          whichever side is convenient. Drag one to resize; double-click it for
          the default size. Only inside the shell — in a browser tab the window
          belongs to the browser. */}
      {inShell &&
        RESIZE_HANDLES.map((h) => (
          <div
            key={h.dir}
            onPointerDown={(e) => startResize(e, h.dir)}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onDoubleClick={resetSize}
            title={`${h.label} — double-click for the default size`}
            aria-label={h.label}
            className={`${NO_DRAG} fixed z-40 touch-none select-none ${h.className} ${h.cursor} ${
              resizing === h.dir ? "bg-reactor-core/30" : "bg-transparent hover:bg-reactor-core/20"
            } transition-colors`}
          >
            {h.dir === "se" && (
              <svg
                viewBox="0 0 10 10"
                className={`absolute bottom-[3px] right-[3px] w-3 h-3 text-text-secondary transition-opacity ${
                  resizing ? "opacity-100" : "opacity-45 hover:opacity-90"
                }`}
                aria-hidden
              >
                <path d="M9 1 L1 9 M9 5 L5 9 M9 9 L9 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
              </svg>
            )}
          </div>
        ))}
    </div>
  );
}

/** Prose and code, with a per-block copy button. Shared by the live answer and
 * by the older (stale) answers so they read identically. */
function AnswerBody({
  text,
  id,
  streaming,
  copied,
  onCopy,
}: {
  text: string;
  id: string;
  streaming: boolean;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  return (
    <div className="space-y-2">
      {splitFences(text).map((seg, i) =>
        seg.kind === "code" ? (
          <div key={i} className="rounded-xl border border-reactor-core/25 bg-black/45 overflow-hidden">
            <div className="flex items-center gap-2 px-2.5 py-1 border-b border-white/5">
              <span className="font-orbitron text-[8px] tracking-[0.22em] text-reactor-core/70">
                {seg.lang ? seg.lang.toUpperCase() : "CODE"}
              </span>
              <button
                type="button"
                onClick={() => onCopy(`${id}-code-${i}`, seg.content)}
                title="Copy this block"
                className={`${NO_DRAG} ml-auto font-rajdhani text-[9px] tracking-[0.14em] text-text-secondary/60 hover:text-reactor-core transition-colors`}
              >
                {copied === `${id}-code-${i}` ? "COPIED" : "COPY"}
              </button>
            </div>
            <pre className="px-3 py-2.5 overflow-x-auto text-[12px] leading-relaxed text-text-primary/95 font-mono">
              <code>{seg.content}</code>
            </pre>
          </div>
        ) : (
          <p key={i} className="whitespace-pre-wrap text-[14px] leading-relaxed text-text-primary/95">
            {seg.content}
            {streaming && i === splitFences(text).length - 1 && (
              <span className="inline-block w-[6px] h-[14px] ml-0.5 align-middle bg-reactor-core/70 animate-pulse" />
            )}
          </p>
        )
      )}
    </div>
  );
}
