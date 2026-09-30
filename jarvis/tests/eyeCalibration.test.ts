// Gaze calibration + calibration-free mapping tests.
//
// Covers the "eye control doesn't work at all" report end to end, without a
// camera:
//   • the 5-feature regression recovers a known gaze map exactly,
//   • span normalization guarantees full-screen reach,
//   • AutoGain (the calibration-free fallback) actually spans the screen
//     where the old fixed 1.8× gain did not, and does not drift while you
//     hold a glance,
//   • a stale pre-change calibration is refused rather than mis-applied.
//
// Run with:  npx tsx tests/eyeCalibration.test.ts

import {
  CALIB_POINTS,
  fitGaze,
  fitIsSane,
  mapGaze,
  normalizeFit,
  saveCalibration,
  loadCalibration,
  AutoGain,
  type GazePoint,
  type StoredCoeffs,
} from "../src/lib/eyeCalibration";

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

// ─────────────────────────────────────────────────────────────────────────
section("The 5-feature regression recovers a known gaze map");

// Synthesise a user whose iris signal is a clean linear function of screen
// position, then check the fit reproduces it. Also include head-pose
// contamination in the "signal" so the yaw/pitch regressors have real work.
const H_SLOPE = 0.12; // raw signal span across the screen
const samples: GazePoint[] = [];
for (const [sx, sy] of CALIB_POINTS) {
  const yaw = (sx - 0.5) * 0.05;
  const pitch = (sy - 0.5) * 0.04;
  samples.push({
    // h sees the gaze AND a bit of head yaw, v sees the gaze AND pitch.
    h: (sx - 0.5) * H_SLOPE + yaw * 0.4,
    v: (0.5 - sy) * H_SLOPE + pitch * 0.4,
    yaw,
    pitch,
    sx,
    sy,
  });
}

const fit = fitGaze(samples);
check("fit produced coefficients", !!fit);
if (fit) {
  check("residual is ~zero on clean data", fit.residual < 0.02, `residual=${fit.residual}`);
  check("fit passes the sanity gate", fitIsSane(fit.coeffs));

  let maxErr = 0;
  for (const s of samples) {
    const p = mapGaze(fit.coeffs, s.h, s.v, s.yaw, s.pitch);
    maxErr = Math.max(maxErr, Math.abs(p.x - s.sx), Math.abs(p.y - s.sy));
  }
  check("predictions reproduce the screen points", maxErr < 0.03, `maxErr=${maxErr}`);
}

section("Degenerate fits are refused");

check("an all-zero fit is rejected", !fitIsSane([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
check("a real iris-scale fit is accepted", fitIsSane([7, 0.5, 0, 0, 0.5, -7, 0.5, 0, 0, 0.5]));
check(
  "a wild over-amplified fit is rejected",
  !fitIsSane([80, 0, 0, 0, 0.5, 80, 0, 0, 0, 0.5])
);
check("too few samples cannot fit", fitGaze(samples.slice(0, 4)) === null);

section("Span normalization guarantees full-screen reach");

if (fit) {
  // Compress the fit so its predictions only cover a small patch (a timid
  // calibration), then normalize and confirm the spread is restored.
  const timid: StoredCoeffs = fit.coeffs.map((c, i) => (i === 4 || i === 9 ? c : c * 0.35));
  const before = samples.map((s) => mapGaze(timid, s.h, s.v, s.yaw, s.pitch));
  const spanBefore = Math.max(...before.map((p) => p.x)) - Math.min(...before.map((p) => p.x));
  const normed = normalizeFit(timid, samples);
  const after = samples.map((s) => mapGaze(normed, s.h, s.v, s.yaw, s.pitch));
  const spanX = Math.max(...after.map((p) => p.x)) - Math.min(...after.map((p) => p.x));
  const spanY = Math.max(...after.map((p) => p.y)) - Math.min(...after.map((p) => p.y));
  check("the timid fit starts compressed", spanBefore < 0.4, `span=${spanBefore}`);
  check("normalization restores horizontal reach", spanX > 0.8, `spanX=${spanX}`);
  check("normalization restores vertical reach", spanY > 0.8, `spanY=${spanY}`);
}

// ─────────────────────────────────────────────────────────────────────────
section("AutoGain: the calibration-free fallback actually spans the screen");

const WARMUP = 45;

/** Feed `n` samples of the same value (simulating a held gaze). */
function hold(g: AutoGain, value: number, n: number) {
  let last = 0.5;
  for (let i = 0; i < n; i++) last = g.push(value);
  return last;
}

const g1 = new AutoGain();
const duringWarmup = hold(g1, 0, WARMUP - 1);
check("maps to centre until the resting centre is learned", duringWarmup === 0.5);
hold(g1, 0, 1); // completes warmup; centre = 0

// A real iris dart: ramps out over several frames (a spike guard would
// otherwise reject it), then settles.
const DART = 0.08;
let mapped = 0.5;
for (let i = 1; i <= 24; i++) mapped = g1.push((i / 24) * DART);
check(
  "a full gaze dart reaches the screen edge",
  mapped > 0.85,
  `mapped=${mapped.toFixed(3)} (a fixed 1.8x gain would give ${(
    0.5 + DART * 1.8
  ).toFixed(3)})`
);

// The regression, stated explicitly: the OLD mapping (a fixed 1.8x expand)
// moved the pointer ~14% off centre for the SAME dart, which is why targets
// at x = 0.88 were unreachable without a calibration.
const oldGain = Math.max(0, Math.min(1, 0.5 + DART * 1.8));
check(
  "the old fixed-gain mapping fell far short",
  oldGain < 0.70,
  `old=${oldGain.toFixed(3)}`
);

// The other direction must work too (looking the other way).
const g2 = new AutoGain();
hold(g2, 0, WARMUP);
let mappedNeg = 0.5;
for (let i = 1; i <= 24; i++) mappedNeg = g2.push(-(i / 24) * DART);
check("the opposite direction reaches the opposite edge", mappedNeg < 0.15, `${mappedNeg}`);

section("AutoGain does not drift while you hold a glance");

const g3 = new AutoGain();
hold(g3, 0, WARMUP);
for (let i = 1; i <= 24; i++) g3.push((i / 24) * DART); // learn the span
const first = g3.push(DART * 0.7);
const later = hold(g3, DART * 0.7, 300); // 10 seconds of a steady look
check(
  "a fixed gaze maps to a fixed point",
  Math.abs(later - first) < 0.01,
  `first=${first.toFixed(3)} later=${later.toFixed(3)}`
);
check("the held point is on screen", later > 0.5 && later < 1);

section("AutoGain bounds the damage from single-frame landmark spikes");

const g4 = new AutoGain();
hold(g4, 0, WARMUP);
for (let i = 1; i <= 24; i++) g4.push((i / 24) * 0.05); // learned span ≈ 0.05
const spanBeforeSpike = g4.span;
g4.push(0.6); // one-frame garbage landmark
g4.push(0.001); // back to normal
check(
  "one bad frame costs at most 25% of the gain",
  g4.span <= spanBeforeSpike * 1.25 + 1e-9,
  `${spanBeforeSpike.toFixed(4)} -> ${g4.span.toFixed(4)}`
);
// The point of the cap: after the spike the fallback must still be usable,
// i.e. a normal dart still reaches the screen edge.
const afterSpike = g4.map(0.05);
check(
  "a normal dart still reaches the edge after a spike",
  afterSpike > 0.75,
  `mapped=${afterSpike.toFixed(3)}`
);

section("AutoGain is NaN / garbage safe");

const g5 = new AutoGain();
check("NaN input maps to centre instead of poisoning the state", g5.push(NaN) === 0.5);
check("Infinity input is safe too", Number.isFinite(g5.push(Infinity)));
hold(g5, 0.01, WARMUP + 5);
check("still finite after warmup", Number.isFinite(g5.push(0.02)));

// ─────────────────────────────────────────────────────────────────────────
section("A stale calibration is refused, not mis-applied");

// Minimal localStorage stub (the module touches it only inside the
// save/load helpers, so installing it here is enough).
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as unknown as Storage;

const coeffs: StoredCoeffs = [7, 0.5, 0, 0, 0.5, -7, 0.5, 0, 0, 0.5];
saveCalibration(coeffs);
const loaded = loadCalibration();
check(
  "a fresh calibration round-trips",
  !!loaded && loaded.every((v, i) => Math.abs(v - coeffs[i]) < 1e-9)
);

// A v3 payload (the old signal definition) under the current key must be
// refused: the features changed units, so applying it would map a correct
// signal through the wrong affine.
store.set("jarvis:eye-calib-v4", JSON.stringify({ v: 3, coeffs }));
check("a v3 payload is refused", loadCalibration() === null);

// Legacy keys are cleaned up on save.
store.set("jarvis:eye-calib-v3", JSON.stringify({ v: 3, coeffs }));
saveCalibration(coeffs);
check("legacy v3 key is removed on save", !store.has("jarvis:eye-calib-v3"));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
