// Did the screen actually change? — local verification of every agent action.
//
// ─── Why this exists ──────────────────────────────────────────────────────
// The browser agent's loop was blind: it clicked, then looked at the page again
// and hoped the new state was a consequence of the click. When a click lands on
// a dead element (an overlay intercepting it, a disabled control, a stale ref, a
// decorative div) the run does not notice — it re-observes an unchanged page and
// burns steps trying variations of the same non-action, then reports failure.
//
// A cheap, local "did anything actually happen?" check turns that failure into
// a signal the model can act on: "your click had no visible effect — try a
// different element". No extra model call, no screenshot round-trip.
//
// ─── What is compared ─────────────────────────────────────────────────────
// Two observations are fingerprinted over three independent channels, because
// "changed" means different things in each:
//
//   URL       navigation          → a new document, always meaningful
//   TEXT      content             → word-set similarity (Jaccard), which is
//                                   robust to reflow/whitespace and to the
//                                   never-ending diffs on live pages
//   STRUCTURE interactive elements→ refs/roles/names, which is what changed on
//                                   a layout update, a modal opening, or a list
//                                   re-render
//
// Everything here is pure: it takes two plain observations and returns a
// verdict, so the thresholds are tunable and testable without a browser.

export interface ScreenElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
}

export interface ScreenSnapshot {
  url: string;
  title: string;
  text: string;
  elements: ScreenElement[];
}

export interface ScreenChange {
  /** True when the page is meaningfully different. */
  changed: boolean;
  urlChanged: boolean;
  /**
   * Reported, but deliberately NOT part of `changed`.
   *
   * Live page titles churn on their own: notification counts ("(3) Inbox"),
   * clocks, "… playing" suffixes. Treating that as a change would tell the
   * agent a dead click worked, which is worse than missing a title-only update.
   */
  titleChanged: boolean;
  structureChanged: boolean;
  /** How many interactive elements appeared (+) or vanished (−). */
  elementDelta: number;
  /** Word-set similarity of the visible text, 0..1. */
  textSimilarity: number;
  /** Words that appeared or vanished, as a count. */
  wordsChanged: number;
  /** Best single-word explanation of what happened. */
  verdict: "none" | "navigation" | "content" | "layout";
  before: string;
  after: string;
}

/** Below this word-set similarity we call the content different. */
export const TEXT_CHANGE_THRESHOLD = 0.98;

/**
 * …and this many words must differ as well.
 *
 * Similarity alone is too trigger-happy on short text: word-set Jaccard drops
 * by ~9% for a single extra word in a ten-word string, so "one word appeared"
 * was reported as a content change. Real page text is ~180 words (see
 * MAX_TEXT_CHARS in the browser agent), where a clock ticking or a counter
 * incrementing touches one or two words and a genuine action rewrites a
 * sentence or more. Both conditions must hold, and the bias is deliberate:
 * wrongly saying "nothing happened" makes the agent abandon a click that
 * WORKED, which is far more damaging than missing a one-word update.
 */
export const MIN_WORDS_CHANGED = 3;

function canonical(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** FNV-1a 32-bit, as 8 hex chars. Fast, dependency-free, good enough to compare. */
export function fingerprintString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A stable fingerprint of what the user can see and interact with.
 * The refs are deliberately EXCLUDED: they are re-issued every turn (`j1`, `j2`
 * …), so including them would make every turn look like a change.
 */
export function fingerprint(snapshot: ScreenSnapshot): string {
  const structural = (snapshot.elements || [])
    .map((e) => `${e.role}:${canonical(e.name)}:${canonical(e.value ?? "")}`)
    .join("|");
  return fingerprintString(
    [
      canonical(snapshot.url),
      canonical(snapshot.title),
      structural,
      canonical(snapshot.text),
    ].join("\u0000")
  );
}

/** Structural fingerprint on its own (elements only). */
export function structureFingerprint(snapshot: ScreenSnapshot): string {
  return fingerprintString(
    (snapshot.elements || [])
      .map((e) => `${e.role}:${canonical(e.name)}:${canonical(e.value ?? "")}`)
      .join("|")
  );
}

/** Word sets used for the text comparison. */
function wordSet(text: string): Set<string> {
  const words = canonical(text)
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(" ")
    .filter((w) => w.length > 1);
  return new Set(words);
}

/** Jaccard similarity of the two texts' vocabularies, 0..1. */
export function textSimilarity(a: string, b: string): number {
  const setA = wordSet(a);
  const setB = wordSet(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  const union = setA.size + setB.size - shared;
  return union === 0 ? 1 : shared / union;
}

/** Compare two observations and say whether the page actually moved. */
export function classifyChange(before: ScreenSnapshot, after: ScreenSnapshot): ScreenChange {
  const urlChanged = canonical(before.url) !== canonical(after.url);
  const titleChanged = canonical(before.title) !== canonical(after.title);
  const structureChanged = structureFingerprint(before) !== structureFingerprint(after);
  const similarity = textSimilarity(before.text, after.text);

  const setA = wordSet(before.text);
  const setB = wordSet(after.text);
  let wordsChanged = 0;
  for (const w of setA) if (!setB.has(w)) wordsChanged++;
  for (const w of setB) if (!setA.has(w)) wordsChanged++;
  // On a page with only a word or two of text, any difference at all counts.
  const minWords = Math.min(setA.size, setB.size) < MIN_WORDS_CHANGED ? 1 : MIN_WORDS_CHANGED;
  const textChanged = similarity < TEXT_CHANGE_THRESHOLD && wordsChanged >= minWords;

  let verdict: ScreenChange["verdict"] = "none";
  if (urlChanged) verdict = "navigation";
  else if (textChanged) verdict = "content";
  else if (structureChanged) verdict = "layout";

  return {
    changed: urlChanged || structureChanged || textChanged,
    urlChanged,
    titleChanged,
    structureChanged,
    elementDelta: (after.elements?.length ?? 0) - (before.elements?.length ?? 0),
    textSimilarity: Number(similarity.toFixed(4)),
    wordsChanged,
    verdict,
    before: fingerprint(before),
    after: fingerprint(after),
  };
}

/**
 * Actions that are EXPECTED to move the page. `extract`, `screenshot` and `wait`
 * are observations, so no change after them is normal and must not be reported
 * as a failed action.
 */
const MUTATING_ACTIONS = new Set(["click", "type", "press", "goto", "scroll"]);

/** Should a "no visible change" note be produced for this action? */
export function expectsChange(action: string): boolean {
  return MUTATING_ACTIONS.has(String(action || "").toLowerCase());
}

/**
 * The feedback line handed back to the model after a step that did nothing.
 * Returns null when there is nothing worth saying.
 */
export function changeNote(action: string, change: ScreenChange | null): string | null {
  if (!change) return null;
  if (!expectsChange(action)) return null;
  if (change.changed) return null;
  return `the ${action} produced NO visible change — that target did nothing; pick a different element or dismiss whatever is covering it`;
}
