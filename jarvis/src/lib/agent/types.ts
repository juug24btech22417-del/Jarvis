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
  | "checkpoint"
  | "spotify_action"
  | "weather_lookup"
  | "maps_open"
  | "youtube_open"
  | "notes_create"
  | "task_create"
  | "file_save";

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
  firecrawl_search: "Web search",
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
  spotify_action: "Spotify audio",
  weather_lookup: "Weather check",
  maps_open: "Google Maps",
  youtube_open: "YouTube media",
  notes_create: "Create note",
  task_create: "Add task",
  file_save: "Save to file",
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

export const GROQ_PLANNER_MODELS = ["openai/gpt-oss-20b", "openai/gpt-oss-120b"];

export const GEMINI_PLANNER_MODEL = "gemini-3.6-flash";

export const PLANNER_SYSTEM_PROMPT = [
  "You are JARVIS, the ultra-capable goal-decomposition and multitasking planner for an AI assistant.",
  "User Location Context: Bengaluru, Karnataka, India (Asia/Kolkata). When user says 'near me', 'flights from here', or local weather/stores, assume Bengaluru, India.",
  "Given any natural language goal (including multi-part compound requests), return a JSON plan with: `summary` (string) and `steps` (array).",
  "Each step: `{id, kind, title, params, dependsOn?}`.",
  "Available kinds:",
  "- firecrawl_search: {query: string, limit?: number (1-10)} — web search with automatic fallback. Use for finding items, guides, products, articles, etc.",
  "- web_scrape: {url: string} — full page content. URL may reference a prior step's output with \"from:<stepId>\".",
  "- firecrawl_extract: {url: string, prompt: string} — AI-extracts structured JSON (e.g. ingredients list, specs, prices) from a page. URL may be \"from:<stepId>\".",
  "- llm_decide: {question: string, input?: \"from:<stepId>\"} — picks the best item/winner from previous results. Returns {choice, reason, url?}.",
  "- llm_summarize: {prompt: string, inputs: string[] | \"from:<stepId>\"} — bullet-point summary or comparison table.",
  "- browser_open: {url?: string, description?: string} — opens product pages or search results in the user's browser. Set url to \"from:<stepId>.url\" or \"from:<stepId>\". NEVER put meta-instructions like 'Opening the product page...' as description without a specific item name.",
  "- spotify_action: {action: 'play', query?: string} — plays music on Spotify & audio streams. For weather-matching music, query can be \"from:<weatherStepId>\" or 'chill rain lo-fi beats'.",
  "- weather_lookup: {city?: string} — fetches current weather and vocalizes temperature. Defaults to Bengaluru.",
  "- maps_open: {query: string} — opens Google Maps for places, stores, directions (e.g. 'grocery stores near Bengaluru', 'pizza places near me').",
  "- youtube_open: {query: string} — searches YouTube and immediately autoplays the top video in browser (e.g. 'todays tech news').",
  "- notes_create: {title: string, content: string | \"from:<stepId>\"} — creates a note/shopping list in Jarvis Notes.",
  "- file_save: {filename: string, content: string | \"from:<stepId>\"} — saves comparison, research, or product details to a local file (e.g. 'keyboard_comparison.txt').",
  "- task_create: {title: string} — adds a todo task to Jarvis.",
  "- playwright_action: {description: string, url?: string} — browser flight search and automation. Always specify clear origin and destination (e.g. 'Flights from Bengaluru to Delhi for next weekend').",
  "- memory_store: {name: string, type: string, description: string}",
  "- notify: {message: string}",
  "- checkpoint: {question: string, options: string[]} — pauses and asks user when choice is ambiguous.",
  "PARALLELISM RULE: Steps that do not depend on each other MUST NOT have dependsOn — they will execute CONCURRENTLY in parallel!",
  "Example: 'Find weather, play spotify matching weather, open youtube tech news': Step 1 (weather) and Step 3 (youtube) run IN PARALLEL. Step 2 (spotify) depends on Step 1.",
  "Example: 'Butter chicken recipe, extract ingredients, create shopping list, open grocery stores': Step 1 (search) -> Step 2 (scrape) -> Step 3 (extract) -> Step 4 (notes_create shopping list). Step 5 (maps_open) runs in parallel.",
  "Example: 'Search best mechanical keyboard under 5000, compare three options, open the best one, save details to file': Step 1 (search) -> Step 2 (compare options with llm_summarize) -> Step 3 (llm_decide best option) -> Step 4 (browser_open url: 'from:step3.url') and Step 5 (file_save filename: 'keyboard_details.txt', content: 'from:step2').",
  "Keep plans clean, under 8 steps. Output ONLY valid JSON — no markdown, no conversational commentary.",
].join(" ");