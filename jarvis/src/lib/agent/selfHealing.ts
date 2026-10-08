// Self-healing integration registry for JARVIS.
//
// The problem this solves: integrations fail silently and stay broken. A route
// returning 404, a daemon that was never started, an expired key — each one
// surfaced only as a confusing error mid-task, and nothing ever fixed it.
//
// Design rules (deliberately conservative):
//  1. NOT every failure is healable, and pretending otherwise is worse than
//     admitting it. Every failure is classified first; only classes with a
//     real, safe repair get one.
//  2. A repair is only ever reported as successful if a RE-PROBE passes.
//     "I tried" is not "it works".
//  3. Repairs are bounded: allowlisted, attempt-capped, and rate-limited so a
//     broken integration can never turn into a restart loop.
//  4. Nothing destructive. This module starts processes it knows about and
//     reports everything else.

import { spawn } from "child_process";

export type FailureClass =
  | "transient"
  | "process_down"
  | "auth"
  | "config"
  | "gone"
  | "unknown";

export type HealthStatus = "healthy" | "degraded" | "down" | "unconfigured";

export interface ProbeResult {
  status: HealthStatus;
  /** Short human-readable detail, shown in the UI. */
  detail: string;
  /** Raw error text when something threw. */
  error?: string;
}

export interface IntegrationCheck extends ProbeResult {
  id: string;
  label: string;
  checkedAt: string;
  latencyMs: number;
  failureClass?: FailureClass;
  /** Whether this integration has a repair this module is willing to run. */
  repairable: boolean;
  healed?: boolean;
  repairLog?: string[];
}

export interface HealResult {
  id: string;
  attempted: boolean;
  healed: boolean;
  failureClass: FailureClass;
  log: string[];
  after?: ProbeResult;
  message: string;
}

interface Integration {
  id: string;
  label: string;
  /** Returns the current state. Must never throw — catch internally. */
  probe: () => Promise<ProbeResult>;
  /** Ordered repair playbook. Each returns a log line; throwing moves on. */
  repairs?: Array<{ name: string; run: () => Promise<string> }>;
}

// ── Failure classification ──────────────────────────────────────────────────

/**
 * Map an error/status into a failure class. Getting this right is the whole
 * point: a 429 is worth retrying, a missing key never is, and a deleted endpoint
 * should never trigger a restart loop.
 */
export function classifyFailure(input: {
  message?: string;
  status?: number;
  unreachable?: boolean;
}): FailureClass {
  const msg = (input.message || "").toLowerCase();
  const status = input.status;

  if (input.unreachable || /econnrefused|enotfound|econnreset|etimedout|fetch failed|network/.test(msg)) {
    return "process_down";
  }
  if (status === 429 || /\b429\b|rate.?limit|too many requests|overloaded|temporarily unavailable/.test(msg)) {
    return "transient";
  }
  if (status === 401 || status === 403 || /unauthor|invalid api key|forbidden|expired|token/.test(msg)) {
    return "auth";
  }
  if (status === 404 || status === 410 || /not found|deprecated|gone/.test(msg)) {
    return "gone";
  }
  if (/missing|not set|not configured|no api key|undefined env/.test(msg)) {
    return "config";
  }
  return "unknown";
}

// ── Integration definitions ─────────────────────────────────────────────────

const TIMEOUT_MS = 4500;

async function fetchStatus(url: string, init?: RequestInit): Promise<{ status: number; reached: boolean; text: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await res.text().catch(() => "");
    return { status: res.status, reached: true, text };
  } catch (e: any) {
    return { status: 0, reached: false, text: e?.message || "unreachable" };
  }
}

const WHATSAPP_URL = process.env.WHATSAPP_SERVER_URL || "http://localhost:3100";

const INTEGRATIONS: Integration[] = [
  {
    id: "whatsapp-bridge",
    label: "WhatsApp bridge",
    // Any HTTP answer — even a 400/404 — proves the daemon PROCESS is alive.
    // Only a refused connection means it is actually down. Depending on a
    // specific route would break the moment the daemon changes its paths.
    probe: async () => {
      const r = await fetchStatus(WHATSAPP_URL);
      if (!r.reached) {
        return { status: "down", detail: `No listener on ${WHATSAPP_URL}`, error: r.text };
      }
      if (r.status === 200) return { status: "healthy", detail: `Responding on ${WHATSAPP_URL}` };
      // Alive but not serving — e.g. WhatsApp Web session not linked yet.
      return { status: "degraded", detail: `Daemon up (HTTP ${r.status}) but not ready — scan the QR to link.` };
    },
    repairs: [
      {
        name: "start whatsapp-server.js",
        run: async () => {
          // Mirrors `npm run whatsapp:server`. Detached so it outlives this
          // request, and stdio ignored so it cannot block the Node process.
          const serverPath = "../whatsapp-server.js";
          const child = spawn(process.execPath, [serverPath], {
            cwd: process.cwd(),
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
          child.unref();
          // POLL for the listener rather than sleeping a fixed amount. First boot
          // launches Chromium and can take 10-30s; a fixed 3.5s wait reported a
          // FALSE failure (the daemon was up, just not yet bound to the port).
          const deadline = Date.now() + 30_000;
          let up = false;
          while (Date.now() < deadline) {
            try {
              await fetch(WHATSAPP_URL, { signal: AbortSignal.timeout(1500) });
              up = true;
              break;
            } catch {
              await new Promise((r) => setTimeout(r, 1000));
            }
          }
          return up
            ? `whatsapp-server.js listening on ${WHATSAPP_URL} (pid ${child.pid ?? "?"})`
            : `spawned whatsapp-server.js (pid ${child.pid ?? "?"}) but the port never opened`;
        },
      },
    ],
  },
  {
    id: "llm-groq",
    label: "Groq (fast lane)",
    probe: async () => {
      const key = process.env.GROQ_API_KEY;
      if (!key || key === "your-api-key-here") {
        return { status: "unconfigured", detail: "GROQ_API_KEY is not set", error: "missing key" };
      }
      // /models is free — no tokens billed, unlike a chat completion.
      const r = await fetchStatus("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.reached) return { status: "down", detail: "Groq unreachable", error: r.text };
      if (r.status === 200) return { status: "healthy", detail: "Key valid, endpoint up" };
      return { status: "degraded", detail: `Groq returned HTTP ${r.status}`, error: r.text.slice(0, 200) };
    },
  },
  {
    id: "llm-gemini",
    label: "Gemini (vision + JSON)",
    probe: async () => {
      const key = process.env.GEMINI_API_KEY;
      if (!key || key === "your-api-key-here") {
        return { status: "unconfigured", detail: "GEMINI_API_KEY is not set", error: "missing key" };
      }
      const r = await fetchStatus(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`
      );
      if (!r.reached) return { status: "down", detail: "Gemini unreachable", error: r.text };
      if (r.status === 200) return { status: "healthy", detail: "Key valid, endpoints up" };
      return { status: "degraded", detail: `Gemini returned HTTP ${r.status}`, error: r.text.slice(0, 200) };
    },
  },
  {
    id: "database",
    label: "Local database",
    probe: async () => {
      try {
        const { prisma } = await import("@/lib/db/queries");
        await prisma.$queryRaw`SELECT 1`;
        return { status: "healthy", detail: "Prisma reachable" };
      } catch (e: any) {
        return { status: "down", detail: "Database query failed", error: e?.message };
      }
    },
  },
  {
    id: "firecrawl",
    label: "Firecrawl (research)",
    probe: async () => {
      if (!process.env.FIRECRAWL_API_KEY) {
        return { status: "unconfigured", detail: "FIRECRAWL_API_KEY is not set", error: "missing key" };
      }
      const { firecrawlService } = await import("@/services/FirecrawlService");
      const info = await firecrawlService.getCredits();
      if (!info.success) {
        return { status: "down", detail: "Credit check failed", error: info.error };
      }
      const left = info.remainingCredits;
      if (typeof left === "number" && left <= 0) {
        return { status: "degraded", detail: "Out of credits for this period", error: "credit exhausted" };
      }
      return { status: "healthy", detail: typeof left === "number" ? `${left} credits left` : "Configured" };
    },
  },
  {
    id: "local-llm",
    label: "Ollama (offline lane)",
    probe: async () => {
      const base = process.env.OLLAMA_URL || "http://localhost:11434";
      const r = await fetchStatus(`${base}/api/tags`);
      if (!r.reached) return { status: "unconfigured", detail: `No Ollama on ${base}`, error: r.text };
      if (r.status === 200) return { status: "healthy", detail: "Ollama responding" };
      return { status: "degraded", detail: `Ollama HTTP ${r.status}`, error: r.text.slice(0, 200) };
    },
  },
];

// ── Heal bookkeeping (bounded, rate-limited) ────────────────────────────────

const HEAL_COOLDOWN_MS = 10 * 60_000;
const MAX_HEALS_PER_WINDOW = 3;

const healHistory = new Map<string, number[]>();

function healAllowed(id: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const recent = (healHistory.get(id) || []).filter((t) => now - t < HEAL_COOLDOWN_MS);
  healHistory.set(id, recent);
  if (recent.length >= MAX_HEALS_PER_WINDOW) {
    const waitMin = Math.ceil((HEAL_COOLDOWN_MS - (now - recent[0])) / 60_000);
    return { allowed: false, reason: `Already repaired ${recent.length}x in the last 10 min — waiting ${waitMin} min to avoid a restart loop.` };
  }
  return { allowed: true };
}

function integration(id: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.id === id);
}

export function listIntegrationIds(): string[] {
  return INTEGRATIONS.map((i) => i.id);
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function checkIntegration(id: string): Promise<IntegrationCheck | null> {
  const integ = integration(id);
  if (!integ) return null;

  const t0 = Date.now();
  let probe: ProbeResult;
  try {
    probe = await integ.probe();
  } catch (e: any) {
    // A probe must never take the whole sweep down with it.
    probe = { status: "down", detail: "Probe threw", error: e?.message };
  }
  const latencyMs = Date.now() - t0;

  const failureClass =
    probe.status === "healthy"
      ? undefined
      : probe.status === "unconfigured"
        ? "config"
        : classifyFailure({ message: probe.error, unreachable: probe.status === "down" });

  return {
    id: integ.id,
    label: integ.label,
    ...probe,
    checkedAt: new Date().toISOString(),
    latencyMs,
    failureClass,
    repairable: !!integ.repairs?.length && failureClass === "process_down",
  };
}

/** Check every integration in parallel — one slow probe cannot stall the rest. */
export async function checkAll(): Promise<IntegrationCheck[]> {
  const results = await Promise.all(INTEGRATIONS.map((i) => checkIntegration(i.id)));
  return results.filter((r): r is IntegrationCheck => r !== null);
}

export async function healIntegration(id: string): Promise<HealResult> {
  const integ = integration(id);
  if (!integ) {
    return { id, attempted: false, healed: false, failureClass: "unknown", log: [], message: `Unknown integration '${id}'.` };
  }

  const before = await checkIntegration(id);
  const failureClass = before?.failureClass ?? "unknown";

  if (before?.status === "healthy") {
    return { id, attempted: false, healed: true, failureClass: "unknown", log: [], after: before, message: `${integ.label} is already healthy.` };
  }

  // Honest branch: several classes have no safe automatic repair.
  if (failureClass !== "process_down") {
    const guidance: Record<FailureClass, string> = {
      transient: "Transient failure — retry in a moment; no repair needed.",
      auth: "Credentials were rejected. This needs a new key; I will not pretend to fix it.",
      config: `Configuration is missing. Set the relevant environment variable and restart.`,
      gone: "The endpoint is gone or was removed. Escalating instead of retrying blindly.",
      process_down: "Process is not running.",
      unknown: "Failure class is unclear, so no automatic repair is safe.",
    };
    return {
      id,
      attempted: false,
      healed: false,
      failureClass,
      log: [guidance[failureClass]],
      after: before ?? undefined,
      message: `${integ.label}: ${guidance[failureClass]}`,
    };
  }

  if (!integ.repairs?.length) {
    return {
      id,
      attempted: false,
      healed: false,
      failureClass,
      log: ["No repair playbook is defined for this integration."],
      after: before ?? undefined,
      message: `${integ.label} is down and has no automatic repair.`,
    };
  }

  const gate = healAllowed(id);
  if (!gate.allowed) {
    return { id, attempted: false, healed: false, failureClass, log: [gate.reason!], after: before ?? undefined, message: gate.reason! };
  }
  healHistory.set(id, [...(healHistory.get(id) || []), Date.now()]);

  const log: string[] = [];
  for (const repair of integ.repairs) {
    try {
      log.push(`ran: ${repair.name}`);
      log.push(await repair.run());
    } catch (e: any) {
      log.push(`failed: ${repair.name} — ${e?.message || "error"}`);
    }
  }

  // Verify. A repair is only successful if a fresh probe says so.
  const after = await checkIntegration(id);
  const healed = after?.status === "healthy" || after?.status === "degraded";

  log.push(healed ? `verified: ${after?.status}` : "verification failed — still not reachable");

  return {
    id,
    attempted: true,
    healed,
    failureClass,
    log,
    after: after ?? undefined,
    message: healed
      ? `${integ.label} was down and is now ${after?.status}.`
      : `${integ.label} was restarted but still is not responding.`,
  };
}

/** Heal every integration that is down AND has a repair, then re-report. */
export async function healAllBroken(): Promise<{ results: HealResult[]; health: IntegrationCheck[] }> {
  const before = await checkAll();
  const targets = before.filter((c) => c.status === "down" && c.repairable);
  const results: HealResult[] = [];
  for (const t of targets) {
    results.push(await healIntegration(t.id));
  }
  const health = await checkAll();
  return { results, health };
}

/** One-line summary for logs and the HUD. */
export function summarize(checks: IntegrationCheck[]): string {
  const down = checks.filter((c) => c.status === "down");
  const degraded = checks.filter((c) => c.status === "degraded");
  const unconfigured = checks.filter((c) => c.status === "unconfigured");
  if (!down.length && !degraded.length) {
    const notes = unconfigured.length ? ` (${unconfigured.length} not configured)` : "";
    return `All ${checks.length} integrations healthy${notes}.`;
  }
  const parts: string[] = [];
  if (down.length) parts.push(`DOWN: ${down.map((d) => d.label).join(", ")}`);
  if (degraded.length) parts.push(`degraded: ${degraded.map((d) => d.label).join(", ")}`);
  return parts.join(" | ");
}
