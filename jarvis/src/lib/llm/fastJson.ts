// Shared fast JSON-LLM helper for JARVIS's feature routes.
//
// Why this exists: routes used to call providers SEQUENTIALLY —
// a dead first hop meant every request paid its full timeout before the
// working provider was even attempted. This helper races providers in
// PARALLEL and returns the first valid JSON.
//
// Provider status (2026-10):
//   Gemini: gemini-2.5-flash — live but free-tier quota limited (429)
//   Gemini: gemini-3.5-flash-lite / 3.6 alias — dead (400/503)
//   Groq:   qwen/qwen3.8-27b — works in TEXT mode with /no_think (~250ms)
//           openai/gpt-oss-120b / 20b — slower reasoners, kept as fallback
//   NVIDIA: nvapi key expired (410)

// Model IDs verified live Oct 2026. GEMINI_JSON_MODEL can override the first
// entry; every model in the list is tried before the provider is abandoned.
const GEMINI_MODELS = [
  process.env.GEMINI_JSON_MODEL,
  "gemini-2.5-flash",
  "gemini-flash-latest",
].filter(Boolean) as string[];

// Groq models, fastest first.
const GROQ_MODELS = [
  "qwen/qwen3.8-27b",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

export interface JsonLlmOptions {
  /** System instruction describing the required JSON shape. */
  system: string;
  /** User payload to analyse. */
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Per-provider abort ceiling. Defaults to 10s. */
  timeoutMs?: number;
  /** Label used in console warnings. */
  label?: string;
}

/**
 * Best-effort repair for a JSON object cut off mid-generation: closes an open
 * string, drops a dangling separator and balances any unclosed braces. Small
 * max-token budgets occasionally truncate the model's reply, and without this
 * the whole (otherwise usable) response would be discarded.
 */
function repairTruncatedJson(s: string): string | null {
  let inStr = false;
  let esc = false;
  const stack: string[] = [];
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    out += c;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) out += '"';
  out = out.replace(/[,:\s]+$/, "");
  while (stack.length) out += stack.pop() === "{" ? "}" : "]";
  return out;
}

/** Extract the first JSON object from a possibly-fenced LLM response. */
export function parseJsonLoose<T = Record<string, unknown>>(text: string): T | null {
  if (!text) return null;
  // Strip think tags that qwen may emit even with /no_think
  const noThink = text.replace(/ thinking[\s\S]*?<\/think>/gi, "").trim();
  const cleaned = noThink.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  const end = cleaned.lastIndexOf("}");
  if (end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch {
      // fall through to the truncation repair below
    }
  }

  const repaired = repairTruncatedJson(cleaned.slice(start));
  if (!repaired) return null;
  try {
    return JSON.parse(repaired) as T;
  } catch {
    return null;
  }
}

async function tryGeminiJson(opts: JsonLlmOptions): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === "" || key === "your-api-key-here") return null;

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: opts.system }] },
            generationConfig: {
              responseMimeType: "application/json",
              temperature: opts.temperature ?? 0.3,
              maxOutputTokens: opts.maxTokens ?? 900,
              thinkingConfig: { thinkingBudget: 0 },
            },
            contents: [{ role: "user", parts: [{ text: opts.user }] }],
          }),
        }
      );
      if (!res.ok) {
        clearTimeout(timer);
        // 400 = invalid model, 404 = gone, 429 = quota exhausted, 503 =
        // temporarily unavailable — all mean "try the next model", never
        // "give up", because the caller races providers and needs a winner.
        if ([400, 404, 429, 503].includes(res.status)) {
          console.warn(`[fastJson] Gemini ${model} HTTP ${res.status} — trying next model`);
          continue;
        }
        console.warn(`[fastJson] Gemini ${model} HTTP ${res.status}`);
        return null;
      }
      const data = await res.json();
      const raw: string | undefined = data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("");
      clearTimeout(timer);
      return raw && raw.trim() ? raw : null;
    } catch (e: unknown) {
      console.warn(`[fastJson] Gemini ${model} failed:`, (e as Error)?.name ?? (e as Error)?.message);
      clearTimeout(timer);
    }
  }
  return null;
}

async function tryGroqJson(opts: JsonLlmOptions): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key || key.trim() === "" || key === "your-api-key-here") return null;

  // /no_think disables qwen3's chain-of-thought (~20x faster); JSON is
  // extracted from free text with parseJsonLoose. Each model gets its own
  // deadline so one dead id cannot consume the whole budget.
  for (const model of GROQ_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10000);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 900,
          messages: [
            { role: "user", content: `/no_think\n${opts.system}\n\n${opts.user}` },
          ],
        }),
      });
      if (!res.ok) {
        console.warn(`[fastJson] Groq ${model} HTTP ${res.status} — trying next model`);
        continue;
      }
      const data = await res.json();
      const raw: string | undefined = data?.choices?.[0]?.message?.content;
      if (!raw || !raw.trim()) continue;
      const cleaned = raw.replace(/ thinking[\s\S]*?<\/think>/gi, "").trim();
      if (cleaned) return cleaned;
    } catch (e: unknown) {
      console.warn(`[fastJson] Groq ${model} failed:`, (e as Error)?.name ?? (e as Error)?.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Race the configured providers and return the first parseable JSON object.
 * Resolves `null` (never throws) when every provider fails, so callers can
 * serve their deterministic fallback immediately.
 */
export async function callJsonLlm<T = Record<string, unknown>>(
  opts: JsonLlmOptions
): Promise<T | null> {
  const label = opts.label ?? "fastJson";
  const attempts: Array<Promise<string | null>> = [tryGeminiJson(opts), tryGroqJson(opts)];
  try {
    // First valid JSON wins; a provider that returns junk simply loses.
    const first = await new Promise<T>((resolve, reject) => {
      let pending = attempts.length;
      let done = false;
      for (const p of attempts) {
        p.then((raw) => {
          if (done) return;
          const parsed = raw ? parseJsonLoose<T>(raw) : null;
          if (parsed) {
            done = true;
            resolve(parsed);
            return;
          }
          if (--pending === 0) reject(new Error(`${label}: no provider returned valid JSON`));
        }).catch(() => {
          if (!done && --pending === 0) reject(new Error(`${label}: all providers failed`));
        });
      }
    });
    return first;
  } catch (e) {
    console.warn(`[fastJson] ${label} —`, (e as Error)?.message);
    return null;
  }
}
