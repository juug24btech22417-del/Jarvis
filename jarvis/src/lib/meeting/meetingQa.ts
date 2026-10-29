// "Chat with this meeting": answer questions from the transcript and the
// captured visuals, with citations that point at real transcript lines.
//
// WHY THIS EXISTS
// The notes answer "what happened", but after a lecture the real question is
// "what did he say about the ripple factor" or "was the deadline Tuesday or
// Thursday". Answering that needs the transcript, not a summary — and an answer
// without a timestamp is unverifiable, so every claim must cite the lines it
// came from.
//
// Citations are LINE NUMBERS, not clock strings: the model is far more reliable
// at returning "line 47" than at reproducing "12:34", and the resolver maps the
// line back to the real speaker/timestamp so a wrong or invented number is
// dropped instead of being rendered as a plausible-looking timestamp.
//
// Pure module: no network, no process.env — unit-testable.

export interface MeetingTurn {
  /** Offset from the start of the meeting, e.g. "12:34". */
  clock: string;
  speaker: string;
  text: string;
}

export interface QaVisualRef {
  title?: string;
  clock?: string;
  imageUrl?: string;
  description?: string;
  /** Equations/labels the vision pass read off the screenshot. */
  textOnScreen?: string;
  /** Offset from the meeting start, so a screen-only fact still has a timestamp. */
  offset?: string;
}

export interface MeetingCitation {
  /** 1-based transcript line, as printed in the prompt. */
  line: number;
  clock: string;
  speaker: string;
  /** The actual transcript text — never the model's paraphrase. */
  quote: string;
  /** 1-based visual number when the answer refers to a captured frame. */
  visual?: number;
  visualTitle?: string;
  imageUrl?: string;
}

export interface MeetingAnswer {
  answer: string;
  citations: MeetingCitation[];
  followUps: string[];
}

export interface CaptionLike {
  speaker: string;
  text: string;
  /** Epoch millis. */
  at: number;
}

/** mm:ss under an hour, h:mm:ss above it. */
export function offsetClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Captions → turns stamped relative to the moment the bot joined. */
export function turnsFromCaptions(captions: CaptionLike[], startedAtMs: number): MeetingTurn[] {
  return captions.map((caption) => ({
    clock: offsetClock(caption.at - startedAtMs),
    speaker: (caption.speaker || "Speaker").trim() || "Speaker",
    text: (caption.text || "").trim(),
  }));
}

/** Numbered transcript for the prompt, plus the char budget it consumed. */
export function formatTurnsForPrompt(
  turns: MeetingTurn[],
  maxChars = 160_000,
  indices?: number[]
): string {
  const order = indices || turns.map((_, i) => i);
  const lines: string[] = [];
  let used = 0;
  for (const index of order) {
    const turn = turns[index];
    if (!turn) continue;
    // The bracket keeps the transcript's OWN line number even when only a
    // subset is shown, so a citation always resolves against the full turn list.
    const line = `[${index + 1}] ${turn.clock} ${turn.speaker}: ${turn.text}`;
    used += line.length + 1;
    if (used > maxChars) break;
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Pick the transcript lines worth sending for one question.
 *
 * A 45-minute lecture is ~1,500 turns; sending all of them costs seconds of
 * time-to-first-token and buries the answer. Score by shared distinctive words
 * and keep the opening minute plus the neighbourhood of the best matches, in
 * chronological order. Short transcripts are sent whole — retrieval there only
 * risks dropping the line the answer lives in.
 */
export function pickRelevantTurns(
  turns: MeetingTurn[],
  question: string,
  maxTurns = 140
): number[] {
  if (turns.length <= maxTurns) return turns.map((_, i) => i);

  const wanted = new Set(tokenize(question).filter((token) => !STOPWORDS.has(token)));
  const scored = turns.map((turn, index) => {
    let score = 0;
    for (const token of tokenize(turn.text)) {
      if (wanted.has(token)) score += token.length > 6 ? 3 : 1;
    }
    return { index, score };
  });

  const keep = new Set<number>();
  // The opening turns usually frame the whole session, so they always travel.
  for (let i = 0; i < Math.min(12, turns.length); i++) keep.add(i);

  const ranked = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.floor(maxTurns * 0.6));

  for (const entry of ranked) {
    // A little window around each hit keeps pronoun-heavy follow-ups readable.
    for (let i = entry.index - 1; i <= entry.index + 1; i++) {
      if (i >= 0 && i < turns.length && keep.size < maxTurns) keep.add(i);
    }
  }

  // Still short? Fill from the end, where conclusions and next steps live.
  for (let i = turns.length - 1; i >= 0 && keep.size < maxTurns; i--) keep.add(i);

  return [...keep].sort((a, b) => a - b);
}

export function buildMeetingQaPrompt(params: {
  question: string;
  turns: MeetingTurn[];
  visuals?: QaVisualRef[];
  title?: string;
  platform?: string;
  summary?: string;
}): string {
  const { question, turns, visuals = [], title, platform, summary } = params;
  const selected = pickRelevantTurns(turns, question);
  const transcript = formatTurnsForPrompt(turns, 160_000, selected);
  const partial = selected.length < turns.length;
  // `textOnScreen` matters more than the description: it is how a formula or a
  // number that was only ever shown — never spoken — becomes answerable.
  const visualBlock = visuals.length
    ? `\nCAPTURED VISUALS (screenshots of the presented screen, analysed by vision)\n${visuals
        .map(
          (v, i) =>
            `[Visual #${i + 1}] ${v.clock || ""} ${v.title || "Untitled"} — ${
              v.description || "no description"
            }${v.textOnScreen ? `\n   text on screen: ${v.textOnScreen}` : ""}`.trim()
        )
        .join("\n")}\n`
    : '';

  return `You are JARVIS, answering a question about a meeting that has already happened. You have the numbered live transcript and nothing else. You are talking to the person who attended (or missed) it.

${title ? `MEETING: ${title}` : ""}${platform ? ` (${platform})` : ""}
${summary ? `\nEXISTING SUMMARY (context only — the transcript is the source of truth)\n${summary.slice(0, 4000)}\n` : ""}
${visualBlock}
HOW TO ANSWER
1. Use ONLY the transcript lines and visuals below. If the answer is not there, say so in one line and name what would answer it — never guess.
2. Cite every factual claim with the transcript line numbers that support it, as \`line\`. Numbers, formulas, names, dates and deadlines MUST be cited. "citations" may only be empty when the answer is a refusal.
3. Quote exact wording for numbers, formulas, definitions, deadlines and disagreements. Do not round or paraphrase a figure.
4. Answer the question that was asked, in 2-6 sentences. Use a short list when the answer is genuinely a list. No preamble, no "based on the transcript".
5. If the transcript contradicts itself, say both things and which line each came from.
6. When a captured visual is the best evidence (a diagram, chart, equation), include its visual number. Something written on screen is evidence even when nobody said it aloud — cite the visual, not a transcript line, for it.
7. Add 2-3 short follow-up questions the person would plausibly ask next, answerable from this transcript.

Return ONLY raw JSON, no markdown fences:
{
  "answer": "string",
  "citations": [{ "line": 12, "visual": 2 }],
  "followUps": ["string"]
}

TRANSCRIPT${partial ? ` (the ${selected.length} lines most likely to matter out of ${turns.length}; line numbers are the transcript's own — say so if the answer may lie in a line that is not shown)` : ""}
${transcript}

QUESTION
${question}`;
}

/** Leftover budget guard so a runaway answer can't overflow the panel. */
const MAX_ANSWER_CHARS = 4000;

/** Answers that legitimately have nothing to cite. */
const REFUSAL =
  /no mention|not mentioned|not in the transcript|doesn't mention|does not mention|could not find|cannot find|isn't in the transcript|no record/i;

const STOPWORDS = new Set(
  `the a an and or but if then than that this these those from with without into onto over under again further once here there when where why how all any both each few more most other some such only own same so too very can will just should would could may might must not no nor of in on at to for by about as is are was were be been being it its it's their them they he she his her you your we our i me my do does did done have has had having what which who whom whose there`.split(
    /\s+/
  )
);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9\u03c0][a-z0-9\u03c0'’.-]{2,}/g) || []).map((token) =>
    token.replace(/^[.'-]+|[.'-]+$/g, "")
  );
}

/**
 * Turn the answer's own wording into citations.
 *
 * Used only when the model returned none: score every transcript line by the
 * number of distinctive words it shares with the answer, keep the strongest
 * ones. Long words count double because they are the specific ones ("rectifier",
 * "discriminant"); the quote attached is always the real line, never the answer.
 */
export function inferCitations(answer: string, turns: MeetingTurn[], max = 3): MeetingCitation[] {
  const answerTokens = new Set(tokenize(answer).filter((token) => !STOPWORDS.has(token)));
  if (!answerTokens.size) return [];

  const scored = turns
    .map((turn, index) => {
      let score = 0;
      for (const token of tokenize(turn.text)) {
        if (!answerTokens.has(token) || STOPWORDS.has(token)) continue;
        score += token.length > 6 ? 2 : 1;
      }
      return { index, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.score || 0;
  // Two shared distinctive words is already evidence: an answer rarely reuses
  // more than a handful of a line's words verbatim. Below that the "citation"
  // would be arbitrary, so it is better to show none.
  if (best < 2) return [];
  const floor = Math.max(2, Math.round(best * 0.4));

  return scored
    .filter((entry) => entry.score >= floor)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((entry) => ({
      line: entry.index + 1,
      clock: turns[entry.index].clock,
      speaker: turns[entry.index].speaker,
      quote: turns[entry.index].text,
    }));
}

/**
 * Validate the model's answer against the real transcript.
 *
 * A citation whose line does not exist is dropped: a fabricated timestamp is
 * worse than no timestamp, because it looks checkable. Visual references are
 * resolved the same way.
 */
export function normalizeMeetingAnswer(
  raw: unknown,
  turns: MeetingTurn[],
  visuals: QaVisualRef[] = []
): MeetingAnswer | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const answerRaw = obj.answer ?? obj.response ?? obj.text;
  const answer = typeof answerRaw === "string" ? answerRaw.replace(/\r\n/g, "\n").trim() : "";
  if (!answer) return null;

  const rawCitations = Array.isArray(obj.citations) ? obj.citations : [];
  const citations: MeetingCitation[] = [];
  const seen = new Set<number>();

  for (const entry of rawCitations) {
    const line =
      typeof entry === "number"
        ? entry
        : entry && typeof entry === "object"
          ? Number((entry as Record<string, unknown>).line ?? (entry as Record<string, unknown>).index)
          : NaN;
    const index = Math.round(line) - 1;
    const lineValid = Number.isFinite(line) && index >= 0 && index < turns.length && !seen.has(index);

    const visualRaw =
      entry && typeof entry === "object"
        ? Number((entry as Record<string, unknown>).visual ?? (entry as Record<string, unknown>).visualNumber)
        : NaN;
    const visualIndex = Number.isFinite(visualRaw) ? Math.round(visualRaw) - 1 : -1;
    const visual = visualIndex >= 0 && visualIndex < visuals.length ? visuals[visualIndex] : null;

    // A fact that was only ever written on screen has no line to cite: keep the
    // visual reference instead of discarding the evidence.
    if (!lineValid) {
      if (!visual) continue;
      citations.push({
        line: 0,
        // Prefer the in-meeting offset over the wall clock: every other citation
        // in the thread is relative to the start of the call.
        clock: visual.offset || "",
        speaker: "Shared screen",
        quote: visual.textOnScreen || visual.description || visual.title || "",
        visual: visualIndex + 1,
        ...(visual.title ? { visualTitle: visual.title } : {}),
        ...(visual.imageUrl ? { imageUrl: visual.imageUrl } : {}),
      });
      if (citations.length >= 8) break;
      continue;
    }

    seen.add(index);
    citations.push({
      line: index + 1,
      clock: turns[index].clock,
      speaker: turns[index].speaker,
      quote: turns[index].text,
      ...(visual
        ? {
            visual: visualIndex + 1,
            ...(visual.title ? { visualTitle: visual.title } : {}),
            ...(visual.imageUrl ? { imageUrl: visual.imageUrl } : {}),
          }
        : {}),
    });
    if (citations.length >= 8) break;
  }

  // A model that forgets to cite still has to produce checkable timestamps:
  // fall back to the transcript lines whose wording the answer actually reuses.
  if (!citations.length && !REFUSAL.test(answer)) {
    citations.push(...inferCitations(answer, turns));
  }

  citations.sort((a, b) => a.line - b.line);

  const followUps = (Array.isArray(obj.followUps) ? obj.followUps : Array.isArray(obj.follow_ups) ? obj.follow_ups : [])
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 3)
    .slice(0, 3);

  return {
    answer: answer.length > MAX_ANSWER_CHARS ? `${answer.slice(0, MAX_ANSWER_CHARS)}…` : answer,
    citations,
    followUps,
  };
}
