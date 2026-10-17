// Turns a BLINK CLICK into a labelled training sample for the gaze map.
//
// ─── Why a click is the best label the app ever gets ──────────────────────
// Eye control is unsupervised almost everywhere: the app sees a raw iris
// signal and has no idea where on the screen the user was really looking, so
// the calibration-free map can be systematically wrong (offset, gain) and
// nobody can tell. A blink click is different. Clicking MEANS "activate the
// thing I am looking at", so the user just told us, for free and without any
// 17-dot ritual, the screen point their gaze corresponded to. That pair —
// (raw signal at the click, screen point the user aimed at) — is a supervised
// example, and the same pair is exactly what `GazeAdapter` needs to correct the
// map's residual error.
//
// ─── The inference, stated honestly ───────────────────────────────────────
// The click lands where the CURSOR was, not where the eye was: the whole point
// is that those differ by the map error. So the label is not the click point,
// it is the control the user was aiming at:
//
//   • click INSIDE a control  → label = that control's centre. Solid, if the
//     control is small; a 40%-of-screen link centre says nothing about where in
//     it the eye was, so the weight falls off with the control's size.
//   • click on empty space with a control NEARBY → label = the nearest point of
//     that control, at a reduced weight scaled by how far the click missed.
//     This is the "I blinked at the button and nothing happened" case, and its
//     residual (click point − control) is a direct measurement of the map error
//     at this gaze.
//   • click on empty space with nothing near → NO lesson. A blink at a blank
//     area is not evidence about anything, and the learner can never un-learn a
//     poisoned sample (the envelope/correction is deliberately monotone), so
//     refusing to guess is a feature.
//
// Everything here is pure geometry over plain rectangles, so the rules are
// testable without a browser or a camera.

export interface ScreenTarget {
  /** Stable identity, for diagnostics. */
  label: string;
  /** Centre, screen fractions 0..1. */
  x: number;
  y: number;
  /** Size, screen fractions 0..1. */
  width: number;
  height: number;
  /** True for elements that actually do something when clicked. */
  interactive: boolean;
}

export interface ClickContext {
  /** Where the cursor was when the blink fired, screen fractions 0..1. */
  point: { x: number; y: number };
  /** Candidate elements near the click (screen fractions). */
  targets: ScreenTarget[];
  /** Did the click visibly change the page? Undefined when unknown. */
  changed?: boolean;
}

export type ClickLessonKind = "direct" | "near-miss";

export interface ClickLesson {
  kind: ClickLessonKind;
  /** Screen point the user demonstrably meant, 0..1. */
  x: number;
  y: number;
  /** How much to believe this label, 0..1. Scales the learner's step. */
  weight: number;
  /** Why, in one line — shown in the HUD and logged with the sample. */
  reason: string;
}

/** A click within this distance of a control counts as aimed at it. */
export const MISS_RADIUS = 0.12;
/**
 * Outer bound of the discounted tier.
 *
 * A badly-wrong map is precisely when the user most needs learning to happen,
 * and with a 12%-of-screen error every blink at a corner control falls outside
 * the confident radius. So a control within FAR_RADIUS still gives a label, at
 * a fraction of the weight: it might be the wrong control, and while the fit
 * averages such noise out, one bogus label must never steer the map. Beyond
 * this the click teaches nothing at all.
 */
export const FAR_RADIUS = 0.25;
/** Weight multiplier for the discounted tier. */
export const FAR_WEIGHT = 0.25;
/** Controls wider/taller than this give no positional information. */
export const USEFUL_SIZE = 0.25;
/** Weight of an inferred (nearest-control) label vs a direct hit. */
export const MISS_WEIGHT = 0.7;

/** Distance from `p` to the nearest point of the rect (0 when inside). */
function rectDistance(t: ScreenTarget, p: { x: number; y: number }): number {
  const hw = t.width / 2;
  const hh = t.height / 2;
  const dx = Math.max(t.x - hw - p.x, 0, p.x - (t.x + hw));
  const dy = Math.max(t.y - hh - p.y, 0, p.y - (t.y + hh));
  return Math.hypot(dx, dy);
}

/** Just the part of a DOMRect this module needs (so it is testable). */
export interface RectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One candidate control as read off the page. */
export interface CandidateElement {
  label: string;
  rect: RectLike;
}

/**
 * Map page elements to the target list the resolver works in.
 *
 * Kept pure — it takes rectangles and a viewport rather than touching the DOM
 * — because this is where a label's geometry comes from: get it wrong (wrong
 * fractions, a zero-size rect, a control counted twice because it is 300px
 * away) and every lesson learned afterwards is quietly biased.
 */
export function screenTargetsFrom(
  elements: CandidateElement[],
  viewport: { width: number; height: number },
  point: { x: number; y: number },
  radius = FAR_RADIUS,
  limit = 500
): ScreenTarget[] {
  const vw = viewport.width > 0 ? viewport.width : 1;
  const vh = viewport.height > 0 ? viewport.height : 1;
  const out: ScreenTarget[] = [];
  for (const el of elements.slice(0, limit)) {
    const r = el.rect;
    if (!r || r.width < 2 || r.height < 2) continue; // invisible / degenerate
    const x = (r.left + r.width / 2) / vw;
    const y = (r.top + r.height / 2) / vh;
    const dx = Math.max(0, Math.abs(point.x - x) - r.width / 2 / vw);
    const dy = Math.max(0, Math.abs(point.y - y) - r.height / 2 / vh);
    if (Math.hypot(dx, dy) > radius) continue;
    out.push({
      label: el.label.replace(/\s+/g, " ").trim().slice(0, 40) || "control",
      x,
      y,
      width: r.width / vw,
      height: r.height / vh,
      interactive: true,
    });
  }
  return out;
}

/** Area in screen fractions² — used to prefer the more specific control. */
function area(t: ScreenTarget): number {
  return Math.max(0, t.width) * Math.max(0, t.height);
}

/**
 * Weight for a label taken from a control's centre: a small control pins the
 * user's eye tightly, a huge one barely constrains it.
 */
function sizeWeight(t: ScreenTarget): number {
  const span = Math.max(t.width, t.height);
  if (span >= USEFUL_SIZE) return 0.15;
  return Math.max(0.25, Math.min(1, 0.06 / Math.max(span, 0.02)));
}

/**
 * Resolve what a blink click teaches, or null when it teaches nothing.
 *
 * @param ctx cursor point, nearby controls, optional change verdict
 * @returns the labelled screen point + how much to trust it
 */
export function resolveClickLesson(ctx: ClickContext): ClickLesson | null {
  const { point } = ctx;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const controls = (ctx.targets ?? []).filter(
    (t) =>
      t.interactive &&
      [t.x, t.y, t.width, t.height].every((n) => Number.isFinite(n)) &&
      t.width > 0 &&
      t.height > 0
  );

  // ── Direct hit: the click landed on a control ──────────────────────────
  const inside = controls.filter((t) => rectDistance(t, point) === 0);
  if (inside.length > 0) {
    // Prefer the most specific (smallest) control the click landed in: nesting
    // is normal in real UIs (a span inside a button inside a card).
    const target = inside.reduce((best, t) => (area(t) < area(best) ? t : best));
    const weight = sizeWeight(target);
    // A big control proves the pupil was somewhere in it, nothing more.
    if (weight <= 0.2) return null;
    return {
      kind: "direct",
      x: target.x,
      y: target.y,
      weight,
      reason: `blink click inside "${target.label}"`,
    };
  }

  // ── Near miss: nothing under the cursor, but a control is close by ─────
  const near = controls
    .map((t) => ({ t, d: rectDistance(t, point) }))
    .filter((c) => c.d <= FAR_RADIUS)
    .sort((a, b) => a.d - b.d || area(a.t) - area(b.t));
  if (near.length === 0) return null;

  const { t: target, d } = near[0];
  const confident = d <= MISS_RADIUS;
  // Closeness scales the belief: 1 at the edge of the control, falling to half
  // at the outer limit of the confident radius; the discounted tier is a
  // fraction of that again.
  const closeness = 1 - Math.min(1, d / MISS_RADIUS);
  const weight =
    MISS_WEIGHT * (0.5 + 0.5 * closeness) * sizeWeight(target) * (confident ? 1 : FAR_WEIGHT);
  if (!(weight > 0.05)) return null;

  // The label is the CONTROL'S CENTRE — not the point of it nearest the click.
  // Using the nearest edge would take the cursor's own error and write it into
  // the label: the user was looking at the control, and the click landed where
  // the (wrong) map said they were looking. Labelling the centre keeps the
  // residual a clean measurement of the map's error, which is the only thing
  // worth learning from. The label's remaining noise is half the control's
  // size, which is what sizeWeight already discounts.
  return {
    kind: "near-miss",
    x: target.x,
    y: target.y,
    weight,
    reason: confident
      ? `blink click missed "${target.label}" by ${(d * 100).toFixed(1)}% of the screen`
      : `blink click missed "${target.label}" by ${(d * 100).toFixed(1)}% — map still far off, learning from it anyway`,
  };
}
