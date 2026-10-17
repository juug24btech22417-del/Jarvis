// Eye control that learns from use: blink clicks (and the rest of the
// interaction stream) become supervised labels, and the map converges on the
// user's real gaze geometry.
//
// Two things are being pinned here:
//
//   1. INTENT — a blink click is an unsupervised sensor reading plus one clear
//      statement from the user ("activate what I am looking at"). Resolving
//      that into a labelled screen point is pure geometry, and getting it
//      wrong is what poisons a learner that can't un-learn. So: a hit labels
//      the control the user clicked; a miss labels the control they nearly
//      hit; a click on empty space labels NOTHING.
//
//   2. CONVERGENCE — the calibration-free map is systematically off (the
//      measured envelope floors the gain, and asymmetric exploration shifts the
//      origin), which is what "it doesn't go where I look" is. The learner
//      models that error as an affine function of the raw eye signal, so a
//      couple of dozen blink clicks should take the end-to-end error from
//      double digits down to ~1-2% of the screen. The numbers below are the
//      honest ones for a 30fps webcam iris estimate: this is "pitch perfect
//      for eye control", not sub-pixel.
//
// Run with:  npx tsx tests/gazeClickLearning.test.ts

import { GazeAdapter } from "../src/lib/gazeAdapt";
import {
  FAR_RADIUS,
  MISS_RADIUS,
  resolveClickLesson,
  screenTargetsFrom,
  type ScreenTarget,
} from "../src/lib/gazeClickLesson";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const button = (label: string, x: number, y: number, w = 0.06, h = 0.04): ScreenTarget => ({
  label,
  x,
  y,
  width: w,
  height: h,
  interactive: true,
});

// ─────────────────────────────────────────────────────────────────────────
section("A blink click resolves to the control the user meant");

const wide = button("hero panel", 0.5, 0.5, 0.6, 0.5);
const label = button("Save", 0.4, 0.5);

const hit = resolveClickLesson({ point: { x: 0.401, y: 0.501 }, targets: [label] });
check("a click inside a control is a direct label", hit?.kind === "direct", JSON.stringify(hit));
check("and the label is the control, not the click point", !!hit && Math.abs(hit.x - 0.4) < 1e-9);
check("a small control is a strong label", !!hit && hit.weight > 0.6, `weight=${hit?.weight}`);
check(
  "the lesson explains itself for the HUD",
  !!hit && /\bSave\b/.test(hit.reason),
  hit?.reason
);

const nested = resolveClickLesson({
  point: { x: 0.401, y: 0.501 },
  targets: [wide, label],
});
check(
  "with nested controls the most specific one wins",
  !!nested && nested.x === label.x,
  `labelled x=${nested?.x}`
);

const huge = resolveClickLesson({ point: { x: 0.5, y: 0.5 }, targets: [wide] });
check(
  "a control too big to constrain the eye teaches nothing",
  huge === null,
  `got ${JSON.stringify(huge)}`
);

const missed = resolveClickLesson({ point: { x: 0.34, y: 0.5 }, targets: [label] });
check("a click near a control is a near-miss lesson", missed?.kind === "near-miss", JSON.stringify(missed));
// The label must be the control's CENTRE. Labelling the point of the control
// nearest the click would write the cursor's own error into the label — the
// click landed where the (wrong) map said the eye was, so that would teach the
// learner that its mistake was correct.
check(
  "its label is the control's centre, not the click point",
  !!missed && Math.abs(missed.x - 0.4) < 1e-9 && Math.abs(missed.x - 0.34) > 0.01,
  `x=${missed?.x}`
);
check(
  "…and it is believed less than a direct hit",
  !!missed && !!hit && missed.weight < hit.weight,
  `${missed?.weight} vs ${hit?.weight}`
);

// A badly-off map is exactly when learning matters, so a control between the
// confident radius and FAR_RADIUS still labels — at a fraction of the weight.
const discounted = resolveClickLesson({ point: { x: 0.34, y: 0.5 }, targets: [button("far", 0.6, 0.5)] });
check(
  "a control just beyond the confident radius still teaches, weakly",
  discounted?.kind === "near-miss" && discounted.weight <= 0.15,
  JSON.stringify(discounted)
);
check(
  "and says so, so the log never claims certainty it doesn't have",
  !!discounted && /far off/.test(discounted.reason),
  discounted?.reason
);

const faraway = resolveClickLesson({
  point: { x: 0.1, y: 0.5 },
  targets: [button("far", 0.6, 0.5)],
});
check(
  `a click beyond ${FAR_RADIUS} of anything teaches nothing`,
  faraway === null,
  `got ${JSON.stringify(faraway)}`
);
check(
  "the confident radius is the tighter of the two",
  MISS_RADIUS < FAR_RADIUS,
  `${MISS_RADIUS} vs ${FAR_RADIUS}`
);

const empty = resolveClickLesson({ point: { x: 0.5, y: 0.5 }, targets: [] });
check("a blink over empty space teaches nothing", empty === null);

const decorative = resolveClickLesson({
  point: { x: 0.5, y: 0.5 },
  targets: [{ ...button("a heading", 0.5, 0.5), interactive: false }],
});
check("non-interactive elements are not labels", decorative === null);

const nan = resolveClickLesson({ point: { x: NaN, y: 0.5 }, targets: [label] });
check("a NaN click point is refused", nan === null);

// ── Page geometry → target list ──────────────────────────────────────────
// 1920×1080, one button centred at (960, 540) and one far away in a corner.
const viewport = { width: 1920, height: 1080 };
const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});
const page = [
  { label: "  Save\n  file  ", rect: rect(940, 530, 40, 20) },
  { label: "far corner", rect: rect(10, 10, 120, 40) },
  { label: "invisible", rect: rect(960, 540, 0, 0) },
];
const mapped = screenTargetsFrom(page, viewport, { x: 0.5, y: 0.5 });
check("only controls near the click are candidates", mapped.length === 1, JSON.stringify(mapped.map((t) => t.label)));
check("pixels become screen fractions", !!mapped[0] && Math.abs(mapped[0].x - 0.5) < 1e-9 && Math.abs(mapped[0].width - 40 / 1920) < 1e-9);
check("labels are whitespace-collapsed", mapped[0]?.label === "Save file", mapped[0]?.label);
check(
  "a zero-size element is not a control",
  mapped.every((t) => t.label !== "invisible")
);
check(
  "the resolver can then label the click",
  resolveClickLesson({ point: { x: 0.5, y: 0.5 }, targets: mapped })?.kind === "direct"
);
check(
  "a degenerate viewport cannot produce NaN coordinates",
  screenTargetsFrom(page.slice(0, 1), { width: 0, height: 0 }, { x: 0.5, y: 0.5 }).every(
    (t) => Number.isFinite(t.x) && Number.isFinite(t.y)
  )
);

// ─────────────────────────────────────────────────────────────────────────
section("Blink clicks teach the map where the user actually meant to click");

// ── The simulated user ───────────────────────────────────────────────────
// True map: screen = 0.5 + (raw - TRUE_C) * TRUE_G. The raw signal spans 0.05
// per screen half — an ordinary iris dart.
const TRUE_G = 20; // screen units per raw unit
const TRUE_C = 0.012; // raw value that corresponds to screen centre

// ── The map the app has before learning ──────────────────────────────────
// The calibration-free mapper derives its gain from the envelope, and its
// span floor (0.025 raw) is right about the user's half-span (0.025), so the
// 1.15 safety margin alone costs ~13% of gain; asymmetric exploration also
// leaves the origin a little off. Both are systematic, and both are exactly
// what a labelled click can measure.
const BASE_G = TRUE_G / 1.13;
const BASE_C = TRUE_C + 0.005; // ~10% of the screen of origin error

const featuresAt = (screenX: number, screenY: number) => {
  const h = TRUE_C + (screenX - 0.5) / TRUE_G;
  const v = TRUE_C + (0.5 - screenY) / TRUE_G; // rawV is positive looking up
  return { h, v, yaw: 0, pitch: 0 };
};
const baseMap = (rawH: number, rawV: number) => ({
  x: Math.max(0, Math.min(1, 0.5 + (rawH - BASE_C) * BASE_G)),
  y: Math.max(0, Math.min(1, 0.5 - (rawV - BASE_C) * BASE_G)),
});
const trueMap = (rawH: number, rawV: number) => ({
  x: 0.5 + (rawH - TRUE_C) * TRUE_G,
  y: 0.5 - (rawV - TRUE_C) * TRUE_G,
});

/** Mean end-to-end error over a fixed probe grid, in screen fractions. */
const PROBES: Array<[number, number]> = [];
for (const sx of [0.1, 0.3, 0.5, 0.7, 0.9]) {
  for (const sy of [0.15, 0.5, 0.85]) PROBES.push([sx, sy]);
}
function meanError(adapter: GazeAdapter): number {
  let sum = 0;
  for (const [sx, sy] of PROBES) {
    const f = featuresAt(sx, sy);
    const truth = trueMap(f.h, f.v);
    const got = adapter.correct(f, baseMap(f.h, f.v));
    sum += Math.hypot(got.x - truth.x, got.y - truth.y);
  }
  return sum / PROBES.length;
}

const adapter = new GazeAdapter();
const before = meanError(adapter);
check(
  "before any click the map is off by double digits (the report)",
  before > 0.05,
  `mean error ${(before * 100).toFixed(1)}% of the screen`
);
check(
  "and with no data the learner changes nothing at all",
  Math.abs(before - (() => {
    let s = 0;
    for (const [sx, sy] of PROBES) {
      const f = featuresAt(sx, sy);
      const t = trueMap(f.h, f.v);
      const b = baseMap(f.h, f.v);
      s += Math.hypot(b.x - t.x, b.y - t.y);
    }
    return s / PROBES.length;
  })()) < 1e-12
);

/** Deterministic spread of click targets across the screen. */
function* clickTargets() {
  const xs = [0.12, 0.3, 0.5, 0.68, 0.88, 0.2, 0.42, 0.6, 0.8, 0.35, 0.55, 0.75, 0.15, 0.45, 0.65, 0.85, 0.25, 0.5, 0.7, 0.9, 0.18, 0.4, 0.62, 0.82, 0.05, 0.95, 0.22, 0.38, 0.52, 0.72, 0.86, 0.28, 0.48, 0.66, 0.78, 0.32, 0.58, 0.74, 0.14, 0.44];
  const ys = [0.2, 0.5, 0.8];
  for (let i = 0; i < xs.length; i++) yield { x: xs[i], y: ys[i % ys.length] };
}

// ── One blink click, exactly as the overlay resolves it ──────────────────
// The cursor is where the MAP puts it (that is the whole error), the user
// aimed at a control at the true screen position, and the click's change is
// irrelevant to the geometry.
let accepted = 0;
let refused = 0;
function blinkAt(screenX: number, screenY: number): number {
  const f = featuresAt(screenX, screenY);
  const cursor = baseMap(f.h, f.v); // where the pointer was
  const target = button("target", screenX, screenY);
  const lesson = resolveClickLesson({ point: cursor, targets: [target] });
  if (!lesson) {
    refused++;
    return -1;
  }
  const ok = adapter.push(
    { h: f.h, v: f.v, yaw: f.yaw, pitch: f.pitch, x: lesson.x, y: lesson.y, mode: "auto" },
    baseMap(f.h, f.v),
    lesson.weight
  );
  if (ok) accepted++;
  return meanError(adapter);
}

// The first click must not snap the cursor: a visible jump mid-use is the
// exact thing that makes a gaze pointer feel broken.
const firstClickError = blinkAt(0.3, 0.5);
const afterOne = adapter.correct(featuresAt(0.3, 0.5), baseMap(featuresAt(0.3, 0.5).h, featuresAt(0.3, 0.5).v));
const baseAt = baseMap(featuresAt(0.3, 0.5).h, featuresAt(0.3, 0.5).v);
const moved = Math.hypot(afterOne.x - baseAt.x, afterOne.y - baseAt.y);
check(
  "one click nudges the map instead of jumping it",
  moved < 0.03,
  `moved ${(moved * 100).toFixed(2)}% after one label (trust ${adapter.trust.toFixed(2)})`
);
check("the first click was accepted as a label", accepted === 1, `accepted=${accepted} refused=${refused}`);
check("error after one click is finite", Number.isFinite(firstClickError));

// ── Learn from 40 ordinary blink clicks ─────────────────────────────────
// A couple of minutes of clicking, at a user's pace.
const history: number[] = [];
let clicks = 1;
for (const t of clickTargets()) {
  const e = blinkAt(t.x, t.y);
  if (e >= 0) {
    clicks++;
    history.push(e);
  }
}
const after = history[history.length - 1];

check(
  "essentially every click teaches something, even while the map is bad",
  refused <= 2,
  `${accepted} accepted, ${refused} refused`
);
check(
  "error collapses to a couple of percent of the screen",
  after <= 0.03,
  `${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}% over ${clicks} blink clicks`
);
check(
  "that is a five-fold improvement, not a nudge",
  after <= before * 0.25,
  `${(after / before).toFixed(2)} of the original error`
);
check(
  "learning never made it worse than the first click",
  history.every((e) => e <= firstClickError + 1e-9),
  `first ${(firstClickError * 100).toFixed(2)}%, worst ${(Math.max(...history) * 100).toFixed(2)}%`
);
check(
  "the improvement is monotone in blocks (no oscillation)",
  history.every((e, i) => i === 0 || e <= history[i - 1] + 0.005),
  history.map((e) => (e * 100).toFixed(1)).join(" → ")
);
check(
  "the far edges are usable, not just the middle",
  (() => {
    const f = featuresAt(0.95, 0.5);
    const t = trueMap(f.h, f.v);
    const g = adapter.correct(f, baseMap(f.h, f.v));
    return Math.hypot(g.x - t.x, g.y - t.y) < 0.03;
  })(),
  "gaze at the right edge still lands within 3%"
);
check(
  "the telemetry says the same thing",
  adapter.meanError !== null && adapter.meanError <= 0.03 && (adapter.rawMeanError ?? 0) > adapter.meanError,
  `mean ${adapter.meanError?.toFixed(4)} vs raw ${adapter.rawMeanError?.toFixed(4)}`
);
check(
  "full trust is earned within about two dozen labelled interactions",
  adapter.trust === 1,
  `trust=${adapter.trust.toFixed(2)} after ${clicks} clicks`
);
check("and it reports how many labels it learned from", adapter.samples === clicks, `samples=${adapter.samples}`);

// ─────────────────────────────────────────────────────────────────────────
section("A burst of nonsense labels cannot wreck the map");

const guarded = new GazeAdapter();
// Learn honestly first.
for (const t of clickTargets()) {
  const f = featuresAt(t.x, t.y);
  guarded.push({ h: f.h, v: f.v, x: t.x, y: t.y, mode: "auto" }, baseMap(f.h, f.v), 1);
}
const goodError = meanError(guarded);
// Now 30 labels that claim the gaze was 40% of the screen away from where the
// model says it was: physically impossible for a held fixation, so they are
// rejected rather than absorbed.
let absorbed = 0;
for (let i = 0; i < 30; i++) {
  const f = featuresAt(0.5, 0.5);
  if (guarded.push({ h: f.h, v: f.v, x: i % 2 ? 0.05 : 0.95, y: 0.5, mode: "auto" }, baseMap(f.h, f.v), 0.4)) {
    absorbed++;
  }
}
check("junk labels are refused, not learned", absorbed === 0, `${absorbed} of 30 absorbed`);
check(
  "the honest model survives them intact",
  Math.abs(meanError(guarded) - goodError) < 0.005,
  `${(goodError * 100).toFixed(1)}% → ${(meanError(guarded) * 100).toFixed(1)}%`
);

// ─────────────────────────────────────────────────────────────────────────
section("Weighted labels, sane bounds");

const weighted = new GazeAdapter();
const f = featuresAt(0.3, 0.5);
check("a zero-weight label is refused (it is not evidence)", weighted.push({ h: f.h, v: f.v, x: 0.3, y: 0.5 }, baseMap(f.h, f.v), 0) === false);
check("a negative weight is refused", weighted.push({ h: f.h, v: f.v, x: 0.3, y: 0.5 }, baseMap(f.h, f.v), -1) === false);
check("a NaN weight is refused", weighted.push({ h: f.h, v: f.v, x: 0.3, y: 0.5 }, baseMap(f.h, f.v), NaN) === false);
check("nothing was learned from any of them", weighted.samples === 0 && weighted.trust === 0);

// A weak label builds trust slowly — that is what keeps a few uncertain
// near-misses from moving the cursor as far as four held fixations.
const weak = new GazeAdapter();
for (let i = 0; i < 4; i++) {
  const g = featuresAt(0.2 + i * 0.05, 0.5);
  weak.push({ h: g.h, v: g.v, x: 0.2 + i * 0.05, y: 0.5, mode: "auto" }, baseMap(g.h, g.v), 0.25);
}
check(
  "four low-confidence labels do not add up to full trust",
  weak.trust < 0.2,
  `trust=${weak.trust.toFixed(3)} after 4 × 0.25-weight labels`
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
