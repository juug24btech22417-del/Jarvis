// Chrome DevTools MCP provider.
//
// WHY: JARVIS already drives a browser (Playwright + stealth) for scraping and
// automation, but when a flow fails it is blind — it knows a selector did not
// match, not that the site returned 403, threw a console error, or never fired
// the request. Chrome DevTools MCP exposes the inspector surface (network,
// console with source-mapped stacks, performance traces, screenshots) over the
// managed stdio client, so failures get diagnosed from evidence instead of
// guesswork.
//
// TWO THINGS THIS HANDLER HAS TO GET RIGHT
//
// 1. tool names change between releases, so they are resolved against the live
//    tool list rather than hard-coded — a hard-coded name that no longer exists
//    produces a confusing "not found".
//
// 2. 29 of the 30 tools require a `pageId`. Calling one without it returns
//    "Invalid arguments ... pageId: Invalid input: expected number, received
//    undefined", which tells the user nothing useful. So this handler resolves
//    the real page id from the server (list_pages), injects it when a tool
//    needs it, and — when a call still fails — explains *what* was missing,
//    *what* it was called with, and *what* to do next.

import { listServerTools, callServerTool, serverStatus, disconnect } from "@/lib/mcp/stdioClient";

type JsonSchema = {
  type?: string;
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
};

type Tool = { name: string; description: string; inputSchema: unknown };

type Cache = {
  tools: Tool[] | null;
  toolsAt: number;
  pageId: number | null;
  warnings: string[];
};

const g = globalThis as unknown as { __jarvisDevtools?: Cache };
if (!g.__jarvisDevtools) g.__jarvisDevtools = { tools: null, toolsAt: 0, pageId: null, warnings: [] };
const cache = g.__jarvisDevtools;

const TOOL_CACHE_MS = 30_000;

async function tools(force = false): Promise<Tool[]> {
  if (!force && cache.tools && Date.now() - cache.toolsAt < TOOL_CACHE_MS) return cache.tools;
  const all = await listServerTools("chrome-devtools");
  cache.tools = all;
  cache.toolsAt = Date.now();
  return all;
}

function schemaOf(tool: Tool): JsonSchema {
  return (tool.inputSchema ?? {}) as JsonSchema;
}

/**
 * Find the tool that best matches a desired capability. Name-only matching:
 * descriptions contain words like "page" in nearly every tool, so matching on
 * them picks the wrong one.
 */
function pickTool(all: Tool[], candidates: string[]): string | null {
  const names = all.map((t) => t.name);
  for (const c of candidates) if (names.includes(c)) return c;
  for (const c of candidates) {
    const hit = names.find((n) => n.endsWith(c));
    if (hit) return hit;
  }
  for (const c of candidates) {
    const hit = names.find((n) => n.includes(c));
    if (hit) return hit;
  }
  return null;
}

/**
 * Resolve the page id to address.
 *
 * The server lists pages as "## Pages\n1: about:blank [selected]". We prefer
 * the selected page (that is the one the user is actually looking at) and fall
 * back to the lowest-numbered page.
 */
async function resolvePageId(force = false): Promise<number | null> {
  if (!force && cache.pageId !== null) return cache.pageId;
  const all = await tools();
  const lister = pickTool(all, ["list_pages"]);
  if (!lister) return null;
  const res = await callServerTool("chrome-devtools", lister, {}, 30_000);
  if (res.isError) return null;

  const lines = res.text.split(/\r?\n/);
  const parsed = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)\s*:/);
      return m ? { id: Number(m[1]), selected: /\[selected\]/i.test(line) } : null;
    })
    .filter((x): x is { id: number; selected: boolean } => !!x);

  if (parsed.length === 0) return null;
  const chosen = parsed.find((p) => p.selected) ?? parsed[0];
  cache.pageId = chosen.id;
  return chosen.id;
}

/** Human-readable description of a tool's required arguments. */
function requiredArgs(schema: JsonSchema): string[] {
  return schema.required ?? [];
}

/**
 * Call a tool, filling in required defaults JARVIS can infer. Today that means
 * `pageId`; anything else genuinely required is reported as a clear error
 * rather than being sent as `undefined` for the server to complain about.
 */
async function callToolSmart(
  toolName: string,
  args: Record<string, unknown>
): Promise<{ text: string; images: string[]; isError: boolean; usedArgs: Record<string, unknown> }> {
  const all = await tools();
  const tool = all.find((t) => t.name === toolName);
  if (!tool) {
    throw new Error(
      `No such tool "${toolName}" on the Chrome DevTools MCP server. Available tools: ${all.map((t) => t.name).join(", ")}`
    );
  }

  const schema = schemaOf(tool);
  const usedArgs: Record<string, unknown> = { ...args };

  for (const req of requiredArgs(schema)) {
    if (usedArgs[req] !== undefined) continue;
    if (req === "pageId") {
      const pageId = await resolvePageId();
      if (pageId === null) {
        throw new Error(
          `"${toolName}" needs a pageId and no page is open. Open one first (DevTools tab → Inspect a URL), then retry.`
        );
      }
      usedArgs.pageId = pageId;
      continue;
    }
    const prop = schema.properties?.[req];
    throw new Error(
      `"${toolName}" requires "${req}"${prop?.type ? ` (${prop.type})` : ""}${prop?.description ? ` — ${prop.description}` : ""}. ` +
        `Provided: ${Object.keys(args).join(", ") || "(none)"}.`
    );
  }

  // A stale pageId (the page was closed) is the most common failure; retry once
  // against a freshly resolved page before reporting anything to the user.
  let res = await callServerTool("chrome-devtools", toolName, usedArgs);
  if (res.isError && typeof usedArgs.pageId === "number") {
    const fresh = await resolvePageId(true);
    if (fresh !== null && fresh !== usedArgs.pageId) {
      usedArgs.pageId = fresh;
      res = await callServerTool("chrome-devtools", toolName, usedArgs);
    }
  }

  return { text: res.text, images: res.images, isError: res.isError, usedArgs };
}

/** Turn a raw MCP tool failure into something actionable. */
function explainFailure(toolName: string, text: string, usedArgs: Record<string, unknown>): string {
  const raw = text.replace(/^Error:\s*/i, "").trim();
  const argsShown = JSON.stringify(usedArgs);

  if (/navigation timeout/i.test(raw)) {
    return `"${toolName}" could not finish loading within the tool's own timeout: ${raw}. Slow dev pages (a big local bundle) commonly exceed it — retry, or raise the tool's timeout argument if it has one. Args: ${argsShown}`;
  }
  if (/invalid arguments|expected .*, received/i.test(raw)) {
    return `"${toolName}" rejected its arguments: ${raw}. Args sent: ${argsShown}`;
  }
  if (/no page|page.*not found|target closed/i.test(raw)) {
    return `"${toolName}" could not find that page: ${raw}. Reopen the page (DevTools tab → Inspect a URL). Args: ${argsShown}`;
  }
  if (/timeout/i.test(raw)) {
    return `"${toolName}" timed out: ${raw}. Args: ${argsShown}`;
  }
  return `"${toolName}" failed: ${raw || "(no message from the server)"}. Args: ${argsShown}`;
}

async function actionStatus() {
  const st = serverStatus("chrome-devtools");
  if (!st.installed) {
    return { ...st, tools: [], toolNames: [], ready: false };
  }
  try {
    const all = await tools(true);
    // Touching list_pages proves the transport really works, not just that
    // initialize() answered.
    let page: number | null = null;
    let reachableNote = "connected";
    try {
      page = await resolvePageId(true);
    } catch (err) {
      reachableNote = `connected, but listing pages failed: ${(err as Error).message}`;
    }
    return {
      ...st,
      connected: true,
      ready: true,
      toolCount: all.length,
      toolNames: all.map((t) => t.name),
      currentPageId: page,
      note: reachableNote,
    };
  } catch (err) {
    return { ...st, connected: false, ready: false, toolNames: [], lastError: (err as Error).message };
  }
}

async function actionTools() {
  const all = await tools(true);
  return {
    count: all.length,
    tools: all.map((t) => ({
      name: t.name,
      description: t.description,
      required: requiredArgs(schemaOf(t)),
      properties: Object.keys(schemaOf(t).properties ?? {}),
    })),
  };
}

async function actionCall(params: Record<string, unknown>) {
  const tool = String(params.tool ?? "").trim();
  if (!tool) throw new Error("tool is required — pass the MCP tool name, e.g. \"take_snapshot\".");
  const args = (params.args ?? {}) as Record<string, unknown>;
  const res = await callToolSmart(tool, args);
  return {
    tool,
    args: res.usedArgs,
    isError: res.isError,
    text: res.isError ? explainFailure(tool, res.text, res.usedArgs) : res.text,
    images: res.images,
  };
}

/**
 * Convenience: navigate to a URL and return the resulting page state, so a
 * caller does not have to know four tool names (and the pageId dance) to
 * answer "what happened on this page".
 */
async function actionInspect(params: Record<string, unknown>) {
  const url = String(params.url ?? "").trim();
  if (!url) throw new Error("url is required, e.g. {\"url\": \"https://example.com\"}");

  const all = await tools();
  const warnings: string[] = [];
  const sections: { label: string; body: string; isError: boolean }[] = [];
  let images: string[] = [];

  const navigate = pickTool(all, ["navigate_page", "navigate", "open_page", "new_page"]);
  if (!navigate) {
    throw new Error(`No navigation tool on this server. Available: ${all.map((t) => t.name).join(", ")}`);
  }

  // Open a page if none exists yet, otherwise navigate the selected one.
  let pageId = await resolvePageId();
  if (pageId === null) {
    const opener = pickTool(all, ["new_page"]);
    if (!opener) throw new Error("No page is open and this server has no new_page tool to open one.");
    const opened = await callServerTool("chrome-devtools", opener, { url, timeout: 60_000 }, 90_000);
    if (opened.isError) {
      warnings.push(explainFailure(opener, opened.text, { url }));
    }
    pageId = await resolvePageId(true);
  } else {
    const nav = await callToolSmart(navigate, { pageId, url });
    if (nav.isError) warnings.push(explainFailure(navigate, nav.text, nav.usedArgs));
    else sections.push({ label: `navigation (${navigate})`, body: nav.text || "ok", isError: false });
  }

  if (pageId === null) {
    return {
      url,
      pageId: null,
      warnings,
      sections,
      images,
      summary:
        "Could not open or find a page, so no snapshot/console/network data was collected. The navigation error above is the cause.",
    };
  }

  const snapshotTool = pickTool(all, ["take_snapshot"]);
  if (snapshotTool) {
    const s = await callToolSmart(snapshotTool, { pageId });
    if (s.isError) warnings.push(explainFailure(snapshotTool, s.text, s.usedArgs));
    else {
      sections.push({ label: `page snapshot (${snapshotTool})`, body: s.text, isError: false });
      images = [...images, ...s.images];
    }
  }

  const consoleTool = pickTool(all, ["list_console_messages"]);
  if (consoleTool) {
    const c = await callToolSmart(consoleTool, { pageId });
    if (c.isError) warnings.push(explainFailure(consoleTool, c.text, c.usedArgs));
    else sections.push({ label: `console (${consoleTool})`, body: c.text || "(no console messages)", isError: false });
  }

  const networkTool = pickTool(all, ["list_network_requests"]);
  if (networkTool) {
    const n = await callToolSmart(networkTool, { pageId });
    if (n.isError) warnings.push(explainFailure(networkTool, n.text, n.usedArgs));
    else sections.push({ label: `network (${networkTool})`, body: n.text || "(no network requests)", isError: false });
  }

  return { url, pageId, warnings, sections, images };
}

async function actionConsole(params: Record<string, unknown>) {
  const all = await tools();
  const tool = pickTool(all, ["list_console_messages", "get_console_message"]);
  if (!tool) throw new Error(`No console tool found. Available: ${all.map((t) => t.name).join(", ")}`);
  const args: Record<string, unknown> = {};
  if (params.types) args.types = params.types;
  if (params.pageSize != null) args.pageSize = Number(params.pageSize);
  const res = await callToolSmart(tool, args);
  return {
    tool,
    isError: res.isError,
    messages: res.isError ? explainFailure(tool, res.text, res.usedArgs) : res.text,
  };
}

async function actionNetwork(params: Record<string, unknown>) {
  const all = await tools();
  const tool = pickTool(all, ["list_network_requests"]);
  if (!tool) throw new Error(`No network tool found. Available: ${all.map((t) => t.name).join(", ")}`);
  const args: Record<string, unknown> = {};
  if (params.pageSize != null) args.pageSize = Number(params.pageSize);
  const res = await callToolSmart(tool, args);
  return {
    tool,
    isError: res.isError,
    requests: res.isError ? explainFailure(tool, res.text, res.usedArgs) : res.text,
  };
}

/** Record a performance trace and stop it, returning the insights. */
async function actionPerf(params: Record<string, unknown>) {
  const all = await tools();
  const start = pickTool(all, ["performance_start_trace"]);
  const stop = pickTool(all, ["performance_stop_trace"]);
  if (!start || !stop) {
    throw new Error(
      `Performance tools are not available on this server (looked for performance_start_trace / performance_stop_trace). Available: ${all.map((t) => t.name).join(", ")}`
    );
  }

  const url = params.url ? String(params.url) : null;
  const warnings: string[] = [];
  if (url) {
    const nav = pickTool(all, ["navigate_page", "navigate", "open_page"]);
    if (nav) {
      const pageId = await resolvePageId();
      if (pageId !== null) {
        const navRes = await callToolSmart(nav, { pageId, url });
        if (navRes.isError) warnings.push(explainFailure(nav, navRes.text, navRes.usedArgs));
      }
    }
  }

  const started = await callToolSmart(start, {});
  if (started.isError) {
    return { url, startTool: start, stopTool: stop, isError: true, insights: "", warnings: [...warnings, explainFailure(start, started.text, started.usedArgs)] };
  }

  // Traces need a moment to settle before stopping.
  await new Promise((r) => setTimeout(r, Number(params.settleMs ?? 3000)));

  const stopped = await callToolSmart(stop, {});
  return {
    url,
    startTool: start,
    stopTool: stop,
    isError: stopped.isError,
    insights: stopped.isError ? "" : stopped.text,
    warnings: stopped.isError ? [...warnings, explainFailure(stop, stopped.text, stopped.usedArgs)] : warnings,
  };
}

export async function handleDevtools(action: string, params: Record<string, unknown>) {
  try {
    switch (action) {
      case "status":
        return { success: true, mcp: "devtools", action, data: await actionStatus() };
      case "tools":
        return { success: true, mcp: "devtools", action, data: await actionTools() };
      case "call":
        return { success: true, mcp: "devtools", action, data: await actionCall(params) };
      case "inspect":
        return { success: true, mcp: "devtools", action, data: await actionInspect(params) };
      case "console":
        return { success: true, mcp: "devtools", action, data: await actionConsole(params) };
      case "network":
        return { success: true, mcp: "devtools", action, data: await actionNetwork(params) };
      case "perf":
        return { success: true, mcp: "devtools", action, data: await actionPerf(params) };
      case "disconnect": {
        const ok = disconnect("chrome-devtools");
        cache.tools = null;
        cache.pageId = null;
        return { success: true, mcp: "devtools", action, data: { disconnected: ok } };
      }
      default:
        return {
          success: false,
          mcp: "devtools",
          error: `Unsupported devtools action '${action}'. Supported: status, tools, call, inspect, console, network, perf, disconnect.`,
        };
    }
  } catch (err) {
    return { success: false, mcp: "devtools", error: (err as Error).message };
  }
}
