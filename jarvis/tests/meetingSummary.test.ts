// Meeting bot — summary quality (pure helpers).
//
// The notes are the only thing left after a call, so these tests pin the two
// things that decide whether they are usable: the prompt actually asks for a
// long, fully covered write-up, and a sloppy model response is normalised into
// something the panel and Notion can render without dropping detail.
//
// All pure: no network, no model, no Next runtime.
//
// Run with:  npx tsx tests/meetingSummary.test.ts

import {
  buildSummaryPrompt,
  meetingNoteTitle,
  normalizeMeetingSummary,
  summaryWordCount,
} from "../src/lib/meeting/summary";

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

/* ------------------------------ prompt contract ---------------------------- */

section("summary prompt");

const prompt = buildSummaryPrompt({
  transcript: "[10:00:01] Prof. Rao: today we derive Vdc = 2Vm/pi\n[10:00:20] Student: why 2Vm?",
  platform: "google-meet",
  title: "Electronics — Rectifiers",
  durationMinutes: 47,
  startedAt: "10/28/2026, 10:00:00 AM",
  visualIndex: "VISUAL #1 — diagram — Full-wave bridge rectifier",
});

check("names the meeting by its calendar title", prompt.includes("Electronics — Rectifiers"));
check("reports duration so the model can size the notes", prompt.includes("47 minutes"));
check("asks for multi-paragraph overview", /180-320 words/.test(prompt));
check("demands chronological sections with a floor", /5-12 entries/.test(prompt));
check("asks for quotes", /highlights/.test(prompt) && /Speaker: quote/.test(prompt));
check("asks for concepts/glossary", /concepts/.test(prompt));
check("asks for open questions", /openQuestions/.test(prompt));
check("forbids truncating the meeting", /COVER THE WHOLE MEETING/.test(prompt));
check("forbids invention", /NEVER INVENT/.test(prompt));
check("cites visuals only when frames were captured", /see Visual #N/.test(prompt));
check("includes the raw transcript", prompt.includes("2Vm/pi"));
check("requests raw JSON only", /Return ONLY raw JSON/.test(prompt));

const noVisualPrompt = buildSummaryPrompt({ transcript: "hello", platform: "zoom" });
check("no visual rules without captured frames", !/see Visual #N/.test(noVisualPrompt));

/* -------------------------------- normaliser ------------------------------- */

section("summary normaliser");

check("garbage returns null", normalizeMeetingSummary("nope") === null);
check("empty object returns null", normalizeMeetingSummary({}) === null);

const full = normalizeMeetingSummary({
  summary:
    "The lecture opened with a recap of half-wave rectification.\n\nProf. Rao then derived the bridge output voltage and worked two numericals.",
  keyTopics: ["Half-wave rectification", "Bridge rectifier", "Ripple factor", "Half-wave rectification"],
  sections: [
    {
      heading: "Recap: half-wave rectification",
      body: "Vdc = Vm/pi for a single diode, so half the cycle is wasted.",
      bullets: "- one diode\n- 50Hz ripple",
    },
    { body: "No heading was returned for this stretch, only prose." },
    { heading: "", body: "", bullets: [] },
  ],
  decisions: ["Use a 470uF capacitor as the smoothing element — because 100uF left 4V of ripple."],
  actionItems: [
    { task: "Redo numerical 3 with a 1k load", assignee: "Dhruv", due: "Friday", priority: 9 },
    "Read section 4.2 before the lab",
    { assignee: "nobody" },
  ],
  openQuestions: ["Why does the bridge need four diodes instead of two?"],
  highlights: ["Prof. Rao: four diodes, two conducting at a time — that is the whole trick."],
  concepts: [
    { term: "Ripple factor", explanation: "AC component left on the DC output; 0.482 for a bridge." },
    { term: "", explanation: "dropped — no term" },
  ],
  nextSteps: "Finish numerical 3 and bring the ripple measurements to the lab.",
});

check("overview keeps both paragraphs", (full?.summary.match(/\n\n/g) || []).length === 1);
check("topics are de-duplicated", full?.keyTopics.length === 3, JSON.stringify(full?.keyTopics));
check("sections are kept in order", full?.sections?.[0].heading === "Recap: half-wave rectification");
check("string bullets are split into a list", (full?.sections?.[0].bullets || []).length === 2);
check("missing heading gets a filler heading", Boolean(full?.sections?.[1].heading));
check("empty section is dropped", full?.sections?.length === 2, `${full?.sections?.length}`);
check("string action item becomes a task", Boolean(full?.actionItems?.[1].task?.startsWith("Read section")));
check("taskless action item is dropped", full?.actionItems?.length === 2);
check("priority is clamped to Todoist's 1-4", full?.actionItems?.[0].priority === 4);
check("quotes and questions survive", full?.highlights?.length === 1 && full?.openQuestions?.length === 1);
check("concept without a term is dropped", full?.concepts?.length === 1);
check("next steps survive", (full?.nextSteps || "").startsWith("Finish numerical 3"));

const aliased = normalizeMeetingSummary({
  overview: ["First paragraph.", "Second paragraph."],
  key_topics: ["a", "b"],
  detailed_notes: [{ title: "Intro", content: "Prose from a snake_case model." }],
  action_items: [{ task: "ship it" }],
  open_questions: ["what next?"],
  next_steps: "meet again",
});
check("array overview is joined", aliased?.summary === "First paragraph.\n\nSecond paragraph.");
check("snake_case key topics", aliased?.keyTopics.length === 2);
check("snake_case notes become sections", aliased?.sections?.[0].heading === "Intro");
check("snake_case action items", aliased?.actionItems?.[0].task === "ship it");

const padded = normalizeMeetingSummary({
  summary: "x",
  keyTopics: Array.from({ length: 40 }, (_, i) => `topic ${i}`),
  sections: Array.from({ length: 40 }, (_, i) => ({ heading: `h${i}`, body: "b" })),
  actionItems: Array.from({ length: 60 }, (_, i) => ({ task: `t${i}` })),
  concepts: Array.from({ length: 40 }, (_, i) => ({ term: `t${i}`, explanation: "e" })),
});
check("topics capped", padded?.keyTopics.length === 16);
check("sections capped", padded?.sections?.length === 20);
check("action items capped", padded?.actionItems.length === 30);
check("concepts capped", padded?.concepts?.length === 16);

/* ------------------------------- word budget ------------------------------- */

section("word budget");

const thin = normalizeMeetingSummary({ summary: "We met. It was fine." });
const thick = normalizeMeetingSummary({
  summary: "word ".repeat(300),
  sections: Array.from({ length: 6 }, () => ({ heading: "Part", body: "word ".repeat(120) })),
});
check("a five-line recap counts as thin", summaryWordCount(thin) < 10, `${summaryWordCount(thin)}`);
check("detailed notes count as long", summaryWordCount(thick) > 900, `${summaryWordCount(thick)}`);
check("null summary counts zero", summaryWordCount(null) === 0);

/* --------------------------------- titles --------------------------------- */

section("note titles");

const dated = meetingNoteTitle({
  title: "Electronics — Rectifiers",
  platform: "google-meet",
  date: new Date("2026-10-28T10:00:00"),
});
check("uses the calendar subject and platform", dated.includes("Electronics — Rectifiers") && dated.includes("Google Meet"), dated);
check("dated rows are distinguishable", /Oct 28, 2026/.test(dated), dated);
check("falls back to a generic title", meetingNoteTitle({ platform: "zoom", date: new Date("2026-10-28T10:00:00") }).includes("Zoom"));

/* ---------------------------------- result --------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
