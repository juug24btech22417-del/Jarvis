// AI Agent mode — goal-driven browser automation.
//
// The LLM sees the page's interactive elements (tagged with data-jv
// indexes) and chooses ONE action per turn: click, fill, or done.
// The route loops (max 12 turns), executing each decision against the
// live page until the goal is met. Self-healing by construction: it
// reads the DOM fresh every turn, so redesigns don't break it.

import { NextRequest, NextResponse } from "next/server";
import { createAgentSession, AgentSession } from "@/lib/browser/engine";
import { prisma } from "@/lib/db/queries";

const MAX_TURNS = 12;
// Hard ceiling for a whole run — the panel shows a spinner until this
// returns, so it must always finish in bounded time.

const RUN_BUDGET_MS = 75_000;

// ─── LLM plumbing — all providers raced in parallel ─────────────────
// The old code tried NVIDIA → Groq → OpenRouter back-to-back; one slow
// provider added its full 30s timeout to EVERY turn (3min+ runs). Now
// every candidate fires at once and the first usable answer wins.

interface LlmCandidate {
  label: string;
  url: string;
  key: string;
  model: string;
  extraHeaders?: Record<string, string>;
}

function llmCandidates(): LlmCandidate[] {
  const cands: LlmCandidate[] = [];
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (nvidiaKey) {
    // -0731 suffix required: NVIDIA 410s the bare id (same fix as chat).
    cands.push({ label: "nvidia", url: "https://integrate.api.nvidia.com/v1/chat/completions", key: nvidiaKey, model: "nvidia/nemotron-3-super-120b-a12b" });
  }
  if (groqKey) {
    for (const model of ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]) {
      cands.push({ label: `groq/${model}`, url: "https://api.groq.com/openai/v1/chat/completions", key: groqKey, model });
    }
  }
  if (openrouterKey) {
    for (const model of ["nvidia/nemotron-3.5-lightning:free", "cohere/north-mini-code:free"]) {
      cands.push({
        label: `openrouter/${model}`,
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: openrouterKey,
        model,
        extraHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "JARVIS Browser Agent" },
      });
    }
  }
  return cands;
}

async function attemptLLM(c: LlmCandidate, messages: Array<{ role: string; content: string }>, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.key}`, ...(c.extraHeaders ?? {}) },
      body: JSON.stringify({ model: c.model, messages, temperature: 0, max_tokens: 700 }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${c.label} → ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${c.label}: empty response`);
    return content as string;
  } finally {
    clearTimeout(timer);
  }
}

async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const cands = llmCandidates();
  if (cands.length === 0) throw new Error("No LLM providers configured (set NVIDIA/GROQ/OPENROUTER key)");

  const errors: string[] = [];
  const raceOnce = async () =>
    Promise.all(
      cands.map(async (c) => {
        try {
          const content = await attemptLLM(c, messages, 14_000);
          // Some providers 200 with a refusal/error string — an answer with
          // no action JSON loses so a usable candidate can win. (A real
          // {"action":"fail"} still passes; only no-JSON output is rejected.)
          const d = parseDecision(content);
          if (d.kind === "fail" && /No action in LLM output/i.test(d.reason)) {
            throw new Error("no action JSON in output");
          }
          return { ok: true as const, content };
        } catch (e) {
          errors.push((e as Error).message.slice(0, 80));
          return { ok: false as const };
        }
      })
    );

  let results = await raceOnce();
  if (!results.some((r) => r.ok)) {
    // Everything rate-limited/errors at once is usually a burst 429 —
    // one short backoff and re-race recovers most of these in-request.
    await new Promise((r) => setTimeout(r, 9_000));
    results = await raceOnce();
  }
  const winner = results.find((r) => r.ok);
  if (!winner) throw new Error(`No LLM available: ${errors.slice(0, 4).join("; ")}`);
  return winner.content;
}

// ─── Agent decision parsing ─────────────────────────────────────────

type AgentDecision =
  | { kind: "goto"; url: string }
  | { kind: "click"; i: number }
  | { kind: "fill"; i: number; value: string }
  | { kind: "press"; key: string }
  | { kind: "done"; answer: string }
  | { kind: "fail"; reason: string };

function parseDecision(raw: string): AgentDecision {
  // Some models wrap JSON in markdown fences or lead with prose — find the
  // first {...} block anywhere in the response.
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const d = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return decisionFromObject(d);
    } catch {
      // Truncated or malformed — fall through to field salvage.
    }
  }

  // Salvage: pull the action fields individually. Handles reasoning models
  // that burn the token budget mid-object (truncated JSON).
  const am = cleaned.match(/"action"\s*:\s*"(goto|click|fill|done|fail)"/i);
  if (!am) return { kind: "fail", reason: `No action in LLM output: "${cleaned.slice(0, 100)}"` };
  const action = am[1].toLowerCase();
  const num = (key: string) => {
    const m = cleaned.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`, "i"));
    return m ? parseInt(m[1], 10) : NaN;
  };
  const str = (key: string) => {
    const m = cleaned.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i"));
    return m ? m[1] : "";
  };
  switch (action) {
    case "goto":
      return { kind: "goto", url: str("url") };
    case "click": {
      const i = num("i");
      return Number.isFinite(i) ? { kind: "click", i } : { kind: "fail", reason: "click missing index" };
    }
    case "fill": {
      const i = num("i");
      return Number.isFinite(i) ? { kind: "fill", i, value: str("value") } : { kind: "fail", reason: "fill missing index" };
    }
    case "press":
      return { kind: "press", key: str("key") || "Enter" };
    case "done":
      return { kind: "done", answer: str("answer") || "Goal completed." };
    case "fail":
      return { kind: "fail", reason: str("reason") || "unknown" };
    default:
      return { kind: "fail", reason: `Unknown action: ${action}` };
  }
}

function decisionFromObject(d: Record<string, unknown>): AgentDecision {
  switch (d.action) {
    case "goto":
      return { kind: "goto", url: String(d.url ?? "") };
    case "click":
      return { kind: "click", i: Number(d.i) };
    case "fill":
      return { kind: "fill", i: Number(d.i), value: String(d.value ?? "") };
    case "press":
      return { kind: "press", key: String(d.key ?? "Enter") };
    case "done":
      return { kind: "done", answer: String(d.answer ?? "") };
    case "fail":
      return { kind: "fail", reason: String(d.reason ?? "unknown") };
    default:
      return { kind: "fail", reason: `Unknown action: ${String(d.action)}` };
  }
}

const SYSTEM_PROMPT = `You are JARVIS, an AI controlling a web browser to complete a goal.
You receive a list of interactive page elements, each with an index i.

CRITICAL OUTPUT RULE: Your entire response must be EXACTLY ONE JSON object and NOTHING else.
No explanations. No thinking out loud. No markdown. Start your response with { and end it with }.

Valid actions:
{"action":"goto","url":"..."}           - navigate somewhere new
{"action":"click","i":<index>}          - click an element
{"action":"fill","i":<index>,"value":"..."} - type into an input
{"action":"press","key":"Enter"}        - press a keyboard key (submits search forms)
{"action":"done","answer":"..."}        - goal achieved; answer summarizes the result
{"action":"fail","reason":"..."}        - impossible on this page

Look at page state carefully. Prefer clicking search buttons after filling.
When the goal's answer is visible in the PAGE TEXT (prices, colors, titles, specs), choose done immediately with that answer — do not keep clicking.
If the page is a homepage, use its search box (fill + press Enter). If no search box exists, goto a search URL directly. Never stop just because you landed somewhere unexpected — adapt.
When the goal is about a specific product, click into the best-matching result link first, then answer from its product page — the page you end on is given to the user as a clickable link, so it must be the product itself, not a results list.`;

// Direct search URLs — skipping the homepage dodges most bot walls,
// because the search results route is served before the strictest
// fingerprint checks kick in. Query is filled from the goal when the
// caller didn't pass a startUrl.
function buildSearchUrl(goal: string): string | null {
  const g = goal.toLowerCase();
  const query = encodeURIComponent(goal.replace(/^(search|find|look up|tell me the (cheapest )?price of)\s+(for\s+)?/i, "").replace(/\s+on\s+(amazon|flipkart|swiggy|zomato|myntra|ajio).*$/i, "").trim());
  if (!query) return null;
  if (/amazon/.test(g)) return `https://www.amazon.in/s?k=${query}`;
  if (/flipkart/.test(g)) return `https://www.flipkart.com/search?q=${query}`;
  if (/myntra/.test(g)) return `https://www.myntra.com/${query.replace(/%20/g, "-")}`;
  if (/ajio/.test(g)) return `https://www.ajio.com/search/?text=${query}`;
  if (/swiggy/.test(g)) return `https://www.swiggy.com/search?query=${query}`;
  // Zomato has no public query-search URL; its /india/search route 404s.
  // The city listing is the tamest real entry — the agent searches in-page.
  if (/zomato/.test(g)) return "https://www.zomato.com/ncr/restaurants";
  return null;
}

function looksLikeProductPage(url: string): boolean {
  // Amazon: /dp/ or /gp/product; Flipkart: /<slug>/p/itm<id>; Myntra:
  // numeric tail; Swiggy/Zomato: restaurant or item slugs.
  return /amazon\.[\w.]+\/((dp|gp\/product)\/|[^/]+\/dp\/)/.test(url)
    || /flipkart\.com\/.*\/p\/itm/.test(url)
    || /myntra\.com\/[^/]+\/\d+/.test(url)
    || /swiggy\.com\/(restaurants|instamart)\//.test(url)
    || /zomato\.com\/[^/]+\/restaurants?\//.test(url);
}

const WALL_RETRIES = 3;

// Snapshot hrefs are page-relative; product checks need absolute URLs.
function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

// On a wall retry we go straight to the site's search URL instead of the
// homepage — homepages run the strictest fingerprint checks, results pages
// are the tamest route on every shopping site.
function freshStartUrl(goal: string, startUrl?: string): string {
  return buildSearchUrl(goal) ?? startUrl ?? "https://www.google.com";
}

// ─── Route ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    goal?: string;
    startUrl?: string;
    sessionName?: string;
    headed?: boolean;
  } | null;

  if (!body?.goal?.trim()) {
    return NextResponse.json({ error: "goal is required" }, { status: 400 });
  }

  const session: AgentSession = await createAgentSession({
    sessionName: body.sessionName,
    headed: !!body.headed,
  });

  const trace: Array<{ turn: number; decision: string; detail?: string }> = [];
  let answer: string | null = null;
  let screenshot: string | null = null;
  let productUrl: string | null = null;
  // Newest page snapshot — used to promote a product href into a
  // clickable link when the LLM answers without navigating to the item.
  let lastSnapshot: { url: string; els: Array<{ i: number; tag: string; txt: string; href: string | null }> } | null = null;
  const started = Date.now();

  try {
    // Retry with a fresh fingerprint when a wall appears — each attempt
    // gets a new viewport/headers/init-script context from freshen().
    for (let attempt = 1; attempt <= WALL_RETRIES && !answer; attempt++) {
      if (attempt > 1) {
        await session.freshen();
        trace.push({ turn: 0, decision: "retry", detail: `Attempt ${attempt}: fresh browser fingerprint` });
      }

      const startUrl =
        attempt === 1 && body.startUrl
          ? body.startUrl
          : freshStartUrl(body.goal, body.startUrl);
      await session.goto(startUrl);

      for (let turn = 1; turn <= MAX_TURNS; turn++) {
        // Run-budget guard: bail out of the turn loop once the whole run
        // is out of time; the outer failure text handles the message.
        if (Date.now() - started > RUN_BUDGET_MS) {
          trace.push({ turn, decision: "budget", detail: "Run budget exhausted" });
          break;
        }
        // Bot wall mid-run: retry with a new fingerprint instead of
        // surrendering with a captcha screenshot.
        if (turn > 1 && (await session.captcha())) {
          trace.push({ turn, decision: "wall", detail: "Bot wall detected — retrying with fresh fingerprint" });
          answer = null;
          break;
        }

        const snap = await session.snapshot();
        lastSnapshot = { url: snap.url, els: snap.els.map((e) => ({ i: e.i, tag: e.tag, txt: e.txt, href: e.href })) };
        const elements = snap.els
          .map((e) => `${e.i}: <${e.tag}${e.id ? ` id=${e.id}` : ""}${e.nm ? ` name=${e.nm}` : ""}${e.type ? ` type=${e.type}` : ""}> ${e.txt || e.ph || ""}${e.href ? ` href=${e.href.slice(0, 80)}` : ""}`)
          .join("\n");
        // The agent answers goals from this text — prices, colors, specs.
        const pageText = (snap.text || "").slice(0, 2200);

        const recent = trace.slice(-4).map((t) => `t${t.turn}:${t.decision} ${t.detail ?? ""}`).join(" | ");
        const llmRaw = await callLLM([
          { role: "system", content: `${SYSTEM_PROMPT}\n\nHuman-behavior tips: after typing into a search box, submit with {"action":"press","key":"Enter"} or click the search button. NEVER repeat an action you already did with the same arguments — if the page looks unchanged, try a different approach (press Enter, click another element, or fail).` },
          {
            role: "user",
            content: `GOAL: ${body.goal}\n\nRECENT ACTIONS (do not repeat): ${recent || "none"}\n\nPAGE: ${snap.title} (${snap.url})\n\nPAGE TEXT (the answer is often here):\n${pageText}\n\nELEMENTS (clickable/typeable, by index):\n${elements}`,
          },
        ]);

        const decision = parseDecision(llmRaw);
        trace.push({ turn, decision: decision.kind, detail: JSON.stringify(decision).slice(0, 160) });

        if (decision.kind === "done") {
          answer = decision.answer;
          break;
        }
        if (decision.kind === "fail") {
          answer = `Couldn't complete: ${decision.reason}`;
          break;
        }
        if (decision.kind === "goto") {
          try {
            await session.goto(decision.url);
          } catch (e) {
            trace.push({ turn, decision: "error", detail: (e as Error).message.slice(0, 100) });
          }
          continue;
        }
        if (decision.kind === "click") {
          try {
            await session.clickRef(decision.i);
          } catch (e) {
            // Stale element / navigation race — tell the agent so it adapts
            // (e.g. re-snapshot picks fresh indexes next turn).
            trace.push({ turn, decision: "error", detail: (e as Error).message.slice(0, 100) });
          }
          continue;
        }
        if (decision.kind === "fill") {
          try {
            await session.fillRef(decision.i, decision.value);
          } catch (e) {
            trace.push({ turn, decision: "error", detail: (e as Error).message.slice(0, 100) });
          }
          continue;
        }
        if (decision.kind === "press") {
          try {
            await session.pressKey(decision.key);
          } catch (e) {
            trace.push({ turn, decision: "error", detail: (e as Error).message.slice(0, 100) });
          }
          continue;
        }
      }
    }

    screenshot = await session.screenshotJpeg();
    if (!answer) {
      const lastError = [...trace].reverse().find((t) => t.decision === "error");
      answer = lastError
        ? `Ran into a page error before finishing: ${lastError.detail}. The goal wasn't completed — try again (transient navigation races happen) or use headed mode.`
        : `Ran out of turns (${MAX_TURNS}) before confirming the goal.`;
    }

    // Give the user a clickable link. Prefer the final page when it IS a
    // product; on a results page, promote the best product href from the
    // last snapshot instead (the LLM often answers without clicking) —
    // scored by how many answer words the link text shares.
    const finalPageUrl = session.url();
    if (finalPageUrl && looksLikeProductPage(finalPageUrl)) {
      productUrl = finalPageUrl;
    } else if (lastSnapshot) {
      const snapBase = lastSnapshot;
      const answerWords = new Set(
        answer.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)
      );
      const best = snapBase.els
        .filter((e) => e.href && e.tag === "a" && looksLikeProductPage(absolutize(e.href, snapBase.url)))
        .map((e) => ({
          href: e.href as string,
          score: (e.txt || "")
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .reduce((n, w) => n + (answerWords.has(w) ? 1 : 0), 0),
        }))
        .sort((a, b) => b.score - a.score)[0];
      if (best?.href) productUrl = absolutize(best.href, snapBase.url);
      else if (finalPageUrl && !/^(Couldn't|Bot wall|Ran )/.test(answer)) productUrl = finalPageUrl;
    }

    // Run history (best-effort).
    try {
      await prisma.browserRun.create({
        data: {
          workflow: "agent",
          goal: body.goal.slice(0, 300),
          success: !/^(Couldn't|Bot wall|Ran )/.test(answer),
          summary: answer.slice(0, 250),
          durationMs: Date.now() - started,
        },
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: !/^(Couldn't|Bot wall|Ran )/.test(answer), answer, productUrl, trace, screenshot });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    // All providers 429ing is a quota blip, not a bug — say so plainly.
    const friendly = /No LLM available/.test(msg)
      ? "All AI providers are rate-limited right now. Wait a minute and try again — this recovers on its own."
      : "Agent run failed";
    return NextResponse.json({ error: friendly, details: msg, trace }, { status: /No LLM available/.test(msg) ? 503 : 500 });
  } finally {
    await session.close();
  }
}
