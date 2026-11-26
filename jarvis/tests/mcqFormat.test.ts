// Multiple-choice formatting tests.
//
// Copied quizzes used to be answered as a paragraph, which is unusable for a
// quiz — the answer has to line up with the question number. These tests pin
// three things: real quiz shapes are recognised, ordinary questions and plain
// lists are NOT reformatted, and both prompt surfaces (clipboard + chat/orb)
// carry the answer-key instruction.
//
// Run with:  npx tsx tests/mcqFormat.test.ts

import { detectMcq, mcqChatDirective, mcqClipboardTask } from "../src/lib/agent/mcq";

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

// ── Shapes people actually paste ──────────────────────────────────────────
section("Detects real quizzes");

const classic = `1. What is the capital of France?
A) Paris
B) London
C) Berlin
D) Madrid

2. Which planet is known as the Red Planet?
A) Venus
B) Mars
C) Jupiter
D) Saturn

3. Water freezes at what temperature?
A. 0°C
B. 50°C
C. 100°C
D. -10°C`;

const c1 = detectMcq(classic);
check("classic A) quiz recognised", !!c1);
check("counts 3 questions", c1?.questions === 3, `got ${c1?.questions}`);
check("counts 12 options", c1?.options === 12, `got ${c1?.options}`);
check("reports option range", c1?.labels === "A\u2013D", `got ${c1?.labels}`);

const parens = `Q1. The powerhouse of the cell is:
(a) Nucleus
(b) Mitochondria
(c) Ribosome
(d) Golgi

Q2. DNA stands for:
(a) Deoxyribonucleic acid
(b) Dinucleic acid
(c) Deoxyribose
(d) Diribonucleic acid`;

const c2 = detectMcq(parens);
check("(a)/(b) style recognised", !!c2);
check("parens: 2 questions", c2?.questions === 2, `got ${c2?.questions}`);

const inline = `1. Largest ocean? A) Atlantic B) Pacific C) Indian D) Arctic
2. Smallest continent? A) Europe B) Australia C) Antarctica D) Asia`;

const c3 = detectMcq(inline);
check("inline-options quiz recognised", !!c3);
check("inline: 2 questions", c3?.questions === 2, `got ${c3?.questions}`);

const lowercase = `1) Which of these is a programming language?
a. Python
b. Cobra
c. Viper
d. Anaconda`;

const c4 = detectMcq(lowercase);
check("single lowercase question with 4 options recognised", c4?.questions === 1);
check("lowercase labels normalised", c4?.labels === "A\u2013D", `got ${c4?.labels}`);

// ── Things that must NOT be reformatted ───────────────────────────────────
section("Leaves normal text alone");

check("plain question is not a quiz", detectMcq("What is the capital of France?") === null);
check(
  "numbered list of questions is not a quiz",
  detectMcq("1. What is a closure?\n2. What is a promise?\n3. What is an event loop?") === null
);
check(
  "two-letter outline is not a quiz",
  detectMcq("Agenda:\na) intro\nb) demo") === null
);
check(
  "prose with no options is not a quiz",
  detectMcq("The mitochondria is the powerhouse of the cell because it produces ATP. ".repeat(4)) === null
);
check("empty string is not a quiz", detectMcq("") === null);

// ── The instructions the model actually receives ──────────────────────────
section("Answer-key instructions");

const clipTask = mcqClipboardTask(c1!);
check("clipboard: demands an answer key", /answer key/i.test(clipTask));
check("clipboard: keeps numbering", /original order and numbering/i.test(clipTask));
check("clipboard: bans paragraphs", /No preamble, no paragraphs/i.test(clipTask));
check("clipboard: puts compact key in summary", /`summary` is the compact key/i.test(clipTask));
check("clipboard: quotes question count", clipTask.includes("3 questions"));
check("clipboard: shows a line format", /1\. B \u2014 /.test(clipTask));

const chatRule = mcqChatDirective(c1!);
check("chat/orb: demands an answer key", /answer key/i.test(chatRule));
check("chat/orb: keeps numbering", /original numbering/i.test(chatRule));
check("chat/orb: bans paragraphs", /No paragraphs/i.test(chatRule));
check("chat/orb: asks for a compact key line", /Key: 1-B 2-D 3-A/.test(chatRule));
check("chat/orb: quotes question count", chatRule.includes("3 questions"));

// ── Wiring ────────────────────────────────────────────────────────────────
section("Clipboard actions are wired to the detector");

import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

const here = fileURLToPath(new URL(".", import.meta.url));
const actionsSrc = readFileSync(join(here, "../src/lib/agent/clipboardActions.ts"), "utf8");
const chatSrc = readFileSync(join(here, "../src/app/api/chat/route.ts"), "utf8");

check("clipboardActions imports the detector", /from "@\/lib\/agent\/mcq"/.test(actionsSrc));
check("clipboardActions uses mcqClipboardTask", /mcqClipboardTask\(mcq\)/.test(actionsSrc));
check("only answer-type actions get the override", /\^\(\?:answer\|exam_answer\|solve\)\$/.test(actionsSrc));
check("chat route imports the directive", /mcqChatDirective/.test(chatSrc));
check("chat route appends it to the system prompt", /enhancedSystemPrompt \+= mcqChatDirective\(mcq\)/.test(chatSrc));

// ── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
