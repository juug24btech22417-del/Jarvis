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

// ─── LLM plumbing (NVIDIA → OpenRouter, same keys as chat) ──────────

async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const nvidiaKey = process.env.NVIDIA_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  const attempt = async (url: string, key: string, model: string, extraHeaders: Record<string, string> = {}, timeoutMs = 30_000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, ...extraHeaders },
        body: JSON.stringify({ model, messages, temperature: 0, max_tokens: 2000 }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("empty LLM response");
      return content as string;
    } finally {
      clearTimeout(timer);
    }
  };

  const errors: string[] = [];
  if (nvidiaKey) {
    try {
      return await attempt("https://integrate.api.nvidia.com/v1/chat/completions", nvidiaKey, "deepseek-ai/deepseek-v4-flash");
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  // Groq — fast and generously rate-limited; try before OpenRouter.
  // (Model ids verified against Groq's live catalog — llama-3.x ids are 410/404 now.)
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    for (const model of ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"]) {
      try {
        return await attempt("https://api.groq.com/openai/v1/chat/completions", groqKey, model);
      } catch (e) {
        errors.push(`groq/${model}: ${(e as Error).message}`);
      }
    }
  }
  // OpenRouter with the same model cascade the chat route uses.
  if (openrouterKey) {
    const models = [
      "nvidia/nemotron-3.5-lightning:free",
      "cohere/north-mini-code:free",
      "poolside/laguna-s-2.1:free",
      "poolside/laguna-xs-2.1:free",
      "inclusionai/ling-3.0-tiny:free",
    ];
    for (const model of models) {
      try {
        return await attempt(
          "https://openrouter.ai/api/v1/chat/completions",
          openrouterKey,
          model,
          { "HTTP-Referer": "http://localhost:3000", "X-Title": "JARVIS Browser Agent" },
          30_000
        );
      } catch (e) {
        errors.push(`${model}: ${(e as Error).message}`);
      }
    }
  }
  throw new Error(`No LLM available: ${errors.join("; ")}`);
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
When the goal's answer is visible in the PAGE TEXT (prices, colors, titles, specs), choose done immediately with that answer — do not keep clicking.`;

// Flipkart/Amazon wall fresh headless profiles that land directly on them.
// A warm-up hop through a neutral site builds a referer chain that looks human.
async function warmUpNavigation(session: AgentSession, targetUrl: string): Promise<void> {
  try {
    await session.goto("https://www.google.com");
    await session.page.waitForTimeout(1200);
  } catch {
    // Neutral site unreachable — go direct as fallback.
  }
  await session.goto(targetUrl);
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
  const started = Date.now();

  try {
    const target = body.startUrl || "https://www.google.com";
    await warmUpNavigation(session, target);

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      // Per-turn bot-wall check: if a wall appears mid-run, stop honestly
      // instead of letting the LLM click into a void.
      if (turn > 1 && (await session.captcha())) {
        trace.push({ turn, decision: "fail", detail: "Bot wall / captcha appeared mid-run" });
        answer = `Flipkart (or the site) threw a bot wall mid-run. The stealth settings dodge most, but not all — a headed run (watch-it-work toggle) usually gets through. Want me to retry headed?`;
        break;
      }

      const snap = await session.snapshot();
      const elements = snap.els
        .map((e) => `${e.i}: <${e.tag}${e.id ? ` id=${e.id}` : ""}${e.nm ? ` name=${e.nm}` : ""}${e.type ? ` type=${e.type}` : ""}> ${e.txt || e.ph || ""}`)
        .join("\n");
      // The agent answers goals from this text — prices, colors, specs.
      const pageText = (snap.text || "").slice(0, 3000);

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

    screenshot = await session.screenshotJpeg();
    if (!answer) {
      const lastError = [...trace].reverse().find((t) => t.decision === "error");
      answer = lastError
        ? `Ran into a page error before finishing: ${lastError.detail}. The goal wasn't completed — try again (transient navigation races happen) or use headed mode.`
        : `Ran out of turns (${MAX_TURNS}) before confirming the goal.`;
    }

    // Run history (best-effort).
    try {
      await prisma.browserRun.create({
        data: {
          workflow: "agent",
          goal: body.goal.slice(0, 300),
          success: !answer.startsWith("Couldn't"),
          summary: answer.slice(0, 250),
          durationMs: Date.now() - started,
        },
      });
    } catch {
      // non-fatal
    }

    return NextResponse.json({ success: !answer.startsWith("Couldn't"), answer, trace, screenshot });
  } catch (error) {
    return NextResponse.json(
      { error: "Agent run failed", details: error instanceof Error ? error.message : String(error), trace },
      { status: 500 }
    );
  } finally {
    await session.close();
  }
}
