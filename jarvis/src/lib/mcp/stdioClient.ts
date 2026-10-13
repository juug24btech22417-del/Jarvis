// Managed MCP stdio client pool.
//
// JARVIS already had an MCP *gateway* (src/app/api/mcp/route.ts) but every
// provider in it was hand-written HTTP. Real MCP servers are child processes
// speaking JSON-RPC over stdio, and the whole point here is that the user
// never opens a terminal: the Next.js server spawns them, keeps them alive,
// and re-connects if one dies.
//
// The Chrome DevTools MCP server is the first client. Anything else that ships
// a stdio MCP binary can be added to SERVERS below.
//
// Notes that are easy to get wrong:
//   • The stdio transport must NOT inherit the whole process env. The SDK's
//     getDefaultEnvironment() forwards only a small allowlist, which keeps
//     NODE_OPTIONS and friends from breaking the child.
//   • We spawn the locally installed binary (node_modules) rather than
//     `npx -y pkg@latest`. npx hits the network on every cold start and can
//     block for seconds, which is what makes an "integrated" tool feel broken.
//   • Connection state is pinned to globalThis for the same reason the service
//     supervisor is — dev hot reloads re-evaluate this module.

import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpServerId = "chrome-devtools";

type ServerSpec = {
  id: McpServerId;
  label: string;
  /** Resolves the spawn target; may throw if the package is missing. */
  resolve: () => { command: string; args: string[] };
  setupHint: string;
};

/**
 * Absolute path to a package's binary, resolved on disk.
 *
 * `require.resolve("pkg/package.json")` is the neat way to do this and it does
 * NOT work here: chrome-devtools-mcp declares an `exports` map that does not
 * expose package.json, so resolution fails with MODULE_NOT_FOUND even though
 * the package is installed. Walking node_modules directly sidesteps the
 * exports policy and works in both the app and a monorepo layout.
 */
function resolvePackageBin(pkg: string, binRel: string): string {
  const roots: string[] = [];
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    roots.push(path.join(dir, "node_modules", pkg, binRel));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const found = roots.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(`${pkg} is not installed — looked for ${binRel} under node_modules. Install it with: npm i ${pkg}`);
  }
  return found;
}

export const SERVERS: Record<McpServerId, ServerSpec> = {
  "chrome-devtools": {
    id: "chrome-devtools",
    label: "Chrome DevTools",
    resolve: () => {
      const bin = resolvePackageBin("chrome-devtools-mcp", path.join("build", "src", "bin", "chrome-devtools-mcp.js"));
      const args = [bin];
      // Google collects tool-invocation telemetry by default, and the perf
      // tools ship trace URLs to the CrUX API. Both are opt-out and neither is
      // needed for local debugging, so JARVIS opts out for you.
      args.push("--no-usage-statistics", "--no-performance-crux");
      // Attach to an already-running Chrome instead of launching a second one.
      // JARVIS already runs a stealth Chrome; pointing at its debug port keeps
      // the logged-in profile (and avoids two Chromes fighting over the
      // profile lock).
      const browserUrl = process.env.JARVIS_DEVTOOLS_BROWSER_URL;
      if (browserUrl) args.push("--browserUrl", browserUrl);
      // Default headless: a debugging window popping up unprompted is worse
      // than the (rare) case where you wanted to watch it. Set
      // JARVIS_DEVTOOLS_HEADLESS=0 for a visible window.
      if (process.env.JARVIS_DEVTOOLS_HEADLESS !== "0") args.push("--headless");
      return { command: process.execPath, args };
    },
    setupHint:
      "Install the server with `npm i chrome-devtools-mcp` (already a dependency). " +
      "If it fails to launch, set JARVIS_DEVTOOLS_BROWSER_URL to a running Chrome's http://127.0.0.1:9222 and disable --headless with JARVIS_DEVTOOLS_HEADLESS=0.",
  },
};

type Entry = {
  client: Client | null;
  connecting: Promise<Client> | null;
  connectedAt: number | null;
  lastError: string | null;
  toolCount: number | null;
};

type Registry = { entries: Map<string, Entry> };
const g = globalThis as unknown as { __jarvisMcpPool?: Registry };
if (!g.__jarvisMcpPool) g.__jarvisMcpPool = { entries: new Map() };
const pool = g.__jarvisMcpPool;

function entryFor(id: string): Entry {
  let e = pool.entries.get(id);
  if (!e) {
    e = { client: null, connecting: null, connectedAt: null, lastError: null, toolCount: null };
    pool.entries.set(id, e);
  }
  return e;
}

async function connect(spec: ServerSpec): Promise<Client> {
  const e = entryFor(spec.id);
  if (e.client) return e.client;
  if (e.connecting) return e.connecting;

  e.connecting = (async () => {
    try {
      const { command, args } = spec.resolve();
      const transport = new StdioClientTransport({
        command,
        args,
        cwd: process.cwd(),
        env: { ...getDefaultEnvironment() },
        // stderr is captured so a failed launch reports *why* (missing Chrome,
        // bad flag) instead of a bare timeout.
        stderr: "pipe",
      });

      const client = new Client({ name: "jarvis", version: "1.0.0" }, { capabilities: {} });
      await client.connect(transport);

      const tools = await client.listTools();
      e.client = client;
      e.connectedAt = Date.now();
      e.lastError = null;
      e.toolCount = tools.tools.length;
      return client;
    } catch (err) {
      e.lastError = (err as Error).message;
      e.client = null;
      throw err;
    } finally {
      e.connecting = null;
    }
  })();

  return e.connecting;
}

export async function getClient(id: McpServerId): Promise<Client> {
  return connect(SERVERS[id]);
}

export type McpToolInfo = { name: string; description: string; inputSchema: unknown };

export async function listServerTools(id: McpServerId): Promise<McpToolInfo[]> {
  const client = await getClient(id);
  const res = await client.listTools();
  return res.tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema ?? {},
  }));
}

/**
 * Call a tool and flatten the MCP content blocks into something a UI can show.
 * Tool results are `{ content: [{type:"text"|"image", ...}], isError }`, not
 * plain JSON, so returning the raw result would force every caller to know the
 * shape.
 */
export async function callServerTool(
  id: McpServerId,
  tool: string,
  args: Record<string, unknown> = {},
  timeoutMs = 120_000
): Promise<{ text: string; images: string[]; isError: boolean; raw: unknown }> {
  const client = await getClient(id);
  const res = (await client.callTool({ name: tool, arguments: args }, undefined, {
    timeout: timeoutMs,
  })) as { content?: unknown[]; isError?: boolean };

  const text: string[] = [];
  const images: string[] = [];
  for (const block of res.content ?? []) {
    const b = block as { type?: string; text?: string; data?: string; mimeType?: string };
    if (b.type === "text" && typeof b.text === "string") text.push(b.text);
    else if (b.type === "image" && typeof b.data === "string") images.push(`data:${b.mimeType ?? "image/png"};base64,${b.data}`);
  }
  return { text: text.join("\n"), images, isError: !!res.isError, raw: res };
}

export function disconnect(id: McpServerId): boolean {
  const e = pool.entries.get(id);
  if (!e?.client) return false;
  void e.client.close().catch(() => {});
  e.client = null;
  e.connectedAt = null;
  e.toolCount = null;
  return true;
}

export function serverStatus(id: McpServerId) {
  const spec = SERVERS[id];
  const e = pool.entries.get(id);
  let resolvable = true;
  let resolveError: string | null = null;
  try {
    spec.resolve();
  } catch (err) {
    resolvable = false;
    resolveError = (err as Error).message;
  }
  return {
    id,
    label: spec.label,
    connected: !!e?.client,
    connectedAt: e?.connectedAt ?? null,
    toolCount: e?.toolCount ?? null,
    lastError: e?.lastError ?? resolveError,
    installed: resolvable,
    setupHint: spec.setupHint,
  };
}
