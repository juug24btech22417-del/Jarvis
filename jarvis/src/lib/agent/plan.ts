// Pure planner utilities — no network, no Next, no LLM.
//
// Extracted from AgentService so the JSON repair / validation / cost logic
// can be unit-tested without booting the app. AgentService imports these.

import {
  APPROVAL_REQUIRED_KINDS,
  SPECIALIST_KINDS,
  STEP_CREDIT_WEIGHT,
  STEP_KIND_LABELS,
  type AgentPlan,
  type AgentStep,
  type AgentStepKind,
  type PlanEstimate,
} from "./types";

import { feedScrollIntent } from "../jarvis/commandRouting";

// Feed detection is shared with the command bar so the two can't drift apart.
// Re-exported here because existing importers (and tests) pull it from the
// planner.
export { feedScrollIntent };

export const KNOWN_KINDS: ReadonlySet<string> = new Set<string>([
  // search / research
  "web_search", "web_scrape", "firecrawl_search", "firecrawl_extract",
  "change_tracking", "llm_decide", "llm_summarize", "deep_research",
  // generic
  "memory_store", "notify", "playwright_action", "browser_open", "checkpoint",
  // desktop / media
  "spotify_action", "weather_lookup", "maps_open", "youtube_open",
  "notes_create", "task_create", "file_save", "timer_set", "telegram_send",
  "shell_command", "vision_inspect", "file_list", "file_open",
  // v5 browser agency + delegation + video
  "browser_act", "browser_screenshot", "browser_login", "browser_replay",
  "delegate", "video_brief",
  // v6 machine ops
  "dev_server_start", "dev_server_stop", "dev_server_status", "file_organize", "repo_inspect",
]);

/** Kinds that may appear inside a delegated specialist sub-plan (no nesting). */
export function kindsAllowedForRole(role: string): Set<string> {
  const keys = (SPECIALIST_KINDS as Record<string, AgentStepKind[]>)[role];
  return new Set(keys ?? SPECIALIST_KINDS.researcher);
}

/* ----------------------------- DEPENDENCY INFERENCE ----------------------------- */

/**
 * Add every "from:<stepId>" reference (found anywhere in params) to the
 * step's dependsOn so the DAG never runs a consumer before its producer.
 */
export function autoInferDependencies(plan: AgentPlan): void {
  const stepIds = new Set(plan.steps.map((s) => s.id));
  for (const s of plan.steps) {
    const rawDeps = Array.isArray(s.dependsOn) ? s.dependsOn : [];
    const validDeps = new Set<string>();

    for (const d of rawDeps) {
      const cleaned = String(d).split(".")[0].trim();
      if (stepIds.has(cleaned) && cleaned !== s.id) validDeps.add(cleaned);
    }

    const findRefs = (val: unknown) => {
      if (typeof val === "string") {
        for (const m of val.matchAll(/from:([a-zA-Z0-9_-]+)/g)) {
          const targetId = m[1].split(".")[0];
          if (stepIds.has(targetId) && targetId !== s.id) validDeps.add(targetId);
        }
      } else if (Array.isArray(val)) {
        for (const item of val) findRefs(item);
      } else if (typeof val === "object" && val !== null) {
        for (const v of Object.values(val)) findRefs(v);
      }
    };
    findRefs(s.params);
    s.dependsOn = Array.from(validDeps);
  }
}

/* ----------------------------- VALIDATION + REPAIR ----------------------------- */

/** Labels for the regenerated titles when a step's title is a raw ref. */
function fallbackTitle(s: AgentStep): string {
  const p = (s.params ?? {}) as Record<string, unknown>;
  // Skip values that are themselves "from:<stepId>" refs — a title like
  // "Web scrape: from:s1" is useless to a human.
  const candidates = [p.task, p.query, p.city, p.label, p.command, p.question, p.filename, p.url, p.description];
  const detail = candidates
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find((v) => v && !v.startsWith("from:"))
    ?.slice(0, 50);
  const label = STEP_KIND_LABELS[s.kind as AgentStepKind] ?? s.kind;
  return detail ? `${label}: ${detail}` : label;
}

/**
 * Validate and repair a raw planner plan in place.
 * Following the project convention: repair cosmetic issues (missing titles,
 * numeric refs) rather than failing the whole mission.
 *
 * @param allowedKinds optional restriction (used for specialist sub-plans).
 */
export function validateAndRepairPlan(
  plan: AgentPlan,
  allowedKinds?: ReadonlySet<string>,
  opts?: { maxSteps?: number; allowDelegate?: boolean }
): AgentPlan {
  const maxSteps = opts?.maxSteps ?? 10;
  if (!plan || typeof plan !== "object") throw new Error("plan is not an object");
  if (typeof plan.summary !== "string") throw new Error("plan.summary missing");
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error("plan.steps empty");
  if (plan.steps.length > maxSteps) throw new Error(`plan.steps too long (max ${maxSteps})`);

  // Rewrite numeric refs ("from:2") to the Nth step's real id.
  const idOf = new Map<string, string>();
  plan.steps.forEach((s, i) => {
    idOf.set(String(i + 1), s.id);
    idOf.set(s.id, s.id);
  });
  const rewriteRefs = (val: unknown): unknown => {
    if (typeof val === "string") {
      return val.replace(/from:([a-zA-Z0-9_-]+)(\.[a-zA-Z]+)?/g, (full, ref: string, field?: string) =>
        idOf.has(ref) ? `from:${idOf.get(ref)}${field ?? ""}` : full
      );
    }
    if (Array.isArray(val)) return val.map(rewriteRefs);
    if (val && typeof val === "object") {
      return Object.fromEntries(Object.entries(val).map(([k, v]) => [k, rewriteRefs(v)]));
    }
    return val;
  };
  for (const s of plan.steps) s.params = rewriteRefs(s.params) as Record<string, unknown>;
  for (const s of plan.steps) {
    if (Array.isArray(s.dependsOn)) {
      s.dependsOn = s.dependsOn.map((d) => {
        const key = String(d).split(".")[0].trim();
        return idOf.get(key) ?? d;
      });
    }
    if (/\bfrom:[a-zA-Z0-9_-]/.test(s.title)) s.title = fallbackTitle(s);
  }

  autoInferDependencies(plan);

  const ids = new Set<string>();
  for (const s of plan.steps) {
    if (!s.id || typeof s.id !== "string") throw new Error("step.id missing");
    if (ids.has(s.id)) throw new Error(`duplicate step id: ${s.id}`);
    ids.add(s.id);
    if (!s.kind || typeof s.kind !== "string") throw new Error(`step ${s.id}.kind missing`);
    if (!KNOWN_KINDS.has(s.kind)) throw new Error(`step ${s.id}: unknown kind "${s.kind}"`);
    if (allowedKinds && !allowedKinds.has(s.kind)) {
      throw new Error(`step ${s.id}: kind "${s.kind}" not allowed for this specialist`);
    }
    if (s.kind === "delegate" && opts?.allowDelegate === false) {
      throw new Error(`step ${s.id}: nested delegation is not allowed`);
    }
    if (typeof s.title !== "string" || !s.title.trim()) s.title = fallbackTitle(s);
    if (typeof s.params !== "object" || s.params === null) s.params = {};
  }

  return plan;
}

/* ----------------------------- COST + RISK ESTIMATE ----------------------------- */

/** Rough per-step wall-clock guesses (seconds) used for the preview. */
const STEP_SECONDS: Partial<Record<AgentStepKind, number>> = {
  firecrawl_search: 4,
  web_search: 5,
  web_scrape: 6,
  firecrawl_extract: 8,
  change_tracking: 10,
  deep_research: 25,
  llm_decide: 5,
  llm_summarize: 6,
  browser_act: 30,
  browser_screenshot: 6,
  browser_login: 45,
  browser_replay: 20,
  delegate: 30,
  video_brief: 10,
  vision_inspect: 12,
  playwright_action: 5,
  browser_open: 1,
  notify: 0,
  memory_store: 0,
  dev_server_start: 20,
  dev_server_stop: 4,
  dev_server_status: 3,
  file_organize: 4,
  repo_inspect: 15,
};

export function stepCreditWeight(kind: AgentStepKind): number {
  return STEP_CREDIT_WEIGHT[kind] ?? 0;
}

/**
 * Compute a plan-level estimate. When a step kind is unknown to the table we
 * assume a small default so the number stays conservative rather than zero.
 */
export function estimatePlan(plan: AgentPlan): PlanEstimate {
  let credits = 0;
  let seconds = 0;
  const riskReasons: string[] = [];

  const isDelegated = plan.steps.some((s) => s.kind === "delegate");
  for (const s of plan.steps) {
    const w = stepCreditWeight(s.kind);
    // A delegate's own sub-steps cost extra; without running them we estimate
    // a modest allowance so the preview is not misleadingly cheap.
    credits += s.kind === "delegate" ? 4 : w;
    seconds += STEP_SECONDS[s.kind] ?? 4;
  }

  if (plan.steps.some((s) => s.kind === "shell_command")) riskReasons.push("runs commands on your PC");
  if (plan.steps.some((s) => s.kind === "dev_server_start" || s.kind === "dev_server_stop")) riskReasons.push("starts/stops a process on your PC");
  if (plan.steps.some((s) => s.kind === "file_organize")) riskReasons.push("moves files on your PC");
  if (plan.steps.some((s) => s.kind === "browser_login")) riskReasons.push("opens a visible browser to sign in");
  if (plan.steps.some((s) => s.kind === "browser_replay")) riskReasons.push("replays a recorded browser workflow");
  if (plan.steps.some((s) => s.kind === "browser_act")) riskReasons.push("takes actions on live websites");
  if (isDelegated) riskReasons.push("spawns specialist sub-agents");
  if (credits >= 10) riskReasons.push("high credit spend");

  const risk: PlanEstimate["risk"] =
    riskReasons.some((r) => /PC|sign in|replays/.test(r)) || credits >= 12
      ? "high"
      : riskReasons.length > 0 || credits >= 6
        ? "medium"
        : "low";

  return { credits, seconds, risk, riskReasons };
}

/** True when any step must never run on the fast lane. */
export function planNeedsApproval(plan: AgentPlan): boolean {
  const required = new Set<string>(APPROVAL_REQUIRED_KINDS);
  return plan.steps.some((s) => required.has(s.kind));
}

/* ----------------------------- BROWSER INTENT ----------------------------- */

// Verbs/phrases that imply the page must be USED, not merely read.
const INTERACTION_RE =
  /\b(sign ?in|log ?in|log ?into|checkout|add to (cart|bag)|buy|purchase|book|reserve|apply|submit|fill (in|out)?|register|sign ?up|post|tweet|comment|download|upload|check my|my (account|orders?|cart|dashboard|wallet|profile|subscription|bill|usage|portfolio|inbox)|track (my |the )?(order|package|shipment)|filter|bookmark|watch ?later|cancel (my |an )?(order|subscription)|renew|pay|transfer|schedule (a )?(meeting|appointment)|dm |message .* on)\b/i;

// Sites whose value is behind a session / interaction.
const INTERACTIVE_SITE_RE =
  /\b(gmail|inbox|amazon|flipkart|myntra|swiggy|zomato|uber|ola|linkedin|twitter|x\.com|instagram|reddit|github|gitlab|jira|notion|slack|discord|whatsapp web|netflix|hotstar|prime video|irctc|makemytrip|booking\.com|airbnb|paypal|stripe dashboard|razorpay|zerodha|groww|bank|net ?banking|portal|dashboard)\b/i;

/**
 * Heuristic: does this goal likely need a real browser interaction?
 * Used as a safety net — if the planner produced only read-only steps for an
 * interactive goal, we auto-append a browser_act step so the user never has
 * to explicitly ask for "playwright".
 */
export function needsBrowserInteraction(goal: string): boolean {
  if (!goal) return false;
  return INTERACTION_RE.test(goal) || (INTERACTIVE_SITE_RE.test(goal) && /\b(my|open|check|show|get|see|read|find|order|latest|new|recent)\b/i.test(goal));
}

const BROWSER_STEP_KINDS = new Set(["browser_act", "browser_login", "browser_replay", "playwright_action"]);

/**
 * If the goal is interactive but the plan has no browser step, append one.
 * Returns the step id added, or null when nothing was added.
 */
export function maybeAppendBrowserStep(plan: AgentPlan, goal: string): string | null {
  if (!needsBrowserInteraction(goal)) return null;
  if (plan.steps.some((s) => BROWSER_STEP_KINDS.has(s.kind))) return null;
  if (plan.steps.length >= 10) return null;

  // Reuse the URL a prior decide/open step found, when there is one.
  const upstream = plan.steps.find((s) => s.kind === "firecrawl_search" || s.kind === "llm_decide" || s.kind === "browser_open");
  const id = `b_act${plan.steps.length + 1}`;
  plan.steps.push({
    id,
    kind: "browser_act",
    title: `Carry out the web task autonomously`,
    params: {
      task: goal,
      ...(upstream ? { url: `from:${upstream.id}.url` } : {}),
      maxSteps: 8,
    },
    ...(upstream ? { dependsOn: [upstream.id] } : {}),
  });
  autoInferDependencies(plan);
  return id;
}

/* ----------------------------- INSTANT PLANNER (no LLM) ----------------------------- */

/**
 * Known sign-in pages for the sites people actually name. Used by the instant
 * planner so "sign in to linkedin" needs no LLM round-trip.
 */
const SITE_URLS: Record<string, string> = {
  linkedin: "https://www.linkedin.com/login",
  amazon: "https://www.amazon.in/ap/signin",
  flipkart: "https://www.flipkart.com/account/login",
  github: "https://github.com/login",
  gitlab: "https://gitlab.com/users/sign_in",
  gmail: "https://accounts.google.com/ServiceLogin?service=mail",
  google: "https://accounts.google.com/ServiceLogin",
  instagram: "https://www.instagram.com/accounts/login/",
  twitter: "https://x.com/i/flow/login",
  x: "https://x.com/i/flow/login",
  reddit: "https://www.reddit.com/login",
  notion: "https://www.notion.so/login",
  netflix: "https://www.netflix.com/login",
  swiggy: "https://www.swiggy.com/account/login",
  zomato: "https://www.zomato.com/partner_with_us",
};

/** Whole-word match so "x" doesn't match the x in "example". */
function matchesSite(text: string, name: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(text);
}

/** Sign-in URL for a site name, or null when we don't know the site. */
export function siteLoginUrl(site: string): string | null {
  const key = (site || "").toLowerCase().trim();
  if (!key) return null;
  for (const [name, url] of Object.entries(SITE_URLS)) {
    if (matchesSite(key, name)) return url;
  }
  return null;
}

/** The first known site named in a goal (used by the instant planner). */
export function findSiteInGoal(goal: string): string | null {
  for (const name of Object.keys(SITE_URLS)) {
    if (matchesSite(goal, name)) return name;
  }
  return null;
}

/** Number words up to ten, for "find three sites" style goals. */
const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Strip instruction noise from a multi-open goal to get a clean search query. */
function extractMultiQuery(goal: string): string {
  let s = goal.trim().replace(/[.!]+$/, "");
  // Drop the trailing "and open ... in separate tabs" instruction.
  s = s.replace(/\b(?:and\s+)?(?:then\s+)?(?:open|show|launch|display|put)\b.*$/i, "");
  if (!s.trim()) s = goal.trim().replace(/[.!]+$/, "");
  // Drop leading find/search verbs.
  s = s.replace(/^(?:please\s+)?(?:find|search(?: for)?|look up|get me|get|show me|show|recommend|give me|list)\s+/i, "");
  // Drop the count.
  s = s.replace(/\b(?:\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b/gi, "");
  // Drop filler nouns that add nothing to a search query.
  s = s.replace(/\b(?:websites?|web\s?sites?|sites?|pages?|links?|places?|resources?|options?|results?)\b/gi, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:to|for|of|that|which|with|about)\s+/i, "").trim();
  return s || goal.trim();
}

/**
 * Detect "find N things and open them all in separate tabs/panels" style goals.
 * Returns the count + a cleaned search query, or null.
 */
export function multiOpenIntent(goal: string): { n: number; query: string } | null {
  const g = goal.trim().replace(/[.!]+$/, "");
  const wantsMultiple =
    /\b(?:open|show|launch|display)\s+(?:all|each|every|them|those|both)\b/i.test(g) ||
    /\b(?:in|across|on|into)\s+(?:\d+\s+)?(?:different|separate|multiple|distinct|new)\s+(?:tabs?|panels?|windows?)\b/i.test(g) ||
    /\b(?:different|separate|multiple|distinct)\s+(?:tabs?|panels?|windows?)\b/i.test(g) ||
    /\bopen\s+(?:each|every)\s+one\b/i.test(g) ||
    /\btop\s+\d+\b[\s\S]*\bopen\b/i.test(g);
  if (!wantsMultiple) return null;
  const m = g.match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (!m) return null;
  const n = NUMBER_WORDS[m[1].toLowerCase()] ?? parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 2) return null;
  return { n: Math.min(n, 8), query: extractMultiQuery(g) };
}

/**
 * Instant planner — recognises the handful of goal shapes that make up most
 * real usage and returns the exact plan the LLM would have produced, in
 * microseconds. Everything else returns null and goes to the LLM.
 *
 * Deliberately conservative: short, anchored, unambiguous phrasing only.
 * Disable with JARVIS_FAST_PLANNER=0.
 */
export function heuristicPlan(goal: string): AgentPlan | null {
  if (process.env.JARVIS_FAST_PLANNER === "0") return null;
  const g = (goal || "").trim().replace(/[.!]+$/, "");
  if (!g || g.length > 150) return null;
  // Multi-clause jobs with a synthesis step need the real planner.
  const tooComplex = /\b(?:compare|versus|\bvs\b|analyse|analyze|analyse|report|brief|summari[sz]e|rank|recommend|which is best|research)\b/i.test(g);

  const wrap = (summary: string, steps: AgentStep[]): AgentPlan => ({
    summary: `⚡ ${summary}`,
    steps,
  });

  // Machine-ops goals (tidy my files, check my dev env, investigate, run things
  // in parallel, verify visually) must NOT be swallowed by the generic
  // "find X and open it" shortcut — they need their own recipe.
  const category = classifyGoal(g);
  const MACHINE_CATS = new Set<MissionCategory>([
    "organize_files", "dev_env", "investigate", "parallel", "vision_verify", "prep_workspace",
  ]);

  // ── undo the last file tidy-up ─────────────────────────────────────────
  if (/\b(?:undo|reverse|put back|restore)\b[\s\S]{0,40}\b(?:tidy|organi[sz]\w*|files?|folders?)\b/i.test(g)) {
    return wrap("Undo the last tidy-up", [
      { id: "u1", kind: "file_organize", title: "Undo the last file tidy-up", params: { mode: "undo" } },
    ]);
  }

  // ── weather ────────────────────────────────────────────────────────────
  let m = g.match(/^(?:what(?:'s| is) )?(?:the )?weather(?: like)?(?: today| right now)?(?: in| for| at)? ([a-zA-Z\s,]{2,40})$/i);
  if (m) {
    const city = m[1].trim();
    return wrap(`Weather in ${city}`, [
      { id: "w1", kind: "weather_lookup", title: `Weather in ${city}`, params: { city } },
    ]);
  }
  if (/^(?:what(?:'s| is) )?(?:the )?weather(?: like)?(?: today| right now)?$/i.test(g)) {
    return wrap("Weather", [{ id: "w1", kind: "weather_lookup", title: "Current weather", params: {} }]);
  }

  // ── timer ──────────────────────────────────────────────────────────────
  m = g.match(/^(?:set|start|begin)(?: a)? (\d{1,3})[ -]?(minute|min|hour|hr)s?(?: timer| countdown| session)?$/i);
  if (m) {
    const n = Number(m[1]);
    const isHour = /^h/i.test(m[2]);
    return wrap(`${n} ${isHour ? "hour" : "minute"} timer`, [
      { id: "t1", kind: "timer_set", title: `${n}${isHour ? "h" : "m"} timer`, params: { minutes: isHour ? n * 60 : n, label: "Timer" } },
    ]);
  }

  // ── scroll a social feed (shorts / reels / tiktok) ──────────────────────
  // Must run BEFORE the music/video rule: "open youtube and watch shorts"
  // would otherwise be captured as a plain YouTube search for "shorts".
  const feed = feedScrollIntent(g);
  if (feed) {
    return wrap(`Scroll ${feed.label}`, [
      {
        id: "fs1",
        kind: "browser_act",
        title: `Open ${feed.label} and scroll through it`,
        params: {
          url: feed.url,
          task:
            `Open ${feed.label} at ${feed.url} and scroll through the feed. ` +
            `Advance to the next item by pressing ArrowDown (or clicking the down/next control), ` +
            `wait for each item to load, and go through about 10 items.`,
          maxSteps: 14,
        },
      },
    ]);
  }

  // ── music / video playback ─────────────────────────────────────────────
  m = g.match(/^(?:play|put on)\s+(.{2,80}?)\s+on spotify$/i);
  if (m) {
    return wrap(`Spotify: ${m[1]}`, [{ id: "m1", kind: "spotify_action", title: `Play ${m[1]}`, params: { action: "play", query: m[1] } }]);
  }
  m = g.match(/^(?:(?:open|go to) youtube and )?(?:play|watch|search|find)\s+(.{2,90}?)(?:\s+on youtube)?$/i);
  if (m && /youtube/i.test(g)) {
    return wrap(`YouTube: ${m[1]}`, [{ id: "y1", kind: "youtube_open", title: `Play ${m[1]}`, params: { query: m[1] } }]);
  }

  // ── find N things and open them all (separate tabs / panels) ───────────
  const multi = multiOpenIntent(g);
  if (multi) {
    const limit = Math.max(5, Math.min(multi.n + 2, 10));
    return wrap(`Find ${multi.n} options and open them: ${multi.query}`, [
      { id: "mo1", kind: "firecrawl_search", title: `Search: ${multi.query}`, params: { query: multi.query, limit } },
      {
        id: "mo2",
        kind: "llm_decide",
        title: `Rank the top ${multi.n} matches`,
        params: { question: `Pick the ${multi.n} best DISTINCT results for: ${multi.query}`, input: "from:mo1" },
        dependsOn: ["mo1"],
      },
      {
        id: "mo3",
        kind: "browser_open",
        title: `Open ${multi.n} of them in separate tabs`,
        params: { url: "from:mo2.urls", count: multi.n },
        dependsOn: ["mo2"],
      },
    ]);
  }

  // ── find X and open it (the classic) ───────────────────────────────────
  m = g.match(/^(?:find|search for|look up|get me|recommend)(?: me)? (?:the )?(.{4,90}?)(?: and open (?:it|that|the best(?: one)?))?$/i);
  if (m && !tooComplex && !multiOpenIntent(g) && !MACHINE_CATS.has(category)) {
    const query = m[1].replace(/\s+and open.*$/i, "").trim();
    return wrap(`Find and open: ${query}`, [
      { id: "f1", kind: "firecrawl_search", title: `Search: ${query}`, params: { query, limit: 5 } },
      { id: "f2", kind: "llm_decide", title: "Pick the best match", params: { question: `Best match for: ${query}`, input: "from:f1" }, dependsOn: ["f1"] },
      { id: "f3", kind: "browser_open", title: "Open the best result", params: { url: "from:f2.url" }, dependsOn: ["f2"] },
    ]);
  }

  // ── sign in to <known site> ────────────────────────────────────────────
  m = g.match(/^(?:please )?(?:sign ?in|log ?in)(?: to| into)? ([a-z0-9 .]{2,24}?)(?: and (.+))?$/i);
  if (m) {
    const site = m[1].trim();
    const url = siteLoginUrl(site);
    if (url) {
      const session = site.split(" ")[0].toLowerCase();
      const steps: AgentStep[] = [
        { id: "l1", kind: "browser_login", title: `Sign in to ${site}`, params: { site, url, session } },
      ];
      const task = (m[2] ?? "").trim();
      if (task) {
        if (/\b(send|dm|message)\b.*\b(telegram|me)\b/i.test(task)) {
          steps.push({ id: "s2", kind: "telegram_send", title: "Send the confirmation", params: { text: `Signed in to ${site}.` }, dependsOn: ["l1"] });
        } else {
          steps.push({ id: "b2", kind: "browser_act", title: task, params: { task, session }, dependsOn: ["l1"] });
        }
      }
      return wrap(`Sign in to ${site}`, steps);
    }
  }

  // ── interactive site work (orders / cart / account) ─────────────────────
  if (!tooComplex && needsBrowserInteraction(g) && g.length <= 120) {
    const site = findSiteInGoal(g);
    if (site) {
      const url = SITE_URLS[site];
      return wrap(`Browser mission: ${g}`, [
        { id: "b1", kind: "browser_login", title: `Sign in to ${site} if needed`, params: { site, url, session: site } },
        { id: "b2", kind: "browser_act", title: g, params: { task: g, session: site, maxSteps: 8 }, dependsOn: ["b1"] },
      ]);
    }
    return wrap(`Browser mission: ${g}`, [
      { id: "b1", kind: "browser_act", title: g, params: { task: g, maxSteps: 8 } },
    ]);
  }

  // ── price of a specific thing ──────────────────────────────────────────
  m = g.match(/^(?:what(?:'s| is) )?(?:the )?price of (?:the )?(.{3,70}?)(?: on ([a-z]+))?$/i);
  if (m) {
    const q = m[1].trim();
    return wrap(`Price of ${q}`, [
      { id: "p1", kind: "firecrawl_search", title: `Search prices: ${q}`, params: { query: `${q} price${m[2] ? ` ${m[2]}` : ""}`, limit: 5 } },
      { id: "p2", kind: "firecrawl_extract", title: "Extract the price", params: { url: "from:p1.url", prompt: `extract the current price of ${q}, the store name and availability` }, dependsOn: ["p1"] },
      { id: "p3", kind: "llm_summarize", title: "Report the price", params: { prompt: `Report the price of ${q} with the source store`, inputs: ["from:p2"] }, dependsOn: ["p2"] },
    ]);
  }

  return null;
}

/* ----------------------------- MEMORY RECALL ----------------------------- */

/** Pick the few most similar past goals for planner few-shot grounding. */
export function pickSimilarPastGoals(
  goal: string,
  past: Array<{ goal: string; status: string; createdAt: number }>,
  limit = 3
): Array<{ goal: string; status: string }> {
  if (!past.length) return [];
  const tokens = (s: string) =>
    new Set(
      s.toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2)
    );
  const g = tokens(goal);
  const scored = past
    .filter((p) => p.status === "done" || p.status === "failed")
    .map((p) => {
      const t = tokens(p.goal);
      let overlap = 0;
      for (const w of t) if (g.has(w)) overlap += 1;
      // Jaccard-ish similarity, tie-broken by recency.
      const sim = overlap / Math.max(1, new Set([...g, ...t]).size);
      return { ...p, sim };
    })
    .filter((p) => p.sim > 0.08)
    .sort((a, b) => b.sim - a.sim || b.createdAt - a.createdAt)
    .slice(0, limit);
  return scored.map((p) => ({ goal: p.goal, status: p.status }));
}

/* ----------------------------- GOAL CATEGORY ----------------------------- */

/**
 * The broad shapes a mission can take. The first ten mirror the "Jarvis, just
 * handle it" tiers (figure-it-out, research→execute, dev agent, cross-web,
 * information→file, vision, parallel, memory, investigation, handle-it).
 * `generic` is the catch-all.
 */
export type MissionCategory =
  | "investigate"
  | "dev_env"
  | "organize_files"
  | "vision_verify"
  | "resources_digest"
  | "oss_contribute"
  | "news"
  | "research_compare"
  | "learn"
  | "prep_workspace"
  | "parallel"
  | "figure_it_out"
  | "generic";

// Order is significant: the FIRST match wins, so the more specific/skid-prone
// categories are tested before the broad ones (e.g. an "investigate why my dev
// environment is broken" goal must classify as `investigate`, not `dev_env`).
const CATEGORY_PATTERNS: Array<{ cat: MissionCategory; re: RegExp }> = [
  {
    // Explicit parallelism is the dominant intent — check it first so "open my
    // project AND research the error AT THE SAME TIME" is planned in parallel
    // rather than as a dev-env check.
    cat: "parallel",
    // NOTE: the verb must allow its -ing/-s form ("is starting"), which a
    // trailing \b after "start" would have rejected.
    re: /\b(in parallel|simultaneously|at the same time|while (?:my|the|it|that) [\s\S]{0,45}?\b(?:start|load|open|run|build|install)\w*|do whatever [\s\S]{0,30}parallel|both at once)\b/i,
  },
  {
    cat: "investigate",
    re: /\b(investigate|diagnose|root ?cause|find out (?:why|whether|if)|figure out (?:what(?:'s| is)|why|whether)|why (?:is|isn'?t|won'?t|doesn'?t|didn'?t|can'?t)|something (?:seems|is|feels) (?:wrong|off|broken)|isn'?t working|not working|still (?:actively )?maintained|worth (?:experimenting|using|trying)|actually free|really free|check its (?:github )?activity)\b/i,
  },
  {
    cat: "dev_env",
    re: /\b(dev(?:elopment)? (?:environment|server|setup)|check whether (?:it'?s|the (?:server|project|app) is|my (?:app|site|project) is) (?:running|up|online|working)|is (?:my|the) (?:server|dev server|app|project) (?:running|up|alive)|start my (?:dev|server|environment)|inspect (?:the|my) (?:project|codebase|repo)|my (?:jarvis )?project|project for (?:obvious )?issues|localhost|node_modules|dependencies (?:are )?(?:outdated|up to date|version)|\bdependenc\w*\b[\s\S]{0,50}\b(?:outdated|up.?to.?date|latest)\b|\boutdated (?:dependenc\w*|packages?|versions?)\b|\blatest version of\b[\s\S]{0,30}\bdependenc\w*\b)/i,
  },
  {
    cat: "organize_files",
    re: /\b(cluttered|clutter|tidy|clean ?up|organi[sz]e) (?:up )?(?:my )?(?:files?|folder|desktop|downloads?|documents?|laptop|computer|workspace)\b|\bmy (?:laptop|desktop|computer) is (?:cluttered|messy|a mess)\b|\b(?:undo|reverse|put back|restore)\b[\s\S]{0,40}\b(?:tidy|organi[sz]\w*|files?|folders?)\b|\b(?:something|anything|stuff)\b[\s\S]{0,20}\bon my (?:computer|laptop|pc|machine)\b|\bon (?:my|the) (?:computer|laptop|pc|machine)\b[\s\S]{0,50}\b(?:improv\w*|better|clean\w*|tidy|organi[sz]\w*|fix|take care)\b/i,
  },
  {
    cat: "vision_verify",
    re: /\b(visually (?:verify|inspect|check)|verify visually|does (?:the|it|this) (?:site|page|app|website) look|look(?:s)? (?:right|correct|broken)|find the (?:main )?(?:call[- ]to[- ]action|cta|button)|is it (?:actually )?(?:playing|open|working))\b/i,
  },
  {
    cat: "resources_digest",
    re: /\b(save (?:it|them|this|the (?:list|notes|findings))|create (?:a )?(?:file|notes?|summary|checklist)|notes? file|structured notes|send (?:it|me|them|the notes) (?:on|to|via) telegram|telegram)\b/i,
  },
  {
    cat: "oss_contribute",
    re: /\b(open[- ]?source|contribute|good first issue|beginner[- ]friendly|github (?:repo|repository|project|activity|issues)|inspect (?:its|the) (?:github )?(?:repo|repository)|is this (?:github )?project worth)\b/i,
  },
  {
    cat: "news",
    re: /\b(news|headlines?|biggest .{0,24}story|announced recently|latest developments|today'?s .{0,20}(?:ai|tech) (?:story|news)|what'?s (?:happening|new) in (?:tech|ai))\b/i,
  },
  {
    cat: "research_compare",
    re: /\b(research|compare|comparison|versus|\bvs\b|alternatives?|free (?:way|alternative|api|tool)|three (?:ai )?(?:tools|apis|sources|resources)|documentation|how (?:other|do) .{0,30}(?:agents?|tools?)|find (?:three|3|a few) .{0,30}(?:apis?|tools?|techniques|technolog))\b/i,
  },
  {
    cat: "learn",
    re: /\b(learn|study|tutorial|course|get me started|learning session|learn something|teach me|onboarding)\b/i,
  },
  {
    cat: "prep_workspace",
    re: /\b(prepare (?:my|the) (?:workspace|environment|desk)|set ?up (?:my )?(?:workspace|environment|coding|dev)|get me ready|coding session|workspace|focus session|prepare .{0,20}(?:session|workspace|environment))\b/i,
  },
  {
    cat: "figure_it_out",
    re: /\b(figure (?:it|this|that) out|you (?:decide|choose|pick)|your call|i (?:have|have got) (?:\d+|an?|two|three|four|five|six) ?(?:minutes|hours?|hrs?) (?:free|to spare)|nothing planned|make (?:this|the) time useful|handle it|just handle it|take care of it|do (?:whatever|something) (?:useful|productive)|most useful thing)\b/i,
  },
];

/** Classify a free-form goal into a mission category. Pure + zero-cost. */
export function classifyGoal(goal: string): MissionCategory {
  const g = (goal || "").trim();
  if (!g) return "generic";
  for (const { cat, re } of CATEGORY_PATTERNS) {
    if (re.test(g)) return cat;
  }
  return "generic";
}

/**
 * Pull a session length out of a goal ("90 minutes free", "two hours",
 * "under an hour"). Returns null when the goal states none.
 */
export function extractDurationMinutes(goal: string): number | null {
  const g = (goal || "").toLowerCase();
  const wordNumbers: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, half: 0.5, an: 1, a: 1 };
  // Numeric form: "90 minutes", "2 hours", "1.5 hrs".
  let m = g.match(/(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?|mins?|hours?|hrs?)\b/);
  if (m) {
    const n = parseFloat(m[1]);
    return /h/.test(m[0]) ? Math.round(n * 60) : Math.round(n);
  }
  // Word form: "two hours", "an hour", "half an hour".
  m = g.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|half|an|a)\s*(?:hours?|hrs?)\b/);
  if (m) return Math.round((wordNumbers[m[1]] ?? 1) * 60);
  m = g.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|half|an|a)\s*(?:min(?:ute)?s?|mins?)\b/);
  if (m) return Math.round(wordNumbers[m[1]] ?? 1);
  return null;
}

/** Strip instruction noise so a goal reads as a clean search query. */
export function cleanGoalQuery(goal: string, maxLen = 110): string {
  let s = (goal || "").trim().replace(/[.!]+$/, "");
  s = s.replace(/^(?:please\s+|jarvis[,\s]+|can you\s+|could you\s+|i want you to\s+|i'?d like you to\s+)/i, "");
  s = s.replace(/\b(?:and\s+)?(?:then\s+)?(?:open|show|launch|save|send|create|put|tell me|report)\b.*$/i, "").trim();
  if (!s) s = (goal || "").trim().replace(/[.!]+$/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, maxLen) || (goal || "").slice(0, maxLen);
}

/* ----------------------------- FALLBACK PLANNER ----------------------------- */

/**
 * Deterministic plan builder used when the LLM planner is unreachable (all
 * providers down / no key). Rather than failing the mission, JARVIS still
 * produces a coherent, executable plan for the goal's category. Steps are
 * ordered and parallelised the same way the LLM would. Never throws.
 */
export function fallbackPlan(goal: string, category: MissionCategory = classifyGoal(goal)): AgentPlan {
  const q = cleanGoalQuery(goal);
  const stated = extractDurationMinutes(goal);
  const wrap = (summary: string, steps: AgentStep[]): AgentPlan => ({ summary: `🧭 ${summary}`, steps });

  switch (category) {
    case "organize_files":
      if (/\b(?:undo|reverse|put back|restore)\b[\s\S]{0,40}\b(?:tidy|organi[sz]\w*|files?|folders?)\b/i.test(goal)) {
        return wrap("Undo the last tidy-up", [
          { id: "u1", kind: "file_organize", title: "Undo the last file tidy-up", params: { mode: "undo" } },
        ]);
      }
      return wrap("Tidy up your files", [
        { id: "o1", kind: "file_list", title: "Scan Downloads", params: { folder: "Downloads" } },
        { id: "o2", kind: "file_list", title: "Scan Desktop", params: { folder: "Desktop" } },
        { id: "o3", kind: "file_list", title: "Scan Documents", params: { folder: "Documents" } },
        {
          id: "o4",
          kind: "file_organize",
          title: "Plan a tidy-up for Downloads",
          params: { folder: "Downloads", mode: "by-type", dryRun: true },
          dependsOn: ["o1"],
        },
        {
          id: "o5",
          kind: "notify",
          title: "Report what can be tidied",
          params: { message: "I scanned your Downloads, Desktop and Documents folders and drafted a move plan. Review it in the mission report — nothing moves and nothing is deleted until you say go ahead." },
          dependsOn: ["o1", "o2", "o3", "o4"],
        },
        { id: "o6", kind: "task_create", title: "Add a tidy-up task", params: { title: "Review and clear out old files" } },
      ]);

    case "prep_workspace":
      return wrap("Prepare a focused workspace", [
        { id: "w1", kind: "shell_command", title: "Open VS Code", params: { command: "code", description: "Open the project in VS Code" } },
        { id: "w2", kind: "task_create", title: "Add a work task", params: { title: `Work session: ${q.slice(0, 60)}` } },
        { id: "w3", kind: "spotify_action", title: "Start focus music", params: { action: "play", query: "deep focus instrumental" } },
        { id: "w4", kind: "timer_set", title: "Start a focus timer", params: { minutes: stated ?? 90, label: "Focus session" } },
      ]);

    case "dev_env": {
      const wantsStart = /\b(start|launch|bring (?:it )?up|boot|spin up|run the (?:app|server|project))\b/i.test(goal);
      const steps: AgentStep[] = [
        { id: "d1", kind: "shell_command", title: "Check git status", params: { command: "git status", description: "Inspect the repository state" } },
      ];
      if (wantsStart) {
        steps.push({ id: "d2", kind: "dev_server_start", title: "Start the dev server", params: { port: 3000 } });
      }
      steps.push({
        id: "d3",
        kind: "dev_server_status",
        title: "Check the dev server",
        params: { port: 3000 },
        ...(wantsStart ? { dependsOn: ["d2"] } : {}),
      });
      steps.push({ id: "d4", kind: "repo_inspect", title: "Inspect the project + dependencies", params: {} });
      steps.push({
        id: "d5",
        kind: "notify",
        title: "Report environment status",
        params: { message: `Environment check for: ${q}. See the step outputs above for what needs attention.` },
        dependsOn: ["d1", "d3", "d4"],
      });
      return wrap("Check your development environment", steps);
    }

    case "investigate":
      return wrap("Investigate and report", [
        { id: "i1", kind: "shell_command", title: "Check the repo + toolchain", params: { command: "git status", description: "Inspect the repo state" } },
        { id: "i2", kind: "shell_command", title: "Probe the local server", params: { command: "curl -s -o /dev/null -w \"%{http_code}\" http://localhost:3000", description: "Probe localhost:3000" } },
        { id: "i3", kind: "firecrawl_search", title: "Research the symptoms", params: { query: q, limit: 5 } },
        { id: "i4", kind: "notify", title: "Report the evidence", params: { message: `Investigation complete for: ${q}. Evidence is in the step outputs above.` }, dependsOn: ["i1", "i2", "i3"] },
      ]);

    case "news":
      return wrap("Read across sources and brief you", [
        { id: "n1", kind: "firecrawl_search", title: "Find today's coverage", params: { query: q, limit: 6 } },
        { id: "n2", kind: "llm_summarize", title: "Compare the sources", params: { prompt: `Summarize the key story, what the sources agree on and where they differ: ${q}`, inputs: ["from:n1"] }, dependsOn: ["n1"] },
        { id: "n3", kind: "browser_open", title: "Open the most informative source", params: { url: "from:n1.urls", count: 1 }, dependsOn: ["n1"] },
      ]);

    case "research_compare":
      return wrap("Research, compare, and open the best", [
        { id: "r1", kind: "firecrawl_search", title: "Research the options", params: { query: q, limit: 6 } },
        { id: "r2", kind: "llm_summarize", title: "Build a comparison", params: { prompt: `Compare the options and note free-tier limits where relevant: ${q}`, inputs: ["from:r1"] }, dependsOn: ["r1"] },
        { id: "r3", kind: "llm_decide", title: "Pick the best option", params: { question: `Best option for: ${q}`, input: "from:r1" }, dependsOn: ["r1"] },
        { id: "r4", kind: "browser_open", title: "Open the best option", params: { url: "from:r3.url" }, dependsOn: ["r3"] },
      ]);

    case "oss_contribute":
      return wrap("Find an open-source project worth contributing to", [
        { id: "c1", kind: "firecrawl_search", title: "Find beginner-friendly repos", params: { query: `${q} good first issue beginner friendly`.trim(), limit: 6 } },
        { id: "c2", kind: "llm_decide", title: "Pick the best fit", params: { question: `Which open-source project fits best: ${q}`, input: "from:c1" }, dependsOn: ["c1"] },
        { id: "c3", kind: "browser_open", title: "Open the repository", params: { url: "from:c2.url" }, dependsOn: ["c2"] },
      ]);

    case "learn":
      return wrap("Set up a learning session", [
        { id: "l1", kind: "firecrawl_search", title: "Find a good resource", params: { query: `learn ${q} tutorial for beginners`.trim(), limit: 6 } },
        { id: "l2", kind: "browser_open", title: "Open the tutorial", params: { url: "from:l1.urls", count: 1 }, dependsOn: ["l1"] },
        { id: "l3", kind: "timer_set", title: "Start a learning timer", params: { minutes: stated ?? 45, label: "Learning session" } },
      ]);

    case "resources_digest":
      return wrap("Collect, organize, and deliver your resources", [
        { id: "x1", kind: "firecrawl_search", title: "Collect resources", params: { query: q, limit: 8 } },
        { id: "x2", kind: "llm_summarize", title: "Organize the list", params: { prompt: `Order these from beginner to advanced and summarize each in one line: ${q}`, inputs: ["from:x1"] }, dependsOn: ["x1"] },
        { id: "x3", kind: "file_save", title: "Save the notes", params: { filename: "jarvis_resources.md", content: "from:x2" }, dependsOn: ["x2"] },
        { id: "x4", kind: "telegram_send", title: "Send the notes to Telegram", params: { file: "from:x3" }, dependsOn: ["x3"] },
      ]);

    case "vision_verify":
      return wrap("Verify this visually", [
        { id: "v1", kind: "browser_act", title: "Carry out the web task", params: { task: goal, maxSteps: 8 } },
        { id: "v2", kind: "vision_inspect", title: "Verify the result visually", params: { question: `Did this succeed as requested: ${q}?` }, dependsOn: ["v1"] },
      ]);

    case "parallel":
      return wrap("Do the independent parts in parallel", [
        { id: "p1", kind: "firecrawl_search", title: "Research the topic", params: { query: q, limit: 5 } },
        { id: "p2", kind: "shell_command", title: "Open VS Code", params: { command: "code", description: "Open the project while research runs" } },
        { id: "p3", kind: "spotify_action", title: "Start focus music", params: { action: "play", query: "deep focus instrumental" } },
        { id: "p4", kind: "notify", title: "Report", params: { message: `Ran the independent parts of: ${q}` }, dependsOn: ["p1", "p2", "p3"] },
      ]);

    case "figure_it_out":
      return wrap("Decide something worthwhile and set it up", [
        { id: "f1", kind: "firecrawl_search", title: "Find the most worthwhile option", params: { query: `${q} productive useful thing to do or learn`.trim(), limit: 6 } },
        { id: "f2", kind: "llm_decide", title: "Choose the best option", params: { question: `Pick the single most useful, achievable option for: ${q}`, input: "from:f1" }, dependsOn: ["f1"] },
        { id: "f3", kind: "browser_open", title: "Open it and get started", params: { url: "from:f2.url" }, dependsOn: ["f2"] },
        { id: "f4", kind: "timer_set", title: "Start a session timer", params: { minutes: stated ?? 45, label: "Focus session" } },
      ]);

    case "generic":
    default:
      return wrap("Search, pick the best result, and open it", [
        { id: "g1", kind: "firecrawl_search", title: `Search the web for: ${q}`, params: { query: q, limit: 5 } },
        { id: "g2", kind: "llm_decide", title: "Pick the best result", params: { question: `Best match for: ${q}`, input: "from:g1" }, dependsOn: ["g1"] },
        { id: "g3", kind: "browser_open", title: "Open the best result", params: { url: "from:g2.url" }, dependsOn: ["g2"] },
      ]);
  }
}

/**
 * A one-line routing hint for the LLM planner. Keeps the model on the proven
 * step recipe for the recognised mission category instead of free-styling.
 */
export function categoryDirective(category: MissionCategory): string {
  switch (category) {
    case "organize_files":
      return "[ROUTING] File tidy-up mission: file_list across Downloads/Desktop/Documents, then file_organize (mode 'by-type', dryRun TRUE) to propose real moves into category folders. Report the plan; only set dryRun:false if the user explicitly said go ahead after a preview. For 'undo' / 'put my files back' emit a single file_organize step with mode:'undo'. NEVER delete. Do NOT use shell commands for files.";
    case "prep_workspace":
      return "[ROUTING] Workspace prep mission: exactly ONE music step (spotify_action) + ONE timer_set + shell_command 'code' to open the editor + task_create. No two music steps.";
    case "dev_env":
      return "[ROUTING] Dev-environment mission: dev_server_status to check the server, repo_inspect for the project/dependencies, shell_command for git status only. To START the app use dev_server_start (never shell_command), then dev_server_status to confirm it came up; finish with notify.";
    case "investigate":
      return "[ROUTING] Investigation mission: collect EVIDENCE (shell_command diagnostics + targeted firecrawl_search), then report findings; do not guess.";
    case "news":
      return "[ROUTING] News mission: firecrawl_search a few sources -> llm_summarize what they agree/disagree on -> browser_open the best one.";
    case "research_compare":
      return "[ROUTING] Research/compare mission: firecrawl_search -> llm_summarize (comparison) -> llm_decide -> browser_open the winner.";
    case "oss_contribute":
      return "[ROUTING] Open-source mission: search for beginner-friendly repos / good-first-issues -> llm_decide -> browser_open the repository.";
    case "learn":
      return "[ROUTING] Learning mission: firecrawl_search a quality adult-level resource -> browser_open -> timer_set a session. Never kids' content.";
    case "resources_digest":
      return "[ROUTING] Digest mission: firecrawl_search -> llm_summarize -> file_save (or notes_create) -> telegram_send when the user asked to be sent it.";
    case "vision_verify":
      return "[ROUTING] Visual-verification mission: use a browser_act (or browser_open) step and then vision_inspect to confirm the outcome visually.";
    case "parallel":
      return "[ROUTING] Parallel mission: the independent parts MUST have no dependsOn so they run concurrently.";
    case "figure_it_out":
      return "[ROUTING] Ambiguous 'just handle it' mission: DECIDE what to do yourself — firecrawl_search the best option -> llm_decide -> browser_open -> timer_set to start a session. Do not ask unnecessary questions.";
    case "generic":
    default:
      return "";
  }
}
