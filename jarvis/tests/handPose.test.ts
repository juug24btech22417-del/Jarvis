// Regression tests for hand pose classification and the panic-freeze release.
//
// These are the bugs that were reported:
//   "even if I didn't show the palm, it takes it as a palm and says frozen"
//   "it doesn't unfreeze even after pointing"
//
// Both are pure threshold logic, so they are testable without a camera by
// feeding synthetic frames. Run with:  npx tsx tests/handPose.test.ts
//
// No test framework: a tiny assert helper keeps this dependency-free, matching
// the rest of the project (which ships no test runner).

import {
  classifyPose,
  isOpenPalm,
  advanceFreezeRelease,
  FREEZE_RELEASE_FRAMES,
  EXT_STRAIGHT,
  EXT_NOT_STRAIGHT,
  type Pose,
  type PoseFrame,
} from "../src/lib/handPose";

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

/** Build a hand frame; only the fields a test cares about need overriding. */
function frame(over: Partial<PoseFrame> = {}): PoseFrame {
  return {
    handFound: true,
    pinch: 0.02,
    fist: 0,
    curl: { index: 0.05, middle: 0.05, ring: 0.05, pinky: 0.05 },
    ext: { index: 1.3, middle: 1.3, ring: 1.3, pinky: 1.3 },
    thumbUp: false,
    fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
    ...over,
  };
}

const ext = (i: number, m: number, r: number, p: number) => ({
  index: i,
  middle: m,
  ring: r,
  pinky: p,
});
const curl = (i: number, m: number, r: number, p: number) => ({
  index: i,
  middle: m,
  ring: r,
  pinky: p,
});

// ─────────────────────────────────────────────────────────────────────────
section("A relaxed pointing hand must NEVER read as an open palm");

// Index out, the other three only loosely folded. This is the reported
// failure: every curl score lands under the old `curl < 0.35` bar, so the
// previous classifier called it an open palm and armed the panic freeze.
const relaxedPoint = frame({
  ext: ext(1.28, 1.0, 1.0, 0.95),
  curl: curl(0.08, 0.28, 0.3, 0.4),
  fingers: { thumb: false, index: true, middle: false, ring: false, pinky: false },
});
check("relaxed point is not an open palm", !isOpenPalm(relaxedPoint));
check(
  "relaxed point classifies as point",
  classifyPose(relaxedPoint) === "point",
  `got ${classifyPose(relaxedPoint)}`
);

// The hysteresis-lag case: the finger booleans still say "extended" from a
// moment ago even though the finger has folded. A boolean OR-path in the palm
// test would re-introduce the bug, so the geometry must win outright.
const hysteresisLagPoint = frame({
  ext: ext(1.28, 1.0, 1.02, 0.98),
  curl: curl(0.08, 0.3, 0.32, 0.38),
  // Stale: middle/ring/pinky still flagged extended from frames ago.
  fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
});
check("stale finger booleans cannot fake a palm", !isOpenPalm(hysteresisLagPoint));
check(
  "stale booleans still classify as point",
  classifyPose(hysteresisLagPoint) === "point",
  `got ${classifyPose(hysteresisLagPoint)}`
);

// Two-finger scroll pose (✌️) must not be a palm either.
const twoFingers = frame({
  ext: ext(1.25, 1.2, 0.9, 0.85),
  curl: curl(0.1, 0.15, 0.5, 0.6),
  fingers: { thumb: false, index: true, middle: true, ring: false, pinky: false },
});
check("two-finger pose is not a palm", !isOpenPalm(twoFingers));
check("two-finger pose classifies as two", classifyPose(twoFingers) === "two");

// ─────────────────────────────────────────────────────────────────────────
section("A genuine open palm still arms the freeze");

const openPalm = frame({
  ext: ext(1.3, 1.35, 1.3, 1.28),
  curl: curl(0.03, 0.02, 0.03, 0.05),
  fingers: { thumb: true, index: true, middle: true, ring: true, pinky: true },
});
check("open palm is recognised", isOpenPalm(openPalm));
check("open palm classifies as palm", classifyPose(openPalm) === "palm");

// A pinching hand with spread fingers is not an open palm.
const pinchSpread = frame({
  ext: ext(1.2, 1.3, 1.3, 1.3),
  pinch: 0.9,
  fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
});
check("a deep pinch is not a palm", !isOpenPalm(pinchSpread));

check("a fist is not a palm", classifyPose(frame({ fist: 0.9 })) === "fist");
check(
  "a thumb-up is not a palm",
  classifyPose(
    frame({
      fist: 0.9,
      thumbUp: true,
      ext: ext(0.8, 0.8, 0.8, 0.8),
      fingers: { thumb: true, index: false, middle: false, ring: false, pinky: false },
    })
  ) === "thumb"
);
check("no hand is none", classifyPose(frame({ handFound: false })) === "none");

// ─────────────────────────────────────────────────────────────────────────
section("Palm and point can never overlap (the dead-band guarantee)");

// Sweep every finger extension ratio through the whole plausible range and
// assert the two poses are mutually exclusive, so no amount of borderline
// noise can flip a pointing hand into a freeze.
let overlap = false;
let palmCount = 0;
for (let m = 0.6; m <= 1.6; m += 0.01) {
  for (let r = 0.6; r <= 1.6; r += 0.01) {
    const f = frame({
      // Index is out in every case: this is the pointing-hand family.
      ext: ext(1.3, r === 0 ? m : m, r, r - 0.05),
      curl: curl(0.08, 0.3, 0.3, 0.3),
      fingers: { thumb: false, index: true, middle: true, ring: true, pinky: true },
    });
    const pose = classifyPose(f);
    if (pose === "palm") {
      palmCount++;
      // A palm read while the middle/ring are below the "not straight" bar is
      // exactly the overlap that caused the false freeze.
      if (m < EXT_NOT_STRAIGHT || r < EXT_NOT_STRAIGHT) overlap = true;
    }
  }
}
check("no ratio produces palm-while-point", !overlap);
check("the sweep is meaningful (some palms found)", palmCount > 0, `${palmCount} palm reads`);
check(
  "straightness thresholds leave a dead band",
  EXT_NOT_STRAIGHT < EXT_STRAIGHT,
  `${EXT_NOT_STRAIGHT} !< ${EXT_STRAIGHT}`
);

// ─────────────────────────────────────────────────────────────────────────
section("Freeze release survives a flickering classifier");

// The reported "it doesn't unfreeze": pose classification alternates between
// point and none while a real user holds a point. The old rule reset on every
// unrecognized frame, so the counter never reached its target.
let counter = 0;
const flicker: Pose[] = ["point", "none", "point", "none", "point"];
for (const p of flicker) counter = advanceFreezeRelease(counter, p);
check(
  "point/none flicker still reaches the release threshold",
  counter >= FREEZE_RELEASE_FRAMES,
  `counter=${counter}, need=${FREEZE_RELEASE_FRAMES}`
);

// A held open palm must keep the freeze engaged, even with a stray
// unrecognized frame in the middle (which is now neutral, not a reset).
counter = 0;
for (const p of ["palm", "palm", "none", "palm", "palm", "palm"] as Pose[]) {
  counter = advanceFreezeRelease(counter, p);
}
check("a held palm keeps the freeze", counter === 0, `counter=${counter}`);

// A fist or a two-finger pose also releases.
counter = 0;
counter = advanceFreezeRelease(counter, "fist");
counter = advanceFreezeRelease(counter, "fist");
counter = advanceFreezeRelease(counter, "fist");
check("a fist releases the freeze", counter >= FREEZE_RELEASE_FRAMES);

// Regression guard on the OLD rule: it required the SAME pose every frame and
// reset on anything else. Model it and show it would have failed the flicker
// case, so this test is genuinely catching the bug and not a tautology.
function oldRule(poses: Pose[]): boolean {
  let c = 0;
  for (const p of poses) {
    if (p !== "none" && p !== "palm") {
      c++;
      if (c >= 4) return true;
    } else {
      c = 0;
    }
  }
  return false;
}
check(
  "the old consecutive-frames rule would have failed this case",
  oldRule([...flicker, "point", "point"]) === false
);

// ─────────────────────────────────────────────────────────────────────────
section("Frozen state never moves the cursor or clicks");
// (Structural check: the frozen branch in AirMouseControl returns before any
// sendInput call. That is verified by reading the component; what we can pin
// down here is that a held palm keeps the state frozen.)
counter = FREEZE_RELEASE_FRAMES;
for (let i = 0; i < 30; i++) counter = advanceFreezeRelease(counter, "palm");
check("sustained palm cannot leak out of frozen", counter === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
