// Local service supervisor — JARVIS owns its sidecar processes.
//
// WHY THIS EXISTS
// Several tools JARVIS wants (Docling for document conversion, the Chrome
// DevTools MCP server) are normally run by hand in a terminal. A tool the user
// has to start is a tool that is not running when they need it. This module
// makes the Next.js server itself the supervisor: it spawns each sidecar,
// keeps it alive, pipes its output to a log file, and reports honest health.
//
// DESIGN NOTES
//   • State is pinned to globalThis. Next.js dev recompiles route modules on
//     every edit; module-level state would be re-created and we would spawn a
//     second copy of every service on each save. Same reason MeetingBotService
//     is pinned this way.
//   • Spawn is always detached:false + windowsHide:true — the child dies with
//     the server (no orphaned python.exe holding a port) and never flashes a
//     console window.
//   • "Ready" means the health URL answered, not "the process started". A
//     process that spawns and immediately crashes looks identical to a healthy
//     one for the first few seconds, and that difference matters.

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

export type ServiceSpec = {
  /** Stable key — also the log file name. */
  name: string;
  /** Human label for the UI. */
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Polled until it answers 2xx; absence means "started" is good enough. */
  healthUrl?: string;
  /** How long to wait for readiness before giving up on this attempt. */
  readyTimeoutMs?: number;
  /** Shown in the UI when the service cannot start at all. */
  setupHint?: string;
};

export type ServiceState = {
  name: string;
  label: string;
  running: boolean;
  ready: boolean;
  pid: number | null;
  startedAt: number | null;
  lastExitAt: number | null;
  lastExitCode: number | null;
  restarts: number;
  lastError: string | null;
  logFile: string;
  setupHint?: string;
};

type Instance = {
  spec: ServiceSpec;
  child: ChildProcess | null;
  ready: boolean;
  startedAt: number | null;
  lastExitAt: number | null;
  lastExitCode: number | null;
  restarts: number;
  lastError: string | null;
  starting: Promise<boolean> | null;
};

type Registry = { instances: Map<string, Instance> };

// globalThis pinning — survives dev-server hot reloads.
const g = globalThis as unknown as { __jarvisServiceSupervisor?: Registry };
if (!g.__jarvisServiceSupervisor) g.__jarvisServiceSupervisor = { instances: new Map() };
const registry = g.__jarvisServiceSupervisor;

const SCRATCH = path.join(process.cwd(), "scratch");

function logFilePath(name: string): string {
  return path.join(SCRATCH, `${name}.log`);
}

function appendLog(name: string, line: string): void {
  try {
    fs.mkdirSync(SCRATCH, { recursive: true });
    // Timestamp every line so a "it stopped working" report has a timeline.
    fs.appendFileSync(logFilePath(name), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    // Logging must never be the reason a service fails to start.
  }
}

/** Last N lines of a service log, for the UI's diagnostics pane. */
export function readServiceLog(name: string, lines = 60): string[] {
  try {
    const raw = fs.readFileSync(logFilePath(name), "utf8");
    return raw.split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

async function pingHealth(url: string, timeoutMs = 2500): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok || (res.status >= 200 && res.status < 500);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Wait until the health URL answers, or the deadline passes.
 * Document conversion loads multi-hundred-MB models on first request, so the
 * readiness window is generous — but bounded, so a broken install fails loudly
 * instead of hanging the request that triggered it.
 */
async function waitForReady(spec: ServiceSpec, child: ChildProcess): Promise<boolean> {
  if (!spec.healthUrl) return true;
  const deadline = Date.now() + (spec.readyTimeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.killed) return false;
    if (await pingHealth(spec.healthUrl)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function buildEnv(spec: ServiceSpec): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Windows consoles use cp1252; python logging crashes on some unicode
    // unless the child is told to emit UTF-8.
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ...spec.env,
  };
}

/** Start a service if it is not already running. Idempotent and concurrency-safe. */
export async function ensureService(spec: ServiceSpec): Promise<boolean> {
  const existing = registry.instances.get(spec.name);
  if (existing) {
    if (existing.ready && existing.child && existing.child.exitCode === null) return true;
    // A start is already in flight — ride along instead of spawning a twin.
    if (existing.starting) return existing.starting;
  }

  const inst: Instance =
    existing ??
    {
      spec,
      child: null,
      ready: false,
      startedAt: null,
      lastExitAt: null,
      lastExitCode: null,
      restarts: 0,
      lastError: null,
      starting: null,
    };
  inst.spec = spec;
  registry.instances.set(spec.name, inst);

  const start = (async (): Promise<boolean> => {
    try {
      if (inst.child && inst.child.exitCode === null) {
        // Process alive from a previous attempt but not confirmed ready — just
        // re-check readiness rather than spawning a duplicate.
        inst.ready = await waitForReady(spec, inst.child);
        return inst.ready;
      }

      fs.mkdirSync(SCRATCH, { recursive: true });
      appendLog(spec.name, `spawn: ${spec.command} ${spec.args.join(" ")}`);

      const child = spawn(spec.command, spec.args, {
        cwd: spec.cwd ?? process.cwd(),
        env: buildEnv(spec),
        windowsHide: true,
        detached: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      inst.child = child;
      inst.startedAt = Date.now();
      inst.lastError = null;
      inst.ready = false;

      child.stdout?.on("data", (d: Buffer) => appendLog(spec.name, `out: ${d.toString().trimEnd()}`));
      child.stderr?.on("data", (d: Buffer) => appendLog(spec.name, `err: ${d.toString().trimEnd()}`));

      child.on("exit", (code, signal) => {
        inst.ready = false;
        inst.lastExitAt = Date.now();
        inst.lastExitCode = code;
        inst.child = null;
        appendLog(spec.name, `exit: code=${code} signal=${signal ?? "-"}`);
      });
      child.on("error", (err) => {
        inst.ready = false;
        inst.lastError = err.message;
        appendLog(spec.name, `spawn-error: ${err.message}`);
      });

      inst.ready = await waitForReady(spec, child);
      if (!inst.ready) {
        inst.lastError =
          inst.lastError ??
          `Service did not become ready within ${Math.round((spec.readyTimeoutMs ?? 90_000) / 1000)}s` +
            (spec.healthUrl ? ` (${spec.healthUrl})` : "");
        appendLog(spec.name, `not-ready: ${inst.lastError}`);
      }
      return inst.ready;
    } catch (err) {
      inst.lastError = (err as Error).message;
      inst.ready = false;
      appendLog(spec.name, `start-failed: ${inst.lastError}`);
      return false;
    } finally {
      inst.starting = null;
    }
  })();

  inst.starting = start;
  return start;
}

/** Kill a service (used by the UI's stop button and by tests). */
export function stopService(name: string): boolean {
  const inst = registry.instances.get(name);
  if (!inst?.child) return false;
  try {
    inst.child.kill();
  } catch {
    // Already gone — the exit handler will have cleared the handle.
  }
  inst.ready = false;
  return true;
}

export function getServiceState(name: string): ServiceState | null {
  const inst = registry.instances.get(name);
  if (!inst) return null;
  return toState(inst);
}

function toState(inst: Instance): ServiceState {
  const alive = !!inst.child && inst.child.exitCode === null;
  return {
    name: inst.spec.name,
    label: inst.spec.label,
    running: alive,
    ready: alive && inst.ready,
    pid: inst.child?.pid ?? null,
    startedAt: inst.startedAt,
    lastExitAt: inst.lastExitAt,
    lastExitCode: inst.lastExitCode,
    restarts: inst.restarts,
    lastError: inst.lastError,
    logFile: logFilePath(inst.spec.name),
    setupHint: inst.spec.setupHint,
  };
}

export function listServiceStates(): ServiceState[] {
  return [...registry.instances.values()].map(toState);
}
