// Tests for the online gaze adapter (RLS on the residual of the base map).
//
// The property that matters: with labelled fixations the adapter must measurably
// REDUCE the cursor's error, must never make the cursor worse before it has
// evidence, and must be impossible to corrupt with garbage samples — this code
// drives a real cursor at 30Hz.
//
// Run with:  npx tsx tests/gazeAdapt.test.ts

import { GazeAdapter, type GazeSample } from "../src/lib/gazeAdapt";

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

/** Seeded LCG — reproducible pseudo-noise without a dependency. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The "user" — and the map JARVIS currently ships.
//
// The shipped map is baseMap(): a fixed gain with no offset, which is what the
// DEFAULT_COEFFS path is. The user's ACTUAL eye geometry differs: a different
// gain (they sit closer to the camera) and a resting offset. That gap is
// exactly the class of error a one-shot 17-dot fit leaves behind, and the whole
// reason this adapter exists.
const BASE_GAIN_X = 6.0;
const BASE_GAIN_Y = 7.0;
function baseMap(h: number, v: number, yaw = 0, pitch = 0) {
  return {
    x: Math.max(0, Math.min(1, 0.5 + BASE_GAIN_X * h - 0.3 * yaw)),
    y: Math.max(0, Math.min(1, 0.5 - BASE_GAIN_Y * v - 0.4 * pitch)),
  };
}

/** The user's real eye geometry: ~18% less x gain, ~10% more y gain, offsets. */
const TRUE_GAIN_X = 4.92;
const TRUE_GAIN_Y = 7.7;
const TRUE_OFF_X = 0.04;
const TRUE_OFF_Y = 0.03;

/** Ground truth: what a raw signal actually means to this user. */
function trueMap(h: number, v: number) {
  return {
    x: Math.max(0, Math.min(1, 0.5 + TRUE_GAIN_X * h + TRUE_OFF_X)),
    y: Math.max(0, Math.min(1, 0.5 - TRUE_GAIN_Y * v - TRUE_OFF_Y)),
  };
}

/** A fixating eye: the user looks at `lookAt`, their iris lands where it lands. */
function fixation(lookAt: { x: number; y: number }, noise = 0, rand: () => number = Math.random) {
  // Invert the user's OWN map (plus sensor noise) — this is the forward
  // direction the face landmarker measures.
  const h = (lookAt.x - 0.5 - TRUE_OFF_X) / TRUE_GAIN_X + (rand() * 2 - 1) * noise;
  const v = (0.5 - TRUE_OFF_Y - lookAt.y) / TRUE_GAIN_Y + (rand() * 2 - 1) * noise;
  return { h, v };
}

/** One labelled observation: features + the point actually looked at. */
function sampleAt(p: { x: number; y: number }, noise = 0, rand?: () => number): GazeSample {
  const s = fixation(p, noise, rand);
  const truth = trueMap(s.h, s.v);
  return { h: s.h, v: s.v, x: truth.x, y: truth.y, mode: "auto" };
}

const LABELS = [
  { x: 0.5, y: 0.5 },
  { x: 0.08, y: 0.08 },
  { x: 0.5, y: 0.08 },
  { x: 0.92, y: 0.08 },
  { x: 0.08, y: 0.5 },
  { x: 0.92, y: 0.5 },
  { x: 0.08, y: 0.92 },
  { x: 0.5, y: 0.92 },
  { x: 0.92, y: 0.92 },
  { x: 0.3, y: 0.3 },
  { x: 0.7, y: 0.3 },
  { x: 0.3, y: 0.7 },
  { x: 0.7, y: 0.7 },
  { x: 0.5, y: 0.28 },
  { x: 0.5, y: 0.72 },
  { x: 0.28, y: 0.5 },
  { x: 0.72, y: 0.5 },
];

// ─────────────────────────────────────────────────────────────────────────
section("Zero evidence changes NOTHING (the cursor cannot get worse by installing it)");

const fresh = new GazeAdapter();
check("no samples yet", fresh.samples === 0);
check("trust starts at zero", fresh.trust === 0);
const untouched = fresh.correct({ h: 0.03, v: -0.02 }, baseMap(0.03, -0.02));
const baseOnly = baseMap(0.03, -0.02);
check(
  "with no samples the output is exactly the base map",
  Math.abs(untouched.x - baseOnly.x) < 1e-12 && Math.abs(untouched.y - baseOnly.y) < 1e-12
);

section("A MEASURABLE improvement once the user's fixations come in");

// The error a brand-new user lives with, before any learning.
const probe = LABELS.map((p) => {
  const s = fixation(p, 0.001, rng(7));
  const b = baseMap(s.h, s.v);
  return Math.hypot(b.x - p.x, b.y - p.y);
});
const baseErr = probe.reduce((a, b) => a + b, 0) / probe.length;
check("the base map is genuinely wrong for this user", baseErr > 0.02, `meanErr=${baseErr.toFixed(4)}`);

const adapter = new GazeAdapter();
const rand = rng(1234);
let accepted = 0;
// Three passes over the fixation grid with realistic sub-pixel noise.
for (let pass = 0; pass < 3; pass++) {
  for (const p of LABELS) {
    const s = sampleAt(p, 0.0006, rand);
    const b = baseMap(s.h, s.v);
    if (adapter.push(s, b)) accepted++;
  }
}
check("samples were accepted", accepted === LABELS.length * 3, `accepted=${accepted}`);
check("trust is now full", adapter.trust === 1);

const after = LABELS.map((p) => {
  const s = fixation(p, 0.001, rng(7));
  const b = baseMap(s.h, s.v);
  const c = adapter.correct(s, b);
  return Math.hypot(c.x - p.x, c.y - p.y);
});
const adaptedErr = after.reduce((a, b) => a + b, 0) / after.length;
check(
  "adaptive refinement cuts the mean landing error by at least half",
  adaptedErr < baseErr * 0.5,
  `${baseErr.toFixed(4)} -> ${adaptedErr.toFixed(4)}`
);
check("and never makes a single label worse than 5% of the screen", Math.max(...after) < 0.05, `worst=${Math.max(...after).toFixed(4)}`);

section("The trust ramp: no visible snap in the first few samples");

const ramped = new GazeAdapter();
const s0 = sampleAt({ x: 0.9, y: 0.9 }, 0, rng(9));
const b0 = baseMap(s0.h, s0.v);
ramped.push(s0, b0);
const afterOne = ramped.correct(s0, b0);
check(
  "one sample moves the cursor by a fraction of the full correction",
  Math.hypot(afterOne.x - b0.x, afterOne.y - b0.y) < 0.25 && ramped.trust < 0.2,
  `moved=${Math.hypot(afterOne.x - b0.x, afterOne.y - b0.y).toFixed(4)} trust=${ramped.trust.toFixed(3)}`
);

section("Garbage samples are refused, not learned");

const guard = new GazeAdapter();
const good = sampleAt({ x: 0.5, y: 0.5 }, 0, rng(3));
const goodBase = baseMap(good.h, good.v);
guard.push(good, goodBase);
const before = guard.samples;
// A wildly wrong label (head moved, fixation mis-timed, wrong target).
const junk: GazeSample = { h: good.h, v: good.v, x: 0.02, y: 0.98, mode: "auto" };
check("a 90%-off-screen label is rejected", guard.push(junk, goodBase) === false);
check("the sample count did not move", guard.samples === before);
check("NaN features are refused", guard.push({ h: NaN, v: 0, x: 0.5, y: 0.5 }, goodBase) === false);
check("Infinity targets are refused", guard.push({ h: 0, v: 0, x: Infinity, y: 0.5 }, goodBase) === false);
check(
  "correction on non-finite input returns the base unchanged",
  (() => {
    const out = guard.correct({ h: NaN, v: NaN }, { x: 0.4, y: 0.6 });
    return out.x === 0.4 && out.y === 0.6;
  })()
);

section("Bounded output: bad data cannot throw the cursor off-screen");

const wild = new GazeAdapter();
for (let i = 0; i < 400; i++) {
  // Every label is wrong by 25% in the same direction — within the rejection
  // tolerance, so they are all accepted. The applied correction must still be
  // capped so the pointer stays usable.
  const s: GazeSample = { h: 0.01, v: 0.01, x: 0.75, y: 0.75, mode: "auto" };
  wild.push(s, { x: 0.5, y: 0.5 });
}
const capped = wild.correct({ h: 0.01, v: 0.01 }, { x: 0.5, y: 0.5 });
check(
  "the applied correction is capped",
  Math.hypot(capped.x - 0.5, capped.y - 0.5) <= 0.25 * Math.SQRT2 + 1e-9,
  `correction=${Math.hypot(capped.x - 0.5, capped.y - 0.5).toFixed(4)}`
);
check("and the output is still on screen", capped.x >= 0 && capped.x <= 1 && capped.y >= 0 && capped.y <= 1);

section("Mode keying: a correction never crosses between maps");

const keyed = new GazeAdapter();
for (const p of LABELS.slice(0, 14)) {
  const s = sampleAt(p, 0, rng(11));
  keyed.push({ ...s, mode: "auto" }, baseMap(s.h, s.v));
}
check("bound to the auto map", keyed.boundMode === "auto" && keyed.samples > 0);
const calibrated = sampleAt(LABELS[0], 0, rng(12));
keyed.push({ ...calibrated, mode: "calib" }, baseMap(calibrated.h, calibrated.v));
check("switching maps restarts the learner", keyed.boundMode === "calib" && keyed.samples === 1);

section("Persistence round-trips, corrupt payloads are refused");

const persisted = new GazeAdapter();
for (const p of LABELS) {
  const s = sampleAt(p, 0, rng(21));
  persisted.push(s, baseMap(s.h, s.v));
}
const restored = new GazeAdapter();
check("a fresh adapter rejects an empty payload", restored.fromJSON({}) === false);
check("the serialized state loads", restored.fromJSON(JSON.parse(JSON.stringify(persisted.toJSON()))) === true);
check("sample count survives", restored.samples === persisted.samples);
const probeSample = fixation({ x: 0.8, y: 0.2 }, 0, rng(31));
const probeBase = baseMap(probeSample.h, probeSample.v);
const a = persisted.correct(probeSample, probeBase);
const b = restored.correct(probeSample, probeBase);
check(
  "and the learned correction is identical after a reload",
  Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12
);
check(
  "a payload from a future version is refused",
  new GazeAdapter().fromJSON({ v: 99, n: 5, w: Array(10).fill(0.1), P: Array(50).fill(1) }) === false
);
check(
  "a NaN-poisoned payload is refused",
  new GazeAdapter().fromJSON({ v: 1, n: 1, w: Array(10).fill(NaN), P: Array(50).fill(1) }) === false
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
