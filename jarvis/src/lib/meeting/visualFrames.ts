// Pure helpers for the meeting bot's visual capture pipeline.
//
// WHY THIS EXISTS
// The bot transcribed meetings but threw away everything that was *shown*: when
// a lecturer put a circuit diagram, a chart or a worked equation on the shared
// screen, the summary had no trace of it. Capturing frames is easy; the hard
// parts are (a) noticing that the presented content actually changed instead of
// storing 200 near-identical snapshots, (b) knowing which captured frames are
// worth keeping, and (c) telling the summariser what they show.
//
// Everything here is deliberately pure — buffers and numbers in, decisions out —
// so the capture engine's judgement calls are unit-testable without a browser.
//
//   • fingerprints — a 16x16 grayscale thumbnail of the presented element,
//     computed in-page via canvas. Distance = mean absolute luminance delta.
//     Robust to cursor blinks and video noise, which a byte-compare is not:
//     PNG/deflate byte streams shift completely on a single changed pixel.
//   • byte diff ratio — the fallback for when a fingerprint can't be taken
//     (no <video>/<canvas> to sample, or a tainted canvas).
//   • caption context — the transcript lines around a capture, so a visual can
//     say who was talking when the diagram appeared.

export const FINGERPRINT_GRID_SIZE = 16;
/** Mean per-cell luminance delta below this = same slide, skip the frame. */
export const DEFAULT_VISUAL_DUPLICATE_THRESHOLD = 6;
/** Shared-bytes delta ratio above which two frames count as different (fallback path). */
export const DEFAULT_BYTE_DIFF_RATIO = 0.02;
/** Public URL prefix — files live in `jarvis/public/meeting-captures/<session>/`. */
export const MEETING_CAPTURE_ROUTE = "meeting-captures";

export interface FrameRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptionLike {
  speaker?: string;
  text: string;
  timestamp: string;
}

/** One screenshot captured while the bot was in a meeting. */
export interface CapturedVisual {
  id: string;
  frameIndex: number;
  sessionId: string;
  filePath: string;
  imageUrl: string;
  timestamp: string;
  clock: string;
  /** Element the frame was cropped from: `video` (screen share) or `canvas`. */
  source: string;
  width: number;
  height: number;
  bytes: number;
  /** Transcript lines around the capture, used as context for the vision pass. */
  captionContext: string;
}

/** A visual that survived the vision pass and is attached to the summary. */
export interface MeetingVisual {
  id: string;
  clock: string;
  timestamp: string;
  /** diagram | equation | chart | table | code | slide | text | other */
  type: string;
  title: string;
  description: string;
  /** Verbatim text/equations read off the image, when the model returned any. */
  textOnScreen?: string;
  imageUrl: string;
  imagePath: string;
  transcriptContext?: string;
  width?: number;
  height?: number;
}

export function visualFileName(frameIndex: number): string {
  return `frame-${String(frameIndex).padStart(3, "0")}.png`;
}

export function visualImageUrl(sessionId: string, frameIndex: number): string {
  return `/${MEETING_CAPTURE_ROUTE}/${sessionId}/${visualFileName(frameIndex)}`;
}

/** `14:32:07` in the machine's local time — what the summary/panel shows. */
export function visualClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString([], { hour12: false });
}

/**
 * Mean absolute difference between two fingerprints, on the 0–255 luminance
 * scale. Returns `Number.POSITIVE_INFINITY` when the grids aren't comparable,
 * so a malformed fingerprint is never mistaken for "same slide".
 */
export function fingerprintDistance(a: number[] | null, b: number[] | null): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return Number.POSITIVE_INFINITY;
    sum += Math.abs(av - bv);
  }
  return sum / a.length;
}

/** True when the new frame shows something meaningfully different from the last kept one. */
export function isDistinctFingerprint(
  previous: number[] | null,
  next: number[] | null,
  threshold: number = DEFAULT_VISUAL_DUPLICATE_THRESHOLD
): boolean {
  if (!previous) return true; // first frame of the session is always kept
  return fingerprintDistance(previous, next) >= threshold;
}

/**
 * Fraction of sampled bytes that differ between two encoded frames. Sampled (not
 * full) comparison keeps this O(2048) on a multi-hundred-KB PNG.
 */
export function byteDiffRatio(a: Uint8Array | null, b: Uint8Array | null, samples = 2048): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 1;
  const n = Math.min(samples, a.length, b.length);
  if (n === 0) return 1;
  let diff = 0;
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i * (a.length - 1)) / Math.max(1, n - 1));
    if (a[idx] !== b[idx]) diff++;
  }
  return diff / n;
}

/** Fallback dedupe for frames with no fingerprint available. */
export function isDistinctFrameBytes(
  previous: Uint8Array | null,
  next: Uint8Array | null,
  maxRatio: number = DEFAULT_BYTE_DIFF_RATIO
): boolean {
  if (!previous) return true;
  return byteDiffRatio(previous, next) > maxRatio;
}

/**
 * Clip a captured element rect to the visible viewport. Playwright rejects a
 * screenshot clip that leaves the page, and a share stage can be dragged
 * partially off-screen.
 */
export function clampRegionToViewport(
  region: FrameRegion | null,
  viewport: { width: number; height: number }
): FrameRegion | null {
  if (!region) return null;
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const right = Math.min(viewport.width, Math.ceil(region.x + region.width));
  const bottom = Math.min(viewport.height, Math.ceil(region.y + region.height));
  const width = right - x;
  const height = bottom - y;
  // Anything smaller than a postage stamp isn't presented content.
  if (width < 160 || height < 120) return null;
  return { x, y, width, height };
}

/** Transcript lines within `windowMs` of a capture, newest last. */
export function visualCaptionContext(
  entries: CaptionLike[],
  atIso: string,
  windowMs = 20_000
): string {
  const at = new Date(atIso).getTime();
  if (Number.isNaN(at)) return "";
  const recent = entries
    .filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return Number.isFinite(t) && at - t <= windowMs && at - t >= -2_000;
    })
    .slice(-4)
    .map((e) => `${e.speaker || "Speaker"}: ${e.text}`);
  return recent.join(" | ").slice(0, 600);
}

/** Evenly spread a longer list down to `max` items, keeping first and last. */
export function sampleEvenly<T>(items: T[], max: number): T[] {
  if (max <= 0) return [];
  if (items.length <= max) return [...items];
  if (max === 1) return [items[0]];
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  }
  return out;
}

/**
 * The block of text handed to the summariser so it can point at the diagrams
 * ("see Visual #2") instead of describing the meeting as if nothing was shown.
 */
export function buildVisualPromptIndex(
  visuals: Array<Pick<MeetingVisual, "id" | "clock" | "type" | "title" | "description" | "transcriptContext">>
): string {
  if (visuals.length === 0) return "";
  const lines = visuals.map((v, i) => {
    const context = v.transcriptContext ? ` | said around then: ${v.transcriptContext}` : "";
    const description = v.description ? ` — ${v.description}` : "";
    return `${i + 1}. [${v.clock}] (${v.type}) ${v.title}${description}${context}`;
  });
  return [
    "VISUALS CAPTURED FROM THE SHARED SCREEN (screenshots of slides, diagrams, equations, charts):",
    ...lines,
    "Reference them in the summary text as (see Visual #1), (see Visual #2)… whenever they are relevant — especially for diagrams, figures and worked numerical problems.",
  ].join("\n");
}

/**
 * Pull the first JSON object/array out of a model reply. Vision models like to
 * wrap JSON in commentary or ```json fences even when told not to.
 */
export function extractJsonObject<T>(raw: string): T | null {
  if (!raw) return null;
  const cleaned = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const attempts = [raw, cleaned];
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) attempts.push(objectMatch[0]);
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const VISUAL_TYPE_LABELS: Record<string, string> = {
  diagram: "Diagram",
  equation: "Equation",
  chart: "Chart",
  table: "Table",
  code: "Code",
  slide: "Slide",
  text: "Text",
  people: "People",
  other: "Visual",
  capture: "Captured frame",
};

export function visualTypeLabel(type: string): string {
  return VISUAL_TYPE_LABELS[type] || VISUAL_TYPE_LABELS.other;
}
