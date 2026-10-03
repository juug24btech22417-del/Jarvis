// Cross-turn "last mission" reference detection — pure.
//
// Tier 8's chain ("open the second one", "find its repo", "compare it with the
// first") is a CONVERSATION, not a new mission. The CommandBar uses these
// helpers to decide whether a message should be answered against the most
// recent mission instead of being planned from scratch.

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, one: 1, "1": 1,
  second: 2, "2nd": 2, two: 2, "2": 2,
  third: 3, "3rd": 3, three: 3, "3": 3,
  fourth: 4, "4th": 4, four: 4, "4": 4,
  fifth: 5, "5th": 5, five: 5, "5": 5,
  sixth: 6, "6th": 6, six: 6, "6": 6,
  seventh: 7, "7th": 7, seven: 7, "7": 7,
  eighth: 8, "8th": 8, eight: 8, "8": 8,
  ninth: 9, "9th": 9, nine: 9, "9": 9,
  tenth: 10, "10th": 10, ten: 10, "10": 10,
};

/** The 1-based ordinal the message refers to, or null. */
const CARDINALS = new Set(["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]);

export function ordinalIndex(text: string): number | null {
  const t = (text || "").toLowerCase();
  // Pick the ordinal that appears FIRST in the sentence — "the second one"
  // contains both "second" (2) and "one" (1); the earlier match wins.
  let best: { idx: number; val: number } | null = null;
  for (const word of Object.keys(ORDINALS)) {
    if (/^\d/.test(word)) continue;
    // Ordinal words ("second", "third") are unambiguous. Bare cardinals
    // ("one", "two") are only ordinals behind a determiner — otherwise
    // "whichever one is more useful" would be misread as "the first one".
    const m = (CARDINALS.has(word)
      ? new RegExp(`\\b(?:the|those|these|my)\\s+${word}\\b`)
      : new RegExp(`\\b${word}\\b`)
    ).exec(t);
    if (m && (!best || m.index < best.idx)) best = { idx: m.index, val: ORDINALS[word] };
  }
  const m = /\b(\d{1,2})(?:st|nd|rd|th)\b/.exec(t);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 20 && (!best || m.index < best.idx)) best = { idx: m.index, val: n };
  }
  return best ? best.val : null;
}

const OPEN_VERB = /\b(open|launch|show|display|pull up|go to|goto|view|browse)\b/i;
const REF_PRONOUN = /\b(it|that|this one|the one|them|those|both|the (?:last|previous|above))\b/i;
const PREV_MISSION = /\b(last|previous|earlier)\s+(?:mission|search|result|results|findings?|job|report)\b/i;
const OF_LIST = /\b(?:of|from|among|out of)\s+(?:those|them|the (?:list|results|findings|options|mission|search))\b/i;
const POSSESSIVE_SUBJECT = /\b(?:its|it'?s|their)\s+(?:repo(?:sitory)?|docs?|documentation|website|site|page|link|price|specs?|github|source)\b/i;

/**
 * Does this message refer back to a previous mission (rather than being a new
 * goal)? Deliberately conservative: a bare "open it" is NOT treated as a
 * mission follow-up — it is far more likely to mean a file/app.
 */
export function isMissionFollowup(text: string): boolean {
  const t = (text || "").trim();
  if (!t || t.length > 200) return false;

  // Explicit "the last mission / previous search".
  if (PREV_MISSION.test(t)) return true;

  // "compare with the first", "send the third one", "open the second one".
  const ord = ordinalIndex(t);
  if (ord !== null && (OPEN_VERB.test(t) || /\b(compare|send|save|use|check|summari[sz]e|tell me about|what about)\b/i.test(t))) {
    return true;
  }

  // "of those", "from the results".
  if (OF_LIST.test(t)) return true;

  // "find its repo", "open its docs", "what's its latest version".
  if (POSSESSIVE_SUBJECT.test(t) && OPEN_VERB.test(t)) return true;
  if (POSSESSIVE_SUBJECT.test(t) && /\b(find|get|show|look up|what(?:'s| is))\b/i.test(t)) return true;

  // "now find the documentation", "then open the repository" — a step-on verb
  // plus a mission-ish noun means "keep going with what you just did".
  if (
    /\b(?:now|then|next)\b[\s\S]{0,12}\b(?:find|open|show|get|compare|save|send|check|summari[sz]e|pull up)\b[\s\S]{0,45}\b(?:documentation|docs|repo(?:sitory)?|website|web ?page|page|link|release notes|pricing|github|source code|tutorial)\b/i.test(t)
  )
    return true;

  // "open whichever one is more useful" — let JARVIS pick from the mission.
  if (/\bwhichever\b/i.test(t) && OPEN_VERB.test(t)) return true;

  // "open the winner / the best one" after a mission.
  if (OPEN_VERB.test(t) && /\b(the (?:best|top|winner|chosen|recommended) one|the winner)\b/i.test(t)) return true;

  return false;
}

/** Does the message ask to open/show something (client-side navigation)? */
export function wantsOpen(text: string): boolean {
  return OPEN_VERB.test(text || "");
}

/** Human-readable menu of a mission's artifacts, for prompting the user. */
export function formatArtifactMenu(
  artifacts: Array<{ kind: string; label: string; value: string }>
): string {
  if (!artifacts.length) return "";
  return artifacts
    .map((a, i) => `${i + 1}. (${a.kind}) ${a.label}`)
    .join("\n");
}

/** Resolve an ordinal ("the second one") against a list; 1-based, clamped. */
export function pickByOrdinal<T>(items: T[], text: string): T | null {
  if (!items.length) return null;
  const n = ordinalIndex(text);
  if (n === null) return null;
  return items[Math.min(n, items.length) - 1] ?? null;
}
