// Tests for the overlay's context brain.
//
// What is actually at risk here:
//   • the metadata line leaking into the answer the user reads (it streams in
//     character by character, so the parser has to hold back partial markers)
//   • the topic going stale-proof but useless (marking everything stale in a
//     real call would make the STALE tag meaningless)
//   • facts growing without bound, pushing the real context out of the prompt
//
// Run with:  npx tsx tests/overlayContext.test.ts

import {
  currentExchange,
  detectTopicShift,
  markStale,
  mergeFacts,
  nextTopicLabel,
  parseMeta,
  rollingWindow,
  similarity,
  splitStreamingAnswer,
  turnsToCompact,
  updateFacts,
  type Exchange,
  type Turn,
} from "../src/lib/overlay/contextBrain";
import { META_SENTINEL } from "../src/lib/overlay/modes";

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

const META = `${META_SENTINEL} {"confidence":"high","why":"direct question","facts":["stack is Next.js"],"topic":"api auth"}>>>`;

// ─────────────────────────────────────────────────────────────────────────
section("The metadata line never reaches the reader");

const full = `Use a short-lived JWT.\n\n${META}`;
const split = splitStreamingAnswer(full);
check("body excludes the marker", !split.body.includes(META_SENTINEL), split.body.slice(-40));
check("body keeps the answer", split.body.startsWith("Use a short-lived JWT."));
check("marker is recognised as complete", split.complete);
check("metadata is parsed", split.meta?.confidence === "high" && split.meta?.topic === "api auth");
check("facts survive parsing", split.meta?.facts?.[0] === "stack is Next.js");

// The killer case: the user must never see a half-arrived marker.
let leaked = "";
for (let i = 1; i <= META_SENTINEL.length + 4; i++) {
  const partial = `Answer text.\n${META_SENTINEL.slice(0, i)}`;
  const s = splitStreamingAnswer(partial);
  if (s.body.includes("<") || s.body.includes("JARVIS_META")) leaked = s.body;
}
check("a partially streamed marker is held back, not flashed", leaked === "", `leaked: ${leaked}`);

const noMarker = splitStreamingAnswer("Just an answer, still arriving");
check("an answer without metadata is passed through untouched", noMarker.body === "Just an answer, still arriving");
check("no phantom metadata", noMarker.meta === null);

check(
  "a torn JSON payload does not throw and yields no meta",
  splitStreamingAnswer(`${META_SENTINEL} {"confidence":"hi`).meta === null
);
check(
  "metadata without the closing >>> still parses (models forget it)",
  parseMeta(`{"confidence":"low","topic":"pricing"}>>>`)?.confidence === "low"
);
check("a bad confidence value is dropped rather than shown", parseMeta(`{"confidence":"maybe"}`)?.confidence === undefined);

// ─────────────────────────────────────────────────────────────────────────
section("Topic continuity: stale means the subject moved, not the sentence");

const topic = "api authentication and the token expiry trade-off";
const onTopic = "and how do you handle refresh tokens for the same api?";
const offTopic = "right, switching gears — what salary range are we talking about for the chef role";

check("a follow-up on the same subject is NOT a shift", !detectTopicShift(topic, onTopic), `sim=${similarity(topic, onTopic).toFixed(2)}`);
check("a genuinely new subject IS a shift", detectTopicShift(topic, offTopic), `sim=${similarity(topic, offTopic).toFixed(2)}`);
check("a two-word continuation is not a shift on its own", !detectTopicShift(topic, "and then?"));
check("an empty topic is a shift (nothing to continue)", detectTopicShift("", "anything at all here"));

check(
  "the model's topic label wins when it gives one",
  nextTopicLabel(topic, onTopic, "refresh tokens") === "refresh tokens"
);
check(
  "the topic carries forward while the subject holds",
  nextTopicLabel(topic, onTopic) === topic
);

const exs: Exchange[] = [
  { id: "a", question: "q1", answer: "a1", mode: "general", density: "brief", style: "quick", at: 1 },
  { id: "b", question: "q2", answer: "a2", mode: "general", density: "brief", style: "quick", at: 2 },
];
const staleMarked = markStale(exs, "b");
check("the newest answer is the live one", currentExchange(staleMarked)?.id === "b");
check("everything else is marked stale", staleMarked.filter((e) => e.stale).length === 1);
check("stale answers are kept, not deleted", staleMarked.length === 2);

// ─────────────────────────────────────────────────────────────────────────
section("Facts: newest wins, duplicates do not grow the prompt");

let facts = mergeFacts([], ["budget is 40k", "they use Postgres"]);
check("first facts are kept", facts.length === 2);
facts = mergeFacts(facts, ["budget is 40k"]);
check("an exact repeat is not stored twice", facts.length === 2);
facts = mergeFacts(facts, ["They use PostgreSQL"]);
check("a fuzzy repeat is also rejected", facts.length === 2, facts.join(" | "));

const updated = updateFacts(["the target date is March"], ["the target date is March 14th"]);
check("a fact with new detail replaces the old one", updated.length === 1 && updated[0].includes("14th"), updated.join(" | "));

// Genuinely different facts, so this measures the CAP and not the dedupe.
const NOUNS = [
  "budget", "timeline", "stack", "headcount", "customer", "deadline", "vendor", "pricing", "scope",
  "risk", "metric", "owner", "contract", "region", "compliance", "launch", "support", "training",
  "hardware", "security", "hiring", "retention", "revenue", "margin", "roadmap", "backlog",
  "incident", "outage", "latency", "uptime",
];
const distinct = NOUNS.map((noun, i) => `fact ${i} ${noun}`);
const bounded = updateFacts([], distinct, 12);
check("the fact list stays bounded", bounded.length === 12, `${bounded.length}`);
check("the newest facts are the ones kept", bounded[bounded.length - 1].includes("29"));
check("near-identical facts collapse instead of piling up", updateFacts([], ["budget is 40k", "budget is 40k total"], 12).length === 1);

// ─────────────────────────────────────────────────────────────────────────
section("Rolling window: bounded prompt, newest first");

const turns: Turn[] = Array.from({ length: 40 }, (_, i) => ({
  id: `t${i}`,
  role: i % 2 ? "you" : "them",
  text: `sentence number ${i} about the deployment plan and its risks`,
  at: i,
}));
const win = rollingWindow(turns, 10, 2600);
check("the window is capped by count", win.length <= 10, `${win.length}`);
check("it keeps the NEWEST turns", win[win.length - 1].text.includes("39"));
check("it is in chronological order", win[0].at < win[win.length - 1].at);
check("everything older is summarised instead", turnsToCompact(turns, 10) === 30);

const longTurns: Turn[] = [
  { id: "l1", role: "them", text: "x".repeat(3000), at: 1 },
  { id: "l2", role: "you", text: "short answer", at: 2 },
];
const capped = rollingWindow(longTurns, 10, 2600);
check("a huge older turn is dropped rather than overflowing the prompt", capped.length === 1 && capped[0].id === "l2");

check("empty turns are ignored", rollingWindow([{ id: "e", role: "them", text: "   ", at: 1 }]).length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
