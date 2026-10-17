// Tests for the routine predictor (decayed interpolated Markov + circular time).
//
// The claims worth pinning down, because a proactive assistant that gets these
// wrong is worse than one that stays quiet:
//   • a real daily routine is predicted, with its time, and ranked first,
//   • one-off noise is never predicted,
//   • the model follows a CHANGE in routine instead of averaging it away,
//   • task chains are predicted from the previous action,
//   • times that straddle midnight are handled as a circle, not a number,
//   • thin or malformed history yields silence, never a confident guess.
//
// Run with:  npx tsx tests/routinePredict.test.ts

import {
  toActions,
  predictRoutine,
  nextPrediction,
  describePrediction,
  circularMinuteDistance,
  type Action,
  type RoutineEvent,
} from "../src/lib/memory/routinePredict";

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

const BASE = new Date(2026, 2, 2, 0, 0, 0); // fixed epoch for reproducible tests

/** An event at `day` days + `hour`:`minute` after BASE. */
function ev(day: number, hour: number, minute: number, kind: string, payload: Record<string, unknown>): RoutineEvent {
  const at = new Date(BASE.getTime());
  at.setDate(at.getDate() + day);
  at.setHours(hour, minute, 0, 0);
  return { kind, payload, at };
}

function at(day: number, hour: number, minute = 0): Date {
  const d = new Date(BASE.getTime());
  d.setDate(d.getDate() + day);
  d.setHours(hour, minute, 0, 0);
  return d;
}

// ─────────────────────────────────────────────────────────────────────────
section("Silence when there is nothing to learn from");

check("no events → no predictions", predictRoutine([], new Date()).length === 0);
check("nextPrediction is null with no history", nextPrediction([], new Date()) === null);

const oneOff = toActions([ev(0, 9, 0, "panel", { panel: "spotify" })]);
check("a single occurrence is not a routine", predictRoutine(oneOff, at(1, 9)).length === 0);
check(
  "two occurrences are still not enough",
  predictRoutine(toActions([ev(0, 9, 0, "panel", { panel: "x" }), ev(1, 9, 0, "panel", { panel: "x" })]), at(2, 9)).length === 0
);

section("toActions: only deliberate, well-formed actions become predictable");

const junk: RoutineEvent[] = [
  { kind: "panel", payload: {}, at: at(0, 9) }, // no panel name
  { kind: "contact", payload: {}, at: at(0, 10) }, // no name
  { kind: "search", payload: {}, at: at(0, 11) }, // no query
  { kind: "panel", payload: { panel: "ok" }, at: new Date(NaN) }, // bad timestamp
  { kind: "unknown-kind", payload: { panel: "nope" }, at: at(0, 12) },
];
check("malformed events are dropped", toActions(junk).length === 0);

const stream = toActions([
  ev(1, 9, 0, "panel", { panel: "Terminal" }),
  ev(0, 9, 0, "panel", { panel: "spotify" }),
  ev(0, 10, 0, "search", { q: "weather" }),
  ev(0, 11, 0, "contact", { name: "Ada", platform: "whatsapp" }),
]);
check("the action stream is sorted chronologically", stream.every((a, i) => i === 0 || a.at >= stream[i - 1].at));
check("panel names are normalized into keys", stream[0].key === "panel:spotify", stream[0]?.key);
check("panel labels are readable", stream[0].label === "open spotify", stream[0]?.label);
check("queries collapse to a generic ask action", stream[1].key === "ask", stream[1]?.key);
check(
  "and asks are marked as context, not as a recommendation",
  stream[1].actionable === false && stream[0].actionable === undefined,
  `ask.actionable=${stream[1].actionable} panel.actionable=${stream[0].actionable}`
);
check("contacts keep name + platform", stream[2].key === "contact:ada@whatsapp", stream[2]?.key);

// ─────────────────────────────────────────────────────────────────────────
section("A real daily routine is predicted, with its time and order");

const routine: RoutineEvent[] = [];
for (let day = 0; day < 21; day++) {
  routine.push(ev(day, 9, 0, "panel", { panel: "spotify" }));
  routine.push(ev(day, 9, 5, "panel", { panel: "terminal" }));
  routine.push(ev(day, 13, 0, "search", { q: "lunch" }));
  routine.push(ev(day, 18, 0, "contact", { name: "Ada", platform: "whatsapp" }));
}
const routineActions = toActions(routine);
const morning = at(21, 9, 0);

const p = predictRoutine(routineActions, morning, { limit: 3 });
check("predictions were produced", p.length > 0);
check("the morning panel is ranked first", p[0]?.key === "panel:spotify", p[0]?.key);
check("with a confident probability", (p[0]?.probability ?? 0) > 0.5, `p=${p[0]?.probability}`);
check("and a perfect regularity score", (p[0]?.regularity ?? 0) > 0.9, `R=${p[0]?.regularity}`);
check(
  "the learned time is the actual time of day",
  circularMinuteDistance(p[0]?.meanMinuteOfDay ?? 0, 9 * 60) < 5,
  `mean=${p[0]?.meanMinuteOfDay}`
);
check(
  "the expected moment lands at 09:00",
  p[0]?.expectedAt.getHours() === 9 && p[0]?.expectedAt.getMinutes() === 0,
  `${p[0]?.expectedAt.toISOString()}`
);
check("and it is due right now", Math.abs(p[0]?.minutesAway ?? 999) <= 1, `${p[0]?.minutesAway} min`);
check(
  "the sentence names the action and the time",
  /open spotify around 09:00/.test(describePrediction(p[0])),
  describePrediction(p[0])
);

section("Ranking is aware of the hour you ask about");

const evening = predictRoutine(routineActions, at(21, 18, 0), { limit: 3 });
check("the evening contact tops the list in the evening", evening[0]?.key === "contact:ada@whatsapp", evening[0]?.key);
check(
  "and the morning panel drops below it",
  (evening.find((r) => r.key === "panel:spotify")?.score ?? 1) < (evening[0]?.score ?? 0)
);

section("One-off noise is never predicted");

const noisy = [...routine];
for (let i = 0; i < 8; i++) {
  noisy.push(ev(3 + i, 15, 30, "panel", { panel: `oneoff-${i}` }));
}
const withNoise = predictRoutine(toActions(noisy), morning, { limit: 10 });
check(
  "single-occurrence panels are excluded",
  withNoise.every((r) => !r.key.startsWith("panel:oneoff")),
  withNoise.map((r) => r.key).join(", ")
);
check("the real routine is still on top", withNoise[0]?.key === "panel:spotify");
check("the limit is respected", predictRoutine(toActions(noisy), morning, { limit: 2 }).length <= 2);
check(
  "a flood of asks never becomes the recommendation",
  withNoise.every((r) => r.key !== "ask"),
  withNoise.map((r) => r.key).join(", ")
);
check("scores are sorted descending", withNoise.every((r, i) => i === 0 || r.score <= withNoise[i - 1].score));
check(
  "probabilities are valid",
  withNoise.every((r) => r.probability >= 0 && r.probability <= 1 && Number.isFinite(r.probability))
);

// ─────────────────────────────────────────────────────────────────────────
section("A CHANGED routine is followed, not averaged away");

// Ten days at 09:00, then ten days at 15:00. Recency weighting must pull the
// learned time toward the new behaviour.
const shifted: RoutineEvent[] = [];
for (let day = 0; day < 10; day++) shifted.push(ev(day, 9, 0, "panel", { panel: "spotify" }));
for (let day = 10; day < 20; day++) shifted.push(ev(day, 15, 0, "panel", { panel: "spotify" }));
const learned = predictRoutine(toActions(shifted), at(20, 15), { limit: 1 })[0];
check("the shifted routine is still predicted", !!learned);
check(
  "its time moved toward the recent habit",
  circularMinuteDistance(learned.meanMinuteOfDay, 15 * 60) < circularMinuteDistance(learned.meanMinuteOfDay, 9 * 60),
  `mean=${learned.meanMinuteOfDay} (09:00=540, 15:00=900)`
);

section("A flood of generic asks never buries a real routine");

// Reproduces the real 60-day history this model was tested against, where
// "ask me something" outnumbered every other action ~40:1 and was the top
// prediction at every hour — burying the routines that are actually useful.
const flooded: RoutineEvent[] = [];
for (let day = 0; day < 21; day++) {
  flooded.push(ev(day, 9, 0, "panel", { panel: "spotify" }));
  for (let i = 0; i < 40; i++) {
    flooded.push(ev(day, (7 + i) % 24, (i * 7) % 60, "search", { q: `question ${day}-${i}` }));
  }
}
const floodedPreds = predictRoutine(toActions(flooded), at(21, 9), { limit: 3 });
check(
  "the genuine routine is still the recommendation",
  floodedPreds[0]?.key === "panel:spotify",
  floodedPreds.map((r) => `${r.key}=${r.probability.toFixed(2)}`).join(", ")
);
check(
  "and no generic ask is ever recommended",
  floodedPreds.every((r) => r.key !== "ask"),
  floodedPreds.map((r) => r.key).join(", ")
);
check("with its real time intact", circularMinuteDistance(floodedPreds[0]?.meanMinuteOfDay ?? 0, 540) <= 5);

section("Task chains: the previous action predicts the next");

const chain: RoutineEvent[] = [];
for (let day = 0; day < 8; day++) {
  chain.push(ev(day, 10, 0, "panel", { panel: "vscode" }));
  chain.push(ev(day, 10, 30, "panel", { panel: "terminal" }));
}
const chainActions: Action[] = toActions(chain);
// Right after the day's "open vscode", with nothing else in between.
const afterVscode = predictRoutine(chainActions, at(7, 10, 5), { limit: 2 });
check("the follow-up action is ranked first", afterVscode[0]?.key === "panel:terminal", afterVscode[0]?.key);

section("Midnight is a circle, not a line");

const nightly: RoutineEvent[] = [];
for (let day = 0; day < 12; day++) {
  nightly.push(ev(day, 23, 50, "panel", { panel: "night" }));
  nightly.push(ev(day, 0, 10, "panel", { panel: "night" })); // same habit, other side of midnight
}
const nightLearned = predictRoutine(toActions(nightly), at(12, 23, 55), { limit: 1 })[0];
check("the habit straddling midnight is learned", !!nightLearned);
check(
  "its mean time sits on midnight, not at noon",
  circularMinuteDistance(nightLearned.meanMinuteOfDay, 0) <= 20,
  `mean=${nightLearned.meanMinuteOfDay} min`
);
check(
  "a tight midnight habit still reads as regular",
  nightLearned.regularity > 0.85,
  `R=${nightLearned.regularity}`
);

// The naive arithmetic mean of 23:50 and 00:10 is 12:00 (720) — a classic bug
// this model must not have.
const naiveMean = Math.round((23 * 60 + 50 + 0 * 60 + 10) / 2);
check(
  "and definitely not the arithmetic mean (the 12:00 bug)",
  circularMinuteDistance(nightLearned.meanMinuteOfDay, naiveMean) > 60,
  `naive=${naiveMean} learned=${nightLearned.meanMinuteOfDay}`
);

// ─────────────────────────────────────────────────────────────────────────
section("Proactive prompt: only when the routine is actually due");

const dueNow = nextPrediction(routineActions, at(21, 9, 0));
check("a routine that is due now is offered", dueNow?.key === "panel:spotify", dueNow?.key ?? "null");
const dueLater = nextPrediction(routineActions, at(21, 3, 0));
check("a routine six hours away is not", dueLater === null, dueLater?.key ?? "null");

section("Robustness: bad input cannot produce a confident guess");

check("an empty stream predicts nothing at 3am", predictRoutine([], at(0, 3)).length === 0);
const garbageDates = toActions([
  { kind: "panel", payload: { panel: "x" }, at: new Date("not a date") },
  { kind: "panel", payload: { panel: "y" }, at: new Date(8.64e15 * 2) },
]);
check("invalid dates are dropped", garbageDates.length === 0);
check(
  "events far in the future cannot inform the present",
  predictRoutine(toActions([ev(0, 9, 0, "panel", { panel: "x" }), ev(400, 9, 0, "panel", { panel: "x" })]), at(2, 9)).length === 0
);

// A NaN `now` must not throw or produce nonsense.
const badNow = predictRoutine(routineActions, new Date("nope"), { limit: 1 });
check("a NaN `now` is tolerated", Array.isArray(badNow));
check(
  "and every returned field is finite",
  badNow.every(
    (r) => Number.isFinite(r.probability) && Number.isFinite(r.expectedAt.getTime()) && Number.isFinite(r.minutesAway)
  )
);

check(
  "circularMinuteDistance handles wrap-around",
  circularMinuteDistance(1435, 5) === 10 && circularMinuteDistance(10, 10) === 0
);

// ─────────────────────────────────────────────────────────────────────────
section("Lookback window keeps dead history out");

// An action that only happened 200 days ago is not a routine.
const ancient: RoutineEvent[] = [];
for (let day = 0; day < 10; day++) ancient.push(ev(-200 + day, 9, 0, "panel", { panel: "ancient" }));
check(
  "history older than the lookback window is ignored",
  predictRoutine(toActions(ancient), at(1, 9), { lookbackDays: 60 }).length === 0
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
