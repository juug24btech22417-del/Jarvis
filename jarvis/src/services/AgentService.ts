// Tier 2A — Goal agent orchestrator.
// Two phases: plan (LLM-decomposed) → execute (run step handlers, persist results).
// State is in-memory keyed by jobId. In v2 we don't persist job history.

import { randomUUID } from "crypto";
import type {
  AgentJob,
  AgentPlan,
  AgentStep,
  StepResult,
} from "@/lib/agent/types";
import { PLANNER_SYSTEM_PROMPT } from "@/lib/agent/types";
import { addEntity, addRelationship } from "@/lib/memory/graph";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.1-8b-instruct:free";

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 12000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// In-memory job store (v1). Reset on process restart.
const jobs = new Map<string, AgentJob>();

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
  };
  jobs.set(job.id, job);

  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const plan = await callPlanner(goal);
      validatePlan(plan);
      job.plan = plan;
      job.status = "awaiting_approval";
      return job;
    } catch (e) {
      lastError = (e as Error)?.message || String(e);
      console.warn(`[Agent] planner attempt ${attempt + 1} failed:`, lastError);
    }
  }

  job.status = "failed";
  job.error = `Could not produce a plan: ${lastError ?? "unknown error"}`;
  return job;
}

/** Approve a plan and run it to completion. */
export async function approveJob(jobId: string): Promise<AgentJob> {
  const job = jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  if (job.status !== "awaiting_approval") {
    throw new Error(`Job is in status ${job.status}, not awaiting_approval`);
  }
  if (!job.plan) throw new Error("Job has no plan");

  job.status = "running";
  job.startedAt = Date.now();
  try {
    await executePlan(job);
    job.status = "done";
  } catch (e) {
    job.status = "failed";
    job.error = (e as Error)?.message || String(e);
  } finally {
    job.finishedAt = Date.now();
  }
  return job;
}

export async function cancelJob(jobId: string): Promise<AgentJob | undefined> {
  const job = jobs.get(jobId);
  if (!job) return undefined;
  if (job.status === "running" || job.status === "awaiting_approval" || job.status === "planning") {
    job.status = "cancelled";
    job.finishedAt = Date.now();
  }
  return job;
}

/* ----------------------------- PLANNER ----------------------------- */

async function callPlanner(goal: string): Promise<AgentPlan> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    // No LLM available — return a tiny stub plan the user can still see.
    return {
      summary: `Heuristic plan for: ${goal.slice(0, 60)}`,
      steps: [
        {
          id: "s1",
          kind: "web_search",
          title: `Search the web for: ${goal.slice(0, 80)}`,
          params: { query: goal },
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

  const res = await fetchWithTimeout(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: goal },
      ],
      max_tokens: 600,
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    throw new Error(`planner HTTP ${res.status}`);
  }
  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  // Strip code fences if the model adds them.
  const json = content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(json) as AgentPlan;
}

function validatePlan(plan: AgentPlan) {
  if (!plan || typeof plan !== "object") throw new Error("plan is not an object");
  if (typeof plan.summary !== "string") throw new Error("plan.summary missing");
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error("plan.steps empty");
  if (plan.steps.length > 8) throw new Error("plan.steps too long (max 8)");
  for (const s of plan.steps) {
    if (!s.id || typeof s.id !== "string") throw new Error("step.id missing");
    if (!s.kind || typeof s.kind !== "string") throw new Error(`step ${s.id}.kind missing`);
    if (typeof s.title !== "string") throw new Error(`step ${s.id}.title missing`);
    if (typeof s.params !== "object" || s.params === null) {
      throw new Error(`step ${s.id}.params must be object`);
    }
  }
}

/* ----------------------------- EXECUTOR ----------------------------- */

async function executePlan(job: AgentJob) {
  const plan = job.plan!;
  const resultsById = new Map<string, StepResult>();

  for (const step of plan.steps) {
    if (job.status === "cancelled") break;

    // Wait on dependencies.
    for (const dep of step.dependsOn ?? []) {
      const depResult = resultsById.get(dep);
      if (!depResult || depResult.status !== "ok") {
        const r: StepResult = {
          stepId: step.id,
          status: "skipped",
          error: `dependency ${dep} not satisfied`,
          finishedAt: Date.now(),
        };
        resultsById.set(step.id, r);
        job.results.push(r);
        continue;
      }
    }

    try {
      const result = await runStep(step, resultsById);
      const r: StepResult = { stepId: step.id, status: "ok", result, finishedAt: Date.now() };
      resultsById.set(step.id, r);
      job.results.push(r);
    } catch (e) {
      const r: StepResult = {
        stepId: step.id,
        status: "error",
        error: (e as Error)?.message || String(e),
        finishedAt: Date.now(),
      };
      resultsById.set(step.id, r);
      job.results.push(r);
      // Continue executing the rest — let the plan degrade gracefully.
    }
  }
}

async function runStep(step: AgentStep, deps: Map<string, StepResult>): Promise<unknown> {
  switch (step.kind) {
    case "web_search": {
      const query = String(step.params.query ?? "");
      if (!query) throw new Error("web_search: query required");
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: "fast" }),
      });
      if (!res.ok) throw new Error(`research HTTP ${res.status}`);
      const data = await res.json();
      return { summary: data.summary ?? "", sources: data.results ?? [] };
    }

    case "web_scrape": {
      const url = String(step.params.url ?? "");
      if (!url) throw new Error("web_scrape: url required");
      const res = await fetch("/api/firecrawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scrape", url }),
      });
      if (!res.ok) throw new Error(`firecrawl HTTP ${res.status}`);
      return await res.json();
    }

    case "llm_summarize": {
      const prompt = String(step.params.prompt ?? "Summarize the following:");
      const inputs: string[] = Array.isArray(step.params.inputs)
        ? (step.params.inputs as string[])
        : Array.from(deps.values())
            .map((r) => (typeof r.result === "string" ? r.result : ""))
            .filter(Boolean);
      if (inputs.length === 0) {
        return { summary: "(no inputs to summarize)" };
      }
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) return { summary: inputs[0].slice(0, 500) };
      const r = await fetchWithTimeout(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            { role: "system", content: "You are JARVIS. Summarize concisely in 3-5 bullet points." },
            { role: "user", content: `${prompt}\n\n${inputs.join("\n\n---\n\n")}` },
          ],
          max_tokens: 400,
          temperature: 0.4,
        }),
      }, 12000);
      if (!r.ok) throw new Error(`summarize HTTP ${r.status}`);
      const data = await r.json();
      return { summary: data?.choices?.[0]?.message?.content?.trim() ?? "(empty)" };
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
      return { id: entityId, name, type };
    }

    case "notify": {
      const message = String(step.params.message ?? "").trim();
      if (!message) throw new Error("notify: message required");
      return { message };
    }

    case "playwright_action": {
      // Tier 2C: run with self-healing retry.
      const description = String(step.params.description ?? "browser action").trim();
      const url = typeof step.params.url === "string" ? step.params.url : null;
      if (!url) {
        return { deferred: true, message: "No URL supplied for browser action.", description };
      }

      const { heal } = await import("@/services/PlaywrightResilience");
      const { playwrightService } = await import("@/services/PlaywrightService");

      // Default: navigate + screenshot. Future: richer action mapping.
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

    default: {
      const exhaustive: never = step.kind;
      throw new Error(`unknown step kind: ${exhaustive}`);
    }
  }
}