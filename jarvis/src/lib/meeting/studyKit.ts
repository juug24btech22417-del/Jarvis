// Revision material built from a finished meeting: flashcards for spaced
// repetition and a formula sheet for the equations that were actually used.
//
// WHY THIS EXISTS
// Notes are a record; revision needs retrieval practice. Turning a lecture into
// "front/back" cards and a single sheet of the formulas that came up is the
// difference between notes you re-read and notes you learn from. Both exports
// are plain text on purpose: a CSV imports straight into Anki, and the markdown
// sheet prints or pastes anywhere.
//
// Pure module: no network, no fs — the route streams what these functions build.

export interface Flashcard {
  front: string;
  back: string;
  tag?: string;
}

export interface FormulaCard {
  name: string;
  expression: string;
  meaning: string;
  useWhen?: string;
}

export interface StudyKit {
  flashcards: Flashcard[];
  formulas: FormulaCard[];
  generatedAt: string;
  title?: string;
}

export interface StudyKitSource {
  title?: string;
  summary?: string;
  concepts?: Array<{ term: string; explanation: string }>;
  visuals?: Array<{
    title?: string;
    description?: string;
    clock?: string;
    /** Equations/labels read off the screenshot by the vision pass. */
    textOnScreen?: string;
  }>;
}

/** Ask the model for cards and formulas from the same transcript the notes used. */
export function buildStudyKitPrompt(params: {
  transcript: string;
  source: StudyKitSource;
  meetingTitle?: string;
  platform?: string;
}): string {
  const { transcript, source, meetingTitle, platform } = params;
  const concepts = (source.concepts || [])
    .map((c) => `- ${c.term}: ${c.explanation}`)
    .join("\n");
  const visuals = (source.visuals || [])
    .map((v, i) =>
      `[Visual #${i + 1}] ${v.clock || ""} ${v.title || ""} — ${v.description || ""}${
        v.textOnScreen ? `\n   text on screen: ${v.textOnScreen}` : ""
      }`.trim()
    )
    .join("\n");

  return `You are JARVIS, turning a recorded meeting into revision material for the person who attended it.

${meetingTitle ? `MEETING: ${meetingTitle}` : ""}${platform ? ` (${platform})` : ""}
${source.summary ? `\nSUMMARY (context)\n${source.summary.slice(0, 3000)}\n` : ""}
${concepts ? `\nTERMS ALREADY EXTRACTED\n${concepts}\n` : ""}
${visuals ? `\nVISUALS THAT WERE SHOWN\n${visuals}\n` : ""}

WHAT TO PRODUCE
A. FLASHCARDS — the questions an exam or a follow-up meeting would actually ask.
   - 12-30 cards. Fewer only if the transcript is genuinely short.
   - One idea per card. "front" is a question or prompt that stands alone (no "according to the transcript"), "back" is the answer with the specific number, formula, name or reason.
   - Cover: definitions, derivations and their steps, worked-problem numbers, comparisons, and the "why" behind decisions.
   - Never write a card whose answer is not supported by the transcript.
   - tag: the topic it belongs to, 1-3 words.
B. FORMULA SHEET — every equation, formula or quantitative rule that was used or stated.
   - expression: the formula itself, in plain characters (e.g. "Vdc = 2Vm / pi"), with the variables defined in "meaning".
   - A formula written on screen counts, even if nobody read it aloud: check the "text on screen" lines above.
   - useWhen: the situation it applies to, in one line.
   - Empty array only when the meeting truly had no formulas. Never invent one.
C. Skip small talk, scheduling chatter and anything that was only mentioned in passing.

Return ONLY raw JSON, no markdown fences:
{
  "flashcards": [{ "front": "string", "back": "string", "tag": "string" }],
  "formulas": [{ "name": "string", "expression": "string", "meaning": "string", "useWhen": "string" }]
}

TRANSCRIPT
${transcript}`;
}

const clean = (value: unknown, maxChars = 1200): string =>
  typeof value === "string" ? value.replace(/\r\n/g, "\n").trim().slice(0, maxChars) : "";

export function normalizeStudyKit(raw: unknown, title?: string): StudyKit | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const cardSource = Array.isArray(obj.flashcards)
    ? obj.flashcards
    : Array.isArray(obj.cards)
      ? obj.cards
      : [];
  const flashcards: Flashcard[] = [];
  for (const entry of cardSource) {
    if (!entry || typeof entry !== "object") continue;
    const card = entry as Record<string, unknown>;
    const front = clean(card.front ?? card.question ?? card.q, 400);
    const back = clean(card.back ?? card.answer ?? card.a, 1200);
    if (!front || !back) continue;
    const tag = clean(card.tag ?? card.topic, 60);
    flashcards.push({ front, back, ...(tag ? { tag } : {}) });
    if (flashcards.length >= 60) break;
  }

  const formulaSource = Array.isArray(obj.formulas)
    ? obj.formulas
    : Array.isArray(obj.equations)
      ? obj.equations
      : [];
  const formulas: FormulaCard[] = [];
  for (const entry of formulaSource) {
    if (!entry || typeof entry !== "object") continue;
    const formula = entry as Record<string, unknown>;
    const expression = clean(formula.expression ?? formula.formula ?? formula.equation, 300);
    if (!expression) continue;
    const name = clean(formula.name ?? formula.title, 160) || expression;
    const meaning = clean(formula.meaning ?? formula.definition ?? formula.variables, 600);
    const useWhen = clean(formula.useWhen ?? formula.use_when ?? formula.when, 300);
    formulas.push({ name, expression, meaning, ...(useWhen ? { useWhen } : {}) });
    if (formulas.length >= 40) break;
  }

  if (!flashcards.length && !formulas.length) return null;
  return { flashcards, formulas, generatedAt: new Date().toISOString(), ...(title ? { title } : {}) };
}

/**
 * Last-resort kit from the summary's glossary, so the button still does
 * something useful when every model is unavailable.
 */
export function studyKitFromSummary(source: StudyKitSource): StudyKit | null {
  const cards: Flashcard[] = (source.concepts || [])
    .filter((c) => c.term && c.explanation)
    .slice(0, 40)
    .map((c) => ({
      front: `What is ${c.term}?`,
      back: c.explanation,
      ...(source.title ? { tag: source.title.slice(0, 60) } : {}),
    }));
  if (!cards.length) return null;
  return {
    flashcards: cards,
    formulas: [],
    generatedAt: new Date().toISOString(),
    ...(source.title ? { title: source.title } : {}),
  };
}

/** RFC-4180 quoting: wrap, double the quotes, keep newlines inside the field. */
function csvField(value: string): string {
  return `"${(value || "").replace(/"/g, '""')}"`;
}

/**
 * Anki's "Notes in Plain Text" import wants one card per line with quoted
 * fields. No header row: Anki would import it as a card.
 */
export function flashcardsToCsv(cards: Flashcard[]): string {
  return cards
    .map((card) => [csvField(card.front), csvField(card.back), csvField(card.tag || "")].join(","))
    .join("\r\n")
    .concat(cards.length ? "\r\n" : "");
}

/** A single printable sheet: formulas first, then the cards, then the glossary. */
export function studyKitToMarkdown(kit: StudyKit, source: StudyKitSource = {}): string {
  const title = kit.title || source.title || "Meeting revision kit";
  const lines: string[] = [`# ${title}`, "", `_Generated ${new Date(kit.generatedAt).toLocaleString()}_`, ""];

  if (source.summary) {
    lines.push("## Overview", "", source.summary.trim(), "");
  }

  lines.push("## Formula sheet", "");
  if (kit.formulas.length) {
    for (const formula of kit.formulas) {
      lines.push(`### ${formula.name}`, "", "```", formula.expression, "```", "");
      if (formula.meaning) lines.push(`**Meaning:** ${formula.meaning}`, "");
      if (formula.useWhen) lines.push(`**Use when:** ${formula.useWhen}`, "");
    }
  } else {
    lines.push("_No formulas were used in this meeting._", "");
  }

  if (source.concepts?.length) {
    lines.push("## Key concepts", "");
    for (const concept of source.concepts) {
      lines.push(`- **${concept.term}** — ${concept.explanation}`);
    }
    lines.push("");
  }

  lines.push(`## Flashcards (${kit.flashcards.length})`, "");
  kit.flashcards.forEach((card, i) => {
    lines.push(`${i + 1}. **${card.front}**`, `   ${card.back}`);
    if (card.tag) lines.push(`   _${card.tag}_`);
    lines.push("");
  });

  return lines.join("\n");
}

/** Filesystem-safe slug for download names. */
export function studyKitSlug(title?: string): string {
  const base = (title || "meeting-revision")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "meeting-revision";
}
