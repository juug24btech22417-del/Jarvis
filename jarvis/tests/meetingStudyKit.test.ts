// Meeting bot — revision kit exports.
//
// The CSV has to survive Anki's importer (quoted fields, embedded commas,
// quotes and newlines) and the markdown sheet has to be readable on its own.
// These pin both, plus the normaliser that keeps a sloppy model response from
// shipping an empty card.
//
// All pure: no network, no fs.
//
// Run with:  npx tsx tests/meetingStudyKit.test.ts

import {
  buildStudyKitPrompt,
  flashcardsToCsv,
  normalizeStudyKit,
  studyKitFromSummary,
  studyKitSlug,
  studyKitToMarkdown,
  type StudyKit,
} from "../src/lib/meeting/studyKit";

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

/* --------------------------------- prompt --------------------------------- */

section("kit prompt");

const prompt = buildStudyKitPrompt({
  transcript: "[1] 00:05 Prof. Rao: Vout = Vpeak / pi for the bridge.",
  source: {
    title: "Electronics — Rectifiers",
    summary: "Bridge rectifier derivation.",
    concepts: [{ term: "Ripple factor", explanation: "AC left on the DC output." }],
    visuals: [{ title: "Bridge rectifier", clock: "10:00:42", description: "Schematic", textOnScreen: "Vout = Vpeak / pi ≈ 3.82V" }],
  },
  meetingTitle: "Electronics — Rectifiers",
  platform: "google-meet",
});

check("the meeting is named", prompt.includes("Electronics — Rectifiers"));
check("the transcript is included", prompt.includes("Vpeak / pi"));
check("known concepts are passed in", prompt.includes("Ripple factor"));
check("text read off a screenshot is passed in", prompt.includes("text on screen: Vout = Vpeak / pi"));
check("on-screen formulas are explicitly allowed", /written on screen counts/.test(prompt));
check("the card count floor is stated", /12-30 cards/.test(prompt));
check("it asks for formulas separately", /FORMULA SHEET/.test(prompt));
check("it forbids inventing formulas", /Never invent one/.test(prompt));

/* -------------------------------- normalise ------------------------------- */

section("kit normaliser");

check("garbage is rejected", normalizeStudyKit("nope") === null);
check("an empty kit is rejected", normalizeStudyKit({ flashcards: [], formulas: [] }) === null);

const kit = normalizeStudyKit(
  {
    flashcards: [
      { front: "What is Vout for a bridge rectifier?", back: "Vout = Vpeak / pi, ~3.82V for 12V AC.", tag: "Rectifiers" },
      { question: "Why divide by pi?", answer: "The average of a rectified sine over a half cycle." },
      { front: "Missing answer" },
      "not an object",
    ],
    formulas: [
      { name: "Bridge output", expression: "Vout = Vpeak / pi", meaning: "Vpeak is the peak AC voltage", useWhen: "Full-wave rectifier with no load" },
      { expression: "" },
      { name: "Quadratic", formula: "x = (-b ± sqrt(b²-4ac)) / 2a", definition: "Roots of ax²+bx+c=0" },
      { expression: "P = V I" },
    ],
  },
  "Electronics"
);

check("the kit is built", Boolean(kit));
check("only complete cards survive", kit?.flashcards.length === 2, `${kit?.flashcards.length}`);
check("question/answer aliases are read", kit?.flashcards[1].front === "Why divide by pi?");
check("tags are optional", kit?.flashcards[1].tag === undefined);
check("formulas are normalised", kit?.formulas.length === 3, `${kit?.formulas.length}`);
check("formula aliases are read", Boolean(kit?.formulas[1].expression.startsWith("x = (")));
check("a named formula keeps its name", kit?.formulas[1].name === "Quadratic");
check("a missing name falls back to the expression", kit?.formulas[2].name === "P = V I", kit?.formulas[2].name);
check("the title is carried", kit?.title === "Electronics");

const padded = normalizeStudyKit({
  flashcards: Array.from({ length: 90 }, (_, i) => ({ front: `q${i}`, back: `a${i}` })),
  formulas: Array.from({ length: 60 }, (_, i) => ({ expression: `f${i}` })),
});
check("cards are capped", padded?.flashcards.length === 60);
check("formulas are capped", padded?.formulas.length === 40);

const fromSummary = studyKitFromSummary({
  title: "Electronics",
  concepts: [
    { term: "Ripple factor", explanation: "AC component on the DC output." },
    { term: "", explanation: "dropped" },
  ],
});
check("a fallback kit can be built from the glossary", fromSummary?.flashcards.length === 1);
check("the fallback card is a question", fromSummary?.flashcards[0].front === "What is Ripple factor?");
check("a glossary-less summary yields no fallback", studyKitFromSummary({ concepts: [] }) === null);

/* ---------------------------------- CSV ----------------------------------- */

section("anki csv");

const csv = flashcardsToCsv([
  { front: "What is Vout?", back: 'Vpeak / pi, "about" 3.82V', tag: "Rectifiers" },
  { front: "Line one\nline two", back: "Multi-line answer" },
  { front: 'Quote "inside"', back: "Comma, inside" },
]);

const rows = csv.split("\r\n").filter(Boolean);
check("one row per card", rows.length === 3, `${rows.length}`);
check("the first row is quoted on all three fields", (rows[0].match(/(^|,)\"/g) || []).length === 3);
check("embedded quotes are doubled", rows[0].includes('""about""'));
check("a newline inside a field stays inside the quotes", rows[1].includes("Line one\nline two"));
check("commas do not split fields", rows[2].includes('"Comma, inside"'));
check("the file ends with a newline", csv.endsWith("\r\n"));
check("no cards means no rows", flashcardsToCsv([]) === "");

/* -------------------------------- markdown -------------------------------- */

section("markdown sheet");

const markdownKit: StudyKit = {
  flashcards: [
    { front: "What is Vout?", back: "Vpeak / pi", tag: "Rectifiers" },
    { front: "Why pi?", back: "Average of a half sine." },
  ],
  formulas: [
    { name: "Bridge output", expression: "Vout = Vpeak / pi", meaning: "Vpeak = peak AC", useWhen: "No load" },
  ],
  generatedAt: "2026-10-28T10:00:00.000Z",
  title: "Electronics — Rectifiers",
};

const md = studyKitToMarkdown(markdownKit, {
  summary: "Bridge rectifier derivation.",
  concepts: [{ term: "Ripple", explanation: "AC on the DC output." }],
});

check("the sheet is titled after the meeting", md.startsWith("# Electronics — Rectifiers"));
check("the overview is included", md.includes("## Overview") && md.includes("Bridge rectifier derivation."));
check("the formula sheet section exists", md.includes("## Formula sheet"));
check("the expression is fenced for copying", md.includes("```\nVout = Vpeak / pi\n```"));
check("the meaning and the use case are both shown", md.includes("**Meaning:**") && md.includes("**Use when:**"));
check("concepts are listed", md.includes("- **Ripple** — AC on the DC output."));
check("cards are numbered", md.includes("1. **What is Vout?**") && md.includes("2. **Why pi?**"));
check("tags are rendered in italics", md.includes("_Rectifiers_"));

const emptySheet = studyKitToMarkdown({ flashcards: [], formulas: [], generatedAt: "2026-10-28T10:00:00.000Z" }, {});
check("a formula-less meeting says so", emptySheet.includes("_No formulas were used in this meeting._"));

/* ---------------------------------- slug ---------------------------------- */

section("download names");

check("spaces and symbols collapse to dashes", studyKitSlug("Electronics — Rectifiers (Unit 2)!") === "electronics-rectifiers-unit-2");
check("an empty title falls back", studyKitSlug("") === "meeting-revision");
check("the slug is filesystem-safe", !/[^a-z0-9-]/.test(studyKitSlug("Программа: 100% done")));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
