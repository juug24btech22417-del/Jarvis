// Multiple-choice quiz support — "answer these, but keep the quiz shape".
//
// Copied quizzes used to come back as a paragraph. That is useless: the reader
// has to hunt for each answer and re-map it to a question. Both the clipboard
// assistant and /api/chat (which is what the orb and the app use) run this
// detector before the model call and add a format directive, so the reply is an
// answer key that lines up with the question numbers.
//
// Pure and dependency-free: unit tests drive the heuristics directly.

export interface McqInfo {
  /** How many questions were recognised. */
  questions: number;
  /** Total option lines (A/B/C/D…). */
  options: number;
  /** Most options seen on a single question. */
  perQuestion: number;
  /** Option letters used, e.g. "A–D". */
  labels: string;
}

// A) … / (A) … / [A] … / A. … / A: … / A - …
const OPTION_RE = /^\s*(?:\(\s*([A-Ha-h])\s*\)|\[\s*([A-Ha-h])\s*\]|([A-Ha-h])\s*[).:\u2013-])\s*\S/;
// 1. … / 2) … / Q3: … / Question 4 - …
const STEM_RE = /^\s*(?:Q(?:uestion)?\s*)?\d{1,3}\s*[).:\]-]\s*\S/i;
// Three or more options on one line, e.g. "… A) Paris B) London C) Berlin".
const INLINE_OPTIONS_RE = /(?:^|[\s(])([A-H])[).:]\s*\S/g;

function optionLetter(line: string): string | null {
  const m = line.match(OPTION_RE);
  if (!m) return null;
  return (m[1] || m[2] || m[3] || "").toUpperCase() || null;
}

function inlineOptionCount(line: string): number {
  const hits = line.match(INLINE_OPTIONS_RE);
  return hits ? hits.length : 0;
}

/**
 * Recognise a pasted multiple-choice quiz. Returns null for anything that is
 * only question-shaped (a single question, an outline of a)/b) bullet points,
 * a numbered to-do list) — the point is to change formatting only for real
 * quizzes, never to reformat ordinary questions.
 */
export function detectMcq(text: string): McqInfo | null {
  const src = (text ?? "").trim();
  if (src.length < 20) return null;

  const lines = src.split(/\r?\n/);
  const blocks: Set<string>[] = [];
  let current: Set<string> | null = null;

  for (const line of lines) {
    // One line can carry the whole question — count it as its own block.
    if (inlineOptionCount(line) >= 3) {
      const letters = new Set<string>();
      for (const hit of line.matchAll(INLINE_OPTIONS_RE)) letters.add(hit[1].toUpperCase());
      blocks.push(letters);
      current = null;
      continue;
    }

    const letter = optionLetter(line);
    if (!letter) continue;

    // Options restart at A for every question.
    if (!current || (letter === "A" && current.size >= 2)) {
      current = new Set<string>();
      blocks.push(current);
    }
    current.add(letter);
  }

  const usable = blocks.filter((b) => b.size >= 2);
  const options = usable.reduce((sum, b) => sum + b.size, 0);
  if (options < 4) return null;

  const hasStem = STEM_RE.test(src) || src.includes("?");
  // A single multi-option block is only a quiz when it actually reads like
  // one ("1. …" or a "?") — otherwise it is a list that happens to use a).
  if (usable.length < 2 && !hasStem) return null;

  const perQuestion = usable.reduce((max, b) => Math.max(max, b.size), 0);
  const distinct = Array.from(new Set(usable.flatMap((b) => Array.from(b)))).sort();
  const labels = distinct.length > 1 ? `${distinct[0]}\u2013${distinct[distinct.length - 1]}` : distinct[0] ?? "";

  return {
    questions: usable.length,
    options,
    perQuestion,
    labels,
  };
}

/**
 * Instruction appended to a clipboard action's task. `answer` becomes the
 * answer key and `summary` the compact key that survives in the toast.
 */
export function mcqClipboardTask(info: McqInfo): string {
  return (
    `MULTIPLE-CHOICE INPUT (${info.questions} questions, options ${info.labels}). ` +
    `\`answer\` must be ONLY the answer key — one line per question, in the original order and numbering, exactly like:\n` +
    `1. B — <the exact text of the option you chose>\n` +
    `2. D — <the exact text of the option you chose>\n` +
    `No preamble, no paragraphs, no restating the question or the other options. ` +
    `\`summary\` is the compact key only, e.g. "1-B 2-D 3-A" (under 200 chars). ` +
    `If two options are nearly equal, still pick one and append " (close call)" to that line.`
  );
}

/**
 * Directive appended to the chat system prompt. Covers the orb, the command bar
 * and Telegram, since they all reach the model through /api/chat.
 */
export function mcqChatDirective(info: McqInfo): string {
  return (
    `\n\n── MULTIPLE-CHOICE FORMAT ────────────────────────\n` +
    `The user's message contains a multiple-choice quiz (${info.questions} questions, options ${info.labels}).\n` +
    `Answer EVERY question and keep the original numbering and order. Reply with an answer key, one short line per question:\n` +
    `1. B — <the option text>\n` +
    `2. D — <the option text>\n` +
    `No paragraphs, no preamble, no restating the questions or the other options, and no explanation unless the user asks for one. ` +
    `Finish with a single compact line: "Key: 1-B 2-D 3-A".\n` +
    `──────────────────────────────────────────────────`
  );
}
