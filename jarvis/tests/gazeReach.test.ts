// Regression test for "the eye cursor is stuck on the right side": gazing
// anywhere else leaves the pointer parked against one edge.
//
// The bug was in the calibration-free mapper (AutoGain), and the way to see it
// is to run the WHOLE chain the overlay runs, in order, over a simulated
// session — learn the map from the raw iris signal, map it, clamp, One-Euro
// filter, then feed the engage→glide→settle cursor model:
//
//   handleFrame      → autoGain.push(raw)          (learning)
//   basePointFor     → autoGain.map(raw)           (the map)
//   cursor path      → clamp(0.5 + (x-0.5)*GAIN)   (GAZE_GAIN = 1)
//   cursor path      → fx.filter(x, now)
//   drive loop       → GazeCursor.step(target, dt)
//
// Two defects made one half of the screen unreachable:
//   1. the origin was the MEAN OF THE FIRST 45 FRAMES — wherever the user
//      happened to be looking at power-on (usually a corner HUD) — and it was
//      frozen there for the session,
//   2. the span was a single symmetric magnitude, so one large rightward
//      excursion permanently stole reach from the left.
// A user powering on while looking left could then only move the cursor
// through x ≈ 0.45..0.93: the entire left half was gone, and gazing left moved
// the pointer nowhere near the left. The assertions below pin the properties
// that make that impossible: gaze direction reaches the matching part of the
// screen, the mapping is monotone, and the reachable band covers most of the
// screen — all independent of where the user was looking when tracking began.
//
// Run with:  npx tsx tests/gazeReach.test.ts

import { AutoGain } from "../src/lib/eyeCalibration";
import { OneEuroFilter } from "../src/lib/oneEuro";
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

// ─── The overlay's constants, mirrored so this test fails if they drift ─────
const FRAME_MS = 33;
const GAZE_GAIN = 1.0;
const CURSOR_OPTS = {
  minRadius: 0.005,
  maxRadius: 0.035,
  noiseK: 3.0,
  exitK: 1.8,
  glideRate: 20,
  fineRate: 14,
  fineRadius: 0.055,
  maxSpeed: 3.2,
};

/**
 * One simulated user's raw iris signal, linear in screen position 0..1 with a
 * per-direction half-span (raw units). Real users are asymmetric — a head
 * turn, or a camera that is not exactly on the eye axis — which is exactly the
 * case a single symmetric span gets wrong.
 */
function rawSignalFor(screen: number, halfLeft: number, halfRight: number, offset = 0): number {
  const d = screen - 0.5;
  return offset + (d < 0 ? d * 2 * halfLeft : d * 2 * halfRight);
}

/** The overlay's cursor chain, exactly as the component wires it. */
class EyeChain {
  private gain = new AutoGain();
  private fx = new OneEuroFilter(1.8, 1.8);
  private cursor = new GazeCursor(CURSOR_OPTS);
  private f = 0;
  /** Where the OS cursor sits; the chain only moves it on a non-null step. */
  x = 0.5;

  /** Feed one frame of raw iris signal; returns the mapped screen position. */
  feed(raw: number): number {
    this.f++;
    const t = this.f * FRAME_MS;
    this.gain.push(raw); // handleFrame: learn
    const mapped = this.gain.map(raw); // basePointFor: use
    const clamped = Math.max(0, Math.min(1, 0.5 + (mapped - 0.5) * GAZE_GAIN));
    const smoothed = this.fx.filter(clamped, t);
    const out = this.cursor.step({ x: smoothed, y: 0.5 }, FRAME_MS / 1000);
    if (out) this.x = out.x;
    return mapped;
  }

  /** Look steadily at `screen` for `n` frames. */
  hold(screen: number, n: number, halfLeft: number, halfRight: number, offset = 0): void {
    for (let i = 0; i < n; i++) this.feed(rawSignalFor(screen, halfLeft, halfRight, offset));
  }

  /** One frame of anything (used for landmark spikes). */
  spike(raw: number): void {
    this.feed(raw);
  }
}

/**
 * A session: power on (the map learns the boot gaze), look around the screen
 * the way anyone using the machine would, and THEN measure where the cursor
 * goes for a steady look at each target.
 *
 * The exploration pass is not a convenience — it is the scenario. An
 * unsupervised mapper cannot know the screen's scale from a single fixation:
 * if the user's boot gaze and their "look left" glance land on the same raw
 * value, no mapper can tell them apart. What must hold is that once they have
 * looked around, every direction reaches the matching part of the screen.
 */
function sweep(options: {
  bootAt: number;
  halfLeft: number;
  halfRight: number;
  offset?: number;
  spikeAt?: number;
  targets?: number[];
}) {
  const { bootAt, halfLeft, halfRight, offset = 0, spikeAt } = options;
  const chain = new EyeChain();
  chain.hold(bootAt, 45, halfLeft, halfRight, offset); // warmup: the boot gaze
  if (spikeAt !== undefined) {
    chain.spike(spikeAt); // one frame of garbage landmark
    chain.hold(bootAt, 3, halfLeft, halfRight, offset); // back to normal
  }
  for (let g = 0.1; g <= 0.91; g += 0.1) chain.hold(g, 8, halfLeft, halfRight, offset); // look around
  const targets = options.targets ?? [0.08, 0.25, 0.5, 0.75, 0.92];
  const rows = targets.map((gaze) => {
    chain.hold(gaze, 90, halfLeft, halfRight, offset); // look steadily, let it land
    return { gaze, cursor: chain.x };
  });
  return rows;
}

// A user whose iris signal spans 0.05 raw units per screen half (a plausible
// everyday dart); 0.025 per side, matching the mapper's own span floor.
const HALF = 0.025;

// ─────────────────────────────────────────────────────────────────────────
section("Where you are looking when tracking starts must not matter");

for (const [label, bootAt] of [
  ["power-on looking at the left rail", 0.1],
  ["power-on looking at the right HUD", 0.9],
  ["power-on looking at the centre", 0.5],
] as Array<[string, number]>) {
  const rows = sweep({ bootAt, halfLeft: HALF, halfRight: HALF });
  const left = rows[0];
  const centre = rows[Math.floor(rows.length / 2)];
  const right = rows[rows.length - 1];
  const lo = Math.min(...rows.map((r) => r.cursor));
  const hi = Math.max(...rows.map((r) => r.cursor));

  check(
    `${label}: gazing left lands the cursor on the left`,
    left.cursor <= 0.33,
    `gaze ${left.gaze} → cursor ${left.cursor.toFixed(2)}`
  );
  check(
    `${label}: gazing right lands the cursor on the right`,
    right.cursor >= 0.67,
    `gaze ${right.gaze} → cursor ${right.cursor.toFixed(2)}`
  );
  check(
    `${label}: gazing centre lands near centre`,
    centre.cursor >= 0.35 && centre.cursor <= 0.65,
    `gaze ${centre.gaze} → cursor ${centre.cursor.toFixed(2)}`
  );
  check(
    `${label}: the reachable band covers most of the screen`,
    hi - lo >= 0.6,
    `${lo.toFixed(2)}..${hi.toFixed(2)} (${((hi - lo) * 100).toFixed(0)}%)`
  );
  check(
    `${label}: the map is monotone — no gaze inversion`,
    rows.every((r, i) => i === 0 || r.cursor >= rows[i - 1].cursor - 1e-9),
    rows.map((r) => r.cursor.toFixed(2)).join(" → ")
  );
}

// ─────────────────────────────────────────────────────────────────────────
section("The pre-fix mapper: why the cursor stuck to one side");

/**
 * The exact pre-fix math, kept as the documented counter-example the
 * assertions above exist for: origin frozen on the boot gaze, one symmetric
 * span taken from the largest absolute deviation.
 */
function legacyMap(raw: number, bootRaw: number, dev: number): number {
  const span = dev || 0.04;
  return Math.max(0, Math.min(1, 0.5 + (raw - bootRaw) / (span * 1.15)));
}

// Power on at the left rail, then look right: the boot gaze becomes a
// permanent origin shift, so everything maps to the right of centre.
const bootRaw = rawSignalFor(0.1, HALF, HALF);
const legacyLeft = legacyMap(rawSignalFor(0.08, HALF, HALF), bootRaw, 0.04);
const legacyRight = legacyMap(rawSignalFor(0.92, HALF, HALF), bootRaw, 0.04);
check(
  "the old mapper could not reach the left even when gazing left",
  legacyLeft > 0.4,
  `gazing left mapped to ${legacyLeft.toFixed(2)} (the cursor lived in the right half)`
);
check(
  "…while the right side worked fine, which is the reported symptom",
  legacyRight > legacyLeft + 0.25,
  `${legacyLeft.toFixed(2)} .. ${legacyRight.toFixed(2)}`
);

// ─────────────────────────────────────────────────────────────────────────
section("An asymmetric signal reaches BOTH sides");

// Leftward glances are half the size of rightward ones — with one symmetric
// span, the big right side stole reach from the left.
const asymRows = sweep({ bootAt: 0.5, halfLeft: 0.02, halfRight: 0.05 });
check(
  "the small side still reaches its edge",
  asymRows[0].cursor <= 0.4,
  `gaze ${asymRows[0].gaze} → cursor ${asymRows[0].cursor.toFixed(2)}`
);
check(
  "the large side reaches its edge too",
  asymRows[asymRows.length - 1].cursor >= 0.67,
  `gaze ${asymRows[asymRows.length - 1].gaze} → cursor ${asymRows[asymRows.length - 1].cursor.toFixed(2)}`
);

// ─────────────────────────────────────────────────────────────────────────
section("A single bad landmark frame cannot crush the reach");

const spiked = sweep({ bootAt: 0.5, halfLeft: HALF, halfRight: HALF, spikeAt: 0.9 });
const spikedLo = Math.min(...spiked.map((r) => r.cursor));
const spikedHi = Math.max(...spiked.map((r) => r.cursor));
check(
  "reach survives a one-frame spike (the envelope never shrinks)",
  spikedHi - spikedLo >= 0.6,
  `${spikedLo.toFixed(2)}..${spikedHi.toFixed(2)} (${((spikedHi - spikedLo) * 100).toFixed(0)}%)`
);
check(
  "and the spike does not shift where centre maps to",
  Math.abs(spiked[Math.floor(spiked.length / 2)].cursor - 0.5) <= 0.15,
  `centre mapped to ${spiked[Math.floor(spiked.length / 2)].cursor.toFixed(2)}`
);

// ─────────────────────────────────────────────────────────────────────────
section("Holding a glance does not drag the pointer");

const holdChain = new EyeChain();
holdChain.hold(0.5, 45, HALF, HALF);
holdChain.hold(0.25, 60, HALF, HALF);
const landed = holdChain.x;
holdChain.hold(0.25, 300, HALF, HALF); // 10 seconds of the same look
check(
  "a fixed gaze maps to a fixed point",
  Math.abs(holdChain.x - landed) < 0.005,
  `${landed.toFixed(3)} → ${holdChain.x.toFixed(3)}`
);

// ─────────────────────────────────────────────────────────────────────────
section("The vertical axis gets the same treatment");

// AutoGain is per-axis; the overlay maps the vertical signal as 1 - map(rawV),
// with rawV positive when looking up. It had the same boot-origin defect.
const yChain = new AutoGain();
const yMap = (screenY: number) => 1 - yChain.map((0.5 - screenY) * 2 * HALF);
for (let i = 0; i < 45; i++) yChain.push((0.5 - 0.1) * 2 * HALF); // boot: top of screen
for (let i = 0; i <= 60; i++) yChain.push((0.5 - i / 60) * 2 * HALF); // sweep downward
const yTop = yMap(0.08);
const yBottom = yMap(0.92);
check("looking up maps to the top of the screen", yTop <= 0.33, `y=${yTop.toFixed(2)}`);
check("looking down maps to the bottom", yBottom >= 0.67, `y=${yBottom.toFixed(2)}`);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
