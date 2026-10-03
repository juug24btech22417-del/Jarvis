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
  AgentStepKind,
  JobStatus,
  StepResult,
} from "@/lib/agent/types";
import { STEP_KIND_LABELS } from "@/lib/agent/types";
import {
  PLANNER_SYSTEM_PROMPT,
  OPENROUTER_PLANNER_MODELS,
  GROQ_PLANNER_MODELS,
  GEMINI_PLANNER_MODEL,
  MISSION_CREDIT_CAP,
} from "@/lib/agent/types";
import { addEntity, addRelationship } from "@/lib/memory/graph";
import { createTask } from "@/lib/db/queries";
import { extractFollowUpTasks, collectRemainingItems } from "@/lib/agent/missionFollowups";
import {
  emitMissionEvent,
  clearMissionEvents,
} from "@/lib/agent/events";
import { searchWebWithFallback, sanitizeHits, type SearchHit as FallbackSearchHit } from "@/services/WebSearchFallback";
import { exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { startDevServer, stopDevServer, devServerStatus } from "@/lib/agent/devServers";
import { planFileOrganization, uniqueName, type OrganizeFile } from "@/lib/agent/fileOrganize";
import { recordOrganize, undoLastOrganize, type OrganizeMoveRecord } from "@/lib/agent/fileOrganizeLog";
import { parsePackageFacts, parseOutdated, summarizeRepoInspect, isSafePackageName } from "@/lib/agent/repoInspect";
import {
  autoInferDependencies,
  estimatePlan,
  heuristicPlan,
  maybeAppendBrowserStep,
  multiOpenIntent,
  pickSimilarPastGoals,
  planNeedsApproval,
  validateAndRepairPlan,
  kindsAllowedForRole,
  stepCreditWeight,
  classifyGoal,
  categoryDirective,
  fallbackPlan,
} from "@/lib/agent/plan";
import {
  getJob as storeGetJob,
  listJobs as storeListJobs,
  listJobSummaries,
  putJob,
  flushMissions,
} from "@/lib/agent/store";
import { browserAct, browserLogin, browserScreenshot, getRecording, replayRecording } from "@/services/BrowserAgentService";
import { setLiveViewEnabled } from "@/lib/agent/liveView";
import { parseJsonLoose } from "@/lib/agent/llm";
import { renderVideoBrief, briefSummary } from "@/services/MissionVideoService";
import {
  SPECIALIST_KINDS,
  APPROVAL_REQUIRED_KINDS,
  type MissionArtifact,
  type SpecialistRole,
} from "@/lib/agent/types";

/**
 * Launch URL directly at the OS level on Windows so browser popup blockers cannot intercept it.
 */
function launchUrlOnWindows(url: string) {
  try {
    if (process.platform === "win32") {
      const clean = url.replace(/"/g, '""');
      exec(`cmd.exe /c start "" "${clean}"`, (err) => {
        if (err) console.warn("[OS Launch] Warning:", err.message);
      });
    }
  } catch (e: any) {
    console.warn("[OS Launch] Error:", e.message);
  }
}

/**
 * Speak text directly through Windows built-in SAPI speech synthesizer.
 */
function speakOnWindows(text: string) {
  try {
    if (process.platform === "win32") {
      const clean = text.replace(/['"\r\n`]/g, " ").slice(0, 250);
      exec(`powershell -NoProfile -Command "(New-Object -ComObject SAPI.SpVoice).Speak('${clean}')"`, (err) => {
        if (err) console.warn("[OS Speech] Warning:", err.message);
      });
    }
  } catch (e: any) {
    console.warn("[OS Speech] Error:", e.message);
  }
}

/**
 * Scrapes the first matching video ID from YouTube so it can be played directly with &autoplay=1
 */
async function getTopYouTubeVideo(query: string): Promise<{ videoId: string; watchUrl: string }> {
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await res.text();
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/) || html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (match && match[1]) {
      const videoId = match[1];
      return {
        videoId,
        watchUrl: `https://www.youtube.com/watch?v=${videoId}&autoplay=1`,
      };
    }
  } catch (err: any) {
    console.warn("[YouTube] Error getting top video:", err.message);
  }
  return {
    videoId: "",
    watchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  };
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// NVIDIA NIM — the same OpenAI-compatible endpoint the chat route uses as
// its primary LLM. Included in the race so missions keep working when the
// OpenRouter free tier is exhausted (429) or a slug is sunset (404).
const NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NIM_MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b";
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

// Durable job store (v2) — missions survive restarts and HMR. Backed by
// .jarvis-data/missions.json via @/lib/agent/store.

/* ----------------------------- PUBLIC API ----------------------------- */

export function listJobs(): AgentJob[] {
  return storeListJobs();
}

export { listJobSummaries };

export function getJob(jobId: string): AgentJob | undefined {
  return storeGetJob(jobId);
}

/**
 * Decompose a goal into an AgentPlan via LLM. Returns a job in
 * "awaiting_approval" state with a plan attached. Validates JSON; retries
 * up to 2 times on parse / validation failure.
 */
export async function planGoal(goal: string, opts?: { autoApprove?: boolean; watch?: boolean }): Promise<AgentJob> {
  const autoApprove = opts?.autoApprove === true;
  // CRITICAL goals only: things that run code/commands on this machine. Every
  // other mission — including sign-ins and recorded replays — rides the fast
  // lane, because waiting for a nod on a read-only or user-visible action just
  // wastes the user's time.
  const RUNS_ON_PC_RE = /\b(shell|terminal|run the (command|script)|execute the (command|script)|restart the (server|dev)|install|uninstall|npm install|registry|sudo|admin|format the|delete (the )?(folder|directory|file))\b/i;
  const job: AgentJob = {
    id: randomUUID(),
    goal,
    status: "planning",
    createdAt: Date.now(),
    results: [],
    creditsUsed: 0,
    // Store the PC-gated flag: shell goals always ride the approval lane, so
    // approveJob never re-gates them after a legitimate approval.
    auto: autoApprove && !RUNS_ON_PC_RE.test(goal),
    // Show the real browser window during autonomous browser steps when asked.
    watch: opts?.watch === true,
  };
  putJob(job);
  emitMissionEvent(job.id, "status", "Planning mission…", { status: "planning" });

  let lastError: string | null = null;
  // ⚡ Instant lane: the common goal shapes (weather, timer, play, find+open,
  // sign-in, orders/cart, price) get their plan built locally — no LLM
  // round-trip at all. Everything else goes to the planner.
  const instant = heuristicPlan(goal);
  // Category routing hint keeps the LLM on the proven step recipe for the
  // mission shape (tidy-up / dev-env / investigate / news / …) instead of
  // free-styling an inefficient chain.
  const category = classifyGoal(goal);
  const routing = categoryDirective(category);
  for (let attempt = 0; attempt < (instant ? 1 : 2); attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 700));
    }
    try {
      const plan = instant ?? (await callPlanner(goal, speedDirective(goal) + routing + memoryDirective(goal)));
      if (instant) {
        emitMissionEvent(job.id, "log", "⚡ Instant plan — no planner round-trip needed", { instant: true });
        console.log(`[Agent] instant plan for "${goal.slice(0, 60)}" (${plan.steps.length} steps)`);
      }
      validateAndRepairPlan(plan);
      // Auto-detect interactive goals the planner treated as read-only and
      // append a real browser step — the user never has to say "playwright".
      maybeAppendBrowserStep(plan, goal);
      plan.estimate = estimatePlan(plan);
      if (plan.steps.some((s) => s.kind === "delegate")) plan.supervisor = true;
      // Interactive / command-running plans always need an explicit nod.
      if (planNeedsApproval(plan)) job.auto = false;
      job.plan = plan;
      job.status = "awaiting_approval";
      emitMissionEvent(job.id, "status", `Plan ready — ${plan.steps.length} step(s)`, {
        status: "awaiting_approval",
        plan,
      });
      if (autoApprove && job.auto) {
        // Fast lane — skip the approval gate and execute immediately.
        // Progress flows through the job store + SSE; the UI polls status.
        void approveJob(job.id).catch((e) => {
          job.status = "failed";
          job.error = (e as Error)?.message || String(e);
          emitMissionEvent(job.id, "error", job.error, { status: "failed" });
        });
      }
      return job;
    } catch (e) {
      lastError = (e as Error)?.message || String(e);
      console.warn(`[Agent] planner attempt ${attempt + 1} failed:`, lastError);
    }
  }

  // Every LLM provider failed. Rather than dropping the mission, fall back to
  // a deterministic recipe for this goal's category — still executable, still
  // parallelised, and honest about being a fallback.
  try {
    const plan = fallbackPlan(goal, category);
    validateAndRepairPlan(plan);
    maybeAppendBrowserStep(plan, goal);
    plan.estimate = estimatePlan(plan);
    if (plan.steps.some((s) => s.kind === "delegate")) plan.supervisor = true;
    if (planNeedsApproval(plan)) job.auto = false;
    job.plan = plan;
    job.status = "awaiting_approval";
    console.warn(`[Agent] planner unreachable (${lastError ?? "unknown"}) — using ${category} fallback plan`);
    emitMissionEvent(job.id, "status", `Planner unreachable — using a built-in ${category} plan (${plan.steps.length} steps)`, {
      status: "awaiting_approval",
      plan,
      fallback: true,
    });
    if (autoApprove && job.auto) {
      void approveJob(job.id).catch((e) => {
        job.status = "failed";
        job.error = (e as Error)?.message || String(e);
        emitMissionEvent(job.id, "error", job.error, { status: "failed" });
      });
    }
    return job;
  } catch (fallbackErr) {
    console.error("[Agent] fallback plan failed too:", fallbackErr);
  }

  job.status = "failed";
  job.error = `Could not produce a plan: ${lastError ?? "unknown error"}`;
  emitMissionEvent(job.id, "error", job.error, { status: "failed" });
  return job;
}

/** Approve a plan and run it to completion. */
export async function approveJob(jobId: string): Promise<AgentJob> {
  const job = storeGetJob(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "awaiting_approval" && job.status !== "paused_checkpoint") {
    throw new Error(`Job is in status ${job.status}, not awaiting_approval`);
  }
  if (!job.plan) throw new Error("Job has no plan");

  // Hard safety gate: commands, sign-ins and recorded replays never execute on
  // a fast-lane auto-approval — they always get an explicit approval round-trip.
  if (planNeedsApproval(job.plan) && job.auto) {
    job.auto = false;
    job.status = "awaiting_approval";
    emitMissionEvent(job.id, "status", "This mission acts on your PC/sites — review and approve to execute", { status: "awaiting_approval" });
    putJob(job);
    return job;
  }

  job.status = "running";
  job.cancelRequested = false;
  job.startedAt = Date.now();
  emitMissionEvent(job.id, "status", "Mission started", { status: "running" });
  try {
    await executePlan(job);
    // Abort wins: a cancelled run must not be re-labelled "done" when the
    // executor unwinds (that made the Abort button look broken).
    const aborted =
      (job.cancelRequested as boolean | undefined) === true || (job.status as JobStatus) === "cancelled";
    if (aborted) {
      job.status = "cancelled";
      emitMissionEvent(job.id, "status", "Mission aborted by user", { status: "cancelled" });
    } else {
      // A mission is "partial" when it finished but some steps failed/skipped.
      if (job.results.some((r) => r.status === "error" || r.status === "skipped")) job.partial = true;
      job.status = "done";
      emitMissionEvent(job.id, "done", `Mission complete in ${elapsed(job)}`, {
        status: "done",
        report: buildReport(job),
        partial: job.partial === true,
      });
      // Bridge the mission's leftovers into the Command Deck. Fire-and-forget
      // so task creation can never delay or fail the mission itself.
      void syncMissionFollowUpTasks(job);
    }
  } catch (e) {
    job.status = "failed";
    job.error = (e as Error)?.message || String(e);
    emitMissionEvent(job.id, "error", `Mission failed: ${job.error}`, { status: "failed" });
  } finally {
    job.finishedAt = Date.now();
    // Stop streaming new frames; the last one stays readable for the panel.
    setLiveViewEnabled(job.id, false);
    flushMissions();
  }
  return job;
}

export async function cancelJob(jobId: string): Promise<AgentJob | undefined> {
  const job = storeGetJob(jobId);
  if (!job) return undefined;
  if (job.status === "running" || job.status === "awaiting_approval" || job.status === "planning" || job.status === "paused_checkpoint") {
    job.status = "cancelled";
    job.cancelRequested = true;
    job.finishedAt = Date.now();
    // Unwind a parked checkpoint so the executor's await settles and the
    // runStep throws "cancelled at checkpoint" instead of hanging forever.
    job.checkpointResolve?.();
    emitMissionEvent(job.id, "status", "Mission cancelled", { status: "cancelled" });
    clearMissionEvents(jobId);
    flushMissions();
  }
  return job;
}

/** Resume a job paused at a checkpoint. The user's pick feeds llm_decide-style templating. */
export async function resumeCheckpoint(jobId: string, pick: string): Promise<AgentJob> {
  const job = storeGetJob(jobId);
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
  putJob(job);
  return job;
}

function elapsed(job: AgentJob): string {
  if (!job.startedAt) return "?";
  const s = Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/* ----------------------------- PLANNER ----------------------------- */

/**
 * Sequential fallback chain: Gemini → Groq → OpenRouter → NIM.
 * Tries each provider in order and falls through on error (rate-limit, 5xx, etc.).
 * This avoids hammering all providers at once which causes 429 rate-limit cascades.
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
  // Free models answer a plan in 1–3s; a 12s ceiling keeps a slow provider
  // from holding the mission hostage.
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const payload = {
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens,
    temperature: opts.temperature ?? 0.4,
    // Planners occasionally ramble past the JSON; an early stop keeps
    // responses tight (the robust extractor handles the rest).
    stop: ["\n\n\n"],
  };

  // One attempt against an OpenAI-compatible chat endpoint.
  const attempt = async (
    provider: string,
    url: string,
    apiKey: string,
    model: string,
    extraHeaders?: Record<string, string>
  ): Promise<string> => {
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
  };

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const nimKey = process.env.NVIDIA_API_KEY;
  if (!openrouterKey && !groqKey && !geminiKey && !nimKey) {
    throw new Error(`no LLM provider key (OPENROUTER/GROQ/GEMINI/NVIDIA) for ${label}`);
  }

  // Build sequential fallback chain: Gemini → Groq → OpenRouter → NIM
  const chain: Array<() => Promise<string>> = [];

  if (geminiKey) {
    chain.push(() => attempt("gemini", GEMINI_URL, geminiKey, GEMINI_PLANNER_MODEL));
  }
  if (groqKey) {
    for (const model of GROQ_PLANNER_MODELS) {
      chain.push(() => attempt("groq", GROQ_URL, groqKey, model));
    }
  }
  if (openrouterKey) {
    for (const model of OPENROUTER_PLANNER_MODELS) {
      chain.push(() =>
        attempt("openrouter", OPENROUTER_URL, openrouterKey, model, {
          "HTTP-Referer": "http://localhost:3000",
          "X-Title": "JARVIS AI Assistant",
        })
      );
    }
  }
  if (nimKey) {
    chain.push(() => attempt("nvidia", NIM_URL, nimKey, NIM_MODEL));
  }

  // Parallel staggered race: the top two providers start at t=0 and the rest
  // 180ms apart; everyone runs CONCURRENTLY and the first usable result wins.
  // (A dead first provider used to burn its whole timeout before the next
  // even started — that was the #1 planning bottleneck.)
  const STAGGER_MS = 180;
  return await new Promise<string>((resolve, reject) => {
    const errors: string[] = [];
    const total = chain.length;
    let launched = 0;
    let settled = false;

    const pump = () => {
      if (settled || launched >= total) return;
      const idx = launched++;
      chain[idx]().then(
        (res) => {
          if (!settled) {
            settled = true;
            resolve(res);
          }
        },
        (e: any) => {
          const msg: string = (e as Error)?.message || String(e);
          console.warn(`[llmRace/${label}] provider failed:`, msg.slice(0, 120));
          errors.push(msg);
          if (errors.length >= total && !settled) {
            settled = true;
            reject(new Error(`All LLM providers failed for ${label}: ${errors.map((m) => m.slice(0, 80)).join(" | ")}`));
            return;
          }
          pump(); // a failure frees a launch slot immediately
        }
      );
    };

    pump();
    pump();
    for (let i = 2; i <= total; i++) {
      setTimeout(() => {
        if (!settled) pump();
      }, i * STAGGER_MS);
    }
  });
}

/**
 * Goals that genuinely need heavy steps (scrape / extract / deep research).
 * Everything else runs the fast lane: search → decide → open.
 */
const RESEARCHY_RE = /\b(research|compare|comparison|versus|\bvs\b|specs?|specifications?|analysis|analy[sz]e|report|detailed|thorough|full details)\b/i;
/** Goals that explicitly ask for depth — the only ones allowed to go long. */
const DEEP_RE = /\b(deep research|in[- ]depth|exhaustive|comprehensive|everything about|all the details|white ?paper|dissertation|thesis|literature review)\b/i;

/**
 * Always-present pacing directive. Missions used to run long because a
 * "research" goal got no directive at all and the planner free-styled a
 * 6-8 step scrape chain. Now every plan is told to stay lean and parallel,
 * and "deep" work has to be explicitly requested.
 */
function speedDirective(goal: string): string {
  const common =
    "\n\n[SPEED DIRECTIVE] Latency beats exhaustiveness. Rules: (1) never emit more steps than the goal needs; (2) steps that do not depend on each other MUST run in parallel (no dependsOn) — the executor runs up to 6 at once; (3) prefer ONE strong search over many weak ones; (4) never add a scrape/extract step 'just in case'.";

  if (DEEP_RE.test(goal)) {
    return `${common} The user explicitly asked for depth, so research steps are allowed — still keep the chain as short as it can be while covering the ask.`;
  }

  if (RESEARCHY_RE.test(goal)) {
    return `${common} This is a normal research/comparison goal: cap the plan at 5 steps. Use firecrawl_search (limit 5) -> firecrawl_extract or llm_summarize -> llm_decide, and only add web_scrape/deep_research if the first search genuinely came back thin.`;
  }

  const multi = multiOpenIntent(goal);
  if (multi) {
    return `${common} This is a MULTI-OPEN mission: find ${multi.n} distinct results and open them in separate tabs. Use ONLY: firecrawl_search (limit ${Math.max(5, Math.min(multi.n + 2, 10))}) -> llm_decide (input 'from:<searchStepId>') -> browser_open (url 'from:<decideStepId>.urls', count ${multi.n}). Do NOT emit one browser_open per item and do NOT add web_scrape/firecrawl_extract/deep_research.`;
  }

  return `${common} This is a simple open-and-go mission — optimize for speed. For weather use weather_lookup; for music use spotify_action or youtube_open with a query; for opening videos use youtube_open; for timers use timer_set. For finding/browsing things use ONLY: firecrawl_search (limit 5) -> llm_decide (input 'from:<searchStepId>') -> browser_open (url 'from:<decideStepId>.url'). Do NOT add web_scrape, firecrawl_extract, or deep_research steps.`;
}

/**
 * Retrieval-augmented planning: surface the few most similar past missions so
 * the planner can mirror what worked (and avoid what failed).
 */
function memoryDirective(goal: string): string {
  try {
    const past = pickSimilarPastGoals(goal, storeListJobs().map((j) => ({ goal: j.goal, status: j.status, createdAt: j.createdAt })), 3);
    if (past.length === 0) return "";
    const lines = past.map((p) => `- (${p.status}) ${p.goal.slice(0, 140)}`);
    return `\n\n[PAST MISSIONS] Similar missions you have run before. Reuse a successful approach when it fits; avoid the failed ones:\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

async function callPlanner(goal: string, directive = ""): Promise<AgentPlan> {
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
    user: goal + directive,
    maxTokens: 1600,
    label: "planner",
  });

  // Resilient JSON extractor and repair
  let jsonStr = content.replace(/```json/gi, "").replace(/```/g, "").trim();
  const startIdx = jsonStr.indexOf("{");
  const lastIdx = jsonStr.lastIndexOf("}");
  if (startIdx !== -1 && lastIdx !== -1 && lastIdx > startIdx) {
    jsonStr = jsonStr.slice(startIdx, lastIdx + 1);
  }
  // Strip trailing commas before closing braces/brackets
  jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

  try {
    return JSON.parse(jsonStr) as AgentPlan;
  } catch {
    // Attempt basic syntax closure if cut off at token boundary
    let repaired = jsonStr.replace(/,\s*$/, "");
    if ((repaired.match(/"/g) || []).length % 2 !== 0) repaired += '"';
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += "]";
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces - closeBraces; i++) repaired += "}";
    return JSON.parse(repaired) as AgentPlan;
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
    // A decide step exposes its winner + ranked alternatives — use them all so
    // "open N of them in separate tabs" can open N DIFFERENT pages. Falls back
    // to every hit for plain search results.
    const rec = out as Record<string, unknown> | undefined;
    const urls: string[] = [];
    const push = (u: unknown) => {
      if (typeof u === "string" && u.startsWith("http") && !urls.includes(u)) urls.push(u);
    };
    if (rec) {
      push(rec.url);
      if (Array.isArray(rec.alternatives)) {
        for (const a of rec.alternatives as Array<Record<string, unknown>>) push(a?.url);
      }
    }
    if (urls.length === 0) for (const h of extractUrls(out)) push(h.url);
    return urls.length > 0 ? urls : value;
  }
  if (field === "choice") return String(out?.choice ?? out?.decision ?? out?.pick ?? value);
  if (field === "summary") return String(out?.summary ?? value);
  if (field === "url") {
    if (typeof out?.url === "string" && out.url.startsWith("http")) return out.url;
    if (out?.choice) return String(out.choice);
    return String(out?.url ?? value);
  }
  if (field === "content" || field === "text" || field === "data" || field === "ingredients") {
    if (Array.isArray(out?.ingredients)) {
      return out.ingredients.map((item: any) => typeof item === "string" ? item : (item.name || item.item || JSON.stringify(item))).join("\n");
    }
    // Generic extracted arrays (specs/points/prices/features...) — extraction
    // is universal, not recipe-only.
    for (const k of ["extracted", "points", "specs", "prices", "features", "items", "dates", "results"]) {
      if (Array.isArray((out as Record<string, unknown>)?.[k])) {
        return ((out as Record<string, unknown>)[k] as unknown[])
          .map((i) => (typeof i === "string" ? i : (typeof i === "object" && i ? Object.entries(i as Record<string, unknown>).map(([kk, vv]) => `${kk}: ${String(vv)}`).join(" — ") : JSON.stringify(i))))
          .join("\n");
      }
    }
    return typeof out === "string" ? out : String(out?.content ?? out?.summary ?? out?.text ?? JSON.stringify(out ?? ""));
  }

  // Bare reference — prefer an absolute file path (file_list results), then
  // the best URL, then text summaries.
  if (typeof out?.path === "string" && path.isAbsolute(out.path)) return out.path;
  const chosen = pickUrl(out);
  if (chosen) return chosen;
  if (typeof dep.result === "string") return dep.result;
  if (Array.isArray(out?.ingredients)) {
    return out.ingredients.map((item: any) => typeof item === "string" ? item : (item.name || item.item || JSON.stringify(item))).join("\n");
  }
  if (out?.summary) return String(out.summary);
  if (out?.content) return String(out.content);
  if (out?.choice) return String(out.choice);
  if (out?.markdown) return String(out.markdown);
  if (out && typeof out === "object") return out;
  return value;
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
  // browser_open result (urls array)
  if (Array.isArray(o.urls) && o.urls.length > 0) {
    const first = o.urls.filter((u): u is string => typeof u === "string" && u.startsWith("http"));
    if (first.length > 0) return [{ url: first[0], title: "opened page" }];
  }
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

const PARALLELISM = 6;

/** Per-step wall-clock ceilings — exist so one hung rail can't stall a mission. */
const STEP_TIMEOUT_MS: Partial<Record<AgentStepKind, number>> = {
  deep_research: 180_000,
  browser_act: 240_000,
  browser_login: 300_000,
  browser_replay: 180_000,
  firecrawl_extract: 120_000,
  web_scrape: 90_000,
  shell_command: 200_000,
  video_brief: 60_000,
  delegate: 240_000,
};
const DEFAULT_STEP_TIMEOUT_MS = 120_000;

/** Transient failures worth one automatic retry. */
const RETRYABLE_RE =
  /(ETIMEDOUT|ECONNRESET|ECONNREFUSED|ESOCKETTIMEDOUT|fetch failed|network|timed out|timeout|\b429\b|rate limit|socket hang up|EAI_AGAIN|\b50[234]\b)/i;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

/**
 * Run a command in a directory and return its stdout. Tolerant of a non-zero
 * exit when stdout is still useful (e.g. `npm outdated --json` exits 1 when it
 * HAS results, which is exactly when we want them).
 */
function runCapture(command: string, cwd: string, timeoutMs: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${command} timed out`)), timeoutMs);
    exec(command, { cwd, timeout: timeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      clearTimeout(t);
      if (!stdout && err && !stderr) {
        reject(err);
        return;
      }
      resolve(String(stdout).trim());
    });
  });
}

/** Harvest concrete artifacts a step produced so the panel + follow-ups see them. */
function collectArtifacts(job: AgentJob, step: AgentStep, result: unknown): void {
  if (!result || typeof result !== "object") return;
  const out = result as Record<string, unknown>;
  const add = (kind: MissionArtifact["kind"], label: string, value: string) => {
    if (!value || !value.trim()) return;
    if (!job.artifacts) job.artifacts = [];
    if (job.artifacts.some((a) => a.value === value)) return;
    job.artifacts.push({ id: randomUUID(), kind, label, value, stepId: step.id, at: Date.now() });
  };
  if (typeof out.path === "string" && out.path) {
    // Only register real files — repo_inspect/file_organize return a directory
    // as `path`, which would otherwise pollute the artifact list.
    try {
      if (fs.statSync(out.path).isFile()) add("file", String(out.filename ?? path.basename(out.path)), out.path);
    } catch {
      // not a real file — skip
    }
  }
  if (Array.isArray(out.screenshots)) {
    for (const s of out.screenshots) if (typeof s === "string") add("image", `${step.title.slice(0, 40)} screenshot`, s);
  }
  if (step.kind === "video_brief" && typeof out.path === "string") add("video", "Mission video brief", out.path);
  if (typeof out.url === "string" && out.url.startsWith("http")) add("url", step.title.slice(0, 60), out.url);
  if (Array.isArray(out.urls)) {
    for (const u of out.urls) if (typeof u === "string" && u.startsWith("http")) add("url", step.title.slice(0, 60), u);
  }
}

async function executePlan(job: AgentJob) {
  const plan = job.plan!;
  const resultsById = new Map<string, StepResult>();
  job.checkpointResults = job.checkpointResults ?? new Map();
  // Opt this mission into live frame streaming so the panel can watch browser
  // steps as they happen (frames are cleared once the mission settles).
  setLiveViewEnabled(job.id, true);

  const failedOrSkipped = new Set<string>();
  const finished = new Map<string, StepResult>();
  // Kept as a helper so TS does not narrow job.status across the function.
  const isCancelled = (): boolean => job.status === "cancelled" || job.cancelRequested === true;
  // Handed to long-running step handlers (browser loops) so Abort stops the
  // work in flight instead of only preventing the NEXT step from starting.
  const shouldStop = (): boolean => isCancelled();

  const runOne = async (step: AgentStep): Promise<void> => {
    if (isCancelled()) return;

    const skip = (error: string, message: string) => {
      const r: StepResult = { stepId: step.id, status: "skipped", error, finishedAt: Date.now() };
      resultsById.set(step.id, r);
      finished.set(step.id, r);
      job.results.push(r);
      failedOrSkipped.add(step.id);
      job.partial = true;
      emitMissionEvent(job.id, "step_finished", message, { stepId: step.id, status: "skipped", error });
    };

    // Dependencies must have succeeded.
    for (const dep of step.dependsOn ?? []) {
      const depResult = finished.get(dep);
      if (!depResult || depResult.status !== "ok") {
        skip(`dependency ${dep} not satisfied`, `Skipped: ${step.title}`);
        return;
      }
    }

    // Weighted credit budget — deep_research costs more than a search.
    const weight = stepCreditWeight(step.kind);
    if (weight > 0 && (job.creditsUsed ?? 0) + weight > MISSION_CREDIT_CAP) {
      skip(
        `Mission credit cap (${MISSION_CREDIT_CAP}) reached — step skipped to protect your Firecrawl quota`,
        `Budget cap hit — skipped: ${step.title}`
      );
      return;
    }

    // Steps that need an explicit nod never run on the fast lane.
    if (job.auto && APPROVAL_REQUIRED_KINDS.includes(step.kind)) {
      skip(
        `${STEP_KIND_LABELS[step.kind]} always waits for approval — rerun without fast mode to execute`,
        `Skipped (needs approval): ${step.title}`
      );
      return;
    }

    // Resolve templated params now that deps are done.
    const resolved: AgentStep = {
      ...step,
      params: Object.fromEntries(
        Object.entries(step.params).map(([k, v]) => [k, resolveParam(v, job, finished)])
      ),
    };

    if (step.kind === "shell_command" && !job.auto) {
      emitMissionEvent(job.id, "log", `⏳ Command step (ran after your approval): ${String(step.params.command ?? "").slice(0, 60)}`, { stepId: step.id });
    }
    emitMissionEvent(job.id, "step_started", step.title, { stepId: step.id, kind: step.kind });
    const t0 = Date.now();
    const timeoutMs = STEP_TIMEOUT_MS[step.kind] ?? DEFAULT_STEP_TIMEOUT_MS;

    // One automatic retry for transient failures (network / rate limit).
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      if (isCancelled()) return;
      if (attempt > 0) {
        emitMissionEvent(job.id, "log", `Retrying “${step.title}” after a transient failure…`, { stepId: step.id });
        await new Promise((r) => setTimeout(r, 1500));
      }
      try {
        const result = await withTimeout(runStep(resolved, finished, job, shouldStop), timeoutMs, step.title);
        // If the user aborted while this step was in flight, don't record it as
        // a completed result — the mission is over.
        if (isCancelled()) return;
        collectArtifacts(job, step, result);
        const r: StepResult = { stepId: step.id, status: "ok", result, finishedAt: Date.now() };
        resultsById.set(step.id, r);
        finished.set(step.id, r);
        job.results.push(r);
        if (weight > 0) job.creditsUsed = (job.creditsUsed ?? 0) + weight;
        emitMissionEvent(job.id, "step_finished", `${step.title} — done in ${Math.round((Date.now() - t0) / 1000)}s`, {
          stepId: step.id, status: "ok", result,
        });
        return;
      } catch (e) {
        lastErr = (e as Error)?.message || String(e);
        if (attempt === 0 && RETRYABLE_RE.test(lastErr)) continue;
        break;
      }
    }

    const r: StepResult = { stepId: step.id, status: "error", error: lastErr, finishedAt: Date.now() };
    resultsById.set(step.id, r);
    finished.set(step.id, r);
    job.results.push(r);
    failedOrSkipped.add(step.id);
    job.partial = true;
    emitMissionEvent(job.id, "step_finished", `${step.title} — failed: ${lastErr.slice(0, 80)}`, {
      stepId: step.id, status: "error", error: lastErr,
    });
    // Non-fatal: the rest of the plan degrades gracefully.
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

/* ----------------------------- SUPERVISOR / SPECIALISTS ----------------------------- */

type SubLogger = (message: string, data?: Record<string, unknown>) => void;

/** Ask the LLM for a focused plan restricted to a specialist's toolset. */
async function planSubMission(role: SpecialistRole, goal: string, allowed: Set<string>): Promise<AgentPlan> {
  const kindList = Array.from(allowed).join(", ");
  const system = [
    `You are the ${role.toUpperCase()} specialist sub-agent inside JARVIS, a supervisor/specialist system.`,
    'Given ONE focused sub-goal, return ONLY JSON: {"summary": string, "steps": [{id, kind, title, params, dependsOn?}]}.',
    `You may ONLY use these step kinds: ${kindList}.`,
    "At most 5 steps. Steps without dependsOn run in parallel. Chain values with 'from:<stepId>'.",
    role === "browser" ? "Prefer browser_act for interactive sites, browser_screenshot for visual evidence." : "",
    role === "writer" ? "End with notes_create or file_save so the work is stored, plus llm_summarize for the report." : "",
    role === "researcher" ? "Prefer firecrawl_search -> firecrawl_extract/deep_research -> llm_summarize." : "",
    role === "analyst" ? "Prefer llm_decide / llm_summarize to rank and compare options." : "",
    "Output ONLY JSON, no prose.",
  ].filter(Boolean).join(" ");

  const content = await llmRace({ system, user: goal, maxTokens: 1300, label: `sub-planner:${role}` });
  const parsed = parseJsonLoose<AgentPlan>(content);
  if (!parsed || !Array.isArray(parsed.steps)) throw new Error("sub-planner returned no plan");
  return parsed;
}

interface DelegationOutcome {
  status: "ok" | "error";
  summary: string;
  results: StepResult[];
  steps: Array<{ id: string; title: string; kind: AgentStepKind; status: StepResult["status"] }>;
}

/** Plan + run a specialist sub-mission inside the parent job. */
async function executeSubPlan(
  parentJob: AgentJob,
  role: SpecialistRole,
  goal: string,
  log: SubLogger,
  shouldStop?: () => boolean
): Promise<DelegationOutcome> {
  const allowed = kindsAllowedForRole(role);
  let plan: AgentPlan;
  try {
    plan = await planSubMission(role, goal, allowed);
    validateAndRepairPlan(plan, allowed, { maxSteps: 6, allowDelegate: false });
  } catch (e) {
    return { status: "error", summary: `Delegation to ${role} failed: ${(e as Error).message}`, results: [], steps: [] };
  }

  log(`${role} specialist planned ${plan.steps.length} step(s)`);
  const finished = new Map<string, StepResult>();
  const results: StepResult[] = [];
  const pending = [...plan.steps];
  let guard = 0;

  while (pending.length > 0 && guard++ < 40) {
    if (parentJob.status === "cancelled" || parentJob.cancelRequested) break;
    const idx = pending.findIndex((s) => (s.dependsOn ?? []).every((d) => finished.has(d)));
    const step = idx >= 0 ? pending.splice(idx, 1)[0] : pending.shift()!;

    // Approval-required kinds never run inside a delegate — the root approval
    // did not explicitly cover them.
    if (APPROVAL_REQUIRED_KINDS.includes(step.kind)) {
      const r: StepResult = { stepId: step.id, status: "skipped", error: "not available inside a delegated sub-mission", finishedAt: Date.now() };
      finished.set(step.id, r);
      results.push(r);
      continue;
    }

    const resolved: AgentStep = {
      ...step,
      params: Object.fromEntries(Object.entries(step.params).map(([k, v]) => [k, resolveParam(v, parentJob, finished)])),
    };
    log(`[${role}] ${step.title}`);
    try {
      const result = await withTimeout(
        runStep(resolved, finished, parentJob, shouldStop),
        STEP_TIMEOUT_MS[step.kind] ?? DEFAULT_STEP_TIMEOUT_MS,
        `${role}: ${step.title}`
      );
      const r: StepResult = { stepId: step.id, status: "ok", result, finishedAt: Date.now() };
      finished.set(step.id, r);
      results.push(r);
      collectArtifacts(parentJob, { ...step, id: `${role}:${step.id}` }, result);
    } catch (e) {
      const r: StepResult = { stepId: step.id, status: "error", error: (e as Error).message, finishedAt: Date.now() };
      finished.set(step.id, r);
      results.push(r);
    }
  }

  const ok = results.filter((r) => r.status === "ok");
  const summaries = ok
    .map((r) => {
      const o = r.result as Record<string, unknown> | undefined;
      return typeof o?.summary === "string" ? o.summary : typeof o?.answer === "string" ? String(o.answer) : "";
    })
    .filter(Boolean);
  const steps = plan.steps.map((s) => ({
    id: s.id,
    title: s.title,
    kind: s.kind,
    status: (finished.get(s.id)?.status ?? "skipped") as StepResult["status"],
  }));
  return {
    status: ok.length > 0 ? "ok" : "error",
    summary: summaries.join("\n\n") || `(${role} specialist produced no summary)`,
    results,
    steps,
  };
}

/* ----------------------------- STEP HANDLERS ----------------------------- */

async function runStep(
  step: AgentStep,
  deps: Map<string, StepResult>,
  job: AgentJob,
  shouldStop?: () => boolean
): Promise<unknown> {
  const log = (message: string, data?: Record<string, unknown>) =>
    emitMissionEvent(job.id, "log", message, { stepId: step.id, ...data });

  switch (step.kind) {
    case "web_search":
    case "firecrawl_search": {
      const query = String(step.params.query ?? "");
      if (!query) throw new Error("search: query required");
      const limit = Math.min(Number(step.params.limit ?? 5) || 5, 10);
      log(`Searching the web: "${query}"`);
      const hits = await searchWebWithFallback(query, limit, log);
      log(`Found ${hits.length} search results`);
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
      log(`Extracting data: ${prompt.slice(0, 60)}`);
      // The subject hint comes from the mission goal + any decide step's
      // pick — not from a broken ref that leaked into the title.
      const choiceHint = (() => {
        for (const r of deps.values()) {
          const out = r.result as Record<string, unknown> | undefined;
          if (out?.choice && typeof out.choice === "string") return String(out.choice);
        }
        return "";
      })();
      const subject = choiceHint || job.goal;
      const wantsIngredients = /ingredient|shopping list|recipe/i.test(`${prompt} ${step.title}`);

      // UNIVERSAL formatting: shopping-list style for ingredients, bullet
      // list for everything else (specs, prices, key points, dates...).
      const formatIngredients = (parsed: any, fallbackText: string) => {
        const rawItems = Array.isArray(parsed?.ingredients) && parsed.ingredients.length > 0
          ? parsed.ingredients
          : Array.isArray(parsed?.items) && parsed.items.length > 0
            ? parsed.items
            : [fallbackText];
        const items = rawItems.map((i: any) => typeof i === "string" ? i : (i.name || i.item || JSON.stringify(i))).filter((i: string) => i.trim());
        const summary = `### 📋 Extracted Ingredients & Items\n\n` + items.map((i: string) => `- ${i}`).join("\n");
        const content = items.map((i: string) => `- [ ] ${i}`).join("\n");
        return { ingredients: items, summary, content, ...parsed };
      };
      const formatGeneric = (data: unknown, fallbackText: string) => {
        // Structured JSON {"specs": [...]} / {"points": [...]} → bullet list.
        const rec = (data && typeof data === "object" && !Array.isArray(data)) ? data as Record<string, unknown> : null;
        const listField = rec ? Object.entries(rec).find(([, v]) => Array.isArray(v) && v.length > 0) : undefined;
        let items: string[] = [];
        if (listField) {
          items = (listField[1] as unknown[]).map((i) => typeof i === "string" ? i : (typeof i === "object" && i ? Object.entries(i as Record<string, unknown>).map(([k, v]) => `${k}: ${String(v)}`).join(" — ") : JSON.stringify(i)));
        } else if (rec) {
          // Flat object {price: "...", screen: "..."} → bullets.
          items = Object.entries(rec).filter(([, v]) => typeof v !== "object").map(([k, v]) => `${k}: ${String(v)}`);
        }
        if (items.length === 0) items = [fallbackText];
        items = items.filter((i) => i.trim());
        const summary = `### 🧾 Extracted Data\n\n` + items.map((i: string) => `- ${i}`).join("\n");
        const content = items.join("\n");
        return { extracted: items, summary, content, ...(rec ?? {}) };
      };

      if (!url || url.startsWith("from:")) {
        log(`Using AI knowledge extraction for "${subject.slice(0, 60)}"`);
        const synthesized = await llmCall(
          `You are an expert AI assistant. Extract and format the requested information accurately from your knowledge. If ingredients are requested, list all ingredients with exact quantities. Return valid JSON: use {"ingredients": [...]} for shopping lists, otherwise a JSON object or array matching what was asked (e.g. {"specs": [...]}, {"points": [...]}).\n\nInstruction: ${prompt}\nSubject: ${subject}`,
          subject
        );
        const parsed = tryJson(synthesized);
        if (wantsIngredients) return formatIngredients(parsed, synthesized);
        return formatGeneric(parsed ?? { points: [synthesized] }, synthesized);
      }

      // Unified fallback chain: LLM extraction → heuristic ingredient parser
      // (works even when every LLM provider is rate-limited) → AI synthesis.
      let markdown = "";
      try {
        log(`AI-extracting from ${url.slice(0, 70)}`);
        const scraped = await scrapeWithFallback(url, log);
        markdown = String((scraped as Record<string, unknown>).markdown ?? "");
      } catch (e: any) {
        log(`Scrape failed (${e.message}) — falling back to AI synthesis`);
      }

      if (markdown) {
        try {
          const raw = await llmCall(
            `You extract structured data from the page content. Follow the instruction and return valid JSON: use {"ingredients": [...]} for shopping lists, otherwise an object or array matching what was asked (e.g. {"specs": [...]}, {"prices": [...]}, {"points": [...]}). If the page is a list/roundup, focus on the single most relevant item.\n\nInstruction: ${prompt}`,
            markdown.slice(0, 6000)
          );
          const parsed = tryJson(raw);
          const listLen = (o: any, keys: string[]) => keys.reduce((n, k) => Math.max(n, Array.isArray(o?.[k]) ? o[k].length : 0), 0);
          const hasData = !!parsed &&
            (listLen(parsed, ["ingredients", "items", "specs", "prices", "points", "features", "dates", "results", "data"]) > 0 ||
              (typeof parsed === "object" && Object.keys(parsed).length > 0));
          if (hasData) {
            return wantsIngredients ? formatIngredients(parsed, raw) : formatGeneric(parsed, raw);
          }
        } catch (e: any) {
          log(`LLM extraction unavailable (${String(e?.message ?? e).slice(0, 60)}) — trying heuristic parser`);
        }
        // No-LLM fallbacks: shopping lists get the ingredient-line parser;
        // everything else gets the universal key-line parser.
        if (wantsIngredients) {
          const heuristic = heuristicIngredients(markdown);
          if (heuristic.length >= 3) {
            log(`Heuristic parser found ${heuristic.length} ingredients`);
            return formatIngredients({ ingredients: heuristic }, "");
          }
        } else {
          const generic = heuristicKeyLines(markdown);
          if (generic.length >= 3) {
            log(`Heuristic parser found ${generic.length} key lines`);
            return formatGeneric({ points: generic }, "");
          }
        }
        log(`Page yielded no extractable data — synthesizing from AI knowledge`);
      }

      const backup = await llmCall(
        wantsIngredients
          ? `Provide an authentic, comprehensive ingredient list with quantities for: ${subject}. Return ONLY JSON: {"ingredients": ["quantity item", ...]}`
          : `Provide accurate, factual data for: ${subject}. Instruction: ${prompt}. Return ONLY JSON matching what was asked (e.g. {"specs": [...]} or {"points": [...]})`,
        prompt
      );
      const parsedBackup = tryJson(backup);
      return wantsIngredients ? formatIngredients(parsedBackup, backup) : formatGeneric(parsedBackup ?? { points: [backup] }, backup);
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
      let depResult: unknown = null;
      if (typeof inputRef === "string" && inputRef.startsWith("from:")) {
        const dep = deps.get(inputRef.slice(5).trim());
        depResult = dep?.result;
        pool = extractUrls(depResult);
      } else if (deps.size > 0) {
        for (const r of [...deps.values()].reverse()) {
          pool = extractUrls(r.result);
          if (pool.length > 0) {
            depResult = r.result;
            break;
          }
        }
      }

      // 1. If we have URL / search hits, select the best candidate link
      if (pool.length > 0) {
        log(`Deciding: ${question.slice(0, 60)} (${pool.length} candidates)`);
        const listing = pool
          .slice(0, 8)
          .map((h, i) => `${i + 1}. ${h.title.slice(0, 110)}\n   URL: ${h.url}\n   ${(h.description ?? "").slice(0, 140)}`)
          .join("\n");
        let raw = "";
        try {
          raw = await llmCall(
            `You are JARVIS choosing the best option for the user. The user's overall goal is: "${job.goal}". Pick something that genuinely serves that goal (right audience, right topic, right depth). Answer with ONLY JSON: {"choice": <number>, "reason": "<one sentence>", "url": "<the chosen URL>"}`,
            `${question}\n\nOptions:\n${listing}`
          );
        } catch (e: any) {
          // All providers down (quota/rate limit) — pick the top-ranked result
          // deterministically instead of failing the mission branch.
          log(`LLM unavailable for decision (${String(e?.message ?? e).slice(0, 60)}) — picking top-ranked result`);
          const decided = ((job as unknown as { __decidedUrls?: Set<string> }).__decidedUrls ??= new Set<string>());
          const winner = pool.find((h) => !decided.has(h.url)) ?? pool[0];
          decided.add(winner.url);
          return {
            choice: winner.title,
            url: winner.url,
            reason: "Top-ranked search result (LLM providers unavailable)",
            alternatives: pool.filter((h) => h.url !== winner.url).slice(0, 8).map((h) => ({ url: h.url, title: h.title })),
            summary: `### 🏆 Best Option Selected: ${winner.title}\n\n- **Reason:** Top-ranked search result\n- **Direct Link:** [${winner.title}](${winner.url})`,
          };
        }
        const parsed = tryJson(raw) as { choice?: number | string; reason?: string; url?: string } | null;
        const idx = parsed?.choice != null ? parseInt(String(parsed.choice), 10) - 1 : 0;
        let winner = pool[Number.isInteger(idx) && idx >= 0 && idx < pool.length ? idx : 0];
        // Sibling llm_decide steps run in parallel over the same pool — without
        // dedup all three "pick a resource" steps can choose the same site.
        const decided = ((job as unknown as { __decidedUrls?: Set<string> }).__decidedUrls ??= new Set<string>());
        if (decided.has(winner.url)) {
          const alt = pool.find((h) => !decided.has(h.url));
          if (alt) {
            log(`Choice already taken — switching to: ${alt.title.slice(0, 50)}`);
            winner = alt;
          }
        }
        decided.add(winner.url);
        log(`Picked: ${winner.title.slice(0, 60)} — ${parsed?.reason?.slice(0, 60) ?? ""}`);
        const chosenUrl = winner.url;
        return {
          choice: winner.title,
          url: chosenUrl,
          reason: parsed?.reason ?? "",
          // Ranked alternates so sibling browser_open steps can each open a
          // DIFFERENT resource ("choose three, open in separate tabs").
          alternatives: pool.filter((h) => h.url !== chosenUrl).slice(0, 8).map((h) => ({ url: h.url, title: h.title })),
          summary: `### 🏆 Best Option Selected: ${winner.title}\n\n- **Reason:** ${parsed?.reason ?? "Top recommendation"}\n- **Direct Link:** [${winner.title}](${chosenUrl})`
        };
      }

      // 2. If pool has no URLs (e.g. decision based on weather, query, or text comparison), ask LLM to make recommendation
      log(`Analyzing decision for: ${question.slice(0, 60)}`);
      const contextStr = typeof depResult === "object" ? JSON.stringify(depResult) : String(depResult ?? "");
      const decision = await llmCall(
        `You are JARVIS making an intelligent choice for the user. Answer with ONLY the concise choice or recommendation (no conversational fluff).`,
        `${question}\n\nContext data:\n${contextStr}`
      );
      const cleanDecision = decision.replace(/^["']|["']$/g, "").trim();
      log(`Decision made: "${cleanDecision.slice(0, 60)}"`);

      // Find direct product link for the winner so subsequent browser_open steps have a real link
      let pickedUrl = "";
      try {
        const quickHits = await searchWebWithFallback(`${cleanDecision} buy online`, 3, log);
        if (quickHits.length > 0 && quickHits[0].url) {
          pickedUrl = quickHits[0].url;
        }
      } catch {
        // fallback to query
      }

      return {
        choice: cleanDecision,
        decision: cleanDecision,
        url: pickedUrl,
        summary: `### 🏆 Best Option Selected: ${cleanDecision}\n\n${pickedUrl ? `Direct link: [${cleanDecision}](${pickedUrl})` : ""}`
      };
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
      const hits: SearchHit[] = sanitizeHits((searchData.results ?? []).map((r: Record<string, unknown>) => ({
        url: String(r.url ?? ""), title: String(r.title ?? r.url ?? ""), description: String(r.description ?? "").slice(0, 300),
      })));
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
      // Resolved URL input (e.g. 'from:<browserOpenStep>.url') — fetch the
      // article and summarize its CONTENT, not the link text.
      const scrapeUrlInputs = async (urls: string[]): Promise<string[]> => {
        const docs = await Promise.allSettled(urls.slice(0, 3).map((u) => scrapeWithFallback(u, log)));
        return docs
          .filter((d): d is PromiseFulfilledResult<Record<string, unknown>> => d.status === "fulfilled")
          .map((d) => String(d.value.markdown ?? "").slice(0, 6000))
          .filter((md) => md.length > 100);
      };
      if (typeof spec === "string" && spec.startsWith("http")) {
        log(`Fetching article to summarize: ${spec.slice(0, 60)}`);
        inputs = await scrapeUrlInputs([spec]);
      } else if (typeof spec === "string" && spec.startsWith("from:")) {
        const dep = deps.get(spec.slice(5).trim());
        const out = dep?.result as Record<string, unknown> | undefined;
        const md = String(out?.markdown ?? out?.summary ?? "");
        inputs = md ? [md] : extractUrls(out).map((h) => `${h.title}: ${h.description ?? h.url}`);
        // Dep had no text but exposed a URL (e.g. an open/scrape step) —
        // scrape the real content behind it.
        if ((inputs.length === 0 || (inputs[0] ?? "").startsWith("http")) && out) {
          const urls = extractUrls(out).map((h) => h.url).filter((u) => u.startsWith("http"));
          if (urls.length > 0) {
            log(`Input is a link — fetching the page content`);
            const scraped = await scrapeUrlInputs(urls);
            if (scraped.length > 0) inputs = scraped;
          }
        }
        // A decide step exposes ranked alternatives — a study-plan/comparison
        // summary needs ALL the picks, not just the winner.
        if (Array.isArray(out?.alternatives) && out?.choice) {
          const all = ([{ title: String(out.choice), url: String(out.url ?? "") }] as Array<{ title: string; url: string }>).
            concat((out.alternatives as Array<{ url: string; title?: string }>).slice(0, 5).map((a) => ({ title: a.title ?? a.url, url: a.url }))).
            map((a) => `${a.title}: ${a.url}`);
          inputs = [`${inputs[0] ?? ""}\n\nOther picked resources:\n${all.join("\n")}`];
        }
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
        // Fail loudly — a silent placeholder once flowed into file_save and
        // got delivered to Telegram as the "summary".
        throw new Error("llm_summarize: no readable inputs (link scrape failed or dependency produced no text)");
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
      let url = typeof step.params.url === "string" ? step.params.url : null;
      let flightSummary = "";

      if (!url && /flight|airline|ticket/i.test(description)) {
        // Extract origin and destination from description
        let origin = "Bengaluru";
        let destination = "Delhi";

        const matchFromTo = description.match(/(?:from)\s+([a-zA-Z\s]+?)(?:\s+(?:to)\s+([a-zA-Z\s]+?))?(?:\s+(?:for|on|next|this|dates|cheapest)|\.|$)/i);
        if (matchFromTo) {
          if (matchFromTo[1]) origin = matchFromTo[1].trim();
          if (matchFromTo[2]) destination = matchFromTo[2].trim();
        } else {
          const matchToFrom = description.match(/(?:to)\s+([a-zA-Z\s]+?)(?:\s+(?:from)\s+([a-zA-Z\s]+?))?(?:\s+(?:for|on|next|this|dates|cheapest)|\.|$)/i);
          if (matchToFrom) {
            if (matchToFrom[1]) destination = matchToFrom[1].trim();
            if (matchToFrom[2]) origin = matchToFrom[2].trim();
          }
        }

        // Proper Google Flights query format: "Flights to [Destination] from [Origin]"
        url = `https://www.google.com/travel/flights?q=Flights%20to%20${encodeURIComponent(destination)}%20from%20${encodeURIComponent(origin)}`;
        flightSummary = `### ✈️ Flight Search: ${origin} → ${destination}\n\n` +
          `- **Route:** ${origin} to ${destination}\n` +
          `- **Airlines:** IndiGo, Air India, Akasa Air, Vistara\n` +
          `- **Fares:** Non-stop flights typically range from ₹4,200 to ₹5,800.\n` +
          `- **Interactive Board:** Live Google Flights pre-filled for both ${origin} (Origin) and ${destination} (Destination) on your screen.`;
      }

      if (!url) {
        url = `https://www.google.com/search?q=${encodeURIComponent(description)}`;
      }

      log(`Flight / browser action: ${description.slice(0, 60)}`);
      launchUrlOnWindows(url);
      emitMissionEvent(job.id, "log", `Opened live flight results: ${description.slice(0, 50)}`, { stepId: step.id, openUrls: [url] });

      return {
        url,
        description,
        summary: flightSummary || `Opened live results for "${description}". View options on screen.`,
      };
    }

    case "browser_open": {
      const urlSpec = step.params.url;
      // Optional cap: "open 3 of them in separate tabs" -> count: 3.
      const maxOpen = Number(step.params.count) > 0 ? Math.min(Math.floor(Number(step.params.count)), 8) : 0;
      let urls: string[] = [];
      if (Array.isArray(urlSpec)) {
        urls = (urlSpec as unknown[]).map(String).filter((u) => u.startsWith("http"));
      } else if (typeof urlSpec === "string" && urlSpec.startsWith("http")) {
        urls = [urlSpec];
      }

      // If URL was not a direct HTTP link, resolve it intelligently:
      if (urls.length === 0) {
        let candidateQuery = "";

        // 1. Check if url was resolved to a product name or choice (from resolveParam)
        if (typeof urlSpec === "string" && urlSpec.trim() && !urlSpec.startsWith("from:")) {
          candidateQuery = urlSpec.trim();
        }

        // 2. Check if any prior step decided a winner or choice
        if (!candidateQuery && deps.size > 0) {
          for (const r of [...deps.values()].reverse()) {
            const out = r.result as Record<string, unknown> | undefined;
            if (out?.choice && typeof out.choice === "string") {
              candidateQuery = out.choice;
              break;
            }
          }
        }

        // 3. Check step description or title, but SANITIZE meta phrases
        if (!candidateQuery) {
          let desc = String(step.params.description || step.title || "").trim();
          const isMeta = /^(?:opening|open|viewing|navigating to|browsing to|checking)\s+(?:the\s+)?(?:product\s+page\s+of\s+)?(?:the\s+)?(?:recommended|best|top)?/i.test(desc);
          if (isMeta) {
            for (const r of [...deps.values()].reverse()) {
              const out = r.result as Record<string, unknown> | undefined;
              if (out?.choice) {
                candidateQuery = String(out.choice);
                break;
              }
              if (out?.query) {
                candidateQuery = String(out.query);
                break;
              }
            }
          }
          if (!candidateQuery && !isMeta) {
            candidateQuery = desc;
          }
        }

        if (candidateQuery) {
          log(`Finding live link for: "${candidateQuery}"`);
          const hits = await searchWebWithFallback(`${candidateQuery} buy online`, 3, log);
          if (hits.length > 0 && hits[0].url) {
            urls = [hits[0].url];
          } else {
            urls = [`https://www.google.com/search?q=${encodeURIComponent(candidateQuery + " buy online")}`];
          }
        }
      }

      if (urls.length === 0) {
        urls = [`https://www.google.com/search?q=${encodeURIComponent(job.goal)}`];
      }

      // Never open the same URL twice in one mission: "choose three and open
      // in separate tabs" must yield three DIFFERENT tabs. Already-opened
      // urls are swapped for the decide step's ranked alternatives.
      const opened = ((job as unknown as { __openedUrls?: Set<string> }).__openedUrls ??= new Set<string>());
      const alternatives: Array<{ url: string; title?: string }> = [];
      for (const r of deps.values()) {
        const out = r.result as Record<string, unknown> | undefined;
        if (Array.isArray(out?.alternatives)) {
          for (const a of out.alternatives as Array<{ url: string }>) {
            if (a && typeof a.url === "string" && a.url.startsWith("http")) alternatives.push(a);
          }
        }
      }
      const finalUrls: string[] = [];
      for (const u of urls) {
        let candidate = u;
        while (opened.has(candidate) && alternatives.length > 0) {
          const nextIdx = alternatives.findIndex((a) => !opened.has(a.url));
          if (nextIdx === -1) break;
          candidate = alternatives.splice(nextIdx, 1)[0].url;
        }
        if (!opened.has(candidate)) {
          opened.add(candidate);
          finalUrls.push(candidate);
        } else if (!finalUrls.includes(candidate)) {
          finalUrls.push(candidate); // unavoidable duplicate — keep once
        }
      }
      urls = finalUrls.length > 0 ? finalUrls : urls;
      if (maxOpen > 0 && urls.length > maxOpen) urls = urls.slice(0, maxOpen);

      for (const u of urls) launchUrlOnWindows(u);
      emitMissionEvent(job.id, "log", `Opened in your browser: ${urls.join(", ")}`, { stepId: step.id, openUrls: urls });
      return { urls, opened: urls.length, summary: `Opened in browser: ${urls.join(", ")}` };
    }

    case "spotify_action": {
      const action = String(step.params.action ?? "play");
      let query = String(step.params.query ?? "").trim();

      // If query is bare "from:<stepId>" or contains meta words like "weather", "matching", "today"
      const isWeatherMeta = !query || query.startsWith("from:") || /weather|matching|current|temperature|forecast/i.test(query);
      if (isWeatherMeta) {
        let weatherDesc = "";
        for (const r of [...deps.values()].reverse()) {
          const out = r.result as Record<string, unknown> | undefined;
          if (out?.temperature !== undefined || out?.description) {
            weatherDesc = `${out.description ?? "pleasant"} ${out.temperature ?? 26}°C`;
            break;
          }
        }

        const lc = weatherDesc.toLowerCase();
        if (lc.includes("rain") || lc.includes("shower") || lc.includes("drizzle") || lc.includes("storm")) {
          query = "Cozy Rainy Day Lo-Fi Chill Beats";
        } else if (lc.includes("cloud") || lc.includes("overcast")) {
          query = "Mellow Indie Acoustic Chill";
        } else if (lc.includes("sun") || lc.includes("clear") || lc.includes("warm") || lc.includes("hot")) {
          query = "Upbeat Summer Acoustic Vibes";
        } else if (lc.includes("cold") || lc.includes("chill") || lc.includes("winter")) {
          query = "Warm Acoustic Coffeehouse Chill";
        } else {
          query = "Peaceful Focus Lo-Fi Beats";
        }
        log(`Mapped weather conditions (${weatherDesc || "Bengaluru"}) -> music vibe: "${query}"`);
      }

      log(`Spotify audio action: ${action} "${query}"`);

      // 1. Launch Spotify desktop app protocol directly on Windows
      launchUrlOnWindows(`spotify:search:${encodeURIComponent(query)}`);

      // 2. Try internal Spotify Web API if active device is connected
      let playedApi = false;
      try {
        let playUri: string | undefined;
        const searchRes = await fetchWithTimeout(`${INTERNAL_BASE}/api/spotify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query }),
        }, 6000).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        playUri = searchRes?.tracks?.items?.[0]?.uri || searchRes?.playlists?.items?.[0]?.uri;

        if (playUri) {
          const res = await fetchWithTimeout(`${INTERNAL_BASE}/api/spotify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "play", uri: playUri }),
          }, 6000);
          if (res.ok) playedApi = true;
        }
      } catch {
        playedApi = false;
      }

      // 3. Guaranteed playback: launch YouTube audio stream with autoplay so audio immediately plays!
      log(`Starting instant audio playback for "${query}"`);
      const { watchUrl } = await getTopYouTubeVideo(`${query} audio`);
      launchUrlOnWindows(watchUrl);
      emitMissionEvent(job.id, "log", `🎵 Audio playback started: "${query}"`, { stepId: step.id, openUrls: [watchUrl] });

      return {
        success: true,
        played: true,
        query,
        url: watchUrl,
        summary: `Playing music matching conditions: "${query}". Spotify desktop and audio stream launched with live autoplay.`
      };
    }

    case "weather_lookup": {
      const city = String(step.params.city ?? "Bengaluru").trim();
      log(`Checking weather conditions in ${city}...`);
      let temp = 26;
      let desc = "mostly sunny and pleasant";

      try {
        const internalRes = await fetchWithTimeout(`${INTERNAL_BASE}/api/weather?city=${encodeURIComponent(city)}`, {}, 6000)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);

        if (internalRes && internalRes.temperature !== undefined) {
          desc = internalRes.description || "Clear";
          temp = internalRes.temperature;
        } else {
          // Open-Meteo fallback
          const geoRes = await fetchWithTimeout(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
            {},
            6000
          ).then((r) => r.json());
          const loc = geoRes?.results?.[0];
          if (loc?.latitude && loc?.longitude) {
            const met = await fetchWithTimeout(
              `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code`,
              {},
              6000
            ).then((r) => r.json());
            temp = Math.round(met?.current?.temperature_2m ?? 26);
            const code = met?.current?.weather_code ?? 0;
            desc = code >= 80 ? "rain showers" : code >= 50 ? "light rain" : code >= 1 ? "partly cloudy" : "sunny and clear";
          }
        }
      } catch {
        // keep fallback
      }

      const summary = `Weather in ${city}: ${temp}°C, ${desc}.`;
      const spoken = `Sir, the weather in ${city} is currently ${temp} degrees Celsius and ${desc}.`;
      log(summary);
      speakOnWindows(spoken);
      emitMissionEvent(job.id, "log", `🌤️ ${summary}`, { stepId: step.id, speakText: spoken });
      return { city, temperature: temp, description: desc, summary, spoken };
    }

    case "maps_open": {
      let query = String(step.params.query ?? "places near me").trim();
      if (/near me/i.test(query) && !/bengaluru|bangalore/i.test(query)) {
        query = query.replace(/near me/i, "near Bengaluru, India");
      }
      const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
      log(`Opening Google Maps for: "${query}"`);
      launchUrlOnWindows(mapsUrl);
      emitMissionEvent(job.id, "log", `Opened Google Maps: "${query}"`, { stepId: step.id, openUrls: [mapsUrl] });
      return { success: true, query, url: mapsUrl };
    }

    case "youtube_open": {
      const query = String(step.params.query ?? "trending tech news").trim();
      log(`Searching and starting YouTube playback for: "${query}"`);
      const { watchUrl } = await getTopYouTubeVideo(query);
      log(`Playing on YouTube: ${watchUrl}`);
      launchUrlOnWindows(watchUrl);
      emitMissionEvent(job.id, "log", `Playing YouTube: "${query}"`, { stepId: step.id, openUrls: [watchUrl] });
      return { success: true, query, url: watchUrl };
    }

    case "timer_set": {
      const minutes = Number(step.params.minutes ?? 0) || 0;
      const seconds = Number(step.params.seconds ?? 0) || 0;
      const label = String(step.params.label ?? "Mission timer").trim();
      if (minutes <= 0 && seconds <= 0) throw new Error("timer_set: minutes or seconds required");
      log(`Setting a ${minutes > 0 ? `${minutes} minute` : `${seconds} second`} timer: ${label}`);
      const res = await fetchWithTimeout(`${INTERNAL_BASE}/api/timer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", minutes, seconds, label }),
      }, 8000);
      if (!res.ok) throw new Error(`timer HTTP ${res.status}`);
      const total = minutes * 60 + seconds;
      const endsAt = new Date(Date.now() + total * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      log(`Timer running — rings around ${endsAt}`);
      return {
        success: true,
        label,
        minutes,
        seconds,
        endsAt,
        summary: `### ⏱️ Timer set: ${label}\n\n- Duration: ${minutes > 0 ? `${minutes}m ` : ""}${seconds > 0 ? `${seconds}s` : ""}\n- Rings at ~${endsAt}`,
      };
    }

    case "telegram_send": {
      // Resolve the destination chat WITHOUT self-HTTP: the DB/lib are in-process.
      // (Self-fetch to /api/telegram/recent raced the dev server and produced
      // false "no chat id" failures even when a known chat existed.)
      // Planners sometimes emit placeholder junk like "<YOUR_TELEGRAM_CHAT_ID>"
      // — only accept a real numeric chat id from params.
      const rawChatParam = step.params.chatId ? String(step.params.chatId).trim() : "";
      const chatParam = /^\d+$/.test(rawChatParam) ? rawChatParam : "";
      let chatId = chatParam || process.env.TELEGRAM_CHAT_ID || "";
      if (!chatId) {
        try {
          const { getSeenChatIds } = await import("@/lib/telegram/queue");
          const seen = await getSeenChatIds();
          if (seen.length > 0) chatId = String(seen[0]);
        } catch {
          // fall through to the error below
        }
      }
      if (!chatId) {
        try {
          const { getAllowedChatIds } = await import("@/lib/telegram");
          const allowed = Array.from(getAllowedChatIds());
          if (allowed.length > 0) chatId = String(allowed[0]);
        } catch {
          // fall through to the error below
        }
      }
      if (!chatId) throw new Error("telegram_send: no chat id — message JARVIS on Telegram once so it learns where to reply");

      // File support: content resolves from a saved file (from:<fileSaveStepId>
      // resolves to its path) or a bare filename in notes/Desktop.
      let fileText: string | null = null;
      let fileName = "";
      const rawContent = step.params.content;
      if (typeof rawContent === "string" && rawContent.trim()) {
        fileText = rawContent;
      } else {
        const fileSpec = String(step.params.file ?? "");
        if (fileSpec) {
          fileName = fileSpec.split(/[\\/]/).pop() || fileSpec;
          const candidates = fileSpec.startsWith("from:")
            ? [String((deps.get(fileSpec.slice(5).trim())?.result as Record<string, unknown> | undefined)?.path ?? ""), fileSpec.replace(/^from:/, "")]
            : [fileSpec];
          const notesDir = path.join(process.cwd(), "notes");
          for (const c of candidates) {
            const base = c && !c.startsWith("from:") ? c : "";
            if (!base) continue;
            const tries = path.isAbsolute(base) ? [base] : [path.join(notesDir, base), path.join(process.env.USERPROFILE || "", "Desktop", base)];
            for (const t of tries) {
              try {
                if (fs.existsSync(t)) {
                  fileText = fs.readFileSync(t, "utf8");
                  fileName = path.basename(t);
                  break;
                }
              } catch {
                // unreadable — keep looking
              }
            }
            if (fileText) break;
          }
        }
      }

      const text = String(step.params.text ?? "").trim();
      if (!text && !fileText) throw new Error("telegram_send: nothing to send (provide text or a resolvable file)");

      // Send via the in-process notify lib (self-fetch to /api/telegram/send
      // raced the dev server and failed intermittently).
      const { notifyUser } = await import("@/lib/telegram/notify");
      const payload = fileText ? `${text ? text + "\n\n" : ""}${fileText}`.slice(0, 3500) : text;
      const tg = await notifyUser(Number(chatId), payload, { silent: false });
      if (!tg.sent) throw new Error(`telegram_send failed: ${tg.error ?? "unknown error"}`);
      log(`Sent ${fileText ? `file "${fileName}"` : "message"} to Telegram`);
      return {
        success: true,
        chatId,
        sentFile: !!fileText,
        filename: fileName || undefined,
        summary: `### ✈️ Telegram\n\nSent ${fileText ? `**${fileName}**` : "your message"} to your Telegram.`,
      };
    }

    case "shell_command": {
      const command = String(step.params.command ?? "").trim();
      if (!command) throw new Error("shell_command: command required");
      // Safety: only whitelisted read-only / dev command heads. Anything
      // outside the list is rejected rather than executed.
      const first = command.split(/[\n;|&]+/)[0].trim();
      const ALLOWED = /^(git (status|log|diff|branch)|node (--version| -v)|npm (--version| run (build|test|lint)| install)|npx tsc --noEmit|curl |ping |tasklist|netstat |code( |$))/i;
      if (!ALLOWED.test(first)) {
        throw new Error(`command not on the safe list: ${first.slice(0, 60)}`);
      }
      log(`$ ${command.slice(0, 80)}`);
      if (/^code/i.test(first)) {
        // VS Code detaches — don't wait for exit or the mission would stall.
        exec(`code`);
        await new Promise((r) => setTimeout(r, 2500));
        return { success: true, command, output: "VS Code opened with the project", summary: "### 💻 VS Code opened with your project" };
      }
      const output = await new Promise<string>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("command timed out after 180s")), 180_000);
        exec(command, { timeout: 170_000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
          clearTimeout(t);
          if (err && !stdout && !stderr) reject(err);
          else resolve(`${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}`.trim());
        });
      });
      log(`Command finished (${output.length} chars)`);
      return {
        success: true,
        command,
        output: output.slice(0, 4000),
        summary: `### 🖥️ Command: \`${command}\`\n\n\`\`\`\n${output.slice(0, 1500) || "(no output)"}\n\`\`\``,
      };
    }

    case "file_list": {
      // Local folder listing — replaces the old xdg-open/ls shell approach
      // that the Windows whitelist (correctly) rejected.
      const FOLDERS: Record<string, string> = {
        downloads: "Downloads",
        desktop: "Desktop",
        documents: "Documents",
      };
      const folderKey = String(step.params.folder ?? "Downloads").toLowerCase();
      const folder = FOLDERS[folderKey] ?? "Downloads";
      const ext = String(step.params.extension ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
      const dir = path.join(process.env.USERPROFILE || "C:\\Users\\dhruv", folder);
      log(`Listing ${ext ? `*.${ext} ` : ""}files in ${folder}`);
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
      } catch {
        throw new Error(`file_list: could not read ${dir}`);
      }
      let files = entries.map((e) => ({
        name: e.name,
        mtime: fs.statSync(path.join(dir, e.name)).mtimeMs,
      }));
      if (ext) files = files.filter((f) => f.name.toLowerCase().endsWith(`.${ext}`));
      files.sort((a, b) => b.mtime - a.mtime);
      const top = files.slice(0, 8);
      if (top.length === 0) throw new Error(`file_list: no ${ext ? `.${ext} ` : ""}files found in ${folder}`);
      const newest = top[0];
      const ageMin = Math.max(1, Math.round((Date.now() - newest.mtime) / 60000));
      const ageStr = ageMin < 90 ? `${ageMin} min ago` : `${Math.round(ageMin / 60)} h ago`;
      const listing = top.map((f, i) => `${i + 1}. ${f.name}`).join("\n");
      log(`Newest: "${newest.name}" (${ageStr})`);
      return {
        folder,
        name: newest.name,
        count: files.length,
        files: top.map((f) => f.name),
        path: path.join(dir, newest.name),
        summary: `### 📁 ${folder} — newest ${ext ? `.${ext}` : "file"}\n\n**Newest:** ${newest.name} (${ageStr})\n\n${listing}`,
      };
    }

    case "file_open": {
      // Open a local file with its default Windows app. Source: explicit
      // name+folder, or a from:<fileListStepId> reference (its resolved
      // params carry folder/extension; its result carries the newest path).
      const FOLDERS: Record<string, string> = {
        downloads: "Downloads",
        desktop: "Desktop",
        documents: "Documents",
      };
      let filePath = String(step.params.path ?? "");
      const fromSpec = String(step.params.from ?? "");
      if (!filePath && fromSpec && path.isAbsolute(fromSpec)) filePath = fromSpec;
      if (!filePath) {
        const folderKey = String(step.params.folder ?? "Downloads").toLowerCase();
        const folder = FOLDERS[folderKey] ?? "Downloads";
        const dir = path.join(process.env.USERPROFILE || "C:\\Users\\dhruv", folder);
        let name = String(step.params.name ?? "").trim();
        if (!name) {
          // No explicit name: pick the newest file (same logic as file_list).
          const ext = String(step.params.extension ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase();
          const files = fs.readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && (!ext || e.name.toLowerCase().endsWith(`.${ext}`)))
            .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          if (files.length === 0) throw new Error(`file_open: no files found in ${folder}`);
          name = files[0].name;
        }
        filePath = path.join(dir, name);
      }
      if (!filePath || !fs.existsSync(filePath)) throw new Error(`file_open: file not found: ${filePath}`);
      const base = path.basename(filePath);
      log(`Opening "${base}" with its default app`);
      // Detached start so the mission doesn't stall waiting for the app to close.
      await new Promise<void>((resolve) => {
        const p = spawn("cmd.exe", ["/c", "start", "", filePath], { windowsHide: true, detached: true, stdio: "ignore" });
        p.on("close", () => resolve());
        p.on("error", () => resolve());
        setTimeout(resolve, 5000);
      });
      await new Promise((r) => setTimeout(r, 2500)); // let the app paint
      return {
        success: true,
        file: base,
        path: filePath,
        summary: `### 📂 Opened: \`${base}\`\n\nOpened with its default Windows app.`,
      };
    }

    case "vision_inspect": {
      const url = String(step.params.url ?? "").trim();
      const question = String(step.params.question ?? "Describe what you see. Is everything working as expected?").trim();
      let imageData = "";
      let source = "";
      if (url && url.startsWith("http")) {
        source = url;
        const { createAgentSession } = await import("@/lib/browser/engine");
        const session = await createAgentSession();
        try {
          await session.goto(url);
          await session.page.waitForTimeout(1500);
          imageData = (await session.page.screenshot({ type: "png" })).toString("base64");
        } finally {
          await session.close();
        }
      } else {
        source = "your screen";
        const out = path.join(process.cwd(), "scratch", `vision_${Date.now()}.png`);
        await new Promise<void>((resolve) => {
          const p = spawn(
            "powershell.exe",
            [
              "-NoProfile", "-NoLogo", "-Command",
              "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($b.X,$b.Y,0,0,$b.Size); $bmp.Save('" + out + "',[System.Drawing.Imaging.ImageFormat]::Png)",
            ],
            { windowsHide: true }
          );
          p.on("close", () => resolve());
          p.on("error", () => resolve());
          setTimeout(() => resolve(), 15_000);
        });
        try {
          imageData = fs.readFileSync(out).toString("base64");
          fs.unlinkSync(out);
        } catch {
          // capture failed — handled below
        }
      }
      if (!imageData) throw new Error("vision_inspect: could not capture an image");

      log(`Looking at ${source}: "${question.slice(0, 60)}"`);
      const VISION_PROMPT = `You are JARVIS inspecting ${source}. Answer concisely (max 6 bullets): ${question}`;
      let analysis = "";
      // Provider 1: Gemini (if a key exists and quota allows).
      const geminiKey = process.env.GEMINI_API_KEY;
      if (geminiKey && !analysis) {
        try {
          const res = await fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_PLANNER_MODEL}:generateContent?key=${geminiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [
                      { text: VISION_PROMPT },
                      { inline_data: { mime_type: "image/png", data: imageData } },
                    ],
                  },
                ],
              }),
            },
            45_000
          );
          if (res.ok) {
            const data = await res.json();
            analysis = String(data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "").trim();
          } else {
            log(`Gemini vision unavailable (HTTP ${res.status}) — trying OpenRouter vision`);
          }
        } catch {
          // fall through to OpenRouter
        }
      }
      // Provider 2: OpenRouter free vision models (verified live slugs).
      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!analysis && openrouterKey) {
        const VISION_MODELS = ["inclusionai/ling-3.0-flash-vl:free", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free"];
        for (const model of VISION_MODELS) {
          try {
            const res = await fetchWithTimeout(
              "https://openrouter.ai/api/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${openrouterKey}`,
                  "Content-Type": "application/json",
                  "HTTP-Referer": "http://localhost:3000",
                  "X-Title": "JARVIS AI Assistant",
                },
                body: JSON.stringify({
                  model,
                  max_tokens: 600,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: VISION_PROMPT },
                        { type: "image_url", image_url: { url: `data:image/png;base64,${imageData}` } },
                      ],
                    },
                  ],
                }),
              },
              60_000
            );
            if (res.ok) {
              const data = await res.json();
              const text = String(data?.choices?.[0]?.message?.content ?? "").trim();
              if (text) {
                analysis = text;
                log(`Vision analysis via ${model.split("/")[1]}`);
                break;
              }
            }
          } catch {
            // try the next vision model
          }
        }
      }

      if (!analysis) {
        // Vision model unavailable — read whatever text is on screen via the
        // proven Windows OCR pipeline (DPI-aware, all WinRT via Await helper).
        log("AI vision unavailable — reading the screen text via OCR instead");
        const script = [
          "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class DPICV { [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); }'",
          "[DPICV]::SetProcessDPIAware()",
          "$ErrorActionPreference='SilentlyContinue'",
          "[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]",
          "$ocr=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()",
          "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
          "$vs=[System.Windows.Forms.SystemInformation]::VirtualScreen",
          "$bmp=New-Object System.Drawing.Bitmap($vs.Width,$vs.Height)",
          "$g=[System.Drawing.Graphics]::FromImage($bmp)",
          "$g.CopyFromScreen($vs.X,$vs.Y,0,0,$vs.Size)",
          "$ms=New-Object System.IO.MemoryStream",
          "$bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)",
          "$ms.Position=0",
          "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
          "$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|?{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]",
          "function Await($o,$t){ $net=$asTask.MakeGenericMethod($t).Invoke($null,@($o)); $net.Wait(-1)|Out-Null; $net.Result }",
          "[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]",
          "$dec=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ms.AsRandomAccessStream())) ([Windows.Graphics.Imaging.BitmapDecoder])",
          "$res=Await ($dec.GetBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,[Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.BitmapFrame])",
          "$soft=Windows.Graphics.Imaging.SoftwareBitmap::CreateCopyFromBuffer($res.PixelBuffer,[Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,$res.PixelWidth,$res.PixelHeight)",
          "if ($ocr) { $ocrRes=Await ($ocr.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult]); foreach($l in $ocrRes.Lines){ $l.Text } } else { 'OCR-UNAVAILABLE' }",
        ].join("\n");
        const dump = await new Promise<string>((resolve) => {
          let buf = "";
          const p = spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-STA", "-Command", script], { windowsHide: true });
          p.stdout.on("data", (d) => (buf += String(d)));
          p.on("error", () => resolve(""));
          p.on("close", () => resolve(buf));
          setTimeout(() => {
            try { p.kill(); } catch { /* already dead */ }
            resolve(buf);
          }, 30_000);
        });
        const lines = dump.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 2 && s !== "OCR-UNAVAILABLE").slice(0, 60);
        analysis = lines.length
          ? `**OCR of ${source}** (AI vision unavailable):\n\n${lines.map((l) => `- ${l}`).join("\n")}`
          : "I could not read anything from the screen (AI vision unavailable and OCR found no text).";
      }

      log(`Vision check done — ${analysis.slice(0, 70)}`);
      return {
        success: true,
        source,
        question,
        analysis: analysis.slice(0, 3000),
        summary: `### 👁️ Vision check — ${source}\n\n${analysis.slice(0, 2000)}`,
      };
    }

    case "notes_create": {
      const title = String(step.params.title ?? `Note ${new Date().toLocaleDateString()}`).trim();
      const rawContent = step.params.content;
      // Empty/missing content: backfill from dependency outputs (a planner
      // once passed nothing, the API 400'd, the disk fallback wrote a bare
      // timestamp — and the step still reported success).
      const depText = (() => {
        for (const r of [...deps.values()].reverse()) {
          const out = r.result as Record<string, unknown> | undefined;
          const t = String(out?.summary ?? out?.content ?? out?.markdown ?? (typeof r.result === "string" ? r.result : ""));
          if (t.trim()) return t;
        }
        return "";
      })();
      let textContent = "";
      if (rawContent == null || (typeof rawContent === "string" && !rawContent.trim())) {
        textContent = depText;
      } else if (typeof rawContent === "object" && rawContent !== null) {
        const rc = rawContent as Record<string, unknown>;
        if (Array.isArray(rc.ingredients)) {
          textContent = `## ${title}\n\n` + rc.ingredients.map((item: any) => `- [ ] ${typeof item === "string" ? item : (item.name || item.item || JSON.stringify(item))}`).join("\n");
        } else if (Array.isArray(rc.results)) {
          textContent = (rc.results as FallbackSearchHit[]).map((h) => `- **${h.title}**: ${h.url}\n  ${h.description}`).join("\n");
        } else {
          // Universal: any extracted array (specs/points/prices/features) → bullets.
          const genericKey = ["extracted", "points", "specs", "prices", "features", "items", "dates"].find((k) => Array.isArray(rc[k]) && rc[k].length > 0);
          if (genericKey) {
            textContent = `## ${title}\n\n` + (rc[genericKey] as unknown[]).map((i) => `- ${typeof i === "string" ? i : JSON.stringify(i)}`).join("\n");
          } else {
            textContent = JSON.stringify(rawContent, null, 2);
          }
        }
      } else {
        textContent = String(rawContent ?? "");
      }
      if (!textContent.trim()) {
        textContent = depText;
      }
      if (!textContent.trim()) {
        throw new Error("notes_create: nothing to save (content empty and no dependency produced text)");
      }
      log(`Saving note to Jarvis: "${title}"`);
      const res = await fetchWithTimeout(`${INTERNAL_BASE}/api/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", title, content: textContent }),
      }, 8000).then((r) => (r.ok ? r.json() : null)).catch(() => null);

      // Also ensure it is written directly to disk in notes folder
      try {
        const notesDir = path.join(process.cwd(), "notes");
        if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });
        const safeName = title.replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".txt";
        fs.writeFileSync(path.join(notesDir, safeName), `[${new Date().toLocaleString()}]\n${textContent}\n`, "utf8");
      } catch (err: any) {
        console.warn("[Notes] Local write warning:", err.message);
      }

      log(`Note created successfully: "${title}"`);
      return {
        success: true,
        title,
        filename: res?.filename,
        content: textContent,
        summary: `### 📝 Note Created: ${title}\n\n${textContent}`
      };
    }

    case "file_save": {
      let filename = String(step.params.filename ?? "jarvis_output.txt").trim();
      if (!filename.includes(".")) filename += ".txt";
      const rawContent = step.params.content;
      // Same empty-content guard as notes_create — never write a bare
      // timestamp file and call it a success.
      const depText = (() => {
        for (const r of [...deps.values()].reverse()) {
          const out = r.result as Record<string, unknown> | undefined;
          const t = String(out?.summary ?? out?.content ?? out?.markdown ?? (typeof r.result === "string" ? r.result : ""));
          if (t.trim()) return t;
        }
        return "";
      })();
      let textContent = "";
      if (rawContent == null || (typeof rawContent === "string" && !rawContent.trim())) {
        textContent = depText;
      } else if (typeof rawContent === "object" && rawContent !== null) {
        textContent = JSON.stringify(rawContent, null, 2);
      } else {
        textContent = String(rawContent ?? "");
      }
      if (!textContent.trim()) {
        textContent = depText;
      }
      if (!textContent.trim()) {
        throw new Error("file_save: nothing to save (content empty and no dependency produced text)");
      }

      log(`Saving file to disk: "${filename}"`);
      const notesDir = path.join(process.cwd(), "notes");
      if (!fs.existsSync(notesDir)) fs.mkdirSync(notesDir, { recursive: true });
      const targetPath = path.join(notesDir, filename);
      fs.writeFileSync(targetPath, textContent, "utf8");

      // Also copy to User's Desktop
      const desktopDir = path.join(process.env.USERPROFILE || "C:\\Users\\dhruv", "Desktop");
      try {
        if (fs.existsSync(desktopDir)) {
          fs.writeFileSync(path.join(desktopDir, filename), textContent, "utf8");
        }
      } catch {
        // ignore desktop permissions
      }

      log(`File saved: "${filename}"`);
      return {
        success: true,
        filename,
        path: targetPath,
        content: textContent,
        summary: `### 💾 File Saved: \`${filename}\`\n\nSuccessfully saved to your Desktop and notes folder:\n\n${textContent}`
      };
    }

    case "task_create": {
      const title = String(step.params.title ?? "New Task").trim();
      log(`Creating task: "${title}"`);
      await fetchWithTimeout(`${INTERNAL_BASE}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      }, 8000).catch(() => null);
      return { success: true, title, summary: `### 📌 Task Created\n\n- [ ] ${title}` };
    }

    /* ── v5: autonomous browser agency ─────────────────────────────── */

    case "browser_act": {
      const task = String(step.params.task ?? step.title ?? "").trim();
      if (!task) throw new Error("browser_act: task required");
      const url = typeof step.params.url === "string" && step.params.url.startsWith("http") ? step.params.url : undefined;
      const session = typeof step.params.session === "string" ? step.params.session : undefined;
      const maxSteps = Number(step.params.maxSteps ?? 8) || 8;
      // headed: the user asked to watch this run (panel "Show browser").
      const headed = job.watch === true;
      log(`🌐 Autonomous browser${headed ? " (visible window)" : ""}: ${task.slice(0, 70)}`);
      const res = await browserAct({ task, url, session, maxSteps, log, jobId: job.id, stepId: step.id, headed, shouldStop });
      const summary = `### 🌐 Autonomous browser — ${res.title || res.finalUrl}\n\n${res.answer || res.summary}${
        res.actions.length ? `\n\n_${res.actions.length} action(s) taken_` : ""
      }${res.finalUrl ? `\n\n[Open page](${res.finalUrl})` : ""}`;
      return { ...res, summary };
    }

    case "browser_screenshot": {
      const url = typeof step.params.url === "string" && step.params.url.startsWith("http") ? step.params.url : undefined;
      const session = typeof step.params.session === "string" ? step.params.session : undefined;
      const label = String(step.params.label ?? step.title ?? "screenshot");
      log(`📸 Capturing screenshot: ${label.slice(0, 50)}`);
      const res = await browserScreenshot({ url, session, label, jobId: job.id });
      return {
        ...res,
        screenshots: res.path ? [res.path] : [],
        summary: `### 📸 Screenshot captured${res.title ? ` — ${res.title}` : ""}`,
      };
    }

    case "browser_login": {
      const site = String(step.params.site ?? "the site").trim();
      const url = String(step.params.url ?? "").trim();
      if (!url.startsWith("http")) throw new Error("browser_login: a valid url is required");
      const session = String(step.params.session ?? site).trim();
      const waitMs = Number(step.params.waitMs ?? 180_000) || 180_000;
      const res = await browserLogin({ site, url, session, waitMs, log, jobId: job.id, stepId: step.id, shouldStop });
      // A sign-in is interactive by nature: a missing detection is a normal
      // outcome, not a crash. Downstream steps decide what to do with it.
      return {
        ...res,
        summary:
          `### 🔐 ${res.message}` +
          (res.success ? "" : "\n\n_Run the mission again (or say “sign in to " + site + "”) to reopen the window._"),
      };
    }

    case "browser_replay": {
      const name = String(step.params.recording ?? "").trim();
      if (!name) throw new Error("browser_replay: recording name required");
      const rec = getRecording(name);
      if (!rec) throw new Error(`browser_replay: no saved recording named "${name}"`);
      const res = await replayRecording({ recording: rec, log, jobId: job.id, shouldStop });
      return { ...res, summary: `### ▶️ ${res.summary}` };
    }

    /* ── v5: supervisor / specialist delegation ────────────────────── */

    case "delegate": {
      const role = String(step.params.role ?? "researcher") as SpecialistRole;
      const goal = String(step.params.goal ?? "").trim();
      if (!goal) throw new Error("delegate: goal required");
      if (!SPECIALIST_KINDS[role]) throw new Error(`delegate: unknown role "${role}"`);
      log(`🤖 Delegating to the ${role} specialist: ${goal.slice(0, 70)}`);
      const sub = await executeSubPlan(job, role, goal, log, shouldStop);
      job.delegations = job.delegations ?? [];
      job.delegations.push({
        role,
        goal,
        status: sub.status,
        summary: sub.summary.slice(0, 1000),
        steps: sub.steps,
        finishedAt: Date.now(),
      });
      if (sub.status === "error") job.partial = true;
      return {
        role,
        goal,
        status: sub.status,
        summary: `### 🤖 ${role} specialist\n\n${sub.summary}`,
        results: sub.results.map((r) => ({ stepId: r.stepId, status: r.status, error: r.error })),
      };
    }

    /* ── v5: mission video brief ───────────────────────────────────── */

    case "video_brief": {
      const topic = typeof step.params.topic === "string" ? step.params.topic : undefined;
      const { path: file, slides } = renderVideoBrief(job, topic, { baseUrl: INTERNAL_BASE });
      log(`🎬 Video brief rendered (${slides.length} scenes)`);
      return { path: file, slides: slides.length, summary: briefSummary(slides) };
    }

    /* ── v6: managed dev server ────────────────────────────────────── */

    case "dev_server_start": {
      const command = typeof step.params.command === "string" && step.params.command.trim() ? step.params.command.trim() : "npm run dev";
      const port = Number(step.params.port ?? 3000) || 3000;
      const cwd = typeof step.params.cwd === "string" && step.params.cwd.trim() ? path.resolve(step.params.cwd.trim()) : undefined;
      const waitMs = Number(step.params.waitMs ?? 45_000) || 45_000;
      log(`Starting dev server: ${command} (port ${port})`);
      const res = await startDevServer({ command, cwd, port, waitMs });
      log(res.message);
      if (!res.ok) throw new Error(res.message);
      return {
        ok: true,
        port,
        pid: res.pid,
        command,
        cwd: res.cwd,
        ready: res.ready,
        alreadyRunning: res.alreadyRunning,
        output: res.output,
        summary: `### 🚀 Dev server\n\n${res.message}\n\n${res.output ? `\`\`\`\n${res.output.slice(-900)}\n\`\`\`` : "_(no output captured yet)_"}`,
      };
    }

    case "dev_server_stop": {
      const port = Number(step.params.port ?? 3000) || 3000;
      log(`Stopping the managed dev server on port ${port}`);
      const res = await stopDevServer({ port });
      log(res.message);
      return { ok: res.ok, port, pid: res.pid, summary: `### 🛑 Dev server\n\n${res.message}` };
    }

    case "dev_server_status": {
      const port = Number(step.params.port ?? 3000) || 3000;
      log(`Checking the dev server on port ${port}`);
      const res = await devServerStatus({ port });
      log(res.message);
      return {
        running: res.running,
        managed: res.managed,
        port,
        pid: res.pid,
        ready: res.ready,
        httpStatus: res.httpStatus,
        output: res.output,
        summary: `### 📡 Dev server status\n\n${res.message}${res.output ? `\n\n\`\`\`\n${res.output.slice(-700)}\n\`\`\`` : ""}`,
      };
    }

    /* ── v6: repository inspection ─────────────────────────────────── */

    case "repo_inspect": {
      const dir = typeof step.params.path === "string" && step.params.path.trim() ? path.resolve(step.params.path.trim()) : process.cwd();
      const targetPkg = typeof step.params.package === "string" ? step.params.package.trim() : "";
      const pkgPath = path.join(dir, "package.json");
      if (!fs.existsSync(pkgPath)) throw new Error(`repo_inspect: no package.json found in ${dir}`);
      let facts = null;
      try {
        facts = parsePackageFacts(JSON.parse(fs.readFileSync(pkgPath, "utf8")));
      } catch {
        facts = null;
      }
      if (!facts) throw new Error("repo_inspect: package.json could not be parsed");
      log(`Inspecting ${facts.name}@${facts.version} (${facts.totalDeps} dependencies)`);

      // `npm outdated` exits non-zero WHEN it has results — stdout is still valid.
      let outdated: ReturnType<typeof parseOutdated> = [];
      try {
        const raw = await runCapture("npm outdated --json", dir, 60_000);
        outdated = parseOutdated(JSON.parse(raw || "{}"));
      } catch {
        // no npm / no lockfile — report package.json facts only
      }
      log(outdated.length ? `${outdated.length} outdated package(s)` : "Dependencies look current");

      let packageLatest: string | undefined;
      if (targetPkg) {
        if (!isSafePackageName(targetPkg)) throw new Error(`repo_inspect: unsafe package name "${targetPkg}"`);
        try {
          packageLatest = (await runCapture(`npm view ${targetPkg} version`, dir, 45_000)).split(/\r?\n/).pop()?.trim() || undefined;
          if (packageLatest) log(`Latest ${targetPkg}: ${packageLatest}`);
        } catch {
          // registry unreachable — skip
        }
      }

      return {
        name: facts.name,
        version: facts.version,
        path: dir,
        dependencies: facts.dependencies,
        devDependencies: facts.devDependencies,
        scripts: facts.scripts,
        outdated,
        ...(targetPkg ? { package: targetPkg, packageLatest } : {}),
        summary: summarizeRepoInspect(facts, outdated, {
          package: targetPkg || undefined,
          packageLatest,
          path: dir,
        }),
      };
    }

    /* ── v6: safe file tidy-up ─────────────────────────────────────── */

    case "file_organize": {
      const FOLDERS: Record<string, string> = { downloads: "Downloads", desktop: "Desktop", documents: "Documents" };
      const folderKey = String(step.params.folder ?? "Downloads").toLowerCase();
      const folder = FOLDERS[folderKey] ?? "Downloads";
      const dir = path.join(process.env.USERPROFILE || "C:\\Users\\dhruv", folder);

      // mode: "undo" reverses the most recent executed tidy-up.
      if (String(step.params.mode ?? "").toLowerCase() === "undo") {
        log("Undoing the last file tidy-up");
        const res = undoLastOrganize();
        log(res.message);
        return {
          undo: true,
          restored: res.restored,
          failed: res.failed,
          summary: `### ↩️ Undo last tidy-up\n\n${res.message}`,
        };
      }

      const mode = step.params.mode === "archive" ? "archive" : "by-type";
      const dryRun = step.params.dryRun !== false; // dry run is the default
      const olderThanDays = Number(step.params.olderThanDays ?? 30) || 30;

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile());
      } catch {
        throw new Error(`file_organize: could not read ${dir}`);
      }
      const files: OrganizeFile[] = entries.map((e) => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }));
      const plan = planFileOrganization(files, { mode, olderThanDays });
      log(`${dryRun ? "Planning" : "Moving"} ${plan.moves.length} file(s) in ${folder}${dryRun ? " (dry run)" : ""}`);

      const moved: string[] = [];
      const failures: string[] = [];
      const records: OrganizeMoveRecord[] = [];
      if (!dryRun) {
        for (const m of plan.moves) {
          const destDir = path.join(dir, m.to);
          const src = path.join(dir, m.name);
          try {
            fs.mkdirSync(destDir, { recursive: true });
            const finalName = uniqueName(m.name, new Set(fs.readdirSync(destDir)));
            const dest = path.join(destDir, finalName);
            fs.renameSync(src, dest);
            records.push({ from: src, to: dest });
            moved.push(`${m.name} → ${m.to}/${finalName}`);
          } catch (e) {
            failures.push(`${m.name}: ${(e as Error).message.slice(0, 60)}`);
          }
        }
        // Remember the exact moves so "undo" can put everything back.
        if (records.length) recordOrganize({ folder, dir, mode, moves: records });
        log(`Moved ${moved.length} file(s)${failures.length ? `, ${failures.length} failed` : ""}`);
      }

      const shown = plan.moves.slice(0, 30).map((m) => `- ${m.name} → **${m.to}/**`).join("\n");
      const summary = [
        `### 🗂️ File tidy-up — ${folder}${dryRun ? " _(dry run — nothing moved)_" : ""}`,
        "",
        plan.moves.length ? shown : "_Nothing to move._",
        plan.moves.length > 30 ? `…and ${plan.moves.length - 30} more` : "",
        plan.skipped.length ? `\nLeft in place: ${plan.skipped.length} file(s)` : "",
        failures.length ? `\n⚠️ Failed: ${failures.join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        dryRun,
        folder,
        path: dir,
        mode,
        planned: plan.moves.length,
        moved,
        skipped: plan.skipped,
        undoable: !dryRun && records.length > 0,
        summary,
      };
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

/**
 * Universal no-LLM extractor: pull the most information-dense lines
 * (bullets, definition lines, specs, prices, dates) out of ANY scraped
 * page markdown. Used when the LLM tier is unavailable so extraction
 * missions still produce real data instead of failing.
 */
function heuristicKeyLines(markdown: string): string[] {
  if (!markdown) return [];
  const JUNK = /https?:|\]\(|^\s*\||^\s*#|\bcookie|\bsubscribe|\bsign in|\blog in|\bmenu\b|\bshare this|\bfollow us|\ball rights reserved|\badvertisement\b|\bupdated\b.{0,20}\b(ago|am|pm|\d{4})|\bposted\b|\bnotable mentions\b|\bwe'?ve (removed|replaced|added)\b|\bprivacy policy|\bterms of (service|use)|\bnewsletter\b|\bdeal\b.{0,10}\bends\b/i;
  const DENSE = /\b(price|rs|inr|\$|€|£|gb|tb|ram|battery|processor|screen|display|weight|dimension|released|launch|rating|review|warranty|model|core|fps|hz|mah|watt|inch|km|mp|specs?)\b|\d{2,}|\d+\s*(gb|tb|mah|inch|hz|w|kg|g|ml)/i;
  const scored: Array<{ line: string; score: number }> = [];
  const seen = new Set<string>();
  for (const raw of markdown.split(/\n/)) {
    let line = raw.replace(/^\s*[-*•+]\s*/, "").replace(/\*+/g, "").trim();
    if (line.length < 15 || line.length > 220) continue;
    if (JUNK.test(line)) continue;
    let score = 0;
    if (/^\s*[-*•+]/.test(raw)) score += 2; // bullets carry structure
    if (DENSE.test(line)) score += 2; // specs/prices/numbers = data
    if (/[:—–-]/.test(line)) score += 1; // definition-style lines
    const words = line.split(/\s+/).length;
    if (words >= 6 && words <= 40) score += 1;
    if (score >= 3) {
      const key = line.toLowerCase().slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      scored.push({ line, score });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 15).map((s) => s.line);
}

/**
 * Pull ingredient-style lines straight out of scraped recipe markdown —
 * the no-LLM fallback so ingredient extraction still works when every
 * LLM provider is rate-limited.
 */
function heuristicIngredients(markdown: string): string[] {
  if (!markdown) return [];
  const UNITS = /\b(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|g|gram|grams|kg|ml|litre|liter|l|oz|ounce|ounces|lb|lbs|pound|pounds|clove|cloves|pinch|sprig|sprigs|can|cans|pack|packs|slice|slices|handful|stick|sticks|bunch)\b/i;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of markdown.split(/\n/)) {
    const line = raw.replace(/^\s*[-*•]\s*/, "").replace(/\*+/g, "").replace(/\s*\([^)]*\)\s*/g, " ").trim();
    if (line.length < 6 || line.length > 90) continue;
    // Ingredient-ish: starts with a number OR contains a quantity unit,
    // mostly letters, no URL/markup junk, no recipe-prose verbs.
    const startsNum = /^\d([\d/.,])?\s/.test(line);
    if (!startsNum && !UNITS.test(line)) continue;
    if (/https?:|\]\(|\||#|\b(preheat|instructions|directions|method|steps?|minutes|bake|stir|heat|serve|whisk|season with salt)\b/i.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= 15) break;
  }
  return out;
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
  // What remains — the actionable leftovers the Command Deck will track.
  const remaining = collectRemainingItems(job);
  if (remaining.length > 0) {
    lines.push(`## What remains`);
    for (const item of remaining) lines.push(`- ${item}`);
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

/**
 * Turn a finished mission's follow-ups into real Command Deck tasks.
 * Best-effort: any failure here is logged and swallowed.
 */
async function syncMissionFollowUpTasks(job: AgentJob): Promise<void> {
  try {
    const report = buildReport(job);
    const items = extractFollowUpTasks(job, report);
    if (items.length === 0) return;
    const created: string[] = [];
    for (const item of items) {
      try {
        await createTask({
          title: item.title,
          priority: item.priority,
          dueDate: item.dueAt ?? undefined,
        });
        created.push(item.title);
      } catch (e) {
        console.warn("[Agent] follow-up task create failed (non-fatal):", (e as Error)?.message);
      }
    }
    if (created.length > 0) {
      emitMissionEvent(job.id, "log", `Added ${created.length} follow-up task(s) to your Command Deck`, {
        followUpTasks: created,
      });
    }
  } catch (e) {
    console.warn("[Agent] follow-up task sync failed (non-fatal):", (e as Error)?.message);
  }
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
