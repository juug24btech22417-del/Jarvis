// Tier 2A — Goal agent types.
// A goal becomes a plan of typed steps; each step has params + optional
// dependency on prior step ids.

export type AgentStepKind =
  | "web_search"
  | "web_scrape"
  | "firecrawl_search"
  | "firecrawl_extract"
  | "change_tracking"
  | "llm_decide"
  | "llm_summarize"
  | "deep_research"
  | "memory_store"
  | "notify"
  | "playwright_action"
  | "browser_open"
  | "checkpoint";

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

export type JobStatus =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "paused_checkpoint"
  | "done"
  | "failed"
  | "cancelled";

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
  /** Firecrawl credits spent on this mission (enforced against MISSION_CREDIT_CAP). */
  creditsUsed?: number;

  // ── Runtime-only checkpoint state (functions/Maps never serialize) ──
  checkpointStepId?: string;
  checkpointResults?: Map<string, StepResult>;
  checkpointResolve?: () => void;
}

export const STEP_KIND_LABELS: Record<AgentStepKind, string> = {
  web_search: "Web search",
  web_scrape: "Web scrape",
  firecrawl_search: "Web search (Firecrawl)",
  firecrawl_extract: "AI extraction",
  change_tracking: "Change watch",
  llm_decide: "AI decision",
  llm_summarize: "LLM summarize",
  deep_research: "Deep research",
  memory_store: "Save to memory",
  notify: "Notify",
  playwright_action: "Browser action",
  browser_open: "Open in browser",
  checkpoint: "Ask me",
};

/** Broad per-mission Firecrawl budget (scrapes/searches/extracts). */
export const MISSION_CREDIT_CAP = 12;

/**
 * LLM providers the planner / step-LLMs may use, raced in parallel.
 *
 * Individual free slugs get sunset regularly (the original llama-3.1 OpenRouter
 * default started returning HTTP 404, NVIDIA EOL'd llama-3.1, Gemini 2.0 flash
 * was retired) — so no single model is load-bearing. Keep these lists aligned
 * with live catalogues:
 *  - OpenRouter: mirror OPENROUTER_FALLBACK_MODELS in /api/chat/route.ts
 *  - Groq: https://api.groq.com/openai/v1/models
 *  - Gemini: error bodies name the replacement slug when a model is retired
 */
export const OPENROUTER_PLANNER_MODELS = [
  process.env.OPENROUTER_MODEL || "nvidia/nemotron-3.5-lightning:free",
  "cohere/north-mini-code:free",
  "poolside/laguna-s-2.1:free",
];

export const GROQ_PLANNER_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b"];

export const GEMINI_PLANNER_MODEL = "gemini-3.6-flash";

export const PLANNER_SYSTEM_PROMPT = [
  "You are JARVIS, the goal-decomposition planner for an AI assistant.",
  "Given a user goal, return a JSON plan with: `summary` (string) and `steps` (array).",
  "Each step: `{id, kind, title, params, dependsOn?}`.",
  "Available kinds: firecrawl_search, web_scrape, firecrawl_extract, change_tracking, llm_decide, llm_summarize, deep_research, memory_store, notify, browser_open, checkpoint, web_search, playwright_action.",
  "Valid params:",
  "- firecrawl_search: {query: string, limit?: number (1-10), scrapeResults?: boolean} — web search. PREFER THIS for 'find the best X' style goals.",
  "- web_scrape: {url: string} — full page content. URL may reference a prior step's output with the form \"from:<stepId>\" (e.g. the url field of a search result or extract).",
  "- firecrawl_extract: {url: string, prompt: string} — AI-extracts structured JSON (name/price/rating/links etc.) from a page. URL may be \"from:<stepId>\".",
  "- change_tracking: {url: string} — reports what changed on a page vs a previous snapshot (use when the goal says 'watch' or 'what changed').",
  "- llm_decide: {question: string, input?: \"from:<stepId>\"} — asks the LLM to pick the best item from a prior step's results. Returns {choice, reason, url?}.",
  "- llm_summarize: {prompt: string, inputs: string[] | \"from:<stepId>\"} — bullet-point summary. inputs may reference prior steps.",
  "- deep_research: {query: string, maxPages?: number} — autonomous search→scrape→follow-links→synthesize. Use for broad research goals.",
  "- memory_store: {name: string, type: string, description: string, related?: [{name, relationship}]}",
  "- notify: {message: string}",
  "- browser_open: {url: string, description?: string} — opens pages in the user's browser. url may be \"from:<stepId>\" or \"from:<stepId>.urls\" (all results). USE THIS when the goal says 'open'.",
  "- checkpoint: {question: string, options: string[]} — pauses the mission and asks the user to pick. Use ONLY when the choice is genuinely ambiguous.",
  "- web_search: {query: string} — legacy research search (use firecrawl_search instead).",
  "- playwright_action: {description: string, url?: string} — low-level browser automation.",
  "Steps with NO dependency between them run in PARALLEL — do not add fake dependencies. Steps that reference outputs use \"from:<stepId>\".",
  "Keep plans under 8 steps. Every scrape/search costs credits — do not scrape the same page twice.",
  "Output ONLY valid JSON — no commentary, no markdown.",
].join(" ");