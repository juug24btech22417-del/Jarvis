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

  // ── music / video playback ─────────────────────────────────────────────
  m = g.match(/^(?:play|put on)\s+(.{2,80}?)\s+on spotify$/i);
  if (m) {
    return wrap(`Spotify: ${m[1]}`, [{ id: "m1", kind: "spotify_action", title: `Play ${m[1]}`, params: { action: "play", query: m[1] } }]);
  }
  m = g.match(/^(?:(?:open|go to) youtube and )?(?:play|watch|search|find)\s+(.{2,90}?)(?:\s+on youtube)?$/i);
  if (m && /youtube/i.test(g)) {
    return wrap(`YouTube: ${m[1]}`, [{ id: "y1", kind: "youtube_open", title: `Play ${m[1]}`, params: { query: m[1] } }]);
  }

  // ── find X and open it (the classic) ───────────────────────────────────
  m = g.match(/^(?:find|search for|look up|get me|recommend)(?: me)? (?:the )?(.{4,90}?)(?: and open (?:it|that|the best(?: one)?))?$/i);
  if (m && !tooComplex) {
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
