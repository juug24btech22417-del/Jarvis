// Circle to Search — the brain behind "draw around anything, JARVIS tells you
// what it is".
//
// Flow: the OS overlay (scripts/clipboard-watcher.ps1) freezes the screen, the
// user draws a freeform loop around something, and the crop is POSTed to
// /api/circle/search as a base64 PNG. This module then:
//
//   1. LOOKS at the crop with a multimodal model: what IS the circled thing?
//      (kind / title / one-line summary / the best search query / the answer
//      when the circle holds text, a question or code)
//   2. ROUTES to the right Google surface through Serper — Shopping for
//      products, Maps-style places for locations, Images for faces and
//      pictures, plain web search for everything else
//   3. Returns ONE card payload that both the OS popup and the web app render.
//
// Everything except `circleSearch` is pure and network-free, so the heuristics
// are unit-tested directly (tests/circleSearch.test.ts) — the same split the
// clipboard detector uses.

import { parseJsonLoose } from "@/lib/llm/fastJson";

export type CircleKind =
  | "product"
  | "place"
  | "person"
  | "text"
  | "question"
  | "code"
  | "chart"
  | "image"
  | "other";

/** Which Google surface a kind is best answered by. */
export type CircleSurface = "shopping" | "places" | "images" | "search";

export interface CircleItem {
  title: string;
  url: string;
  snippet: string;
  /** Site name / price source shown after the title. */
  source: string;
  price?: string;
  thumbnail?: string;
}

export interface CircleResult {
  success: true;
  kind: CircleKind;
  /** Card badge text, e.g. "Product found". */
  kindLabel: string;
  title: string;
  summary: string;
  /** The direct answer when the circle held text / a question / code. */
  answer: string;
  /** Best Google query for this circle (always present when we saw anything). */
  query: string;
  confidence: number;
  items: CircleItem[];
  /** One-click "search Google" target for the card footer. */
  searchUrl: string;
  /** Which provider answered / which surface was searched, for the log line. */
  provider: string;
  surface: CircleSurface;
  /** True when no vision model answered - the card says so instead of looking empty. */
  visionFailed: boolean;
  /** Total server time for the whole circle, so the UI can prove it was fast. */
  elapsedMs: number;
}

/** Card badge per kind — the GitHub-notebook style label the watcher shows. */
export const KIND_LABEL: Record<CircleKind, string> = {
  product: "Product found",
  place: "Place found",
  person: "Person found",
  text: "Text found",
  question: "Answered",
  code: "Code found",
  chart: "Chart found",
  image: "Visual match",
  other: "Found it",
};

const KINDS = Object.keys(KIND_LABEL) as CircleKind[];
const KIND_SET = new Set<string>(KINDS);

/**
 * Normalise whatever the model called the kind. Models drift ("goods",
 * "object", "celebrity", "landmark"), so aliases are folded onto our nine
 * kinds and anything unknown becomes "other" instead of a broken badge.
 */
export function coerceKind(v: unknown): CircleKind {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return "other";
  if (KIND_SET.has(s)) return s as CircleKind;

  // The model sometimes returns a whole phrase ("product on a shelf"). Word
  // boundaries matter here: without them "logo" reads as code (log) and
  // "paragraph" reads as a chart (graph).
  if (/(?:^|\W)(?:products?|items?|goods|gadgets?|objects?|devices?|phones?|laptops?|shoes?|sneakers?|watches?|books?|bottles?|bags?|toys?|furniture|appliances?|vehicles?|cars?|headphones?|earbuds?|clothes|clothing|outfit)(?:$|\W)/.test(s))
    return "product";
  if (/(?:^|\W)(?:places?|landmarks?|monuments?|locations?|cities|city|countries|country|buildings?|maps?|streets?|restaurants?|cafes?|hotels?|storefronts?)(?:$|\W)/.test(s))
    return "place";
  if (/(?:^|\W)(?:faces?|persons?|people|humans?|celebrity|celebrities|actors?|actresses?|singers?|politicians?|athletes?|portraits?|women|woman|men|man)(?:$|\W)/.test(s))
    return "person";
  if (/(?:^|\W)(?:charts?|graphs?|diagrams?|tables?|infographics?|plots?|dashboards?|stats|statistics|figures?)(?:$|\W)/.test(s))
    return "chart";
  if (/(?:^|\W)(?:codes?|snippets?|programs?|scripts?|commands?|terminal|errors?|logs?|traces?|stacks?|exceptions?|bugs?|crashes|compiler|console)(?:$|\W)/.test(s))
    return "code";
  if (/(?:^|\W)(?:questions?|query|queries|prompts?)(?:$|\W)/.test(s)) return "question";
  if (/(?:^|\W)(?:texts?|paragraphs?|passages?|documents?|articles?|sentences?|writing|labels?|captions?)(?:$|\W)/.test(s))
    return "text";
  if (/(?:^|\W)(?:photos?|pictures?|images?|logos?|arts?|paintings?|memes?|posters?|screenshots?|graphics?|illustrations?)(?:$|\W)/.test(s))
    return "image";
  return "other";
}

/** Product → Shopping, place → Places, faces/pictures → Images, rest → web. */
export function selectSurface(kind: CircleKind): CircleSurface {
  switch (kind) {
    case "product":
      return "shopping";
    case "place":
      return "places";
    case "person":
    case "image":
    case "chart":
      return "images";
    default:
      return "search";
  }
}

/** A kind whose whole value is the answer, not a list of links. */
export function isAnswerFirst(kind: CircleKind, answer: string): boolean {
  return kind === "question" && answer.trim().length > 0;
}

/** The "Search Google" URL for a query, aimed at the right Google tab. */
export function buildSearchUrl(query: string, kind: CircleKind): string {
  const q = encodeURIComponent((query ?? "").trim());
  if (!q) return "https://www.google.com/search";
  if (kind === "product") return `https://www.google.com/search?tbm=shop&q=${q}`;
  if (kind === "person" || kind === "image" || kind === "chart")
    return `https://www.google.com/search?tbm=isch&q=${q}`;
  if (kind === "place") return `https://www.google.com/maps/search/?api=1&query=${q}`;
  return `https://www.google.com/search?q=${q}`;
}

/** Hostname without the www, used as a result's "source" line. */
export function host(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url ?? ""));
  if (!m) return "";
  return m[1].replace(/^www\./i, "");
}

function str(v: unknown, max = 400): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) : t;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n > 0 && n <= 1 ? n : n > 1 ? Math.min(1, n / 100) : fallback;
}

export interface CirclePlan {
  kind: CircleKind;
  title: string;
  summary: string;
  answer: string;
  query: string;
  confidence: number;
}

/**
 * Turn the vision model's JSON into the plan the router uses. Never throws:
 * a missing/incoherent answer still yields a usable plan (the circled crop is
 * still searchable), so the card always has something to show.
 */
export function planFromVision(
  raw: Record<string, unknown> | null,
  fallbackQuery = ""
): CirclePlan {
  const fallback = str(fallbackQuery, 200);
  if (!raw) {
    return {
      kind: "other",
      title: fallback || "Screen selection",
      summary: fallback
        ? `Searching for "${fallback}".`
        : "I could not identify this with a model, so here are matching results.",
      answer: "",
      query: fallback,
      confidence: 0,
    };
  }

  const kind = coerceKind(raw.kind ?? raw.type ?? raw.category);
  const title = str(raw.title ?? raw.name ?? raw.subject, 90);
  const summary = str(raw.summary ?? raw.description, 300);
  const answer = str(raw.answer ?? raw.text ?? raw.transcription ?? raw.content, 4000);
  const query =
    str(raw.query ?? raw.searchQuery ?? raw.search_query, 160) || title || fallback;

  return {
    kind,
    title: title || fallback || "Screen selection",
    summary,
    answer,
    query,
    confidence: num(raw.confidence, kind === "other" ? 0.4 : 0.8),
  };
}

/**
 * Flatten a Serper response of any surface into the card's item list.
 * Pure: same input, same output, so the mapping is unit-tested per surface.
 */
export function normalizeSerper(surface: CircleSurface, data: unknown): CircleItem[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const out: CircleItem[] = [];
  const seen = new Set<string>();

  const push = (item: CircleItem) => {
    if (!item.title && !item.url) return;
    const key = (item.url || item.title).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const rows = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

  // Shopping first when we asked for it, so prices lead the card.
  if (surface === "shopping") {
    for (const r of rows(d.shopping)) {
      push({
        title: str(r.title, 120),
        url: str(r.link, 500),
        snippet: [str(r.source, 60), str(r.price, 24)].filter(Boolean).join(" · "),
        source: str(r.source, 60),
        price: str(r.price, 24),
        thumbnail: str(r.imageUrl, 500),
      });
    }
  }

  if (surface === "places") {
    for (const r of rows(d.places)) {
      const title = str(r.title ?? r.name, 120);
      const address = str(r.address, 160);
      push({
        title,
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [title, address].filter(Boolean).join(" ")
        )}`,
        snippet: [address, r.rating ? `★ ${str(r.rating, 8)}` : ""].filter(Boolean).join(" · "),
        source: "Google Maps",
      });
    }
  }

  if (surface === "images") {
    for (const r of rows(d.images)) {
      const link = str(r.link ?? r.imageUrl, 500);
      push({
        title: str(r.title, 120) || host(link),
        url: link,
        snippet: str(r.source, 80),
        source: str(r.source, 80) || host(link),
        thumbnail: str(r.imageUrl ?? r.thumbnailUrl, 500),
      });
    }
  }

  // Web results back every surface: the specific tab can come back empty
  // (a niche product with no Shopping listings still has web pages).
  for (const r of rows(d.organic)) {
    push({
      title: str(r.title, 140),
      url: str(r.link, 500),
      snippet: str(r.snippet, 300),
      source: host(str(r.link, 500)),
    });
  }

  for (const r of rows(d.knowledgeGraph ? [d.knowledgeGraph] : [])) {
    const title = str(r.title, 120);
    push({
      title,
      url: str(r.website ?? r.descriptionLink, 500),
      snippet: str(r.description, 300),
      source: str(r.type, 60) || "Knowledge",
    });
  }

  return out.slice(0, 6);
}

// ── The vision look ───────────────────────────────────────────────────────
//
// Speed IS the feature, so this never walks a list of models one after another.
// Every candidate is fired in PARALLEL, the first valid JSON wins, the losers
// are aborted, and one hard deadline bounds the whole thing:
//
//   t=0.0s   the fast Gemini racers start (the healthy path)
//   t=2.5s   hedged racers start, in case Gemini is quota-limited
//   t=9.0s   deadline - whatever answered by now wins, else we degrade fast
//
// A throttled provider can therefore never cost the user its timeout. The old
// sequential chain (30s per model, then 3x7s of OpenRouter) is exactly how a
// circle ended up taking 60-80s and coming back empty when Gemini hit its
// free-tier limit.

const DEFAULT_VISION_TIMEOUT_MS = 9_000;
const DEFAULT_HEDGE_MS = 2_500;

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Fast, healthy racers. These decide the common case. */
const GEMINI_FAST_MODELS = [
  process.env.CIRCLE_VISION_MODEL,
  "gemini-2.5-flash",
  "gemini-3.6-flash",
].filter(Boolean) as string[];

/** Slower backstop, only fired if the fast racers have not answered yet. */
const GEMINI_FALLBACK_MODELS = ["gemini-flash-latest"];

/** Free OpenRouter vision models - the safety net when Gemini is throttled. */
const OPENROUTER_VISION_MODELS = [
  process.env.CIRCLE_OPENROUTER_MODEL,
  "google/gemma-4-31b-it:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
].filter(Boolean) as string[];

function geminiKey(): string | null {
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!k || !k.trim() || k.trim() === "your-api-key-here") return null;
  return k.trim();
}

function openRouterKey(): string | null {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k || !k.trim() || k.trim() === "your-api-key-here") return null;
  return k.trim();
}

const CIRCLE_SYSTEM = `You are JARVIS. The user circled a region of their screen with a freehand loop. The circled area is BRIGHT; everything outside it is dimmed and greyed — that is context only, never the subject. Identify what is inside the loop and return STRICT JSON only, no fences:

{
  "kind": "product|place|person|text|question|code|chart|image|other",
  "title": "the circled thing's name, max 60 chars (product name, place, person, or a 3-6 word label)",
  "summary": "one sentence, max 180 chars, saying exactly what this is",
  "query": "the single best Google search query to find this, max 90 chars",
  "answer": "if the circle holds readable text, a question, code or an error: the direct answer / transcription / fix. Otherwise a short useful description of the object.",
  "confidence": 0.0
}

Rules:
- kind "product": a physical good that can be bought (shoes, a phone, headphones, a book, a bottle). Make "query" the exact product + brand + model.
- kind "place": a landmark, building, city, map, restaurant storefront.
- kind "person": a face or a photo of a person.
- kind "question": the circled text is a question that deserves an answer — put that answer in "answer".
- kind "text": readable prose/labels worth transcribing — transcribe it in "answer".
- kind "code": code, a terminal, a stack trace or an error — put the corrected code or the fix in "answer".
- kind "chart": a graph, table, dashboard or diagram.
- kind "image": a photo, logo, artwork or meme.
- Read every visible word, number and brand inside the loop. Never invent a brand or model you cannot actually read; if it is unreadable say so in "summary" and keep "query" generic.
- "query" must never be empty: fall back to describing the object in plain words.
- confidence is how sure you are of the identification (0.0-1.0).`;

function userPrompt(question?: string): string {
  const lines = [
    "Look at the attached crop of the user's screen and respond with the strict JSON object now.",
  ];
  if (question) lines.push(`The user also asks: "${question}" — answer it in "answer".`);
  return lines.join("\n");
}

export interface VisionResult {
  raw: Record<string, unknown> | null;
  provider: string;
  ms: number;
}

interface RaceResult {
  provider: string;
  raw: Record<string, unknown>;
}

/**
 * Race the candidates and resolve with the FIRST valid identification.
 * Rejects only when every candidate has already lost.
 */
function raceFirst(attempts: Array<Promise<RaceResult | null>>): Promise<RaceResult> {
  return new Promise<RaceResult>((resolve, reject) => {
    let pending = attempts.length;
    let done = false;
    if (!pending) {
      reject(new Error("no vision provider configured"));
      return;
    }
    const lose = () => {
      if (!done && --pending === 0) reject(new Error("all vision providers failed"));
    };
    for (const p of attempts) {
      p.then((r) => {
        if (done) return;
        if (r) {
          done = true;
          resolve(r);
          return;
        }
        lose();
      }).catch(lose);
    }
  });
}

async function geminiAttempt(
  model: string,
  key: string,
  base64: string,
  mime: string,
  prompt: string,
  signal: AbortSignal
): Promise<RaceResult | null> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: CIRCLE_SYSTEM }] },
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.15,
            // Generation length dominates latency; the answer is a small object.
            maxOutputTokens: 500,
            thinkingConfig: { thinkingBudget: 0 },
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: base64 } }],
            },
          ],
        }),
      }
    );
    if (!res.ok) {
      // 429 = free-tier quota: expected, and the hedge covers it.
      if (res.status !== 429) console.warn(`[circleSearch] gemini ${model} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text: string | undefined = data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    const parsed = text ? parseJsonLoose<Record<string, unknown>>(text) : null;
    return parsed ? { provider: `Gemini/${model}`, raw: parsed } : null;
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") {
      console.warn(`[circleSearch] gemini ${model} failed:`, (e as Error)?.name);
    }
    return null;
  }
}

async function openRouterAttempt(
  model: string,
  key: string,
  dataUrl: string,
  prompt: string,
  signal: AbortSignal
): Promise<RaceResult | null> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "JARVIS Circle to Search",
      },
      signal,
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `${CIRCLE_SYSTEM}\n\n${prompt}` },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 700,
        temperature: 0.15,
      }),
    });
    if (!res.ok) {
      if (res.status !== 429) console.warn(`[circleSearch] openrouter ${model} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text: string | undefined = data?.choices?.[0]?.message?.content;
    const parsed = text ? parseJsonLoose<Record<string, unknown>>(text) : null;
    return parsed ? { provider: `OpenRouter/${model}`, raw: parsed } : null;
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") {
      console.warn(`[circleSearch] openrouter ${model} failed:`, (e as Error)?.name);
    }
    return null;
  }
}

/**
 * Look at the circled crop with the first model that answers.
 * Resolves `raw: null` (never throws) when nothing could see it in time — the
 * caller still returns a usable card, fast.
 */
export async function lookAtCircle(image: string, question?: string): Promise<VisionResult> {
  const started = Date.now();
  const base64 = image.replace(/^data:image\/\w+;base64,/, "");
  const mime = /^data:(image\/[\w.+-]+);base64,/.exec(image)?.[1] ?? "image/png";
  if (!base64) return { raw: null, provider: "none", ms: 0 };

  const timeoutMs = envNum("CIRCLE_VISION_TIMEOUT_MS", DEFAULT_VISION_TIMEOUT_MS);
  const hedgeMs = envNum("CIRCLE_HEDGE_MS", DEFAULT_HEDGE_MS);
  const prompt = userPrompt(question);

  const ctrl = new AbortController();
  const deadline = setTimeout(() => ctrl.abort(), timeoutMs);
  const attempts: Array<Promise<RaceResult | null>> = [];

  const gk = geminiKey();
  if (gk) {
    for (const m of GEMINI_FAST_MODELS) {
      attempts.push(geminiAttempt(m, gk, base64, mime, prompt, ctrl.signal));
    }
  }

  // Hedged racers: they wait a beat before spending a request, so the healthy
  // path stays at two calls and the fallbacks only run when they are needed.
  const hedge = <T>(fn: () => Promise<T>): Promise<T | null> =>
    new Promise<void>((res) => setTimeout(res, hedgeMs)).then(() =>
      ctrl.signal.aborted ? null : fn()
    );

  if (gk) {
    for (const m of GEMINI_FALLBACK_MODELS) {
      attempts.push(hedge(() => geminiAttempt(m, gk, base64, mime, prompt, ctrl.signal)));
    }
  }
  const ork = openRouterKey();
  if (ork) {
    const dataUrl = `data:${mime};base64,${base64}`;
    for (const m of OPENROUTER_VISION_MODELS) {
      attempts.push(hedge(() => openRouterAttempt(m, ork, dataUrl, prompt, ctrl.signal)));
    }
  }

  try {
    const winner = await raceFirst(attempts);
    return { raw: winner.raw, provider: winner.provider, ms: Date.now() - started };
  } catch (e) {
    console.warn("[circleSearch] vision failed:", (e as Error)?.message);
    return { raw: null, provider: "none", ms: Date.now() - started };
  } finally {
    clearTimeout(deadline);
    // Abort the losers: no reason to keep paying for tokens we will not use.
    ctrl.abort();
  }
}

// ── Serper ────────────────────────────────────────────────────────────────

export function serperKey(): string | null {
  const k = process.env.SERPER_API_KEY;
  if (!k || !k.trim() || k === "your-api-key-here") return null;
  return k.trim();
}

/**
 * POST one Serper surface. If the specific tab fails (a niche query can 400 on
 * /shopping) we retry on plain web search, so the card is never empty just
 * because of the tab we chose.
 */
export async function serperSearch(
  surface: CircleSurface,
  query: string,
  key: string,
  count: number
): Promise<{ surface: CircleSurface; data: Record<string, unknown> | null }> {
  const call = async (s: CircleSurface): Promise<Record<string, unknown> | null> => {
    const body: Record<string, unknown> = { q: query, num: count };
    if (s === "places") delete body.num; // /places takes only the query
    try {
      const res = await fetch(`https://google.serper.dev/${s}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(9_000),
      });
      if (!res.ok) {
        console.warn(`[circleSearch] Serper /${s} HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (e) {
      console.warn(`[circleSearch] Serper /${s} failed:`, (e as Error)?.message);
      return null;
    }
  };

  const data = await call(surface);
  if (data) {
    const items = normalizeSerper(surface, data);
    if (items.length) return { surface, data };
  }
  if (surface !== "search") {
    const fallback = await call("search");
    if (fallback) return { surface: "search", data: fallback };
  }
  return { surface, data };
}

// ── Orchestration ─────────────────────────────────────────────────────────

export interface CircleSearchOptions {
  /** Base64 PNG/JPEG (data URL or bare) of the drawn region. */
  image: string;
  /** Optional typed follow-up question. */
  question?: string;
  /** Max result rows in the card. */
  maxItems?: number;
  /**
   * Skip the Google search leg and only identify what was circled. Used by
   * /api/circle/act, which needs the subject before it acts on it and has no
   * use for result rows — it saves a round trip on the interactive path.
   */
  describeOnly?: boolean;
}

/**
 * The whole feature in one call: look at the circle, decide what it is, search
 * the right Google surface, and hand back the card payload. Never throws and
 * never returns a provider error — a vision outage still produces a card with
 * whatever the Serper key and the query can do.
 */
export async function circleSearch(opts: CircleSearchOptions): Promise<CircleResult> {
  const started = Date.now();
  const { image, question } = opts;
  const maxItems = Math.min(Math.max(opts.maxItems ?? 4, 1), 6);

  const vision = await lookAtCircle(image, question);
  const plan = planFromVision(vision.raw, question ?? "");
  const visionFailed = !vision.raw;
  const surface = selectSurface(plan.kind);
  const searchUrl = buildSearchUrl(plan.query, plan.kind);

  let items: CircleItem[] = [];
  let searched: CircleSurface = surface;

  // A pure question is answered in the card; searching it would only add noise.
  const answerOnly = isAnswerFirst(plan.kind, plan.answer);
  const key = opts.describeOnly ? "" : serperKey();
  if (!answerOnly && key && plan.query) {
    const res = await serperSearch(surface, plan.query, key, maxItems);
    searched = res.surface;
    items = normalizeSerper(res.surface, res.data);
  }

  if (items.length > maxItems) items = items.slice(0, maxItems);

  // Never hand back a blank card. If no model could see the circle we say so in
  // plain words and point at the next move, instead of showing an empty result
  // the way the old sequential version did after its 60-80s.
  const title = visionFailed ? "Couldn't read that one" : plan.title;
  const summary = visionFailed
    ? "No vision model answered in time just now. Press Ctrl+Alt+S and circle a tighter area, or try again in a moment."
    : plan.summary || (plan.query ? `Best match for "${plan.query}".` : "Here is what I found.");

  return {
    success: true,
    kind: visionFailed ? "other" : plan.kind,
    kindLabel: visionFailed ? "Not identified" : KIND_LABEL[plan.kind],
    title,
    summary,
    answer: plan.answer,
    query: plan.query,
    confidence: plan.confidence,
    items,
    searchUrl,
    surface: searched,
    visionFailed,
    elapsedMs: Date.now() - started,
    provider: visionFailed
      ? `vision-unavailable (${vision.ms}ms)`
      : key
        ? `${vision.provider} + Serper/${searched}`
        : `${vision.provider} (no SERPER_API_KEY)`,
  };
}
