// Tier 2C — Self-healing wrapper around PlaywrightService.
// On failure, capture page state + error, ask the LLM for an adapter fix,
// retry up to 2 more times. If the LLM says "ask the user", surface a
// structured needsUserInput payload.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface FailureContext {
  /** Plain text error from the underlying Playwright call. */
  error: string;
  /** Current URL of the page (best effort). */
  url?: string;
  /** <title> of the page (best effort). */
  title?: string;
  /** Human description of the action we tried. */
  attemptedAction: string;
  /** Last 500 chars of visible body text (best effort). */
  pageSnippet?: string;
}

export type AdapterFix =
  | { kind: "wait"; ms: number; reason: string }
  | { kind: "retry"; reason: string }
  | { kind: "scroll"; direction: "down" | "up"; amount: number; reason: string }
  | { kind: "navigate"; url: string; reason: string }
  | { kind: "askUser"; reason: string };

export interface HealOutcome {
  /** Did we eventually succeed? */
  ok: boolean;
  /** Number of total attempts (1 = no healing needed). */
  attempts: number;
  /** Final result string. */
  result?: string;
  /** Last error if all attempts failed. */
  error?: string;
  /** LLM-suggested fix the agent could surface to the user. */
  needsUserInput?: string;
  /** Brief narrative of what happened (for the AgentPanel timeline). */
  trail: string[];
}

/**
 * Ask the LLM for a single adapter fix given the failure context.
 * Returns null if no API key, if the model returns garbage, or if it gives up.
 */
async function askAdapter(ctx: FailureContext): Promise<AdapterFix | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const sys = [
    "You are JARVIS's browser-resilience adapter.",
    "A Playwright action failed. Suggest ONE concrete fix as JSON only — no prose.",
    "Pick one kind:",
    '- {"kind":"wait","ms":<int>,"reason":"<why>"}',
    '- {"kind":"retry","reason":"<why>"}',
    '- {"kind":"scroll","direction":"down|up","amount":<int>,"reason":"<why>"}',
    '- {"kind":"navigate","url":"<abs url>","reason":"<why>"}',
    '- {"kind":"askUser","reason":"<what we need from the user>"}',
    "Output strictly the JSON object. No commentary, no markdown.",
  ].join(" ");

  try {
    const res = await fetchWithTimeout(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: `Attempted: ${ctx.attemptedAction}\nURL: ${ctx.url ?? "?"}\nTitle: ${ctx.title ?? "?"}\nError: ${ctx.error}\nPage snippet (last 500 chars):\n${ctx.pageSnippet ?? ""}`,
          },
        ],
        max_tokens: 200,
        temperature: 0.2,
      }),
    }, 8000);

    if (!res.ok) return null;
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? "";
    const json = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(json);
    if (typeof parsed?.kind !== "string") return null;
    return parsed as AdapterFix;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run a Playwright action with self-healing retry. The action is invoked with
 * optional guidance; the caller should keep the action description in
 * `attemptedAction` for the LLM context.
 */
export async function heal<T extends { content?: string; error?: string }>(
  attemptedAction: string,
  run: (guidance?: AdapterFix) => Promise<T>
): Promise<HealOutcome> {
  const trail: string[] = [];
  const MAX_ATTEMPTS = 3;
  let lastError = "unknown";
  let lastResult: T | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      lastResult = await run();
      if (lastResult && !lastResult.error) {
        trail.push(`attempt ${attempt}: ok`);
        return {
          ok: true,
          attempts: attempt,
          result: lastResult.content ?? "(no content)",
          trail,
        };
      }
      lastError = lastResult?.error ?? "unknown";
      trail.push(`attempt ${attempt}: failed (${lastError.slice(0, 60)})`);
    } catch (e) {
      lastError = (e as Error)?.message ?? String(e);
      trail.push(`attempt ${attempt}: threw (${lastError.slice(0, 60)})`);
    }

    if (attempt >= MAX_ATTEMPTS) break;

    const fix = await askAdapter({
      error: lastError,
      attemptedAction,
    });

    if (!fix) {
      trail.push(`adapter: no fix (no key or unparseable)`);
      break;
    }

    trail.push(`adapter suggests: ${fix.kind} — ${fix.reason ?? ""}`);

    if (fix.kind === "askUser") {
      return {
        ok: false,
        attempts: attempt,
        error: lastError,
        needsUserInput: fix.reason,
        trail,
      };
    }

    // Apply fix and retry.
    if (fix.kind === "wait") {
      await sleep(Math.min(15_000, Math.max(250, fix.ms)));
    }
    // Other fix kinds (retry/scroll/navigate) are passed through as guidance
    // to the next run() call. Most simple service methods won't use it,
    // but it documents intent for callers that can act on it.
    try {
      lastResult = await run(fix);
      if (lastResult && !lastResult.error) {
        trail.push(`attempt ${attempt + 1} (post-${fix.kind}): ok`);
        return {
          ok: true,
          attempts: attempt + 1,
          result: lastResult.content ?? "(no content)",
          trail,
        };
      }
      lastError = lastResult?.error ?? "unknown";
      trail.push(`attempt ${attempt + 1} (post-${fix.kind}): failed`);
    } catch (e) {
      lastError = (e as Error)?.message ?? String(e);
      trail.push(`attempt ${attempt + 1} (post-${fix.kind}): threw`);
    }
  }

  return {
    ok: false,
    attempts: MAX_ATTEMPTS,
    error: lastError,
    trail,
  };
}