// Element grounding — "click the blue Subscribe button" → the element to click.
//
// ─── Why this exists ──────────────────────────────────────────────────────
// The browser agent hands the model a numbered list of interactive elements and
// asks it to pick one by ref. That works, but it fails in a specific and
// expensive way: the model picks a PLAUSIBLE ref (usually a nearby one) and the
// run spends its whole step budget clicking the wrong things. An LLM reading a
// 70-row table is also unreliable at exact ids, and every wrong pick costs a
// full decision round-trip.
//
// Grounding moves that job into a local scorer. The model can name what it
// wants ("the blue Subscribe button"), and the ranker resolves it against the
// elements that actually exist on the page right now. It costs microseconds, it
// is deterministic, and it can EXPLAIN its choice ("matched 'subscribe' ×2,
// role=button, phrased whole") — which is what lets the agent recover instead
// of guessing again.
//
// ─── The scorer ───────────────────────────────────────────────────────────
// A small, fully local retrieval model — deliberately not an LLM call:
//
//   • IDF TOKEN OVERLAP   — rare words matter more. "subscribe" appearing on one
//                           element out of 70 is a far stronger signal than
//                           "more", and inverse document frequency is exactly
//                           that, learned from the candidate set itself (no
//                           training data, no model file).
//   • FUZZY TOKENS        — prefix match and 1-edit tolerance, because pages
//                           write "Subscribe", "subscribe", "Subscriptions",
//                           and the user says "subscrbe".
//   • PHRASE BONUS        — a window containing the whole phrase beats one that
//                           merely shares its words.
//   • ROLE PRIOR          — "button" in the request is EVIDENCE about the
//                           element's role, not another word to match, so a
//                           mismatch (asking for a button, matching a <p> text
//                           node) is actively penalised.
//
// The output carries a margin-based CONFIDENCE, so the caller can decide to act
// on it, or to fall back to the model's own ref, instead of silently clicking a
// mediocre match.

export interface GroundCandidate {
  ref: string;
  role: string;
  name: string;
  value?: string;
}

export interface GroundingMatch {
  ref: string;
  /** 0..1 — how well this element matches the request. */
  score: number;
  /** 0..1 — score combined with the margin over the runner-up. */
  confidence: number;
  role: string;
  name: string;
  /** Human-readable reasons, for step logs and for the model's own feedback. */
  why: string[];
}

/** Suggested acceptance threshold for acting on a match without the model. */
export const GROUND_ACCEPT = 0.5;

/** Words that describe the ACTION or the ROLE, not the element's text. */
const NON_CONTENT = new Set([
  "the", "a", "an", "on", "in", "into", "to", "of", "for", "and", "or", "my",
  "this", "that", "with", "it", "is", "at", "by", "please", "then", "there",
  "click", "tap", "hit", "press", "push", "type", "enter", "fill", "select",
  "choose", "open", "go", "goto", "navigate", "find", "locate", "element",
  "labeled", "labelled", "called", "named", "text", "one", "page", "site",
]);

/** Role words in a request → the element role they argue for. */
const ROLE_HINTS: Array<{ words: string[]; roles: string[] }> = [
  { words: ["checkbox", "tick", "tickbox"], roles: ["checkbox", "switch"] },
  { words: ["searchbox", "search"], roles: ["searchbox", "textbox", "combobox"] },
  { words: ["textbox", "textfield", "input", "field", "form"], roles: ["textbox", "searchbox", "textarea", "combobox"] },
  { words: ["dropdown", "select", "picker", "combobox"], roles: ["select", "combobox"] },
  { words: ["button", "btn"], roles: ["button", "submit", "menuitem"] },
  { words: ["link"], roles: ["link"] },
  { words: ["tab"], roles: ["tab"] },
  { words: ["menu"], roles: ["menu", "menuitem", "menuitemcheckbox"] },
  { words: ["option"], roles: ["option", "radio"] },
  { words: ["radio"], roles: ["radio"] },
];

/** Keep letters/digits, split camelCase and separators into words. */
export function tokenize(input: string): string[] {
  if (!input) return [];
  return String(input)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** True when two tokens are the same word up to prefix/dropped letters. */
export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (a.length >= 5 && b.length >= 5 && Math.abs(a.length - b.length) <= 2 && withinOneEdit(a, b)) return true;
  // SHARED STEM — inflections a prefix test misses: "Subscribe" vs
  // "Subscriptions" share no prefix in full, but agreeing on the first six
  // characters is a real signal in English UI labels (and "search" vs "season"
  // do not agree there, which is what keeps it from matching everything).
  const stem = Math.min(a.length, b.length, 6);
  if (stem >= 5 && a.slice(0, stem) === b.slice(0, stem)) return true;
  return false;
}

/** Levenshtein distance ≤ 1 — enough for the typos a model or a human makes. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  if (i < a.length || j < b.length) edits++;
  return edits <= 1;
}

/** Words in the request that say what kind of element to look for. */
export function roleHintOf(target: string): string | null {
  const tokens = tokenize(target);
  for (const hint of ROLE_HINTS) {
    if (hint.words.some((w) => tokens.includes(w))) return hint.roles[0];
  }
  return null;
}

function roleMatches(role: string, hintRoles: string[]): boolean {
  const r = (role || "").toLowerCase();
  if (hintRoles.includes(r)) return true;
  // "submit" inputs and menuitems are buttons in every practical sense.
  if (hintRoles.includes("button") && (r === "submit" || r === "menuitem")) return true;
  if (hintRoles.includes("link") && r === "a") return true;
  return false;
}

/**
 * Rank candidates against a natural-language target.
 *
 * Returns only candidates that match at least one meaningful token, best first.
 */
export function groundTarget(
  target: string,
  candidates: GroundCandidate[],
  opts: { accept?: number } = {}
): GroundingMatch[] {
  const requestTokens = tokenize(target).filter((t) => !NON_CONTENT.has(t));
  if (!candidates.length || !requestTokens.length) return [];

  const hint = roleHintOf(target);
  const hintRoles = hint ? ROLE_HINTS.find((h) => h.roles[0] === hint)?.roles ?? [hint] : null;
  const normalizePhrase = (s: string) => tokenize(s).join(" ");
  const requestPhrase = normalizePhrase(target);

  // Candidate NAME tokens only. The role is deliberately NOT part of the text
  // corpus: matching the word "button" against `role="button"` and then also
  // granting a role bonus counted the same evidence twice, which made a request
  // of "please click the button" return the page's first button with 0.53
  // confidence — a coin flip presented as a decision, exactly the failure this
  // module exists to prevent. A role-only request now matches nothing.
  const candTokens = candidates.map((c) => tokenize(`${c.name} ${c.value ?? ""}`));
  const candPhrase = candidates.map((c) => normalizePhrase(`${c.name} ${c.value ?? ""}`));

  // IDF over the candidate set: a token present on one element is decisive, a
  // token present on all of them says almost nothing.
  const df = new Map<string, number>();
  for (const t of requestTokens) {
    let count = 0;
    for (const toks of candTokens) {
      if (toks.some((ct) => tokensMatch(ct, t))) count++;
    }
    df.set(t, count);
  }

  // Tokens NO candidate carries ("blue", "big", "top") cannot discriminate
  // between elements, so they are removed from the denominator. Counting them
  // just scaled every score down together, which pushed real matches below the
  // acceptance threshold and looked like grounding "not working".
  const discriminative = requestTokens.filter((t) => (df.get(t) ?? 0) > 0);
  if (!discriminative.length) return [];

  const idf = (t: string) => Math.log(1 + candidates.length / (1 + (df.get(t) ?? candidates.length)));
  const totalIdf = discriminative.reduce((sum, t) => sum + idf(t), 0) || 1;

  const matches: GroundingMatch[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const toks = candTokens[i];
    const why: string[] = [];

    let gained = 0;
    let matchedNameTokens = 0;
    const hitTokens: string[] = [];
    for (const t of discriminative) {
      const hits = toks.filter((ct) => tokensMatch(ct, t)).length;
      if (hits > 0) {
        gained += idf(t);
        matchedNameTokens += hits;
        hitTokens.push(t);
      }
    }
    if (!hitTokens.length) continue;

    let score = gained / totalIdf; // 0..1 IDF-weighted coverage
    why.push(`matched ${hitTokens.join(", ")}`);

    if (requestPhrase.length > 3 && candPhrase[i].includes(requestPhrase)) {
      score += 0.35;
      why.push("whole phrase");
    }

    if (hintRoles) {
      if (roleMatches(c.role, hintRoles)) {
        score += 0.2;
        why.push(`role=${c.role}`);
      } else {
        score -= 0.3;
        why.push(`role mismatch (${c.role})`);
      }
    }

    score = Math.max(0, Math.min(1, score));

    // CONCISENESS PRIOR — the same length normalization BM25 applies. Between
    // two elements that both match fully, "Subscribe" is a better answer to
    // "Subscribe button" than "Subscribe to newsletter and turn on alerts";
    // without this they tie and the tie shows up as unusable confidence.
    const extra = Math.max(0, toks.length - matchedNameTokens);
    if (extra > 0) score *= 1 - Math.min(0.15, 0.03 * extra);

    matches.push({
      ref: c.ref,
      score,
      confidence: 0, // filled in below, needs the runner-up
      role: c.role,
      name: c.name,
      why,
    });
  }

  matches.sort((a, b) => b.score - a.score);

  // Confidence blends absolute match quality with the MARGIN over the
  // runner-up, and the margin is weighted HIGHER on purpose: two elements with
  // identical labels are a genuine coin flip, and a coin flip must land below
  // GROUND_ACCEPT so the caller defers to the model instead of clicking one.
  const bestScore = matches[0]?.score ?? 0;
  for (let i = 0; i < matches.length; i++) {
    // Compared against the best OTHER candidate, not merely the next one in
    // the list. Using the next one gave the runner-up in a two-element tie a
    // margin of 1 (nothing followed it) and therefore full confidence — the
    // exact opposite of the intended semantics, and it would have let a coin
    // flip be clicked with a confident-looking score.
    const bestOther = i === 0 ? matches[1]?.score ?? 0 : bestScore;
    const margin = Math.max(0, Math.min(1, (matches[i].score - bestOther) / 0.2));
    matches[i].confidence = Math.max(
      0,
      Math.min(1, 0.45 * matches[i].score + 0.55 * margin)
    );
  }

  void opts;
  return matches;
}

/** The single best grounded element, or null when nothing matches meaningfully. */
export function bestMatch(
  target: string,
  candidates: GroundCandidate[],
  opts: { accept?: number } = {}
): GroundingMatch | null {
  const accept = opts.accept ?? GROUND_ACCEPT;
  const ranked = groundTarget(target, candidates, opts);
  const top = ranked[0];
  if (!top) return null;
  return top.confidence >= accept ? top : null;
}

/**
 * One prompt line telling the model about (or warning it off) a textual target.
 * Feeding the ranker's view back is what turns a wrong guess into a recovery.
 */
export function describeGrounding(
  target: string,
  candidates: GroundCandidate[],
  opts: { accept?: number } = {}
): string {
  const ranked = groundTarget(target, candidates, opts);
  if (!ranked.length) return `No element matches "${target}" — try scrolling or a different wording.`;
  const top = ranked[0];
  const accepted = bestMatch(target, candidates, opts);
  const summary = ranked
    .slice(0, 3)
    .map((m) => `${m.ref} "${m.name}" (${m.role}, ${m.confidence.toFixed(2)})`)
    .join(" | ");
  return accepted
    ? `Best local match for "${target}": ${summary}.`
    : `Ambiguous target "${target}" — closest candidates: ${summary}. Pick one explicitly; the top match (${top.ref}) was not confident enough.`;
}
