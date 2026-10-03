/**
 * Tolerant JSON parsing for LLM output.
 *
 * Models frequently wrap JSON in markdown fences ("```json ... ```"),
 * prefix it with a reasoning block (" thinking ... </think>"), or add a
 * one-line preamble ("Sure! Here's the plan:"). Plain JSON.parse throws
 * on all of those, which used to silently abort entire research/meeting
 * pipelines. This helper strips the noise, finds the first balanced
 * {...} or [...] block, and parses it. It returns the provided fallback
 * (default `{}`) instead of throwing so callers can degrade gracefully.
 *
 * It also knows how to read a bare JSON array when elements match a
 * predicate — the Oracle planner/fact prompts historically instructed
 * the model to return either an array or an object, so callers use
 * `coerceArray` to accept both shapes.
 */

/** Remove ` thinking...</think>` reasoning blocks some models emit. */
export function stripThinking(text: string): string {
  if (!text) return "";
  return text
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/^\s*<think(?:ing)?>[\s\S]*$/i, "")
    .trim();
}

/**
 * Parse a JSON value from a possibly-dirty LLM string.
 * Returns `fallback` (default `{}`) when nothing parseable is found.
 */
export function parseJsonLoose<T = any>(text: string, fallback: T = {} as T): T {
  if (!text || typeof text !== "string") return fallback;
  let t = stripThinking(text).trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```).
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

  // If the string starts with prose, find the first JSON opener.
  const firstBrace = t.search(/[{[]/);
  if (firstBrace > 0) t = t.slice(firstBrace);

  // Trim trailing junk after the last matching close-brace.
  const lastBrace = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (lastBrace > 0 && lastBrace < t.length - 1) t = t.slice(0, lastBrace + 1);

  try {
    const parsed = JSON.parse(t);
    return (parsed ?? fallback) as T;
  } catch {
    // Fall back to extracting the first balanced object/array via a
    // brace counter (handles prose *inside* the JSON payload).
    const extracted = extractFirstJson(t);
    if (extracted !== undefined) return extracted as T;
    return fallback;
  }
}

/** Scan for the first balanced `{...}`/`[...]` and parse it. */
function extractFirstJson(text: string): any | undefined {
  const start = text.search(/[{[]/);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Coerce an LLM response into an array of `T`.
 *
 * Accepts any of:
 *   - a bare array:            [{...}, {...}]
 *   - an object with `key`:    { "queries": [...] } / { "facts": [...] }
 *   - a JSON string array:     ["fact 1", "fact 2"]  (mapped via `mapItem`)
 *
 * Returns [] when nothing usable is found.
 */
export function coerceArray<T>(
  text: string,
  key: string,
  mapItem: (item: any) => T | null
): T[] {
  const parsed = parseJsonLoose<any>(text, null as any);
  let raw: any[] = [];

  if (Array.isArray(parsed)) {
    raw = parsed;
  } else if (parsed && typeof parsed === "object") {
    const candidate = (parsed as any)[key];
    if (Array.isArray(candidate)) raw = candidate;
    else if (typeof candidate === "string") raw = [candidate];
  }

  const out: T[] = [];
  for (const item of raw) {
    const mapped = mapItem(item);
    if (mapped !== null && mapped !== undefined) out.push(mapped);
  }
  return out;
}
