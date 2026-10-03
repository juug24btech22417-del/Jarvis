// Managed dev-server registry.
//
// `shell_command` is deliberately whitelisted to commands that FINISH on their
// own — it can never start a long-running server. This module is the escape
// hatch: it launches ONE detached child per (cwd, port), tracks its pid, keeps
// a bounded tail of its stdout/stderr, and can stop it cleanly. Because the
// registry lives at module scope, a later mission ("is my dev server still
// up?") can see a server started by an earlier one.

import { spawn, exec, type ChildProcess } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";

export interface ManagedServer {
  key: string;
  command: string;
  cwd: string;
  port: number;
  pid?: number;
  startedAt: number;
  logPath: string;
  proc?: ChildProcess;
  exited: boolean;
  exitCode: number | null;
  lines: string[];
}

export interface StartResult {
  ok: boolean;
  alreadyRunning: boolean;
  port: number;
  pid?: number;
  command: string;
  cwd: string;
  ready: boolean;
  httpStatus?: number;
  waitedMs: number;
  logPath: string;
  output: string;
  message: string;
}

export interface StatusResult {
  running: boolean;
  managed: boolean;
  port: number;
  pid?: number;
  ready: boolean;
  httpStatus?: number;
  uptimeMs?: number;
  command?: string;
  cwd?: string;
  output: string;
  message: string;
}

export interface StopResult {
  ok: boolean;
  port: number;
  pid?: number;
  message: string;
}

const LOG_LIMIT = 200;

/** Module-scoped registry — survives across missions within one server run. */
const servers = new Map<string, ManagedServer>();

function registryKey(cwd: string, port: number): string {
  return `${path.resolve(cwd)}::${port}`;
}

/**
 * Only launch commands that plausibly start a dev/static server. Anything else
 * (rm -rf, curl, arbitrary binaries) is refused.
 */
const ALLOWED_START =
  /^(?:npm\s+(?:run\s+)?(?:dev|start|serve|preview)|pnpm\s+(?:dev|start|run\s+\w+)|yarn\s+(?:dev|start)|bun\s+(?:run\s+)?(?:dev|start)|npx\s+(?:next|vite|serve|nodemon|http-server|wrangler)\b|node\s+\S+\.(?:js|mjs|cjs)|python\s+-m\s+http\.server|python3?\s+-m\s+http\.server)\b/i;

export function isAllowedStartCommand(command: string): boolean {
  const c = (command || "").trim();
  if (!c || c.length > 200) return false;
  if (/[;&|`$><]/.test(c)) return false; // no chaining / redirection
  return ALLOWED_START.test(c);
}

/** Tail of a managed server's captured output. */
export function serverOutput(s: ManagedServer, maxChars = 2500): string {
  const text = s.lines.join("\n");
  return text.length > maxChars ? text.slice(text.length - maxChars) : text;
}

export function listManagedServers(): Array<Pick<ManagedServer, "key" | "command" | "cwd" | "port" | "pid" | "startedAt" | "exited">> {
  return Array.from(servers.values()).map(({ key, command, cwd, port, pid, startedAt, exited }) => ({
    key, command, cwd, port, pid, startedAt, exited,
  }));
}

/** Is something accepting TCP connections on the port? */
export function isPortOpen(port: number, host = "127.0.0.1", timeoutMs = 900): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try {
      socket.connect(port, host);
    } catch {
      finish(false);
    }
  });
}

/** Poll an HTTP URL until it answers (or the budget runs out). */
export async function waitForHttp(
  port: number,
  timeoutMs: number,
  pathname = "/"
): Promise<{ ready: boolean; status?: number; waitedMs: number }> {
  const started = Date.now();
  const url = `http://127.0.0.1:${port}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  let lastStatus: number | undefined;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: "manual" });
      lastStatus = res.status;
      if (res.status > 0 && res.status < 500) {
        return { ready: true, status: res.status, waitedMs: Date.now() - started };
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ready: false, status: lastStatus, waitedMs: Date.now() - started };
}

function capture(s: ManagedServer, chunk: Buffer | string, stream: "out" | "err") {
  const text = chunk.toString();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    s.lines.push(stream === "err" ? `[stderr] ${line}` : line);
  }
  if (s.lines.length > LOG_LIMIT) s.lines.splice(0, s.lines.length - LOG_LIMIT);
  try {
    fs.appendFileSync(s.logPath, text);
  } catch {
    // logging is best-effort
  }
}

export interface StartOptions {
  command?: string;
  cwd?: string;
  port?: number;
  waitMs?: number;
  readyPath?: string;
}

/**
 * Launch (or adopt) a dev server.
 *
 * Idempotent: if something already answers on the port, or a tracked child is
 * still alive, it reports "already running" instead of starting a duplicate.
 */
export async function startDevServer(opts: StartOptions = {}): Promise<StartResult> {
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const port = Number(opts.port ?? 3000) || 3000;
  const command = (opts.command ?? "npm run dev").trim();
  const waitMs = Math.max(3000, Math.min(Number(opts.waitMs ?? 45_000), 120_000));
  const readyPath = opts.readyPath ?? "/";
  const key = registryKey(cwd, port);

  if (!isAllowedStartCommand(command)) {
    return {
      ok: false, alreadyRunning: false, port, command, cwd, ready: false, waitedMs: 0,
      logPath: "", output: "",
      message: `Refused to run "${command}": only dev/static server commands are allowed to be managed.`,
    };
  }

  const existing = servers.get(key);
  if (existing && !existing.exited) {
    const http = await waitForHttp(port, 5000, readyPath);
    return {
      ok: true, alreadyRunning: true, port, pid: existing.pid, command: existing.command, cwd,
      ready: http.ready, httpStatus: http.status, waitedMs: 0, logPath: existing.logPath,
      output: serverOutput(existing),
      message: `A dev server is already running on port ${port} (pid ${existing.pid ?? "?"}).`,
    };
  }

  // Something else owns the port — adopt it rather than double-bind.
  if (await isPortOpen(port)) {
    const http = await waitForHttp(port, 6000, readyPath);
    return {
      ok: true, alreadyRunning: true, port, command, cwd,
      ready: http.ready, httpStatus: http.status, waitedMs: http.waitedMs, logPath: "", output: "",
      message: `Port ${port} is already serving${http.status ? ` (HTTP ${http.status})` : ""} — nothing to start.`,
    };
  }

  const scratch = path.join(cwd, "scratch");
  try {
    if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
  } catch {
    // fall back to cwd
  }
  const logPath = path.join(fs.existsSync(scratch) ? scratch : cwd, `devserver-${port}.log`);
  const server: ManagedServer = {
    key, command, cwd, port, startedAt: Date.now(), logPath, exited: false, exitCode: null, lines: [],
  };
  servers.set(key, server);

  let child: ChildProcess;
  try {
    child = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: String(port) },
    });
  } catch (e) {
    servers.delete(key);
    return {
      ok: false, alreadyRunning: false, port, command, cwd, ready: false, waitedMs: 0, logPath, output: "",
      message: `Could not launch "${command}": ${(e as Error).message}`,
    };
  }

  server.proc = child;
  server.pid = child.pid;
  child.stdout?.on("data", (c) => capture(server, c, "out"));
  child.stderr?.on("data", (c) => capture(server, c, "err"));
  child.on("exit", (code) => {
    server.exited = true;
    server.exitCode = code;
  });
  // Let the server outlive this request / the Next.js process.
  child.unref();

  const http = await waitForHttp(port, waitMs, readyPath);
  const output = serverOutput(server);
  return {
    ok: true,
    alreadyRunning: false,
    port,
    pid: child.pid,
    command,
    cwd,
    ready: http.ready,
    httpStatus: http.status,
    waitedMs: http.waitedMs,
    logPath,
    output,
    message: http.ready
      ? `Dev server started on port ${port} (pid ${child.pid}) and is responding${http.status ? ` (HTTP ${http.status})` : ""}.`
      : `Dev server started on port ${port} (pid ${child.pid}) but did not respond within ${Math.round(waitMs / 1000)}s — check the log.`,
  };
}

/** Stop a server we started. Never kills a process we don't own. */
export async function stopDevServer(opts: { cwd?: string; port?: number } = {}): Promise<StopResult> {
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const port = Number(opts.port ?? 3000) || 3000;
  const key = registryKey(cwd, port);
  const server = servers.get(key);

  if (!server) {
    return { ok: false, port, message: `I'm not managing a server on port ${port}, so I won't kill anything there.` };
  }
  const pid = server.pid;
  if (server.exited || !pid) {
    servers.delete(key);
    return { ok: true, port, pid, message: `The managed server on port ${port} had already stopped.` };
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    if (process.platform === "win32") {
      // Kill the whole tree — `npm run dev` spawns next as a child.
      exec(`taskkill /PID ${pid} /T /F`, () => done());
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // already gone
        }
      }
      done();
    }
    setTimeout(done, 6000);
  });

  server.exited = true;
  const stillUp = await isPortOpen(port);
  if (!stillUp) servers.delete(key);
  return {
    ok: !stillUp,
    port,
    pid,
    message: stillUp
      ? `Sent stop to pid ${pid}, but port ${port} still answers — something else may own it.`
      : `Stopped the dev server on port ${port} (pid ${pid}).`,
  };
}

/** Is a dev server running — tracked by us or merely answering on the port? */
export async function devServerStatus(opts: { cwd?: string; port?: number } = {}): Promise<StatusResult> {
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  const port = Number(opts.port ?? 3000) || 3000;
  const key = registryKey(cwd, port);
  const server = servers.get(key);
  const managed = !!server && !server.exited;
  const open = await isPortOpen(port);
  const http = open ? await waitForHttp(port, 4000, "/") : { ready: false, status: undefined, waitedMs: 0 };

  if (managed) {
    return {
      running: true, managed: true, port, pid: server.pid, ready: http.ready, httpStatus: http.status,
      uptimeMs: Date.now() - server.startedAt, command: server.command, cwd: server.cwd,
      output: serverOutput(server),
      message: `Your dev server is up on port ${port} (pid ${server.pid}, ${Math.round((Date.now() - server.startedAt) / 1000)}s uptime)${http.status ? `, responding HTTP ${http.status}` : http.ready ? "" : " (not responding yet)"}.`,
    };
  }

  if (open) {
    return {
      running: true, managed: false, port, ready: http.ready, httpStatus: http.status, output: "",
      message: `Something is serving port ${port}${http.status ? ` (HTTP ${http.status})` : ""}, but I didn't start it.`,
    };
  }

  return {
    running: false, managed: false, port, ready: false, output: "",
    message: `Nothing is listening on port ${port} — no dev server is running.`,
  };
}
