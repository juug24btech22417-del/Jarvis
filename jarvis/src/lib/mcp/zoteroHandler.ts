// Zotero MCP provider.
//
// WHY: JARVIS's research pipeline can search the open web but has no access to
// the *curated* corpus the user actually reads — their Zotero library, and
// more importantly their highlights and annotations. "Which of my saved papers
// support this claim, and what did I underline?" is answerable only from here.
//
// The underrated part is the LOCAL API: Zotero 7+ serves the same Web API
// shape on http://127.0.0.1:23119/api, so the whole library is readable with
// no API key and no data leaving the machine. The cloud API is the fallback
// for when the desktop app isn't running.
//
// Local API gotchas this handler surfaces instead of hiding:
//   • Zotero must be running (it *is* the server).
//   • "Allow other applications on this computer to communicate with Zotero"
//     must be enabled in Settings → Advanced, or every call 403s with
//     "Request not allowed".
//   • The `Zotero-API-Version` header is required on local requests.

import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

type Mode = "auto" | "local" | "cloud";

const LOCAL_BASE = process.env.ZOTERO_LOCAL_URL || "http://127.0.0.1:23119/api";
const CLOUD_BASE = "https://api.zotero.org";
const DOWNLOAD_URL = "https://www.zotero.org/download/";

/**
 * Where the Zotero desktop app lives, if it is installed at all.
 *
 * "Can't reach Zotero" and "Zotero isn't installed" are different problems
 * with different fixes, and the second one used to be indistinguishable from
 * the first — the user got "No Zotero source available" either way. Detection
 * is env-overridable because a portable install sits wherever the user put it.
 */
function zoteroAppCandidates(): string[] {
  const configured = process.env.ZOTERO_APP_PATH;
  if (configured) return [configured];
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    return [
      path.join(pf, "Zotero", "zotero.exe"),
      path.join(pf86, "Zotero", "zotero.exe"),
      ...(local ? [path.join(local, "Zotero", "zotero.exe"), path.join(local, "Programs", "Zotero", "zotero.exe")] : []),
    ];
  }
  if (process.platform === "darwin") return ["/Applications/Zotero.app", path.join(os.homedir(), "Applications", "Zotero.app")];
  return ["/usr/bin/zotero", "/usr/local/bin/zotero", path.join(os.homedir(), ".local", "bin", "zotero")];
}

function findZoteroApp(): { installed: boolean; path: string | null; checked: string[] } {
  const checked = zoteroAppCandidates();
  const found = checked.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  return { installed: !!found, path: found ?? null, checked };
}

type Resolved = { base: string; userId: string; headers: Record<string, string>; mode: "local" | "cloud" };

function cloudConfig() {
  const key = process.env.ZOTERO_API_KEY;
  const userId = process.env.ZOTERO_USER_ID;
  return key && userId ? { key, userId } : null;
}

type LocalProbe =
  | { state: "ok"; status: number }
  | { state: "permission"; message: string }
  | { state: "not-running"; detail: string }
  | { state: "unexpected"; detail: string; status: number };

/**
 * Ask Zotero's local API where it stands.
 *
 * Three outcomes matter to the user and need three different fixes: nothing is
 * listening (start the app), the app is listening but the permission is off
 * (turn it on), or something answered that is not Zotero (the port is taken).
 */
async function probeLocalApi(): Promise<LocalProbe> {
  const headersBase = { "Zotero-API-Version": "3", Accept: "application/json" };
  try {
    const res = await fetch(`${LOCAL_BASE}/users/0/collections?limit=1`, {
      headers: headersBase,
      signal: AbortSignal.timeout(4000),
    });
    if (res.status === 403) {
      return {
        state: "permission",
        message:
          'Zotero is open but refused the request: in Zotero enable Edit → Settings → Advanced → "Allow other applications on this computer to communicate with Zotero", then try again.',
      };
    }
    if (res.ok) {
      // Prove it really is Zotero answering, not another process on 23119.
      const body = await res.text();
      if (!/^\s*\[/.test(body)) {
        return { state: "unexpected", detail: `answered with non-Zotero body: ${body.slice(0, 80)}`, status: res.status };
      }
      return { state: "ok", status: res.status };
    }
    return { state: "unexpected", detail: `HTTP ${res.status}`, status: res.status };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    const code = e.cause?.code || e.name;
    return {
      state: "not-running",
      detail: code === "ECONNREFUSED" ? `Nothing is listening on ${LOCAL_BASE}` : `${code ? code + ": " : ""}${e.message}`.trim(),
    };
  }
}

/** The message a user gets when no transport works — with the actual fix. */
function noSourceMessage(detail: string): string {
  const app = findZoteroApp();
  const lines = ["No Zotero source available.", detail];
  if (app.installed) {
    lines.push(
      `The Zotero app is installed at ${app.path} — it just isn't running. Press "Start Zotero" in this tab (or open it yourself); JARVIS connects automatically once it is up.`
    );
  } else {
    lines.push(
      `Zotero does not appear to be installed on this machine (checked ${app.checked.join(", ")}). Install it from ${DOWNLOAD_URL}, open it once, then press "Start Zotero". It needs no API key in local mode.`
    );
  }
  lines.push(`Cloud fallback: set ZOTERO_API_KEY and ZOTERO_USER_ID in .env.local (this needs no desktop app).`);
  return lines.join(" ");
}

async function resolveEndpoint(mode: Mode = "auto"): Promise<Resolved> {
  const headersBase = { "Zotero-API-Version": "3", Accept: "application/json" };

  if (mode === "local" || mode === "auto") {
    const probe = await probeLocalApi();
    if (probe.state === "permission") {
      // A reachable-but-refusing server must be surfaced, never silently
      // replaced by a cloud fallback that hides the real problem.
      throw new Error(probe.message);
    }
    if (probe.state === "ok") return { base: LOCAL_BASE, userId: "0", headers: headersBase, mode: "local" };
    if (mode === "local") {
      throw new Error(noSourceMessage(`${probe.detail}.`));
    }
  }

  const cloud = cloudConfig();
  if (cloud) {
    return {
      base: CLOUD_BASE,
      userId: cloud.userId,
      headers: { ...headersBase, "Zotero-API-Key": cloud.key },
      mode: "cloud",
    };
  }

  const probe = await probeLocalApi();
  const detail =
    probe.state === "ok"
      ? "The local API answered but the request could not be completed."
      : probe.state === "permission"
        ? probe.message
        : `${probe.detail}.`;
  throw new Error(noSourceMessage(detail));
}

/**
 * Launch the Zotero desktop app and wait for its local API to answer.
 *
 * Starting the app is the one step a user cannot do from inside JARVIS, and it
 * is also the only reason the local (key-free) mode ever fails on a machine
 * that has Zotero installed — so JARVIS does it instead of describing it.
 */
async function actionLaunch(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const waitMs = Math.max(2_000, Number(params.waitMs ?? 45_000));
  const app = findZoteroApp();

  if (!app.installed) {
    throw new Error(
      `Zotero is not installed on this machine (checked ${app.checked.join(", ")}). Install it from ${DOWNLOAD_URL} — no API key is needed once it is running — or set ZOTERO_APP_PATH if it lives somewhere else.`
    );
  }

  // Already up? Nothing to launch.
  const before = await probeLocalApi();
  if (before.state === "ok") {
    return { launched: false, alreadyRunning: true, reachable: true, appPath: app.path, localApi: LOCAL_BASE };
  }
  if (before.state === "permission") {
    return { launched: false, alreadyRunning: true, reachable: false, appPath: app.path, error: before.message };
  }

  const child = spawn(app.path!, [], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();

  const deadline = Date.now() + waitMs;
  let last: LocalProbe = before;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_500));
    last = await probeLocalApi();
    if (last.state === "ok" || last.state === "permission") break;
  }

  if (last.state === "ok") {
    return { launched: true, reachable: true, appPath: app.path, localApi: LOCAL_BASE, seconds: Math.round((waitMs - (deadline - Date.now())) / 1000) };
  }
  return {
    launched: true,
    reachable: false,
    appPath: app.path,
    localApi: LOCAL_BASE,
    error:
      last.state === "permission"
        ? last.message
        : `Zotero was started from ${app.path} but its local API did not answer within ${Math.round(waitMs / 1000)}s (${last.state === "not-running" ? last.detail : last.detail}). If the app opened, give it a few more seconds and retry.`,
  };
}

async function zGet(r: Resolved, pathAndQuery: string, timeoutMs = 20_000) {
  const url = `${r.base}/users/${r.userId}${pathAndQuery}`;
  const res = await fetch(url, { headers: r.headers, signal: AbortSignal.timeout(timeoutMs) });
  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Zotero ${res.status} for ${pathAndQuery}: ${bodyText.slice(0, 300)}`);
  }
  return JSON.parse(bodyText);
}

function shapeItem(raw: any) {
  const d = raw?.data ?? {};
  return {
    key: d.key ?? raw?.key,
    version: d.version ?? raw?.version,
    itemType: d.itemType,
    title: d.title || "(untitled)",
    creators: (d.creators ?? []).map((c: any) => c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")).filter(Boolean),
    date: d.date ?? null,
    publication: d.publicationTitle ?? d.bookTitle ?? d.proceedingsTitle ?? d.publisher ?? null,
    doi: d.DOI ?? null,
    url: d.url ?? null,
    tags: (d.tags ?? []).map((t: any) => t.tag),
    collections: d.collections ?? [],
    abstractNote: d.abstractNote ? String(d.abstractNote).slice(0, 600) : null,
  };
}

async function actionStatus() {
  const cloud = cloudConfig();
  let local: { reachable: boolean; error: string | null } = { reachable: false, error: null };
  try {
    await resolveEndpoint("local");
    local = { reachable: true, error: null };
  } catch (err) {
    local = { reachable: false, error: (err as Error).message };
  }

  let active: string | null = null;
  let librarySize: number | null = null;
  try {
    const r = await resolveEndpoint("auto");
    active = r.mode;
    // The API reports the total in the Total-Results header; a small page is
    // enough to prove read access without pulling the whole library.
    const items = await zGet(r, "/items/top?limit=1");
    librarySize = Array.isArray(items) ? items.length : 0;
  } catch {
    // active stays null — status still reports what each transport said
  }

  const app = findZoteroApp();

  return {
    activeSource: active,
    local: { base: LOCAL_BASE, ...local },
    cloud: { configured: !!cloud, userId: cloud?.userId ?? null },
    app: { installed: app.installed, path: app.path, checked: app.checked },
    canLaunch: app.installed && local.reachable === false,
    sampleFetched: librarySize,
    hint: app.installed
      ? 'Local mode needs no key. In Zotero enable Edit → Settings → Advanced → "Allow other applications on this computer to communicate with Zotero" if you get a 403.'
      : `Zotero is not installed here — install it from ${DOWNLOAD_URL} for the key-free local mode, or set ZOTERO_API_KEY and ZOTERO_USER_ID for the cloud API.`,
  };
}

async function actionCollections() {
  const r = await resolveEndpoint();
  const raw = await zGet(r, "/collections?limit=100");
  return {
    source: r.mode,
    collections: (raw as any[]).map((c) => ({
      key: c.data.key,
      name: c.data.name,
      parentCollection: c.data.parentCollection || null,
      itemCount: c.meta?.numItems ?? null,
    })),
  };
}

async function actionItems(params: Record<string, unknown>) {
  const r = await resolveEndpoint();
  const limit = Math.min(Math.max(Number(params.limit ?? 25), 1), 100);
  const qs = new URLSearchParams({
    limit: String(limit),
    sort: String(params.sort ?? "dateAdded"),
    direction: String(params.direction ?? "desc"),
  });
  const q = params.query ? String(params.query) : params.q ? String(params.q) : "";
  if (q) qs.set("q", q);
  if (params.itemType) qs.set("itemType", String(params.itemType));
  if (params.collection) qs.set("collection", String(params.collection));

  const top = params.all !== true ? "/items/top" : "/items";
  const raw = await zGet(r, `${top}?${qs.toString()}`);
  return { source: r.mode, query: q || null, items: (raw as any[]).map(shapeItem) };
}

async function actionSearch(params: Record<string, unknown>) {
  const q = String(params.query ?? params.q ?? "").trim();
  if (!q) throw new Error("query is required");
  const r = await resolveEndpoint();
  const qs = new URLSearchParams({
    q,
    limit: String(Math.min(Math.max(Number(params.limit ?? 25), 1), 100)),
    qmode: String(params.qmode ?? "everything"),
  });
  const raw = await zGet(r, `/items/top?${qs.toString()}`);
  return { source: r.mode, query: q, count: (raw as any[]).length, items: (raw as any[]).map(shapeItem) };
}

async function actionItem(params: Record<string, unknown>) {
  const key = String(params.key ?? "").trim();
  if (!key) throw new Error("key is required");
  const r = await resolveEndpoint();
  const raw = await zGet(r, `/items/${key}`);
  return { source: r.mode, item: shapeItem(raw) };
}

/**
 * Annotations (highlights + notes) for one item. Annotations are children of
 * the item's PDF attachment, so this walks the child tree and flattens it.
 */
async function actionAnnotations(params: Record<string, unknown>) {
  const key = String(params.key ?? "").trim();
  if (!key) throw new Error("key is required");
  const r = await resolveEndpoint();
  const children = (await zGet(r, `/items/${key}/children?limit=100`)) as any[];

  const annotations: any[] = [];
  for (const child of children) {
    if (child.data?.itemType !== "attachment") continue;
    const attachmentKey = child.data.key;
    // Annotations live under the attachment, not the parent item.
    const subs = (await zGet(r, `/items/${attachmentKey}/children?limit=100`)) as any[];
    for (const s of subs) {
      if (s.data?.itemType !== "annotation") continue;
      annotations.push({
        attachment: child.data.title || attachmentKey,
        type: s.data.annotationType ?? null,
        text: s.data.annotationText ?? null,
        comment: s.data.annotationComment ?? null,
        color: s.data.annotationColor ?? null,
        page: s.data.annotationPageLabel ?? null,
        tags: (s.data.tags ?? []).map((t: any) => t.tag),
      });
    }
  }
  return { source: r.mode, key, annotationCount: annotations.length, annotations };
}

/** Recent imports — "what have I been reading lately". */
async function actionRecent(params: Record<string, unknown>) {
  const r = await resolveEndpoint();
  const days = Math.min(Math.max(Number(params.days ?? 14), 1), 365);
  const qs = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(params.limit ?? 25), 1), 100)),
    sort: "dateAdded",
    direction: "desc",
  });
  const raw = (await zGet(r, `/items/top?${qs.toString()}`)) as any[];
  const cutoff = Date.now() - days * 86_400_000;
  const items = raw.map(shapeItem).filter((i) => {
    const added = raw.find((x) => (x.data?.key ?? x.key) === i.key)?.data?.dateAdded;
    return added ? Date.parse(added) >= cutoff : true;
  });
  return { source: r.mode, days, count: items.length, items };
}

export async function handleZotero(action: string, params: Record<string, unknown>) {
  try {
    switch (action) {
      case "status":
        return { success: true, mcp: "zotero", action, data: await actionStatus() };
      case "launch":
        return { success: true, mcp: "zotero", action, data: await actionLaunch(params) };
      case "collections":
        return { success: true, mcp: "zotero", action, data: await actionCollections() };
      case "items":
        return { success: true, mcp: "zotero", action, data: await actionItems(params) };
      case "search":
        return { success: true, mcp: "zotero", action, data: await actionSearch(params) };
      case "item":
        return { success: true, mcp: "zotero", action, data: await actionItem(params) };
      case "annotations":
        return { success: true, mcp: "zotero", action, data: await actionAnnotations(params) };
      case "recent":
        return { success: true, mcp: "zotero", action, data: await actionRecent(params) };
      default:
        return {
          success: false,
          mcp: "zotero",
          error: `Unsupported zotero action '${action}'. Supported: status, launch, collections, items, search, item, annotations, recent.`,
        };
    }
  } catch (err) {
    return { success: false, mcp: "zotero", error: (err as Error).message };
  }
}
