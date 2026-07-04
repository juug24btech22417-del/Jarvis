// Tier 2A — Goal agent types.
// A goal becomes a plan of typed steps; each step has params + optional
// dependency on prior step ids.

export type AgentStepKind =
  | "web_search"
  | "web_scrape"
  | "llm_summarize"
  | "memory_store"
  | "notify"
  | "playwright_action";

export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  /** Human description (shown in plan UI). */
  title: string;
  /** Step-specific params. Validated per kind. */
  params: Record<string, unknown>;
  /** Step ids that must complete first. */
  dependsOn?: string[];
}

export interface AgentPlan {
  /** Short human label, e.g. "Research + summarize RAG evaluation papers". */
  summary: string;
  steps: AgentStep[];
}

export type JobStatus = "planning" | "awaiting_approval" | "running" | "done" | "failed" | "cancelled";

export interface StepResult {
  stepId: string;
  status: "ok" | "error" | "skipped";
  /** What came out (string / object — type-checked at consumer). */
  result?: unknown;
  error?: string;
  /** When it finished. */
  finishedAt: number;
}

export interface AgentJob {
  id: string;
  goal: string;
  plan?: AgentPlan;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Per-step results in execution order. */
  results: StepResult[];
  /** LLM planner error if status === "failed" before plan approval. */
  error?: string;
}

export const STEP_KIND_LABELS: Record<AgentStepKind, string> = {
  web_search: "Web search",
  web_scrape: "Web scrape",
  llm_summarize: "LLM summarize",
  memory_store: "Save to memory",
  notify: "Notify",
  playwright_action: "Browser action",
};

export const PLANNER_SYSTEM_PROMPT = [
  "You are JARVIS, the goal-decomposition planner for an AI assistant.",
  "Given a user goal, return a JSON plan with: `summary` (string) and `steps` (array).",
  "Each step: `{id, kind, title, params, dependsOn?}`.",
  "Available kinds: web_search, web_scrape, llm_summarize, memory_store, notify, playwright_action.",
  "Valid params:",
  "- web_search: {query: string}",
  "- web_scrape: {url: string}",
  "- llm_summarize: {prompt: string, inputs: string[]}",
  "- memory_store: {name: string, type: string, description: string, related?: [{name, relationship}]}",
  "- notify: {message: string}",
  "- playwright_action: {description: string, url?: string}",
  "Keep plans under 6 steps. Use dependsOn only when a step truly needs prior output.",
  "Output ONLY valid JSON — no commentary, no markdown.",
].join(" ");