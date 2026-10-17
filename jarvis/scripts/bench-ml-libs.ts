// Performance benchmarks for the perception/prediction libraries.
//
// These run inside latency-critical loops — the gaze adapter on every directed
// glance, the cursor model at 60Hz, grounding on every agent step — so "fast"
// has to be a measured number with a budget, not an impression. Each section
// FAILS if it blows its budget, so this doubles as a regression test.
//
// Run with:  npm run bench:ml

import { GazeAdapter, type GazeSample } from "../src/lib/gazeAdapt";
import { GazeCursor } from "../src/lib/gazeCursor";
import { predictRoutine, toActions, type RoutineEvent } from "../src/lib/memory/routinePredict";
import { bestMatch, type GroundCandidate } from "../src/lib/screen/elementGrounding";
import { classifyChange, type ScreenSnapshot } from "../src/lib/screen/screenChange";

let passed = 0;
let failed = 0;

/** Sub-millisecond numbers are microseconds — print them as such. */
function fmt(ms: number): string {
  return ms < 0.01 ? `${(ms * 1000).toFixed(2)}\u00b5s` : `${ms.toFixed(3)}ms`;
}

function budget(name: string, measuredMs: number, limitMs: number, detail = "") {
  const ok = measuredMs <= limitMs;
  if (ok) passed++;
  else failed++;
  const mark = ok ? "\u2713" : "\u2717";
  console.log(
    `  ${mark} ${name}: ${fmt(measuredMs)} (budget ${fmt(limitMs)})${detail ? ` — ${detail}` : ""}`
  );
}

function ms(fn: () => void, iterations = 1): number {
  const t0 = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  return (performance.now() - t0) / iterations;
}

// ── Gaze adapter: runs per accepted fixation (a few times per second) ────
console.log("\nOnline gaze adapter (per fixation)");
const adapter = new GazeAdapter();
const base = (s: GazeSample) => ({ x: 0.5 + 6 * s.h, y: 0.5 - 7 * s.v });
let n = 0;
const pushMs = ms(() => {
  const s: GazeSample = {
    h: ((n % 20) - 10) / 400,
    v: ((n % 13) - 6) / 400,
    x: 0.5 + ((n % 20) - 10) / 40,
    y: 0.5 - ((n % 13) - 6) / 40,
    mode: "auto",
  };
  n++;
  adapter.push(s, base(s));
}, 5000);
budget("push() (RLS update + guard rails)", pushMs, 0.5, "5k samples");

const correctMs = ms(() => {
  adapter.correct({ h: 0.01, v: -0.02, yaw: 0.001, pitch: 0.002 }, { x: 0.4, y: 0.6 });
}, 20000);
budget("correct() (applied every gaze frame)", correctMs, 0.05, "20k calls");

// ── Cursor model: 60Hz loop, so the budget is a fraction of 16.7ms ───────
console.log("\nGaze cursor model (60Hz drive loop)");
const cursor = new GazeCursor();
let t = 0;
const stepMs = ms(() => {
  t += 0.016;
  cursor.step({ x: 0.5 + 0.3 * Math.sin(t), y: 0.5 + 0.2 * Math.cos(t) }, 0.016);
}, 20000);
budget("step() (engage → glide → settle)", stepMs, 0.05, "20k frames");

// ── Routine prediction: a dashboard/briefing call ────────────────────────
console.log("\nRoutine prediction (per API call)");
const events: RoutineEvent[] = [];
const now = new Date();
for (let d = 60; d >= 1; d--) {
  for (let k = 0; k < 60; k++) {
    const at = new Date(now.getTime() - d * 86_400_000);
    at.setHours(k % 24, (k * 7) % 60, 0, 0);
    events.push({
      kind: k % 3 === 0 ? "panel" : k % 3 === 1 ? "search" : "contact",
      payload: k % 3 === 0 ? { panel: `app-${k % 12}` } : k % 3 === 1 ? { q: `query ${k}` } : { name: `Person${k % 9}` },
      at,
    });
  }
}
const actions = toActions(events);
console.log(`  (corpus: ${events.length} events -> ${actions.length} actions)`);
const predictMs = ms(() => {
  predictRoutine(actions, now, { limit: 3 });
}, 50);
budget("predictRoutine() on the API's row cap", predictMs, 100, "avg of 50 runs");

// ── Grounding: runs on every agent step that names a target ─────────────
console.log("\nElement grounding (per agent step)");
const page: GroundCandidate[] = Array.from({ length: 70 }, (_, i) => ({
  ref: `j${i + 1}`,
  role: i % 7 === 0 ? "link" : i % 11 === 0 ? "textbox" : "button",
  name: i % 11 === 0 ? `Search field ${i}` : `Action ${i} for the account`,
}));
const groundMs = ms(() => {
  bestMatch("click the blue Subscribe button", page);
}, 5000);
budget("bestMatch() over 70 elements", groundMs, 3, "5k queries");

// ── Change verification: runs after every mutating agent action ─────────
console.log("\nScreen-change verification (per agent action)");
const long = Array.from({ length: 180 }, (_, i) => `phrase${i}`).join(" ");
const before: ScreenSnapshot = { url: "https://x.test/a", title: "T", text: long, elements: page };
const after: ScreenSnapshot = { url: "https://x.test/b", title: "T", text: `${long} extra`, elements: page.slice(0, 68) };
const changeMs = ms(() => {
  classifyChange(before, after);
}, 5000);
budget("classifyChange() on a full page excerpt", changeMs, 2, "5k comparisons");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
