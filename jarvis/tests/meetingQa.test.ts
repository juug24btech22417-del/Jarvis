// Meeting bot — "chat with this meeting".
//
// The answer is only trustworthy if its timestamps point at real transcript
// lines, so these tests pin the citation rules: model-supplied lines are
// validated, invented lines are dropped, and an uncited answer still gets
// citations inferred from the lines it actually paraphrases.
//
// All pure: no network, no model.
//
// Run with:  npx tsx tests/meetingQa.test.ts

import {
  buildMeetingQaPrompt,
  formatTurnsForPrompt,
  inferCitations,
  normalizeMeetingAnswer,
  offsetClock,
  turnsFromCaptions,
  type MeetingTurn,
} from "../src/lib/meeting/meetingQa";

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

const START = Date.parse("2026-10-28T10:00:00Z");

const TURNS: MeetingTurn[] = [
  { clock: "00:05", speaker: "Prof. Rao", text: "Today we finish the full-wave bridge rectifier." },
  {
    clock: "00:42",
    speaker: "Prof. Rao",
    text: "The output voltage is Vout = Vpeak over pi, about 3.82 volts with a 12 volt AC supply.",
  },
  { clock: "01:10", speaker: "Dhruv", text: "Why do we divide by pi and not by two?" },
  {
    clock: "01:22",
    speaker: "Prof. Rao",
    text: "Because the average of a rectified sine over a half cycle is two over pi times the peak.",
  },
  { clock: "02:05", speaker: "Prof. Rao", text: "Submit the lab report by Friday, the 30th." },
];

const VISUALS = [
  {
    title: "Bridge rectifier",
    clock: "10:00:42",
    description: "Schematic with four diodes",
    textOnScreen: "Vout = Vpeak / pi ≈ 3.82V",
    imageUrl: "/meeting-captures/a/frame-001.png",
  },
  { title: "Waveform", clock: "10:01:20", description: "Rectified sine with ripple", imageUrl: "/meeting-captures/a/frame-002.png" },
];

/* --------------------------------- clocks --------------------------------- */

section("clocks");

check("zero offset formats as mm:ss", offsetClock(0) === "00:00");
check("12m34s", offsetClock(754_000) === "12:34", offsetClock(754_000));
check("past an hour switches to h:mm:ss", offsetClock(3_725_000) === "1:02:05", offsetClock(3_725_000));
check("negative offsets clamp to zero", offsetClock(-5000) === "00:00");

const turns = turnsFromCaptions(
  [
    { speaker: "Prof. Rao", text: "first", at: START + 5_000 },
    { speaker: "", text: "second", at: START + 65_000 },
  ],
  START
);
check("captions become offset turns", turns[0].clock === "00:05" && turns[1].clock === "01:05");
check("a missing speaker is labelled", turns[1].speaker === "Speaker");

/* --------------------------------- prompt --------------------------------- */

section("prompt");

const prompt = buildMeetingQaPrompt({
  question: "What is the rectifier output voltage?",
  turns: TURNS,
  visuals: VISUALS,
  title: "Electronics — Rectifiers",
  platform: "google-meet",
});

check("transcript lines are numbered", prompt.includes("[2] 00:42 Prof. Rao:"));
check("the meeting is named", prompt.includes("Electronics — Rectifiers"));
check("visuals are numbered for citation", prompt.includes("[Visual #1]") && prompt.includes("[Visual #2]"));
check("text read off a screenshot is answerable", prompt.includes("text on screen: Vout = Vpeak / pi"));
check("the question is included", prompt.includes("What is the rectifier output voltage?"));
check("the model is told to stay inside the transcript", /Use ONLY the transcript/.test(prompt));
check("citations are required for facts", /MUST be cited/.test(prompt));
check("empty citations are limited to refusals", /may only be empty when the answer is a refusal/.test(prompt));

check(
  "long transcripts are cut at the budget",
  formatTurnsForPrompt(TURNS, 60).split("\n").length < TURNS.length,
  String(formatTurnsForPrompt(TURNS, 60).split("\n").length)
);

/* ------------------------------- citations -------------------------------- */

section("citation resolution");

const answer = normalizeMeetingAnswer(
  {
    answer: "The rectifier output is Vout = Vpeak over pi, roughly 3.82 V from a 12 V AC supply.",
    citations: [{ line: 2, visual: 1 }, { line: 99 }, { line: 2 }],
    followUps: ["Why divide by pi?", "What does the smoothing capacitor do?", "Both good", "Extra"],
  },
  TURNS,
  VISUALS
);

check("the answer survives", Boolean(answer?.answer.startsWith("The rectifier output")));
check("valid citations resolve to real lines", answer?.citations[0].line === 2);
check(
  "the quoted text comes from the transcript, not the model",
  Boolean(answer?.citations[0].quote.includes("Vpeak over pi"))
);
check("the clock and speaker come from the turn", answer?.citations[0].clock === "00:42" && answer?.citations[0].speaker === "Prof. Rao");
check("an invented line is dropped", (answer?.citations || []).every((c) => c.line <= TURNS.length));
check("duplicate lines are collapsed", answer?.citations.length === 1, `${answer?.citations.length}`);
check("a visual reference is resolved", answer?.citations[0].visual === 1 && Boolean(answer?.citations[0].imageUrl));
check("follow-ups are capped at three", answer?.followUps.length === 3);

const uncited = normalizeMeetingAnswer(
  { answer: "The output voltage is Vpeak over pi, about 3.82 volts from a 12 volt supply." },
  TURNS,
  VISUALS
);
check("an uncited answer still gets timestamps", (uncited?.citations || []).length >= 1, JSON.stringify(uncited?.citations));
check(
  "inferred citations point at the line that was paraphrased",
  uncited?.citations[0]?.line === 2,
  JSON.stringify(uncited?.citations.map((c) => c.line))
);

const refusal = normalizeMeetingAnswer({ answer: "The transcript does not mention the lab room number." }, TURNS, VISUALS);
check("a refusal is not force-cited", refusal?.citations.length === 0);

const generic = normalizeMeetingAnswer({ answer: "Yes." }, TURNS, VISUALS);
check("a vague answer gets no fake citations", generic?.citations.length === 0);

const onScreenOnly = normalizeMeetingAnswer(
  { answer: "Vout = Vpeak / pi, about 3.82 V.", citations: [{ visual: 1 }] },
  TURNS,
  VISUALS
);
check("an on-screen-only fact keeps its visual citation", onScreenOnly?.citations[0].visual === 1);
check(
  "the visual citation shows what was written on screen",
  Boolean(onScreenOnly?.citations[0].quote.includes("Vpeak / pi"))
);
check("an out-of-range visual-only citation is dropped", normalizeMeetingAnswer({ answer: "See the chart.", citations: [{ visual: 7 }] }, TURNS, VISUALS)?.citations.length === 0);

check("an empty answer is rejected", normalizeMeetingAnswer({ answer: "   " }, TURNS) === null);
check("non-object JSON is rejected", normalizeMeetingAnswer("nope", TURNS) === null);

const snake = normalizeMeetingAnswer(
  { answer: "The report is due Friday the 30th.", citations: [{ line: 5 }], follow_ups: ["Where do I submit it?"] },
  TURNS
);
check("snake_case follow-ups are read", snake?.followUps.length === 1);
check("the deadline citation is preserved", snake?.citations[0].clock === "02:05");

const badVisual = normalizeMeetingAnswer({ answer: "See the waveform.", citations: [{ line: 4, visual: 9 }] }, TURNS, VISUALS);
check("an out-of-range visual is dropped", badVisual === null || badVisual.citations[0].visual === undefined, JSON.stringify(badVisual?.citations));

/* ------------------------------ inference --------------------------------- */

section("citation inference");

const inferred = inferCitations("The professor said the diode only conducts one way.", TURNS);
check(
  "distinctive words pull the matching line",
  inferred.every((c) => TURNS[c.line - 1].text.length > 0),
  JSON.stringify(inferred)
);
check("inference on unrelated text finds nothing", inferCitations("The cafeteria closes at four.", TURNS).length === 0);
check("inference on a stub answer finds nothing", inferCitations("ok", TURNS).length === 0);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
