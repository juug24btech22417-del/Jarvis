// Browser automation API — panel workflows + custom action lists.
//
// Thin layer over the shared hardened engine (src/lib/browser/engine.ts).
// Adds:
//  - localhost rate limiting (and evaluate is restricted to localhost too,
//    since arbitrary JS execution is effectively remote code execution)
//  - run history persisted to BrowserRun + screenshots saved to disk
//  - workflows use fillAny/fail-soft so real-world pages don't kill runs

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db/queries";
import { runActions, BrowserAction } from "@/lib/browser/engine";

// ─── Rate limiting (per process; good enough for a personal app) ────

const RATE = { windowMs: 60_000, max: 20 };
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < RATE.windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > RATE.max;
}

function isLocalhost(req: NextRequest): boolean {
  const host = req.headers.get("host") ?? "";
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

// ─── Workflows ──────────────────────────────────────────────────────

const WORKFLOWS: Record<
  string,
  { name: string; description: string; actions: BrowserAction[] }
> = {
  search_flight: {
    name: "Search Flight",
    description: "Search flights on Google Flights",
    actions: [
      {
        type: "navigate",
        url: "https://www.google.com/travel/flights?q=Flights%20from%20{{origin}}%20to%20{{destination}}",
      },
      { type: "wait", timeout: 3500 },
      { type: "screenshot" },
    ],
  },

  check_price: {
    name: "Check Price",
    description: "Check product price on Amazon",
    actions: [
      { type: "navigate", url: "https://www.amazon.com" },
      { type: "fill", selector: "#twotabsearchtextbox", value: "{{product}}" },
      { type: "click", selector: "#nav-search-submit-button" },
      { type: "waitForSelector", selector: "div[data-component-type='s-search-result']", timeout: 12_000 },
      {
        type: "evaluate",
        script: `
          JSON.stringify(
            Array.from(document.querySelectorAll("div[data-component-type='s-search-result']"))
              .slice(0, 3)
              .map((el) => ({
                title: (el.querySelector("h2 span")?.textContent || "").trim().slice(0, 90),
                price: (el.querySelector(".a-price .a-offscreen")?.textContent || "").trim(),
              }))
              .filter((r) => r.title)
          )
        `,
      },
      { type: "screenshot" },
    ],
  },

  form_fill: {
    name: "Fill Form",
    description: "Fill out contact forms",
    actions: [
      { type: "navigate", url: "{{url}}" },
      {
        type: "fillAny",
        selector: 'input[name="name"] || #name || input[name="custname"] || input[placeholder*="Name" i] || input[autocomplete="name"]',
        value: "{{name}}",
        optional: true,
        timeout: 3_000,
      },
      {
        type: "fillAny",
        selector: 'input[type="email"] || input[name="email"] || #email || input[name="custemail"]',
        value: "{{email}}",
        optional: true,
        timeout: 3_000,
      },
      {
        type: "fillAny",
        selector: 'textarea[name="message"] || #message || textarea',
        value: "{{message}}",
        optional: true,
        timeout: 3_000,
      },
      { type: "wait", timeout: 500 },
      { type: "screenshot" },
    ],
  },

  news_headlines: {
    name: "News Headlines",
    description: "Grab top BBC world headlines",
    actions: [
      { type: "navigate", url: "https://www.bbc.com/news/world" },
      { type: "waitForSelector", selector: "h2", timeout: 10_000 },
      {
        type: "evaluate",
        script: `
          JSON.stringify(
            Array.from(document.querySelectorAll("h2"))
              .map((e) => (e.textContent || "").trim())
              .filter((t) => t.length > 15)
              .slice(0, 8)
          )
        `,
      },
    ],
  },
};

// ─── Handlers ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (rateLimited(req.headers.get("x-forwarded-for") ?? "local")) {
    return NextResponse.json({ error: "Too many runs — slow down a moment." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    workflow?: string;
    actions?: BrowserAction[];
    variables?: Record<string, string>;
    sessionName?: string;
    headed?: boolean;
    saveRun?: boolean;
  } | null;

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { workflow, actions, variables = {}, sessionName, headed, saveRun = true } = body;

  let actionsToExecute: BrowserAction[];

  if (workflow) {
    const workflowConfig = WORKFLOWS[workflow];
    if (!workflowConfig) {
      return NextResponse.json(
        { error: "Unknown workflow", availableWorkflows: Object.keys(WORKFLOWS) },
        { status: 400 }
      );
    }
    const substitute = (s: string) =>
      s.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || `{{${key}}}`);
    actionsToExecute = workflowConfig.actions.map((action) => ({
      ...action,
      ...(action.url ? { url: substitute(action.url) } : {}),
      ...(action.value ? { value: substitute(action.value) } : {}),
      ...(action.selector ? { selector: substitute(action.selector) } : {}),
    }));
  } else if (Array.isArray(actions) && actions.length > 0) {
    actionsToExecute = actions.slice(0, 40);
  } else {
    return NextResponse.json({ error: "Either 'workflow' or 'actions' required" }, { status: 400 });
  }

  // evaluate = arbitrary JS in a browser context. Localhost callers only.
  if (actionsToExecute.some((a) => a.type === "evaluate") && !isLocalhost(req)) {
    return NextResponse.json(
      { error: "evaluate action is restricted to localhost callers" },
      { status: 403 }
    );
  }

  const started = Date.now();
  try {
    const run = await runActions(actionsToExecute, {
      sessionName,
      headed: !!headed,
      globalTimeoutMs: 90_000,
    });
    const results = run.results;
    const succeeded = results.filter((r) => r.success).length;
    const screenshot = results.find((r) => r.action === "screenshot" && r.data)?.data;
    const pdf = results.find((r) => r.action === "pdf" && r.data)?.data;

    // Persist run history + screenshot to disk (best-effort).
    let runId: string | null = null;
    if (saveRun) {
      try {
        let screenshotPath: string | null = null;
        if (screenshot) {
          const dir = path.join(process.cwd(), "public", "automation");
          await mkdir(dir, { recursive: true });
          const b64 = screenshot.split(",")[1] ?? "";
          const file = `run_${Date.now()}.jpg`;
          await writeFile(path.join(dir, file), Buffer.from(b64, "base64"));
          screenshotPath = `/automation/${file}`;
        }
        const created = await prisma.browserRun.create({
          data: {
            workflow: workflow ?? "custom",
            variables: JSON.stringify(variables).slice(0, 2000),
            success: succeeded > 0 && !run.captcha,
            summary: `${succeeded}/${results.length} actions succeeded${run.captcha ? " — captcha wall" : ""}`,
            errorCount: results.filter((r) => !r.success).length,
            durationMs: run.durationMs,
            screenshotPath,
          },
        });
        runId = created.id;
      } catch (e) {
        console.warn("[Browser] run log failed (non-fatal):", (e as Error).message);
      }
    }

    return NextResponse.json({
      success: succeeded > 0,
      runId,
      workflow: workflow ?? "custom",
      results,
      screenshot,
      pdf,
      captcha: run.captcha,
      finalUrl: run.finalUrl,
      durationMs: run.durationMs,
      summary: `${succeeded}/${results.length} actions succeeded`,
    });
  } catch (error) {
    console.error("Browser automation error:", error);
    return NextResponse.json(
      { error: "Browser automation failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const wantHistory = url.searchParams.get("history") === "1";

  if (wantHistory) {
    const runs = await prisma.browserRun.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
    return NextResponse.json({ success: true, runs });
  }

  return NextResponse.json({
    success: true,
    usage: {
      method: "POST",
      endpoint: "/api/browser",
      workflows: Object.fromEntries(
        Object.entries(WORKFLOWS).map(([id, w]) => [id, { name: w.name, description: w.description }])
      ),
      options: {
        sessionName: "use a persistent logged-in profile",
        headed: "watch the browser do it (non-headless)",
        saveRun: "persist to run history (default true)",
      },
      history: "GET /api/browser?history=1 — recent runs",
    },
    note: "Stealth-hardened Playwright. domcontentloaded navigation, fail-soft actions, JPEG screenshots, captcha detection.",
  });
}
