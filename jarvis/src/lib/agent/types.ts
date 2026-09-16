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
  | "file_save"
  | "timer_set"
  | "telegram_send"
  | "shell_command"
  | "vision_inspect"
  | "file_list"
  | "file_open";

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
  /** Fast lane: mission ran without the manual approval gate (still abortable). */
  auto?: boolean;

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
  timer_set: "Set timer",
  telegram_send: "Telegram",
  shell_command: "Run command",
  vision_inspect: "Vision check",
  file_list: "List files",
  file_open: "Open file",
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
  "- firecrawl_extract: {url: string, prompt: string} — AI-extracts structured data from ANY page into JSON: specs, prices, key points, dates, names, ingredients, comparison data, etc. The prompt says WHAT to extract (e.g. 'extract the PS5 full specs', 'extract the ticket prices', 'extract the main arguments'). URL may be \"from:<stepId>\". Pair with notes_create or file_save whenever the user says 'extract ... and save/put it in notes/a file'.",
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
  "- timer_set: {minutes?: number, seconds?: number, label?: string} — starts a timer on this PC that rings when it ends. Use for workout/study/focus/session timing (e.g. 'set a 20-minute timer').",
  "- telegram_send: {text?: string, file?: string (\"from:<fileSaveStepId>\" or a filename), chatId?: string} — sends a message — or the text of a saved file — to the user's Telegram. Use whenever the user asks to send/message them, and for things that must reach their phone.",
  "- shell_command: {command: string, description?: string} — runs ONE safe whitelisted shell command on this PC: git status/log/diff/branch, node/npm versions, npm run build/test/lint, npm install, curl/ping checks (e.g. 'curl -s -o /dev/null -w \"%{http_code}\" http://localhost:3000'), tasklist, netstat, 'code' to open the project in VS Code. ONLY for machine-level requests ('is my server running?', 'open my project in VS Code', 'fix my dev environment'). Commands must finish on their own (max ~3 min) — NEVER start long-running dev servers; instead check status and report/suggest. Missions with this step always ask for user approval first.",
  "- vision_inspect: {url?: string, question?: string} — screenshots a webpage (url) or the whole screen and answers with AI vision. Use when the user asks to VERIFY something visually ('does the site look right?', 'is it actually playing?') and as a FALLBACK when other approaches cannot find or confirm something.",
  "- file_list: {folder?: 'Downloads'|'Desktop'|'Documents', extension?: string} — lists files in a local user folder (newest first), optionally filtered by extension (e.g. 'pdf'). Use for 'open my Downloads folder', 'find the newest PDF', 'my recent files'. NEVER use shell commands like xdg-open or ls for files/folders.",
  "- file_open: {name?: string, folder?: 'Downloads'|'Desktop'|'Documents', from?: \"from:<fileListStepId>\"} — opens a local file with its default Windows app (e.g. the newest PDF from a file_list step). Pair: file_list (folder 'Downloads', extension 'pdf') -> file_open (from '<fileListStepId>').",
  "NOTE: You cannot control the user's phone (DND, phone apps, SMS). For such requests do the PC-side parts and reach the user via telegram_send instead.",
  "MUSIC RULE: at most ONE audio step per plan — NEVER combine spotify_action AND youtube_open for music in the same plan (double playback). For study/work/prep sessions pick exactly ONE focus-music step (prefer spotify_action with a focus/lofi query).",
  "AUDIENCE RULE: The user is a college student. For 'learn something interesting', educational or study content choose substantive adult-level material (science explainers, documentaries, tech talks, university lectures) — NEVER kids' content (shapes, colors, nursery rhymes, cartoons).",
  "PARALLELISM RULE: Steps that do not depend on each other MUST NOT have dependsOn — they will execute CONCURRENTLY in parallel!",
  "Example: 'Find weather, play spotify matching weather, open youtube tech news': Step 1 (weather) and Step 3 (youtube) run IN PARALLEL. Step 2 (spotify) depends on Step 1.",
  "Example: 'Find a good dinner recipe, extract the ingredients, create a shopping list, open Google Maps with stores': Step 1 (firecrawl_search 'best easy dinner recipe with ingredients list') -> Step 2 (llm_decide one specific dish with a full recipe on its page, input 'from:step1') -> Step 3 (firecrawl_extract url 'from:step2.url', prompt 'list all ingredients with quantities for this dish') -> Step 4 (notes_create title 'Dinner Shopping List', content 'from:step3') -> Step 5 (maps_open 'grocery stores near me', runs in parallel). CRITICAL: decide ONE specific dish whose page contains the actual recipe — do NOT pick a roundup/listicle of many recipes.",
  "UNIVERSAL EXTRACT PATTERN — 'extract X and save/put it in notes/a file' works for ANY X (specs, prices, key points, schedule, features, stats): Step 1 (firecrawl_search for the topic) -> Step 2 (llm_decide the best source, input 'from:step1') -> Step 3 (firecrawl_extract url 'from:step2.url', prompt 'extract <X>') -> Step 4 (notes_create title '<X>', content 'from:step3') — or file_save if the user said file. Example: 'Research the best mechanical keyboard under 5000, extract the specs of the top pick, save to notes': search -> llm_decide -> firecrawl_extract prompt 'extract full specs and price of the top keyboard' -> notes_create title 'Keyboard Specs' content 'from:<extractId>'.",
  "Example: 'Search best mechanical keyboard under 5000, compare three options, open the best one, save details to file': Step 1 (search) -> Step 2 (compare options with llm_summarize) -> Step 3 (llm_decide best option) -> Step 4 (browser_open url: 'from:step3.url') and Step 5 (file_save filename: 'keyboard_details.txt', content: 'from:step2').",
  "Example: 'Find top tech story, summarize it, save it and send me on Telegram': Step 1 (firecrawl_search) -> Step 2 (llm_summarize inputs 'from:step1') -> Step 3 (file_save filename 'tech_story.txt' content 'from:step2') -> Step 4 (telegram_send file 'from:step3').",
  "Example: 'Open Spotify, play a random song, verify visually it is playing, then open YouTube and search a music video': Step 1 (spotify_action) -> Step 2 (vision_inspect question 'Is Spotify open and playing music right now?') -> Step 3 (youtube_open).",
  "Example: 'I have two hours free. Set up a productive coding session for me' (AMBIGUOUS — interpret the goal yourself): Step 1 (shell_command 'code' to open the editor) -> Step 2 (youtube_open 'deep focus lofi music') -> Step 3 (timer_set 120 minutes 'focus session') -> Step 4 (notify with the session plan). For ambiguous goals like 'set me up', 'get me ready', 'make this time productive' — decide WHAT to do yourself from context and build the plan; do not ask unless something valuable is truly unclear (then use checkpoint). PREP SESSIONS: exactly ONE music step + ONE timer + organizing steps (task_create/notes_create) — never two music steps.",
  "Example: 'Get me ready for tomorrow's college work': Step 1 (task_create 'Review tomorrow\'s classes and assignments') -> Step 2 (spotify_action play 'deep focus study playlist') -> Step 3 (timer_set 90 minutes 'study session'). ONE music step only.",
  "Example: 'I want to learn something interesting for 30 minutes. Find something and set me up': Step 1 (firecrawl_search 'best short documentaries OR fascinating science explainers for curious adults') -> Step 2 (llm_decide most mind-expanding pick for a college student, input 'from:step1') -> Step 3 (browser_open 'from:step2.url') -> Step 4 (timer_set 30 minutes 'learning session'). Choose genuinely fascinating adult-level content.",
  "Example: 'Open my project in VS Code and check whether my dev server is running': Step 1 (shell_command 'code') -> Step 2 (shell_command curl localhost:3000 status check). If the server is down, report it and suggest the command — do not try to keep a server running yourself.",
  "Example: 'Open my Downloads folder, find the newest PDF, open it, screenshot the first page, tell me what it contains': Step 1 (file_list folder 'Downloads' extension 'pdf') -> Step 2 (file_open from '<step1>') -> Step 3 (vision_inspect question 'A PDF should be open on screen — what does its first page contain?'). NEVER use xdg-open, ls, start or explorer shell commands for files — this PC is Windows and only file_list/file_open handle local files.",
  "SPEED RULES: For simple 'find X and open it' / 'play X' goals use the minimal chain: firecrawl_search (limit 5) -> llm_decide (input 'from:<searchId>') -> browser_open (url 'from:<decideId>.url'). Do NOT add web_scrape, firecrawl_extract or deep_research unless the user explicitly asks for research, comparison, specs, extraction or summaries — they are slow and cost credits.",
  "If the user wants to watch or play something, use youtube_open directly with a query — no separate search step needed.",
  "Keep plans clean, under 8 steps. Output ONLY valid JSON — no markdown, no conversational commentary.",
].join(" ");