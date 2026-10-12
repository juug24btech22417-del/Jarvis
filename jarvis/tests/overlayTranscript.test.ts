// Tests for transcript hygiene and the bounded audio queue.
//
// Whisper answers silence with plausible speech ("Thank you.", "Thanks for
// watching!"), and those lines used to land in the transcript pane and in the
// answer prompt as if someone had said them. The queue is the other half: a slow
// network must drop stale audio rather than grow without bound.
//
// Run with:  npx tsx tests/overlayTranscript.test.ts

import { cleanTranscript, dedupeAgainst, isLikelyHallucination, speakerLabel } from "../src/lib/overlay/transcript";
import { createBoundedQueue } from "../src/lib/overlay/queue";

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
section("Whisper's silence artefacts never reach the user");

for (const artefact of [
  "Thank you.",
  "thanks for watching!",
  "Please subscribe",
  "[BLANK_AUDIO]",
  "(silence)",
  "♪",
  "Subtitles by the Amara.org community",
  "   ",
  "you",
  "Okay. Okay. Okay. Okay.",
  "hmm",
]) {
  const r = cleanTranscript(artefact);
  check(`filtered: ${JSON.stringify(artefact)}`, r.filtered && r.text === "", `got ${JSON.stringify(r.text)}`);
}

section("Real speech is never filtered");

for (const real of [
  "So how would you handle the migration if the schema changes?",
  "We should probably use a queue for that.",
  "The budget for this quarter is forty thousand dollars.",
  "Yes, that works.",
  "Let me share my screen and show you the dashboard.",
]) {
  const r = cleanTranscript(real);
  check(`kept: ${JSON.stringify(real.slice(0, 32))}…`, !r.filtered && r.text.length > 0);
}

check(
  "articles and volume words are not mistaken for fillers",
  !isLikelyHallucination("The database is the bottleneck in the write path")
);
check("a number alone is not treated as speech noise", !isLikelyHallucination("Forty thousand is the cap"));

// ─────────────────────────────────────────────────────────────────────────
section("Overlapping chunks are not repeated into the transcript");

check(
  "the tail of the previous chunk is trimmed off the next",
  dedupeAgainst("so the plan is to ship on friday", "to ship on friday and then monitor") === "and then monitor",
  JSON.stringify(dedupeAgainst("so the plan is to ship on friday", "to ship on friday and then monitor"))
);
check("an exact repeat is dropped entirely", dedupeAgainst("same thing again", "same thing again") === "");
check("new content passes through untouched", dedupeAgainst("hello there", "completely different sentence") === "completely different sentence");
check("no previous text means no trimming", dedupeAgainst("", "first thing said") === "first thing said");
check("short coincidences are not trimmed (would eat real words)", dedupeAgainst("we can do it", "it matters a lot") === "it matters a lot");

section("Speaker labels tell the two ears apart");
check("system audio is the other person", speakerLabel("system") === "THEM");
check("mic is you", speakerLabel("mic") === "YOU");
check("typed is you", speakerLabel("typed") === "YOU");

// ─────────────────────────────────────────────────────────────────────────
// The queue is async, and tsx runs these files as CJS (no top-level await), so
// the async half of the file lives in one entry point.
async function queueTests() {
section("The upload queue is bounded and keeps the freshest audio");

const started: number[] = [];
const finished: number[] = [];
let release: Array<() => void> = [];
const dropped: unknown[] = [];

const queue = createBoundedQueue<number>(
  async (n) => {
    started.push(n);
    await new Promise<void>((r) => release.push(r));
    finished.push(n);
  },
  { concurrency: 2, maxPending: 2, onDrop: (item) => dropped.push(item) }
);

/** Let the queue's microtasks run (it starts work off the call stack). */
const flush = () => new Promise((r) => setTimeout(r, 5));
const releaseAll = () => {
  const rs = release;
  release = [];
  rs.forEach((r) => r());
};

for (let i = 1; i <= 6; i++) queue.push(i);
await flush();

check("only the concurrency limit runs at once", started.length === 2, `${started.length} started`);
check("the pending buffer is capped", queue.pending === 2, `${queue.pending} pending`);
check("the OLDEST waiting chunk is the one dropped", JSON.stringify(dropped) === "[3,4]", JSON.stringify(dropped));
check("the newest audio survives", started.includes(1) && queue.pending === 2);

releaseAll();
await flush();
releaseAll();
await flush();
check("the queue drains and finishes what it kept", finished.length === 4, `${finished.length} finished`);
check("drain resolves once idle", await queue.drain().then(() => true));

section("A failing upload cannot poison the session");
const failing = createBoundedQueue<number>(async () => {
  throw new Error("network down");
}, { concurrency: 1 });
failing.push(1);
failing.push(2);
await failing.drain();
check("errors are swallowed and the queue keeps going", failing.inflight === 0 && failing.pending === 0);

section("clear() empties the queue, aborting nothing already in flight");
const clearing = createBoundedQueue<number>(async () => {
  await new Promise((r) => setTimeout(r, 20));
}, { concurrency: 1, maxPending: 5 });
clearing.push(1);
clearing.push(2);
clearing.push(3);
clearing.clear();
check("everything waiting is dropped", clearing.pending === 0);
await clearing.drain();
check("and the queue still settles", clearing.inflight === 0);
}

void queueTests().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
