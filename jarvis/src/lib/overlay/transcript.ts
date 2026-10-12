// Transcript hygiene.
//
// WHY
// ---
// Whisper does not return an empty string when a chunk contains no speech — it
// returns something that LOOKS like speech, learned from its training data:
// "Thank you.", "Thanks for watching!", "Please subscribe.", "[BLANK_AUDIO]",
// "Subtitles by the Amara.org community". VAD keeps most silent rounds from
// ever being uploaded, but any round with a cough, a keyboard, or a fan gets
// through — and those phrases then go straight into the answer prompt and the
// transcript pane as if someone said them.
//
// Pure functions, unit-tested in tests/overlayTranscript.test.ts.

export interface CleanResult {
  text: string;
  /** True when the whole chunk was noise and must not be shown or answered. */
  filtered: boolean;
}

/** Exact matches (case/punctuation-insensitive) that are never real dialogue. */
const HALLUCINATION_PHRASES = new Set([
  "thank you", "thanks", "thank you for watching", "thanks for watching", "thank you for watching!",
  "thanks for watching!", "thank you for watching the video", "thanks for watching the video",
  "please subscribe", "like and subscribe", "subscribe to my channel", "don't forget to subscribe",
  "subtitles by the amaraorg community", "subtitles by amaraorg", "amaraorg", "wwwamaraorg",
  "transcription by", "transcribed by", "subtitles by", "captions by",
  "you", "yeah", "okay", "ok", "uh", "um", "hmm", "mm", "ah", "oh", "hey", "so", "right", "yes", "no",
  "bye", "bye bye", "goodbye", "hello", "hi", "hey guys", "welcome back", "see you next time",
  "the end", "music", "applause", "laughter", "silence", "blank audio", "inaudible", "no speech",
  "foreign", "thank you very much", "thanks again", "okay thank you", "thank you so much",
]);

/** Bracketed tags Whisper emits for non-speech audio. */
const NON_SPEECH_TAG =
  /^[\[(（【]\s*(blank[_ ]?audio|silence|inaudible|music|applause|laughter|noise|no speech|sound|beep|sighs?|coughs?|typing|foreign|subtitles?[^\])]*)\s*[\])）】]$/i;

/** Normalise for comparison: lowercase, strip punctuation, collapse spaces. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[♪♫#*_`]+/g, " ")
    .replace(/[.,!?;:"'’“”()\[\]{}<>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text with no letters at all (dashes, dots, emoji, URLs alone). */
function hasContent(text: string): boolean {
  return /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0900-\u097F\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text);
}

/**
 * Does this line look like a Whisper artefact rather than speech?
 *
 * Deliberately conservative on SHORT lines: a real call does contain "Yes.",
 * so those are only dropped when they make up the entire chunk (which they do
 * in hallucination). Anything longer is judged on its content.
 */
export function isLikelyHallucination(raw: string): boolean {
  const text = (raw || "").trim();
  if (!text) return true;
  if (NON_SPEECH_TAG.test(text)) return true;
  if (!hasContent(text)) return true;

  const norm = normalise(text);
  if (!norm) return true;
  if (HALLUCINATION_PHRASES.has(norm)) return true;

  // "Thank you. Thank you. Thank you." — a single phrase looped is the classic
  // artefact; real speech never repeats one word five times in one breath.
  const words = norm.split(" ").filter(Boolean);
  if (words.length >= 4) {
    const counts = new Map<string, number>();
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
    const top = Math.max(...counts.values());
    if (top / words.length > 0.6) return true;
  }
  // A phrase looped 3+ times ("okay okay okay okay").
  if (words.length >= 3) {
    const phrase = words.slice(0, Math.min(3, words.length)).join(" ");
    if (norm.split(phrase).length - 1 >= 3 && phrase.length > 4) return true;
  }

  // A bare trailing YouTube-style credit line.
  if (/^(subtitles?|captions?|transcri(p|b)(ed|ption))\b/i.test(text) && words.length <= 12) return true;
  return false;
}

/** Strip the artefacts and decide whether anything is left worth showing. */
export function cleanTranscript(raw: string): CleanResult {
  const text = (raw || "").trim();
  if (isLikelyHallucination(text)) return { text: "", filtered: true };
  const cleaned = text
    .replace(/^\s*(subtitles?|captions?) by[^.]*[.]?\s*/i, "")
    .replace(/\s*[♪♫]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || isLikelyHallucination(cleaned)) return { text: "", filtered: true };
  return { text: cleaned, filtered: false };
}

/** Who said it — the two ears have different owners during a call. */
export function speakerLabel(kind: "system" | "mic" | "typed"): string {
  if (kind === "mic") return "YOU";
  if (kind === "typed") return "YOU";
  return "THEM";
}

/** Collapse a chunk that merely repeats the tail of what was already said —
 * Whisper re-emits the last sentence when a chunk starts mid-word. */
export function dedupeAgainst(previous: string, next: string): string {
  const prev = normalise(previous);
  const nxt = normalise(next);
  if (!prev || !nxt) return next;
  if (prev.endsWith(nxt) || prev.includes(nxt)) return "";
  const prevWords = prev.split(" ");
  const nextWords = nxt.split(" ");
  // Longest tail of `prev` that is a prefix of `next`.
  for (let overlap = Math.min(prevWords.length, nextWords.length, 12); overlap >= 4; overlap--) {
    if (prevWords.slice(-overlap).join(" ") === nextWords.slice(0, overlap).join(" ")) {
      const kept = nextWords.slice(overlap).join(" ");
      return kept.length > 2 ? kept : "";
    }
  }
  return next;
}
