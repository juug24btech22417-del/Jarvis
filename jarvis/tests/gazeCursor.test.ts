// Tests for the gaze motion model (engage → glide → settle).
//
// This is where "eye control keeps dancing" lives: either the dead zone is
// smaller than the sensor noise, so the cursor never truly parks, or the
// hysteresis is too weak and it chatters park → cross → glide → park.
//
// "Zero sends at rest" is a hard, checkable property — no camera required.
//
// Run with:  npx tsx tests/gazeCursor.test.ts

import { GazeCursor } from "../src/lib/gazeCursor";

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

/** Seeded LCG — reproducible "sensor noise" without a dependency. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DT = 1 / 30; // 30fps
const CENTRE = { x: 0.5, y: 0.5 };

/** Run `frames` steps of a jittery fixation; returns how many MOVED the pointer. */
function fixationJitterTest(amplitude: number, frames = 300) {
  const rand = rng(0x5eed);
  const cursor = new GazeCursor();
  let sends = 0;
  let maxWander = 0;
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i < frames; i++) {
    const t = {
      x: CENTRE.x + (rand() * 2 - 1) * amplitude,
      y: CENTRE.y + (rand() * 2 - 1) * amplitude,
    };
    if (prev) {
      maxWander = Math.max(maxWander, Math.hypot(t.x - prev.x, t.y - prev.y));
    }
    prev = t;
    if (cursor.step(t, DT)) sends++;
  }
  return { sends, maxWander, radius: cursor.radius };
}

// ─────────────────────────────────────────────────────────────────────────
section("THE STATUE RULE: a fixation never moves the pointer");

// Realistic post-filter iris noise. This is the amplitude the old fixed
// 1.1%-of-screen dead zone (0.011) was fighting — noise that crosses it
// several times a second IS the dancing the user reported.
const mild = fixationJitterTest(0.004);
check(
  "300 frames of +/-0.4% jitter produce ZERO sends",
  mild.sends === 0,
  `${mild.sends} sends`
);
check(
  "the noise was real (test is not vacuous)",
  mild.maxWander > 0.006,
  `maxWander=${mild.maxWander.toFixed(4)}`
);

// A noisier camera / worse lighting. The dead zone must MEASURE this and grow
// — that self-measurement is what makes it work on every machine, instead of
// being a constant that one user's lighting tuned.
const noisy = fixationJitterTest(0.009);
check(
  "a noisier signal still produces ZERO sends",
  noisy.sends === 0,
  `${noisy.sends} sends`
);
check(
  "the dead zone grew to match the noise",
  noisy.radius > 0.009,
  `radius=${noisy.radius.toFixed(4)} (floor 0.009)`
);

// The property that makes the first two tests meaningful: with the OLD fixed
// 0.011 radius, the same jitter crosses constantly. Model it to prove the
// fix addresses the reported behaviour.
function oldFixedZoneSends(amplitude: number, frames = 300) {
  const rand = rng(0x5eed);
  let anchor = { x: CENTRE.x, y: CENTRE.y };
  let sends = 0;
  for (let i = 0; i < frames; i++) {
    const t = {
      x: CENTRE.x + (rand() * 2 - 1) * amplitude,
      y: CENTRE.y + (rand() * 2 - 1) * amplitude,
    };
    const d = Math.hypot(t.x - anchor.x, t.y - anchor.y);
    if (d >= 0.011) {
      sends++;
      anchor = { x: t.x, y: t.y };
    }
  }
  return sends;
}
const oldSends = oldFixedZoneSends(0.009);
check(
  "the old fixed dead zone chattered on the same noise",
  oldSends > 5,
  `${oldSends} sends — the dancing this change removes`
);

// ─────────────────────────────────────────────────────────────────────────
section("A deliberate glance still moves the cursor immediately");

const c2 = new GazeCursor();
c2.step(CENTRE, DT); // park
let first = null;
let framesToMove = -1;
for (let i = 0; i < 5; i++) {
  const out = c2.step({ x: CENTRE.x + 0.2, y: CENTRE.y }, DT);
  if (out) {
    if (framesToMove < 0) framesToMove = i;
    if (!first) first = out;
  }
}
check("a 20% glance engages on the first frame", framesToMove === 0, `frame ${framesToMove}`);
check("it produced a position", !!first);

section("Nothing teleports: the speed cap holds");

// A glance 40% of the screen away must still be approached gradually.
const c3 = new GazeCursor();
c3.step({ x: 0.1, y: 0.1 }, DT);
const jumped = c3.step({ x: 0.9, y: 0.9 }, DT);
const travelled = jumped ? Math.hypot(jumped.x - 0.1, jumped.y - 0.1) : 0;
// maxSpeed defaults to 2.6 screen-fractions/sec → 2.6/30 = 0.0867 per frame.
check(
  "one frame moves at most the slew cap",
  travelled <= 2.6 * DT + 1e-9,
  `travelled=${travelled.toFixed(4)}`
);
check("but it did move", travelled > 0);

section("The glide lands, then parks");

const c4 = new GazeCursor();
const far = { x: 0.85, y: 0.2 };
c4.step(far, DT); // park at the target
// Nudge the target 0.25 away and hold it there.
const target = { x: 0.85, y: 0.45 };
let last = { x: far.x, y: far.y };
let landedAt = -1;
for (let i = 0; i < 60; i++) {
  const out = c4.step(target, DT);
  if (out) last = out;
  else if (i > 0) {
    landedAt = i;
    break;
  }
}
check("it parks after gliding", landedAt > 0 && landedAt < 40, `landed at frame ${landedAt}`);
check(
  "it lands close to what you looked at",
  Math.hypot(last.x - target.x, last.y - target.y) < 0.03,
  `error=${Math.hypot(last.x - target.x, last.y - target.y).toFixed(4)}`
);

section("Resetting after a dropout parks instead of sweeping");

const c5 = new GazeCursor();
c5.step({ x: 0.2, y: 0.2 }, DT);
c5.step({ x: 0.3, y: 0.3 }, DT);
c5.reset(); // tracking lost
const afterReset = c5.step({ x: 0.9, y: 0.9 }, DT);
check("the first frame after a reset sends nothing (parks there)", afterReset === null);
const second = c5.step({ x: 0.9, y: 0.9 }, DT);
check("and it is now parked at the new position, not gliding from the old", second === null);

section("Garbage input cannot poison the state");

const c6 = new GazeCursor();
c6.step(CENTRE, DT);
check("NaN target is refused", c6.step({ x: NaN, y: 0.5 }, DT) === null);
check("Infinity target is refused", c6.step({ x: 0.5, y: Infinity }, DT) === null);
const recovered = c6.step({ x: 0.6, y: 0.6 }, DT);
check("and the cursor recovers cleanly afterwards", recovered === null || Number.isFinite(recovered.x));

section("Hysteresis: no park→cross→glide chatter at the boundary");

// Park, then hold a target that sits RIGHT at the edge of the zone. Without
// hysteresis this alternates engaged/parked every frame, which is exactly the
// visible "dance" the user described.
const c7 = new GazeCursor();
c7.step(CENTRE, DT);
// Let the zone settle first.
for (let i = 0; i < 60; i++) c7.step(CENTRE, DT);
const radius = c7.radius;
let transitions = 0;
let prevMoved = false;
for (let i = 0; i < 200; i++) {
  // 1.15x the radius: outside the land radius, well inside the exit radius.
  const out = c7.step({ x: CENTRE.x + radius * 1.15, y: CENTRE.y }, DT);
  const moved = !!out;
  if (moved !== prevMoved) transitions++;
  prevMoved = moved;
}
check(
  "a target hovering at the zone edge does not cause repeated state flips",
  transitions <= 2,
  `${transitions} transitions over 200 frames`
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
