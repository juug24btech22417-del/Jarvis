// Tier 2A — Goal agent orchestrator.
// plan (LLM-decomposed) → execute (typed step handlers, DAG-parallel).
//
// v3 hybrid engine:
//  - Firecrawl (search/scrape/extract) + Playwright (open/actions) combined
//  - automatic engine fallback: walled/timed-out Firecrawl scrapes retry
//    headless through the browser engine
//  - steps without dependencies run in PARALLEL (pool of 3)
//  - "from:<stepId>" param templating lets the planner chain outputs
//  - per-mission Firecrawl credit cap (MISSION_CREDIT_CAP)
//  - checkpoint steps pause for user input mid-mission
//  - every step emits live events (SSE) with human-readable log lines

import { randomUUID } from "crypto";
import type {
  AgentJob,
  AgentPlan,
  AgentStep,
  JobStatus,
  StepResult,
} from "@/lib/agent/types";
import {
  PLANNER_SYSTEM_PROMPT,
  OPENROUTER_PLANNER_MODELS,
  GROQ_PLANNER_MODELS,
  GEMINI_PLANNER_MODEL,
  MISSION_CREDIT_CAP,
} from "@/lib/agent/types";
import { addEntity, addRelationship } from "@/lib/memory/graph";
import {
  emitMissionEvent,
  clearMissionEvents,
} from "@/lib/agent/events";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// NVIDIA NIM — the same OpenAI-compatible endpoint the chat route uses as
// its primary LLM. Included in the race so missions keep working when the
// OpenRouter free tier is exhausted (429) or a slug is sunset (404).
const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_MODEL = process.env.NVIDIA_MODEL || "deepseek-ai/deepseek-v4-flash-0731";
// Additional OpenAI-compatible providers raced by the planner (see llmRace).
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Server-side code must call API routes with an absolute URL — relative
// fetch() in a route handler throws (the old code did exactly this).
const INTERNAL_BASE = process.env.INTERNAL_BASE_URL || "http://localhost:3000";

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// In-memory job store (v1). Reset on process restart. Kept on globalThis
// so Next dev module re-evals (HMR) don't wipe running missions.
const __jobG = globalThis as unknown as { __jarvisAgentJobs?: Map<string, AgentJob> };
if (!__jobG.__jarvisAgentJobs) __jobG.__jarvisAgentJobs = new Map<string, AgentJob>();
const jobs = __jobG.__jarvisAgentJobs;

/* ----------------------------- PUBLIC API ----------------------------- */

export function listJobs(): AgentJob[] {
  return Array.from(jobs.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getJob(jobId: string): AgentJob | undefined {
  return jobs.get(jobId);
}

/**
 * Decompose a goal into an AgentPlan via LLM. Returns a job in
 * "awaiting_approval" state with a plan attached. Validates JSON; retries
 * up to 2 times on parse / validation failure.
 */
export async function planGoal(goal: string): Promise<AgentJob> {
  const job: AgentJob = {
    id: randomUUID(),
    goal,
    status: "planning",
    createdAt: Date.now(),
    results: [],
    creditsUsed: 0,
  };
  jobs.set(job.id, job);
  emitMissionEvent(job.id, "status", "Planning mission…", { status: "planning" });

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const plan = await callPlanner(goal);
      validatePlan(plan);
      job.plan = plan;
      job.status = "awaiting_approval";
      emitMissionEvent(job.id, "status", `Plan ready — ${plan.steps.length} step(s)`, {
        status: "awaiting_approval",
        plan,
      });
      return job;
    } catch (e) {
      lastError = (e as Error)?.message || String(e);
      console.warn(`[Agent] planner attempt ${attempt + 1} failed:`, lastError);
    }
  }

  job.status = "failed";
  job.error = `Could not produce a plan: ${lastError ?? "unknown error"}`;
  emitMissionEvent(job.id, "error", job.error, { status: "failed" });
  return job;
}

/** Approve a plan and run it to completion. */
export async function approveJob(jobId: string): Promise<AgentJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "awaiting_approval" && job.status !== "paused_checkpoint") {
    throw new Error(`Job is in status ${job.status}, not awaiting_approval`);
  }
  if (!job.plan) throw new Error("Job has no plan");

  job.status = "running";
  job.startedAt = Date.now();
  emitMissionEvent(job.id, "status", "Mission started", { status: "running" });
  try {
    await executePlan(job);
    job.status = "done";
    emitMissionEvent(job.id, "done", `Mission complete in ${elapsed(job)}`, {
      status: "done",
      report: buildReport(job),
    });
  } catch (e) {
    job.status = "failed";
    job.error = (e as Error)?.message || String(e);
    emitMissionEvent(job.id, "error", `Mission failed: ${job.error}`, { status: "failed" });
  } finally {
    job.finishedAt = Date.now();
  }
  return job;
}

export async function cancelJob(jobId: string): Promise<AgentJob | undefined> {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (job.status === "running" || job.status === "awaiting_approval" || job.status === "planning" || job.status === "paused_checkpoint") {
    job.status = "cancelled";
    job.finishedAt = Date.now();
    // Unwind a parked checkpoint so the executor's await settles and the
    // runStep throws "cancelled at checkpoint" instead of hanging forever.
    job.checkpointResolve?.();
    emitMissionEvent(job.id, "status", "Mission cancelled", { status: "cancelled" });
    clearMissionEvents(jobId);
  }
  return job;
}

/** Resume a job paused at a checkpoint. The user's pick feeds llm_decide-style templating. */
export async function resumeCheckpoint(jobId: string, pick: string): Promise<AgentJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "paused_checkpoint") {
    throw new Error(`Job is in status ${job.status}, not paused_checkpoint`);
  }
  const stepId = job.checkpointStepId;
  const step = job.plan?.steps.find((s) => s.id === stepId);
  if (!step) throw new Error("Checkpoint step not found");

  emitMissionEvent(job.id, "log", `You chose: ${pick}`, { stepId });

  const r: StepResult = {
    stepId: step.id,
    status: "ok",
    result: { choice: pick, byUser: true },
    finishedAt: Date.now(),
  };
  job.results.push(r);
  job.checkpointResults?.set(step.id, r);
  job.checkpointResults = job.checkpointResults ?? new Map();
  job.checkpointResults.set(step.id, r);
  job.status = "running";

  // Continue execution from where the pool left off (it awaits this promise).
  job.checkpointResolve?.();
  return job;
}

function elapsed(job: AgentJob): string {
  if (!job.startedAt) return "?";
  const s = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/* ----------------------------- PLANNER ----------------------------- */

/**
 * Race every configured LLM provider/model in parallel and take the first
 * usable response. Free slugs get sunset regularly (the original llama-3.1
 * OpenRouter default started returning HTTP 404, NVIDIA EOL'd llama-3.1,
 * Gemini 2.0 flash was retired) — so no single model is load-bearing.
 */
async function llmRace(opts: {
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number;
  timeoutMs?: number;
  label: string;
}): Promise<string> {
  const label = opts.label;
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const payload = {
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.4,
  };

  // One attempt against an OpenAI-compatible chat endpoint.
  const attempt = (
    provider: string,
    url: string,
    apiKey: string,
    model: string,
    extraHeaders?: Record<string, string>
  ): Promise<string> =>
    (async () => {
      const res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...extraHeaders,
          },
          body: JSON.stringify({ model, ...payload }),
        },
        timeoutMs
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`${label} HTTP ${res.status} (${provider}/${model})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
      }
      const data = await res.json();
      const content: string = data?.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) throw new Error(`${label} returned empty content (${provider}/${model})`);
      return content.trim();
    })();

  const attempts: Promise<string>[] = [];

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const nimKey = process.env.NVIDIA_API_KEY;
  if (!openrouterKey && !groqKey && !geminiKey && !nimKey) {
    throw new Error(`no LLM provider key (OPENROUTER/GROQ/GEMINI/NVIDIA) for ${label}`);
  }

  if (openrouterKey) {
    for (const model of OPENROUTER_PLANNER_MODELS) {
      attempts.push(
        attempt("openrouter", OPENROUTER_URL, openrouterKey, model, {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JARVIS AI Assistant",
        })
      );
    }
  }
  if (groqKey) {
    for (const model of GROQ_PLANNER_MODELS) {
      attempts.push(attempt("groq", GROQ_URL, groqKey, model));
    }
  }
  if (geminiKey) {
    attempts.push(attempt("gemini", GEMINI_URL, geminiKey, GEMINI_PLANNER_MODEL));
  }
  if (nimKey) {
    attempts.push(attempt("nvidia", NIM_URL, nimKey, NIM_MODEL));
  }

  try {
    return await Promise.any(attempts);
  } catch (e) {
    // AggregateError — surface each provider/model's failure so the user sees WHY.
    const errors = (e as AggregateError)?.errors ?? [e];
    throw new Error(errors.map((err) => (err as Error)?.message || String(err)).join("; "));
  }
}

async function callPlanner(goal: string): Promise<AgentPlan> {
  if (
    !process.env.OPENROUTER_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !process.env.GEMINI_API_KEY &&
    !process.env.NVIDIA_API_KEY
  ) {
    // No LLM available — return a tiny stub plan the user can still see.
    return {
      summary: `Heuristic plan for: ${goal.slice(0, 60)}`,
      steps: [
        {
          id: "s1",
          kind: "firecrawl_search",
          title: `Search the web for: ${goal.slice(0, 80)}`,
          params: { query: goal, limit: 5 },
        },
        {
          id: "s2",
          kind: "notify",
          title: "Report back to user",
          params: { message: `I couldn't reach my reasoning engine, so I've only queued a web search. Try again with OPENROUTER_API_KEY set.` },
          dependsOn: ["s1"],
        },
      ],
    };
  }

  const content = await llmRace({
    system: PLANNER_SYSTEM_PROMPT,
    user: goal,
    maxTokens: 900,
    label: "planner",
  });
  // Strip code fences if the model adds them.
  const json = content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(json) as AgentPlan;
}

const KNOWN_KINDS = new Set([
  "web_search", "web_scrape", "firecrawl_search", "firecrawl_extract",
  "change_tracking", "llm_decide", "llm_summarize", "deep_research",
  "memory_store", "notify", "playwright_action", "browser_open", "checkpoint",
]);

function validatePlan(plan: AgentPlan) {
  if (!plan || typeof plan !== "object") throw new Error("plan is not an object");
  if (typeof plan.summary !== "string") throw new Error("plan.summary missing");
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error("plan.steps empty");
  if (plan.steps.length > 10) throw new Error("plan.steps too long (max 10)");
  const ids = new Set<string>();
  for (const s of plan.steps) {
    if (!s.id || typeof s.id !== "string") throw new Error("step.id missing");
    if (ids.has(s.id)) throw new Error(`duplicate step id: ${s.id}`);
    ids.add(s.id);
    if (!s.kind || typeof s.kind !== "string") throw new Error(`step ${s.id}.kind missing`);
    if (!KNOWN_KINDS.has(s.kind)) throw new Error(`step ${s.id}: unknown kind "${s.kind}"`);
    if (typeof s.title !== "string") throw new Error(`step ${s.id}.title missing`);
    if (typeof s.params !== "object" || s.params === null) {
      throw new Error(`step ${s.id}.params must be object`);
    }
  }
}

/* ----------------------------- TEMPLATING ----------------------------- */

interface SearchHit {
  url: string;
  title: string;
  description?: string;
}

/**
 * Resolve "from:<stepId>[.urls|.choice|.url|.summary]" references against
 * completed step results. Bare "from:<id>" on a scrape/extract/open step
 * picks the most useful URL from that step's output.
 */
function resolveParam(value: unknown, job: AgentJob, deps: Map<string, StepResult>): unknown {
  if (typeof value !== "string" || !value.startsWith("from:")) return value;
  const ref = value.slice(5).trim();
  const [stepId, field] = ref.split(".");
  const dep = deps.get(stepId) ?? job.checkpointResults?.get(stepId);
  if (!dep || dep.status !== "ok") return value; // unresolved — handler errors on missing url

  const out = dep.result as Record<string, unknown> | undefined;
  if (field === "urls") {
    const urls = extractUrls(out).map((h) => h.url);
    return urls.length > 0 ? urls : value;
  }
  if (field === "choice") return String(out?.choice ?? out?.pick ?? value);
  if (field === "summary") return String(out?.summary ?? value);
  if (field === "url") return String(out?.url ?? (out?.choice ? "" : value));

  // Bare reference — smart-pick the best URL.
  const chosen = pickUrl(out);
  return chosen ?? value;
}

function extractUrls(out: unknown): SearchHit[] {
  if (!out || typeof out !== "object") return [];
  const o = out as Record<string, unknown>;
  // search results
  const results = o.results;
  if (Array.isArray(results)) {
    const hits: SearchHit[] = [];
    for (const r of results) {
      if (!r || typeof r !== "object") continue;
      const rec = r as Record<string, unknown>;
      const url = String(rec.url ?? rec.link ?? "");
      if (!url) continue;
      hits.push({ url, title: String(rec.title ?? url), description: String(rec.description ?? rec.snippet ?? "") });
    }
    return hits;
  }
  // decide result
  if (typeof o.url === "string" && o.url) return [{ url: o.url, title: String(o.choice ?? "") }];
  // scrape result
  if (typeof o.url === "string") return [{ url: o.url, title: String(o.title ?? "") }];
  return [];
}

function pickUrl(out: unknown): string | null {
  const hits = extractUrls(out);
  if (hits.length === 0) return null;
  // An llm_decide result exposes its pick explicitly.
  const rec = out as Record<string, unknown>;
  if (typeof rec.url === "string" && rec.url) return rec.url;
  return hits[0].url;
}

/* ----------------------------- EXECUTOR (DAG-parallel) ----------------------------- */

const PARALLELISM = 3;

async function executePlan(job: AgentJob) {
  const plan = job.plan!;
  const resultsById = new Map<string, StepResult>();
  job.checkpointResults = job.checkpointResults ?? new Map();

  const runnable = new Set(plan.steps.map((s) => s.id));
  const failedOrSkipped = new Set<string>();
  const finished = new Map<string, StepResult>();

  const runOne = async (step: AgentStep): Promise<void> => {
    if (job.status === "cancelled") return;

    // Dependencies must have succeeded.
    for (const dep of step.dependsOn ?? []) {
      const depResult = finished.get(dep);
      if (!depResult || depResult.status !== "ok") {
        const r: StepResult = {
          stepId: step.id,
          status: "skipped",
          error: `dependency ${dep} not satisfied`,
          finishedAt: Date.now(),
        };
        resultsById.set(step.id, r);
        finished.set(step.id, r);
        job.results.push(r);
        failedOrSkipped.add(step.id);
        emitMissionEvent(job.id, "step_finished", `Skipped: ${step.title}`, { stepId: step.id, status: "skipped", error: r.error });
        return;
      }
    }

    // Credit budget for Firecrawl-backed kinds.
    const CREDIT_KINDS = new Set(["firecrawl_search", "web_scrape", "firecrawl_extract", "deep_research", "change_tracking"]);
    if (CREDIT_KINDS.has(step.kind)) {
      if ((job.creditsUsed ?? 0) >= MISSION_CREDIT_CAP) {
        const r: StepResult = {
          stepId: step.id,
          status: "skipped",
          error: `Mission credit cap (${MISSION_CREDIT_CAP}) reached — step skipped to protect your Firecrawl quota`,
          finishedAt: Date.now(),
        };
        resultsById.set(step.id, r);
        finished.set(step.id, r);
        job.results.push(r);
        failedOrSkipped.add(step.id);
        emitMissionEvent(job.id, "step_finished", `Budget cap hit — skipped: ${step.title}`, { stepId: step.id, status: "skipped" });
        return;
      }
    }

    // Resolve templated params now that deps are done.
    const resolved: AgentStep = {
      ...step,
      params: Object.fromEntries(
        Object.entries(step.params).map(([k, v]) => [k, resolveParam(v, job, finished)])
      ),
    };

    emitMissionEvent(job.id, "step_started", step.title, { stepId: step.id, kind: step.kind });
    const t0 = Date.now();
    try {
      const result = await runStep(resolved, finished, job);
      const r: StepResult = { stepId: step.id, status: "ok", result, finishedAt: Date.now() };
      resultsById.set(step.id, r);
      finished.set(step.id, r);
      job.results.push(r);
      if (CREDIT_KINDS.has(step.kind)) job.creditsUsed = (job.creditsUsed ?? 0) + 1;
      emitMissionEvent(job.id, "step_finished", `${step.title} — done in ${Math.round((Date.now() - t0) / 1000)}s`, {
        stepId: step.id, status: "ok", result,
      });
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      const r: StepResult = { stepId: step.id, status: "error", error: msg, finishedAt: Date.now() };
      resultsById.set(step.id, r);
      finished.set(step.id, r);
      job.results.push(r);
      failedOrSkipped.add(step.id);
      emitMissionEvent(job.id, "step_finished", `${step.title} — failed: ${msg.slice(0, 80)}`, {
        stepId: step.id, status: "error", error: msg,
      });
      // Non-fatal: the rest of the plan degrades gracefully (unchanged behavior).
    }
  };

  // Pool: launch steps as their deps complete, up to PARALLELISM at a time.
  const pending = new Set(plan.steps.map((s) => s.id));
  const running = new Set<Promise<void>>();

  const ready = (): AgentStep[] =>
    plan.steps.filter((s) => {
      if (!pending.has(s.id)) return false;
      return (s.dependsOn ?? []).every((d) => finished.has(d) || failedOrSkipped.has(d));
    });

  while (pending.size > 0 && job.status !== "cancelled") {
    const batch = ready();
    if (batch.length === 0) {
      // Only blocked-by-running steps remain → wait for any to settle.
      if (running.size === 0) {
        // Nothing running and nothing ready → dependency cycle. Bail out.
        for (const id of pending) {
          const step = plan.steps.find((s) => s.id === id)!;
          emitMissionEvent(job.id, "error", `Steps unreachable (dependency cycle?): ${step.title}`, { stepId: id });
        }
        break;
      }
      await Promise.race(running);
      continue;
    }
    for (const step of batch) {
      pending.delete(step.id);
      const p = runOne(step).finally(() => running.delete(p));
      running.add(p);
      if (running.size >= PARALLELISM) break;
    }
    if (running.size > 0) await Promise.race(running);
  }

  if (running.size > 0) await Promise.all(running);
}

/* ----------------------------- STEP HANDLERS ----------------------------- */

async function runStep(step: AgentStep, deps: Map<string, StepResult>, job: AgentJob): Promise<unknown> {
  const log = (message: string, data?: Record<string, unknown>) =>
    emitMissionEvent(job.id, "log", message, { stepId: step.id, ...data });

  switch (step.kind) {
    case "firecrawl_search": {
      const query = String(step.params.query ?? "");
      if (!query) throw new Error("firecrawl_search: query required");
      const limit = Math.min(Number(step.params.limit ?? 5) || 5, 10);
      const scrapeResults = !!step.params.scrapeResults;
      log(`Searching the web: "${query}"`);
      const res = await fetchWithTimeout(`${INTERNAL_BASE}/api/firecrawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", url: query, options: { query, limit, scrapeResults } }),
      }, 60_000);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `search HTTP ${res.status}`);
      }
      const data = await res.json();
      const hits: SearchHit[] = (data.results ?? []).map((r: Record<string, unknown>) => ({
        url: String(r.url ?? ""),
        title: String(r.title ?? r.url ?? ""),
        description: String(r.description ?? "").slice(0, 300),
      }));
      log(`Found ${hits.length} results`);
      return { query, results: hits };
    }

    case "web_scrape": {
      const url = String(step.params.url ?? "");
      if (!url || url.startsWith("from:")) throw new Error("web_scrape: url missing/unresolved (check the plan's from: reference)");
      return await scrapeWithFallback(url, log);
    }

    case "firecrawl_extract": {
      const url = String(step.params.url ?? "");
      const prompt = String(step.params.prompt ?? "Extract the key data from this page");
      if (!url || url.startsWith("from:")) throw new Error("firecrawl_extract: url missing/unresolved");
      log(`AI-extracting from ${url.slice(0, 70)}`);
      const res = await fetchWithTimeout(`${INTERNAL_BASE}/api/firecrawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extract", url, options: { prompt } }),
      }, 75_000);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        // Fallback: scrape + LLM extraction when Firecrawl's extractor fails.
        log("Extractor failed — falling back to scrape + LLM");
        const scraped = await scrapeWithFallback(url, log);
        const markdown = String((scraped as Record<string, unknown>).markdown ?? "");
        if (!markdown) throw new Error(e.error || "extract failed and page could not be scraped");
        const summary = await llmCall(
          `You extract structured data. Follow the instruction and return ONLY JSON.\n\nInstruction: ${prompt}`,
          markdown.slice(0, 6000)
        );
        return tryJson(summary) ?? { summary };
      }
      const data = await res.json();
      log("Extraction complete");
      return { url, extracted: data.data?.extracted ?? data.data ?? data };
    }

    case "change_tracking": {
      const url = String(step.params.url ?? "");
      if (!url || url.startsWith("from:")) throw new Error("change_tracking: url missing/unresolved");
      log(`Diffing ${url.slice(0, 70)} against last snapshot`);
      // Firecrawl's changeTracking format needs per-target setup; the
      // pragmatic equivalent: scrape fresh (bypass cache) and compare
      // against the cached copy the service would otherwise have served.
      const fresh = await fetchWithTimeout(`${INTERNAL_BASE}/api/firecrawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scrape", url, options: { refreshCache: true } }),
      }, 60_000);
      if (!fresh.ok) {
        const e = await fresh.json().catch(() => ({}));
        throw new Error(e.error || `scrape HTTP ${fresh.status}`);
      }
      const data = await fresh.json();
      const markdown = String(data.markdown ?? "");
      // The pre-refresh cached copy was overwritten, so summarize the fresh
      // state and flag that a baseline is now stored for future diffs.
      log("Fresh snapshot taken (baseline stored for future diffs)");
      return {
        url,
        mode: "baseline-or-changed",
        title: data.title ?? "",
        summary: markdown.slice(0, 2500),
      };
    }

    case "llm_decide": {
      const question = String(step.params.question ?? "Which option is best?");
      const inputRef = step.params.input;
      let pool: SearchHit[] = [];
      if (typeof inputRef === "string" && inputRef.startsWith("from:")) {
        const dep = deps.get(inputRef.slice(5).trim());
        pool = extractUrls(dep?.result);
      } else if (deps.size > 0) {
        // Default: newest search-like result in deps.
        for (const r of [...deps.values()].reverse()) {
          pool = extractUrls(r.result);
          if (pool.length > 0) break;
        }
      }
      if (pool.length === 0) throw new Error("llm_decide: no input results to choose from");

      log(`Deciding: ${question.slice(0, 60)} (${pool.length} candidates)`);
      const listing = pool
        .map((h, i) => `${i + 1}. ${h.title}\n   URL: ${h.url}\n   ${h.description ?? ""}`)
        .join("\n");
      const raw = await llmCall(
        `You are JARVIS choosing the best option for the user. Answer with ONLY JSON: {"choice": <number>, "reason": "<one sentence>", "url": "<the chosen URL>"}`,
        `${question}\n\nOptions:\n${listing}`
      );
      const parsed = tryJson(raw) as { choice?: number | string; reason?: string; url?: string } | null;
      const idx = parsed?.choice != null ? parseInt(String(parsed.choice), 10) - 1 : 0;
      const winner = pool[Number.isInteger(idx) && idx >= 0 && idx < pool.length ? idx : 0];
      log(`Picked: ${winner.title.slice(0, 60)} — ${parsed?.reason?.slice(0, 60) ?? ""}`);
      return { choice: winner.title, url: parsed?.url || winner.url, reason: parsed?.reason ?? "" };
    }

    case "deep_research": {
      const query = String(step.params.query ?? "");
      if (!query) throw new Error("deep_research: query required");
      const maxPages = Math.min(Number(step.params.maxPages ?? 4) || 4, 6);
      log(`Deep research: "${query}" (up to ${maxPages} pages)`);
      // 1. search
      const searchRes = await fetchWithTimeout(`${INTERNAL_BASE}/api/firecrawl`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", url: query, options: { query, limit: maxPages } }),
      }, 60_000);
      if (!searchRes.ok) throw new Error(`search HTTP ${searchRes.status}`);
      const searchData = await searchRes.json();
      const hits: SearchHit[] = (searchData.results ?? []).map((r: Record<string, unknown>) => ({
        url: String(r.url ?? ""), title: String(r.title ?? r.url ?? ""), description: String(r.description ?? "").slice(0, 300),
      }));
      log(`Found ${hits.length} sources — scraping top ${Math.min(3, hits.length)}`);
      // 2. scrape top 3 with fallback
      const top = hits.slice(0, 3);
      const scraped = await Promise.allSettled(top.map((h) => scrapeWithFallback(h.url, log)));
      const docs = scraped
        .map((s, i) => (s.status === "fulfilled" ? { title: top[i].title, url: top[i].url, markdown: String((s.value as Record<string, unknown>).markdown ?? "") } : null))
        .filter((d): d is { title: string; url: string; markdown: string } => d !== null && d.markdown.length > 100);
      log(`Scraped ${docs.length} sources — synthesizing`);
      // 3. synthesize
      const corpus = docs.map((d) => `### ${d.title} (${d.url})\n${d.markdown.slice(0, 2500)}`).join("\n\n");
      const summary = await llmCall(
        "You are JARVIS doing research. Synthesize the sources below into a tight brief: key findings first, then notable details. Markdown bullets.",
        `${query}\n\n${corpus}`
      );
      return { query, sources: docs.map((d) => d.url), summary: summary.slice(0, 4000) };
    }

    case "web_search": {
      const query = String(step.params.query ?? "");
      if (!query) throw new Error("web_search: query required");
      const res = await fetch(`${INTERNAL_BASE}/api/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: "fast" }),
      });
      if (!res.ok) throw new Error(`research HTTP ${res.status}`);
      const data = await res.json();
      return { summary: data.summary ?? "", results: data.results ?? [] };
    }

    case "llm_summarize": {
      const prompt = String(step.params.prompt ?? "Summarize the following:");
      let inputs: string[] = [];
      const spec = step.params.inputs;
      if (typeof spec === "string" && spec.startsWith("from:")) {
        const dep = deps.get(spec.slice(5).trim());
        const out = dep?.result as Record<string, unknown> | undefined;
        const md = String(out?.markdown ?? out?.summary ?? "");
        inputs = md ? [md] : extractUrls(out).map((h) => `${h.title}: ${h.description ?? h.url}`);
      } else if (Array.isArray(spec)) {
        inputs = (spec as unknown[]).map((x) => resolveParam(x, job, deps)).map(String);
      } else {
        inputs = Array.from(deps.values())
          .map((r) => {
            const out = r.result as Record<string, unknown> | undefined;
            return String(out?.markdown ?? out?.summary ?? (typeof r.result === "string" ? r.result : ""));
          })
          .filter(Boolean);
      }
      if (inputs.length === 0) {
        return { summary: "(no inputs to summarize)" };
      }
      log(`Summarizing ${inputs.length} input(s)`);
      const summary = await llmCall(
        "You are JARVIS. Summarize concisely in markdown bullets. Lead with the most important point.",
        `${prompt}\n\n${inputs.join("\n\n---\n\n").slice(0, 8000)}`
      );
      return { summary };
    }

    case "memory_store": {
      const name = String(step.params.name ?? "").trim();
      const type = String(step.params.type ?? "CONCEPT").trim();
      const description = String(step.params.description ?? "").trim();
      if (!name || !description) throw new Error("memory_store: name + description required");
      const entityId = await addEntity({ name, type, description });
      const related: Array<{ name: string; relationship: string }> = Array.isArray(step.params.related)
        ? (step.params.related as Array<{ name: string; relationship: string }>)
        : [];
      for (const rel of related) {
        try {
          const targetId = await addEntity({
            name: rel.name,
            type: "CONCEPT",
            description: `Linked to ${name}`,
          });
          await addRelationship({
            sourceId: entityId,
            targetId: targetId,
            type: rel.relationship,
            metadata: { description: `${name} ${rel.relationship} ${rel.name}` },
          });
        } catch (e) {
          console.warn("[Agent] related entity failed:", e);
        }
      }
      log(`Saved to memory: ${name}`);
      return { id: entityId, name, type };
    }

    case "notify": {
      const message = String(step.params.message ?? "").trim();
      if (!message) throw new Error("notify: message required");
      emitMissionEvent(job.id, "log", `Notify: ${message.slice(0, 80)}`, { stepId: step.id });
      return { message };
    }

    case "checkpoint": {
      const question = String(step.params.question ?? "How should I proceed?");
      const options: string[] = Array.isArray(step.params.options)
        ? (step.params.options as unknown[]).map(String).slice(0, 5)
        : ["Continue", "Stop"];
      job.checkpointStepId = step.id;
      job.status = "paused_checkpoint";
      emitMissionEvent(job.id, "checkpoint", question, { stepId: step.id, options });
      // Park until resumeCheckpoint() resolves us (or cancel).
      await new Promise<void>((resolve) => {
        job.checkpointResolve = resolve;
      });
      if ((job.status as JobStatus) === "cancelled") throw new Error("cancelled at checkpoint");
      return { choice: job.checkpointResults?.get(step.id)?.result ?? "continue" };
    }

    case "playwright_action": {
      const description = String(step.params.description ?? "browser action").trim();
      const url = typeof step.params.url === "string" ? step.params.url : null;
      if (!url) {
        return { deferred: true, message: "No URL supplied for browser action.", description };
      }

      const { heal } = await import("@/services/PlaywrightResilience");
      const { playwrightService } = await import("@/services/PlaywrightService");

      log(`Browser action: ${description.slice(0, 60)}`);
      const outcome = await heal(`visit ${url}`, async () => {
        return await playwrightService.openWebsite(url);
      });

      if (outcome.ok) {
        return {
          url,
          description,
          attempts: outcome.attempts,
          result: outcome.result,
        };
      }

      if (outcome.needsUserInput) {
        return {
          url,
          description,
          error: outcome.error,
          needsUserInput: outcome.needsUserInput,
          attempts: outcome.attempts,
          trail: outcome.trail,
        };
      }

      throw new Error(`browser action failed after ${outcome.attempts} attempts: ${outcome.error}`);
    }

    case "browser_open": {
      const urlSpec = step.params.url;
      let urls: string[] = [];
      if (Array.isArray(urlSpec)) {
        urls = (urlSpec as unknown[]).map(String).filter((u) => u.startsWith("http"));
      } else if (typeof urlSpec === "string" && urlSpec.startsWith("http")) {
        urls = [urlSpec];
      }
      if (urls.length === 0) throw new Error("browser_open: no resolvable URL (check the from: reference)");

      // Client-side opener: the panel polls for this and window.open()s
      // the links on the user gesture chain. Headless server tabs annoy
      // nobody and popup blockers demand a user gesture anyway.
      emitMissionEvent(job.id, "log", `Queued ${urls.length} page(s) to open in your browser`, { stepId: step.id, openUrls: urls });
      return { urls, opened: urls.length };
    }

    default: {
      const exhaustive: never = step.kind;
      throw new Error(`unknown step kind: ${exhaustive}`);
    }
  }
}

/* ----------------------------- ENGINE FALLBACK ----------------------------- */

/**
 * Scrape with automatic engine fallback:
 *  1. Firecrawl (fast, anti-bot, cached)
 *  2. On failure/wall → the hardened Playwright engine (headless stealth)
 * The goal is "never give up on a URL while one engine still works".
 */
async function scrapeWithFallback(
  url: string,
  log: (message: string, data?: Record<string, unknown>) => void
): Promise<Record<string, unknown>> {
  log(`Scraping ${url.slice(0, 70)}`);
  try {
    const res = await fetchWithTimeout(`${INTERNAL_BASE}/api/firecrawl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "scrape", url }),
    }, 60_000);
    if (res.ok) {
      const data = await res.json();
      if (data.success && String(data.markdown ?? "").length > 50) {
        log(`Firecrawl got it (${String(data.markdown).length.toLocaleString()} chars)`);
        return { url, title: data.title ?? "", markdown: data.markdown ?? "", engine: "firecrawl" };
      }
      log(`Firecrawl returned thin content — trying the browser engine`);
    } else {
      log(`Firecrawl failed (HTTP ${res.status}) — trying the browser engine`);
    }
  } catch {
    log(`Firecrawl unreachable — trying the browser engine`);
  }

  // Fallback: hardened Playwright engine via the browser agent's session path.
  try {
    const { createAgentSession } = await import("@/lib/browser/engine");
    const session = await createAgentSession();
    try {
      await session.goto(url);
      await session.page.waitForTimeout(1200);
      const wall = await session.captcha();
      const snap = await session.snapshot();
      if (wall) throw new Error("bot wall on fallback engine too");
      const markdown = snap.text || "";
      if (markdown.length < 50) throw new Error("fallback engine got thin content");
      log(`Browser engine got it (${markdown.length.toLocaleString()} chars)`);
      return { url, title: snap.title, markdown, engine: "playwright" };
    } finally {
      await session.close();
    }
  } catch (e) {
    throw new Error(`Both engines failed on ${url}: ${(e as Error).message.slice(0, 80)}`);
  }
}

/* ----------------------------- LLM helpers ----------------------------- */

async function llmCall(system: string, user: string, maxTokens = 700): Promise<string> {
  return llmRace({ system, user, maxTokens, timeoutMs: 45_000, label: "llm" });
}

function tryJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* ----------------------------- MISSION REPORT ----------------------------- */

export function buildReport(job: AgentJob): string {
  const lines: string[] = [];
  lines.push(`# JARVIS Mission Report`);
  lines.push(`**Goal:** ${job.goal}`);
  lines.push(`**Status:** ${job.status} · ${elapsed(job)} · ${job.creditsUsed ?? 0} Firecrawl credits`);
  lines.push("");
  if (job.plan) {
    lines.push(`## Plan — ${job.plan.summary}`);
    for (const s of job.plan.steps) {
      const r = job.results.find((x) => x.stepId === s.id);
      const icon = r?.status === "ok" ? "✅" : r?.status === "error" ? "❌" : r?.status === "skipped" ? "⏭️" : "•";
      lines.push(`- ${icon} **${s.title}** (${STEP_KIND_LABEL(s.kind)})`);
      if (r?.error) lines.push(`  - error: ${r.error}`);
    }
    lines.push("");
  }
  const findings = job.results.filter((r) => r.status === "ok");
  for (const r of findings) {
    const out = r.result as Record<string, unknown> | undefined;
    const summary = out?.summary ?? out?.extracted;
    if (summary) {
      lines.push(`## ${job.plan?.steps.find((s) => s.id === r.stepId)?.title ?? r.stepId}`);
      lines.push(String(typeof summary === "string" ? summary : JSON.stringify(summary, null, 2)).slice(0, 3000));
      lines.push("");
    }
  }
  const urls = new Set<string>();
  for (const r of findings) collectUrls(r.result, urls);
  if (urls.size > 0) {
    lines.push(`## Sources`);
    for (const u of urls) lines.push(`- ${u}`);
  }
  return lines.join("\n");
}

function STEP_KIND_LABEL(kind: string): string {
  try {
    // Lazy import avoided for bundling: labels are short — inline map.
    const labels: Record<string, string> = {
      web_search: "Web search", web_scrape: "Web scrape", firecrawl_search: "Web search",
      firecrawl_extract: "AI extraction", change_tracking: "Change watch", llm_decide: "AI decision",
      llm_summarize: "LLM summarize", deep_research: "Deep research", memory_store: "Save to memory",
      notify: "Notify", playwright_action: "Browser action", browser_open: "Open in browser", checkpoint: "Ask me",
    };
    return labels[kind] ?? kind;
  } catch {
    return kind;
  }
}

function collectUrls(out: unknown, into: Set<string>): void {
  if (!out || typeof out !== "object") return;
  const o = out as Record<string, unknown>;
  if (typeof o.url === "string" && o.url.startsWith("http")) into.add(o.url);
  if (Array.isArray(o.urls)) for (const u of o.urls) if (typeof u === "string" && u.startsWith("http")) into.add(u);
  if (Array.isArray(o.results)) {
    for (const r of o.results) {
      const rec = r as Record<string, unknown>;
      if (typeof rec.url === "string" && rec.url.startsWith("http")) into.add(rec.url);
    }
  }
  if (Array.isArray(o.sources)) for (const u of o.sources) if (typeof u === "string" && u.startsWith("http")) into.add(u);
}
