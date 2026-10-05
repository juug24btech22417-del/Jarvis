// Browser agency — the real Playwright layer behind Mission Control.
//
// Exposes:
//   browserAct()       — autonomous perceive → decide → act loop on a live page
//   browserScreenshot()— capture visual evidence to the artifact store
//   browserLogin()     — headed sign-in that persists to a named profile
//   record/replay      — record a user's clicks into a saved workflow, replay it
//
// The agent is LLM-driven: it looks at a stamped snapshot of the page, picks
// the next action, performs it, and repeats until the task is done. Nothing
// here requires the user to say "playwright" — the planner decides to use it.

import path from "path";
import fs from "fs";
import { createAgentSession, type AgentSession, type PageElementRef } from "@/lib/browser/engine";
import { agentLlm, parseJsonLoose } from "@/lib/agent/llm";
import { saveArtifact } from "@/lib/agent/artifacts";
import { isLiveViewEnabled, publishLiveFrame, setLiveViewEnabled, clearLiveView } from "@/lib/agent/liveView";
import { feedScrollIntent, feedTargetForSite } from "@/lib/jarvis/commandRouting";
import { evaluateLoginSignal, isAuthUrl, loginMessage, type CookieLike } from "@/lib/agent/loginSignals";
import type { BrowserRecording } from "@/lib/agent/types";

export type Logger = (message: string, data?: Record<string, unknown>) => void;

const RECORDINGS_FILE = path.join(process.cwd(), ".jarvis-data", "recordings.json");

/* ----------------------------- FEED SCROLLING ----------------------------- */
//
// "Open Instagram and scroll reels until I stop" — Shorts/Reels/TikTok are
// snap-scroll feeds, and the only reliable way to drive them is a REAL browser
// the user is already signed into: the bundled Chromium gets a bot wall before
// the first video loads. This loop is deliberately NOT LLM-driven — a model
// call per scroll would be slow and expensive for what is just "press the down
// key, wait, repeat". It runs until stopped.

export interface FeedSessionInput {
  /** Natural-language request, e.g. "open instagram and scroll reels". */
  goal?: string;
  /** Explicit site key (youtube | instagram | tiktok | facebook | snapchat). */
  site?: string;
  /** ms between advances. Clamped: faster looks robotic, slower is dull. */
  intervalMs?: number;
  /** Mission job id when started from a mission (enables live frames). */
  jobId?: string;
}

interface FeedSession {
  id: string;
  label: string;
  url: string;
  mode: string;
  stopped: boolean;
  advanced: number;
  startedAt: number;
  lastError?: string;
  session_obj: AgentSession;
}

interface FeedGlobal {
  __jarvisFeedSessions?: Map<string, FeedSession>;
}
const feedGlobal = globalThis as unknown as FeedGlobal;

function feedSessions(): Map<string, FeedSession> {
  if (!feedGlobal.__jarvisFeedSessions) feedGlobal.__jarvisFeedSessions = new Map();
  return feedGlobal.__jarvisFeedSessions;
}

// A calm cadence: one advance every 10s by default, and it keeps going until
// stopped. Faster reads as a bot and is unpleasant to watch.
const FEED_DEFAULT_INTERVAL = 10_000;
const FEED_MIN_INTERVAL = 2_000;
const FEED_MAX_INTERVAL = 120_000;

// A feed that bounces to a sign-in page is not a feed. Scrolling a login form
// for ten minutes is worse than saying so, so detect it and stop.
const LOGIN_WALL_RE = /(\/accounts\/login|\/login|\/signin|\/sign-in|\/checkpoint|\/auth\/)/i;

// YouTube hands a logged-out visitor off to Google sign-in (or /sorry/) instead
// of playing Shorts, so the URL gives it away before the page even renders.
const BOT_WALL_RE = /(?:accounts\.google\.com|\/sorry\/|\/recaptcha|\/challenge)/i;

// Chrome's own error page. The browser never reached the site at all — which
// happens to a browser launched through the JARVIS proxy whenever the proxy is
// not running. Without this the loop happily "scrolled" an error page.
const DEAD_PAGE_RE = /^(?:chrome-error:\/\/|edge-error:\/\/|chrome:\/\/network-error)/i;

/**
 * A page that is really a sign-in form or a bot check is not a feed.
 *
 * Returns a message to show the user, or null when the page looks scrollable.
 * The tab is deliberately left open — the sign-in has to happen in the very
 * window JARVIS just raised, so closing it (as this used to) made the wall
 * impossible to clear.
 */
async function feedWall(session_obj: AgentSession, label: string): Promise<string | null> {
  const url = session_obj.url();
  if (!url || DEAD_PAGE_RE.test(url)) {
    return `${label} wouldn't load — the browser reported a connection error. If that browser is routed through the JARVIS proxy, it has no internet while the proxy is down: start JARVIS, or launch the browser with launch-jarvis-browser.bat.`;
  }
  if (LOGIN_WALL_RE.test(url)) {
    return `${label} asked me to sign in. I left that page open in your browser (${url}) — sign in once there and ask me again; the login is remembered.`;
  }
  if (BOT_WALL_RE.test(url)) {
    return `${label} bounced to a bot check (${url}). That page is open in your browser — clear it once and ask me again.`;
  }
  if (await session_obj.captcha().catch(() => false)) {
    return `${label} is showing a bot check instead of the feed. It is open in your browser — clear it once (or sign in) and ask me again.`;
  }
  return null;
}

/** Start scrolling a feed in the user's real browser. Runs until stopped. */
export async function startFeedScroll(
  input: FeedSessionInput
): Promise<{ id: string; label: string; url: string; mode: string }> {
  const target =
    (input.site ? feedTargetForSite(input.site) : null) ??
    feedScrollIntent(input.goal ?? "") ??
    feedScrollIntent(input.site ?? "");
  if (!target) {
    throw new Error('I couldn\'t tell which feed to open. Try "open instagram and scroll reels".');
  }

  // Real browser on purpose — headless hits the bot wall on both YouTube and
  // Instagram before a single video loads.
  const session_obj = await createAgentSession({ realBrowser: true });
  await session_obj.goto(target.url);

  // Surface a wall immediately rather than "scrolling" a sign-in form. The tab
  // stays open and in front so the user can actually clear the wall.
  const wall = await feedWall(session_obj, target.label);
  if (wall) throw new Error(wall);

  const id = `feed_${Date.now().toString(36)}`;
  const rec: FeedSession = {
    id,
    label: target.label,
    url: target.url,
    mode: "real-browser",
    stopped: false,
    advanced: 0,
    startedAt: Date.now(),
    session_obj,
  };
  feedSessions().set(id, rec);

  void runFeedLoop(rec, input.intervalMs, input.jobId);
  return { id, label: rec.label, url: rec.url, mode: rec.mode };
}

async function runFeedLoop(rec: FeedSession, intervalMs = FEED_DEFAULT_INTERVAL, jobId?: string): Promise<void> {
  const interval = Math.max(FEED_MIN_INTERVAL, Math.min(intervalMs, FEED_MAX_INTERVAL));
  if (jobId) setLiveViewEnabled(jobId, true);

  try {
    while (!rec.stopped) {
      try {
        // Shorts / Reels / TikTok all advance on ArrowDown in the web player.
        // Racing it against a short deadline matters: a CDP call into a busy
        // real tab can otherwise stall for the page timeout and freeze the
        // whole loop (which also made "stop" feel unresponsive).
        await Promise.race([
          rec.session_obj.pressKey("ArrowDown"),
          new Promise((r) => setTimeout(r, 3000)),
        ]);
        rec.advanced++;

        if (jobId && isLiveViewEnabled(jobId)) {
          const frame = await rec.session_obj.screenshotJpeg().catch(() => "");
          if (frame) {
            publishLiveFrame({
              jobId,
              stepId: rec.id,
              action: `scroll ${rec.advanced}`,
              url: rec.session_obj.url(),
              title: rec.label,
              frame,
            });
          }
        }
        // Mid-scroll redirect (session expired, or the bot check finally
        // served) — stop instead of pressing the down key on a login form
        // forever. The URL checks are free; the content check walks the DOM, so
        // it runs every third advance rather than on every 10s tick.
        const liveUrl = rec.session_obj.url();
        if (!liveUrl || DEAD_PAGE_RE.test(liveUrl)) {
          rec.lastError = "The page dropped out — stopped scrolling. Check that browser has internet.";
          break;
        }
        if (LOGIN_WALL_RE.test(liveUrl)) {
          rec.lastError = "Sign-in expired — stopped scrolling. Sign in again and ask me.";
          break;
        }
        if (
          BOT_WALL_RE.test(liveUrl) ||
          (rec.advanced % 3 === 0 && (await rec.session_obj.captcha().catch(() => false)))
        ) {
          rec.lastError = "A bot check appeared — stopped scrolling. Clear it once and ask me again.";
          break;
        }
      } catch (e) {
        rec.lastError = (e as Error)?.message?.split("\n")[0];
        break; // a closed tab means the user ended it themselves
      }
      // Interruptible wait, so "stop" lands immediately instead of after the
      // remainder of a full interval.
      const until = Date.now() + interval;
      while (!rec.stopped && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  } finally {
    await rec.session_obj.close().catch(() => {});
    if (jobId) clearLiveView(jobId);
    feedSessions().delete(rec.id);
  }
}

/** Stop one feed session (by id) or every running one. */
export function stopFeedScroll(id?: string): { stopped: string[] } {
  const stopped: string[] = [];
  for (const rec of feedSessions().values()) {
    if (id && rec.id !== id) continue;
    rec.stopped = true;
    stopped.push(rec.id);
  }
  return { stopped };
}

export function listFeedSessions() {
  return [...feedSessions().values()].map((r) => ({
    id: r.id,
    label: r.label,
    url: r.url,
    currentUrl: (() => {
      try {
        return r.session_obj.url();
      } catch {
        return r.url;
      }
    })(),
    mode: r.mode,
    advanced: r.advanced,
    startedAt: r.startedAt,
    lastError: r.lastError,
  }));
}

export function isFeedScrolling(): boolean {
  return feedSessions().size > 0;
}

/* ----------------------------- RECORDING STORE ----------------------------- */

interface RecGlobal {
  __jarvisRecordings?: BrowserRecording[];
  __jarvisLiveRecordings?: Map<string, LiveRecording>;
}
const rg = globalThis as unknown as RecGlobal;

function loadRecordings(): BrowserRecording[] {
  if (rg.__jarvisRecordings) return rg.__jarvisRecordings;
  let list: BrowserRecording[] = [];
  try {
    if (fs.existsSync(RECORDINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(RECORDINGS_FILE, "utf8"));
      if (Array.isArray(raw)) list = raw as BrowserRecording[];
    }
  } catch {
    list = [];
  }
  rg.__jarvisRecordings = list;
  return list;
}

function persistRecordings(list: BrowserRecording[]): void {
  try {
    const dir = path.dirname(RECORDINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RECORDINGS_FILE, JSON.stringify(list, null, 2), "utf8");
  } catch (e) {
    console.warn("[BrowserAgent] could not persist recordings:", (e as Error).message);
  }
}

export function listRecordings(): BrowserRecording[] {
  return loadRecordings().sort((a, b) => b.createdAt - a.createdAt);
}

export function getRecording(nameOrId: string): BrowserRecording | undefined {
  const key = (nameOrId || "").toLowerCase();
  return loadRecordings().find((r) => r.id === nameOrId || r.name.toLowerCase() === key);
}

function saveRecording(rec: BrowserRecording): void {
  const list = loadRecordings();
  const idx = list.findIndex((r) => r.id === rec.id);
  if (idx >= 0) list[idx] = rec;
  else list.unshift(rec);
  rg.__jarvisRecordings = list;
  persistRecordings(list);
}

/* ----------------------------- RECORDER ----------------------------- */

interface LiveRecording {
  id: string;
  name: string;
  session: string;
  startUrl: string;
  session_obj: AgentSession;
  steps: BrowserRecording["steps"];
  startedAt: number;
}

const RECORDER_INIT = `
(() => {
  try {
    if (window.__jvRecInstalled) return;
    window.__jvRecInstalled = true;
    function cssPath(el) {
      if (!el || el.nodeType !== 1) return "";
      if (el.id && /^[A-Za-z][\\w-]*$/.test(el.id)) return "#" + el.id;
      const parts = [];
      let node = el;
      let depth = 0;
      while (node && node.nodeType === 1 && depth < 5) {
        let sel = node.tagName.toLowerCase();
        if (node.getAttribute) {
          const nm = node.getAttribute("name");
          if (nm) { sel += "[name='" + nm + "']"; parts.unshift(sel); break; }
          const ph = node.getAttribute("placeholder");
          if (ph) { sel += "[placeholder='" + ph.replace(/'/g, "") + "']"; parts.unshift(sel); break; }
        }
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
          if (same.length > 1) sel += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
        }
        parts.unshift(sel);
        node = node.parentElement;
        depth++;
      }
      return parts.join(" > ");
    }
    function send(kind, el, value) {
      try {
        if (!window.__jvRec) return;
        window.__jvRec({
          kind,
          selector: cssPath(el),
          value: value == null ? "" : String(value).slice(0, 200),
          label: (el && (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder"))) ? String(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder")).trim().slice(0, 60) : "",
        });
      } catch (e) {}
    }
    document.addEventListener("click", (e) => send("click", e.target), true);
    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t && (t.tagName === "SELECT")) send("select", t, t.value);
      else send("fill", t, t.value);
    }, true);
    document.addEventListener("input", (e) => {
      const t = e.target;
      if (t && t.tagName === "INPUT" && t.type === "text") send("fill", t, t.value);
    }, true);
    document.addEventListener("keydown", (e) => { if (e.key === "Enter") send("press", e.target, "Enter"); }, true);
  } catch (e) {}
})()
`;

export async function startRecording(input: { name: string; url: string; session?: string }): Promise<{ id: string; message: string }> {
  if (!rg.__jarvisLiveRecordings) rg.__jarvisLiveRecordings = new Map();
  const sessionName = input.session || "recorded";
  const session_obj = await createAgentSession({ sessionName, headed: true });

  // Capture clicks / typing as the user drives the visible window.
  await session_obj.page.context().exposeBinding("__jvRec", (_src, payload: unknown) => {
    const rec = Array.from(rg.__jarvisLiveRecordings!.values()).find((r) => r.session_obj === session_obj);
    if (!rec) return;
    const p = payload as { kind: BrowserRecording["steps"][number]["kind"]; selector: string; value?: string; label?: string };
    // Collapse consecutive fills on the same field to the last value typed.
    const last = rec.steps[rec.steps.length - 1];
    if (p.kind === "fill" && last && last.kind === "fill" && last.selector === p.selector) {
      last.value = p.value;
      return;
    }
    rec.steps.push({ kind: p.kind, selector: p.selector, value: p.value, label: p.label });
  });
  await session_obj.page.addInitScript(RECORDER_INIT);
  await session_obj.goto(input.url);

  const id = `rec_${Date.now().toString(36)}`;
  rg.__jarvisLiveRecordings.set(id, {
    id,
    name: input.name || `Recording ${new Date().toLocaleString()}`,
    session: sessionName,
    startUrl: input.url,
    session_obj,
    steps: [{ kind: "navigate", url: input.url, label: input.url }],
    startedAt: Date.now(),
  });
  return { id, message: `Recording started — interact with the visible browser window, then stop.` };
}

export async function stopRecording(id: string): Promise<BrowserRecording | null> {
  const live = rg.__jarvisLiveRecordings?.get(id);
  if (!live) return null;
  try {
    await live.session_obj.close();
  } catch {
    // ignore
  }
  rg.__jarvisLiveRecordings!.delete(id);
  if (live.steps.length <= 1) return null; // nothing was recorded

  const rec: BrowserRecording = {
    id: live.id,
    name: live.name,
    session: live.session,
    startUrl: live.startUrl,
    steps: live.steps,
    createdAt: Date.now(),
    runs: 0,
  };
  saveRecording(rec);
  return rec;
}

/* ----------------------------- AGENT LOOP ----------------------------- */

const BROWSER_AGENT_SYSTEM = [
  "You are JARVIS's autonomous browser agent controlling a real Chromium page.",
  "You see a stamped list of interactive elements and a slice of the page text.",
  "Decide ONE next action per turn to accomplish the user's task.",
  "Return ONLY JSON with this shape:",
  '{"thought": "<short reason>", "action": {"type": "<type>", ...}}',
  "Allowed action types:",
  '  - {"type":"goto","url":"<absolute url>"}',
  '  - {"type":"click","ref": <element index>}',
  '  - {"type":"fill","ref": <element index>, "value":"<text>"}',
  '  - {"type":"press","value":"Enter"}',
  '  - {"type":"select","ref": <element index>, "value":"<option>"}',
  '  - {"type":"scroll","value":"down"|"up"}',
  '  - {"type":"wait"}',
  '  - {"type":"done","answer":"<final answer, with the key facts/numbers the task asked for>","url":"<current url>"}',
  "Rules:",
  "- Only use element indexes that exist in the list. To type, first fill the field (or click it then fill).",
  "- Prefer search boxes over guessing URLs. After filling a search field, press Enter.",
  "- When the task's information is visible on the page, return done with the answer — do not keep clicking.",
  "- If a cookie/consent banner blocks the page, click its accept button.",
  "- Never invent prices, dates or facts — only report what the page shows. If not found, say so in the answer.",
  "- Keep to at most one action per response.",
].join("\n");

interface AgentAction {
  type: "goto" | "click" | "fill" | "press" | "select" | "scroll" | "wait" | "done";
  ref?: number;
  value?: string;
  url?: string;
  answer?: string;
}

export interface BrowserActResult {
  summary: string;
  answer: string;
  finalUrl: string;
  title: string;
  actions: Array<{ type: string; detail: string }>;
  screenshots: string[];
  engine: "playwright";
}

/** True once the user (or a crash) has closed the page/window. */
function pageClosed(session_obj: AgentSession): boolean {
  try {
    return session_obj.page.isClosed();
  } catch {
    return true;
  }
}

/** Read the session cookies without throwing when the window is gone. */
async function cookiesOf(session_obj: AgentSession): Promise<CookieLike[]> {
  try {
    const cookies = await session_obj.page.context().cookies();
    return cookies.map((c) => ({ name: c.name, value: c.value }));
  } catch {
    return [];
  }
}

function elementListing(els: PageElementRef[]): string {
  return els
    .slice(0, 70)
    .map((e) => `[${e.i}] <${e.tag}${e.type ? ` type=${e.type}` : ""}> "${e.txt}"${e.nm ? ` name=${e.nm}` : ""}${e.ph ? ` placeholder="${e.ph}"` : ""}${e.href ? ` -> ${String(e.href).slice(0, 80)}` : ""}`)
    .join("\n");
}

/**
 * Autonomous browser run. If no URL is provided the agent starts at a search
 * engine so it can find the right page itself.
 */
export async function browserAct(opts: {
  task: string;
  url?: string;
  session?: string;
  maxSteps?: number;
  log?: Logger;
  jobId?: string;
  stepId?: string;
  /** Show the real Chromium window so the user can watch the run. */
  headed?: boolean;
  /** Return true when the mission was aborted — the loop exits promptly. */
  shouldStop?: () => boolean;
}): Promise<BrowserActResult> {
  const log = opts.log ?? (() => {});
  const maxSteps = Math.min(Math.max(opts.maxSteps ?? 8, 1), 14);
  const session_obj = await createAgentSession({
    sessionName: opts.session ? `mission_${opts.session.replace(/[^\w-]/g, "_")}` : undefined,
    headed: opts.headed === true,
  });
  const screenshots: string[] = [];
  const actions: Array<{ type: string; detail: string }> = [];

  const capture = async (label: string) => {
    if (!opts.jobId) return;
    try {
      const dataUrl = await session_obj.screenshotJpeg();
      const b64 = dataUrl.split(",")[1] ?? "";
      const file = saveArtifact(opts.jobId, `${label}_${Date.now()}.jpg`, Buffer.from(b64, "base64"));
      screenshots.push(file);
    } catch {
      // screenshot is best-effort evidence
    }
  };

  // Stream the current frame to the panel so the mission can be watched live.
  // Deliberately NON-BLOCKING: the screenshot happens in the background and
  // reuses the URL/title we already have, so streaming costs the agent loop
  // ~0ms (awaiting a screenshot + a full DOM snapshot per action used to add
  // a second or more to every step).
  let liveBusy = false;
  const live = (action: string, url: string, title: string) => {
    if (!opts.jobId || liveBusy || !isLiveViewEnabled(opts.jobId)) return;
    const jobId = opts.jobId;
    liveBusy = true;
    void session_obj
      .screenshotJpeg()
      .then((frame) => {
        publishLiveFrame({ jobId, stepId: opts.stepId ?? "browser_act", action, url, title, frame });
      })
      .catch(() => {})
      .finally(() => {
        liveBusy = false;
      });
  };

  try {
    const start = opts.url && opts.url.startsWith("http")
      ? opts.url
      : `https://www.google.com/search?q=${encodeURIComponent(opts.task.slice(0, 120))}`;
    log(`🌐 Browser agent starting at ${start.slice(0, 80)}`);
    await session_obj.goto(start);
    await session_obj.page.waitForTimeout(500);

    let lastSignature = "";
    let repeatCount = 0;
    let answer = "";
    live("loaded the page", session_obj.url(), "");

    let aborted = false;
    for (let step = 0; step < maxSteps; step++) {
      // Cooperative cancellation: Abort must stop the browser in flight, not
      // just the next step in the plan.
      if (opts.shouldStop?.()) {
        aborted = true;
        log("🛑 Aborted by user — stopping the browser agent");
        actions.push({ type: "cancelled", detail: "stopped by user" });
        break;
      }
      if (await session_obj.captcha()) {
        log("Bot wall detected — refreshing session fingerprint");
        await session_obj.freshen();
        await session_obj.goto(start);
      }

      const snap = await session_obj.snapshot();
      const history = actions.length
        ? actions.map((a, i) => `${i + 1}. ${a.type} ${a.detail}`).join("\n")
        : "(nothing yet)";
      const prompt = [
        `TASK: ${opts.task}`,
        `CURRENT URL: ${snap.url}`,
        `PAGE TITLE: ${snap.title}`,
        `\nACTIONS SO FAR:\n${history}`,
        `\nINTERACTIVE ELEMENTS:\n${elementListing(snap.els)}`,
        `\nPAGE TEXT (trimmed):\n${snap.text.slice(0, 1500)}`,
        `\nWhat is the ONE next action? Return JSON only.`,
      ].join("\n");

      let raw: string;
      try {
        raw = await agentLlm({ system: BROWSER_AGENT_SYSTEM, user: prompt, maxTokens: 500, temperature: 0.2, label: "browser-agent", json: true });
      } catch (e) {
        log(`Browser agent LLM unavailable (${String((e as Error).message).slice(0, 60)}) — returning what the page shows`);
        answer = await fallbackAnswer(session_obj);
        break;
      }

      const parsed = parseJsonLoose<{ thought?: string; action?: AgentAction }>(raw);
      const action = parsed?.action;
      if (!action || !action.type) {
        log("Browser agent produced no usable action — stopping");
        break;
      }

      if (action.type === "done") {
        answer = String(action.answer ?? "").trim();
        actions.push({ type: "done", detail: action.url ?? snap.url });
        await capture("final");
        live("finished — recording the answer", snap.url, snap.title);
        break;
      }

      const sig = `${action.type}:${action.ref ?? ""}:${action.value ?? ""}:${action.url ?? ""}`;
      if (sig === lastSignature) {
        repeatCount += 1;
        if (repeatCount >= 3) {
          log("Browser agent is repeating itself — stopping to avoid a loop");
          answer = await fallbackAnswer(session_obj);
          break;
        }
      } else {
        repeatCount = 0;
        lastSignature = sig;
      }

      try {
        switch (action.type) {
          case "goto":
            if (action.url?.startsWith("http")) {
              await session_obj.goto(action.url);
              actions.push({ type: "goto", detail: action.url.slice(0, 80) });
            }
            break;
          case "click":
            if (typeof action.ref === "number") {
              await session_obj.clickRef(action.ref);
              actions.push({ type: "click", detail: `[${action.ref}]` });
            }
            break;
          case "fill":
            if (typeof action.ref === "number") {
              await session_obj.fillRef(action.ref, String(action.value ?? ""));
              actions.push({ type: "fill", detail: `[${action.ref}] "${String(action.value ?? "").slice(0, 40)}"` });
            }
            break;
          case "press":
            await session_obj.pressKey(String(action.value ?? "Enter"));
            actions.push({ type: "press", detail: String(action.value ?? "Enter") });
            break;
          case "select":
            if (typeof action.ref === "number") {
              await session_obj.page.selectOption(`[data-jv="${action.ref}"]`, String(action.value ?? "")).catch(() => {});
              actions.push({ type: "select", detail: `[${action.ref}] ${action.value}` });
            }
            break;
          case "scroll":
            await session_obj.page.evaluate((dir) => window.scrollBy(0, dir === "up" ? -600 : 600), String(action.value ?? "down"));
            actions.push({ type: "scroll", detail: String(action.value ?? "down") });
            break;
          case "wait":
            await session_obj.page.waitForTimeout(900);
            actions.push({ type: "wait", detail: "" });
            break;
          default:
            log(`Browser agent asked for unknown action "${action.type}"`);
        }
      } catch (e) {
        log(`Browser action failed: ${String((e as Error).message).slice(0, 70)}`);
      }
      if (step === 0) await capture("start");
      // Publish after every action so the panel's live view tracks the run
      // (fire-and-forget — never on the critical path).
      live(
        `${action.type}${action.value ? ` "${String(action.value).slice(0, 40)}"` : ""}${typeof action.ref === "number" ? ` [${action.ref}]` : ""}`,
        session_obj.url(),
        snap.title
      );
    }

    if (!answer && !aborted) answer = await fallbackAnswer(session_obj);
    if (aborted) answer = "Aborted by the user before the task finished.";
    const finalUrl = session_obj.url();
    const title = (await session_obj.snapshot().catch(() => ({ title: "" }))).title || "";
    log(`🌐 Browser agent finished (${actions.length} action(s))${aborted ? " — aborted" : ""}`);

    return {
      summary: answer || "The browser agent completed the task but found no explicit answer.",
      answer,
      finalUrl,
      title,
      actions,
      screenshots,
      engine: "playwright",
    };
  } finally {
    await session_obj.close().catch(() => {});
  }
}

/** Last-resort answer: the visible page text, condensed. */
async function fallbackAnswer(session_obj: AgentSession): Promise<string> {
  try {
    const snap = await session_obj.snapshot();
    const text = snap.text.replace(/\s+/g, " ").slice(0, 600);
    return text ? `Page: ${snap.title}\n\n${text}` : "";
  } catch {
    return "";
  }
}

/* ----------------------------- SCREENSHOT ----------------------------- */

export async function browserScreenshot(opts: {
  url?: string;
  session?: string;
  label?: string;
  jobId?: string;
}): Promise<{ path: string | null; url: string; title: string }> {
  const session_obj = await createAgentSession({
    sessionName: opts.session ? `mission_${opts.session.replace(/[^\w-]/g, "_")}` : undefined,
  });
  try {
    if (opts.url?.startsWith("http")) await session_obj.goto(opts.url);
    const dataUrl = await session_obj.screenshotJpeg();
    const b64 = dataUrl.split(",")[1] ?? "";
    let file: string | null = null;
    if (opts.jobId) {
      file = saveArtifact(opts.jobId, `${opts.label || "screenshot"}_${Date.now()}.jpg`, Buffer.from(b64, "base64"));
    }
    const snap = await session_obj.snapshot().catch(() => ({ title: "" }));
    return { path: file, url: session_obj.url(), title: snap.title };
  } finally {
    await session_obj.close().catch(() => {});
  }
}

/* ----------------------------- LOGIN ----------------------------- */

export interface BrowserLoginResult {
  success: boolean;
  session: string;
  url: string;
  message: string;
  /** Which signal proved the session (for logs + tests). */
  reason: "cookie" | "url" | "none";
  /** True when the user closed the window before we saw a session. */
  closedByUser: boolean;
  /** True when the mission was aborted mid sign-in. */
  cancelled: boolean;
  /** How long the window was kept open. */
  elapsedMs: number;
}

/**
 * Open a VISIBLE browser so the user can sign in once; the session is saved
 * to the named profile and reused silently afterwards.
 *
 * The window STAYS OPEN for the whole `waitMs` window so the user can actually
 * finish signing in (type password, 2FA, captcha…). We only declare success on
 * a positive signal that cannot fire for an anonymous visitor:
 *   • a session cookie whose name looks like a real auth token AND that is new
 *     (or changed) versus the baseline taken right after load, or
 *   • we started on a sign-in page and have since left it, stably, after the
 *     settle window.
 * If the user closes the window first, nothing is claimed — the result says so.
 */
export async function browserLogin(opts: {
  site: string;
  url: string;
  session: string;
  waitMs?: number;
  log?: Logger;
  jobId?: string;
  stepId?: string;
  /** Return true when the mission was aborted — the window closes now. */
  shouldStop?: () => boolean;
}): Promise<BrowserLoginResult> {
  const log = opts.log ?? (() => {});
  const sessionName = `mission_${(opts.session || opts.site).replace(/[^\w-]/g, "_")}`;
  // 3 minutes by default: LinkedIn/Google with 2FA routinely takes longer than
  // the old 2 minutes, and it costs nothing to keep the window open.
  const budgetMs = Math.min(Math.max(opts.waitMs ?? 180_000, 20_000), 600_000);
  const deadline = Date.now() + budgetMs;

  const session_obj = await createAgentSession({ sessionName, headed: true });
  let closedByUser = false;
  let cancelled = false;
  let reason: "cookie" | "url" | "none" = "none";
  const startedAt = Date.now();

  const live = async (action: string) => {
    if (!opts.jobId || !isLiveViewEnabled(opts.jobId) || pageClosed(session_obj)) return;
    try {
      const frame = await session_obj.screenshotJpeg();
      publishLiveFrame({
        jobId: opts.jobId,
        stepId: opts.stepId ?? "browser_login",
        action,
        url: session_obj.url(),
        title: "Sign in",
        frame,
      });
    } catch {
      // best effort
    }
  };

  try {
    await session_obj.goto(opts.url);
    const baselineUrl = session_obj.url() || opts.url;
    const baselineCookies = await cookiesOf(session_obj);
    log(
      `🔐 A browser window is open on ${opts.site}. Sign in there — leave it open until you're done; JARVIS detects the sign-in and saves the session automatically (closing the window also ends the step).`
    );
    await live("waiting for you to sign in");

    let prevUrl = baselineUrl;
    let lastDetail = "waiting";
    const settleFrom = Date.now();

    while (Date.now() < deadline) {
      if (opts.shouldStop?.()) {
        cancelled = true;
        log("🛑 Aborted by user — closing the sign-in window");
        break;
      }
      if (pageClosed(session_obj)) {
        closedByUser = true;
        break;
      }
      await session_obj.page.waitForTimeout(2500);
      if (pageClosed(session_obj)) {
        closedByUser = true;
        break;
      }

      const currentUrl = session_obj.url() || baselineUrl;
      const currentCookies = await cookiesOf(session_obj);
      if (currentCookies.length === 0 && pageClosed(session_obj)) {
        closedByUser = true;
        break;
      }

      const signal = evaluateLoginSignal({
        startedAt: settleFrom,
        now: Date.now(),
        baselineUrl,
        currentUrl,
        urlStable: currentUrl === prevUrl,
        baselineCookies,
        currentCookies,
      });
      lastDetail = signal.detail;
      prevUrl = currentUrl;

      if (signal.signedIn) {
        reason = signal.reason;
        break;
      }
      await live(`waiting — ${lastDetail}`);
    }

    // The user closed the window: judge on what the last poll already saw
    // rather than inventing a result (or claiming a sign-in that never was).
    const success = reason !== "none";
    const finalUrl = pageClosed(session_obj) ? baselineUrl : session_obj.url();
    if (success) {
      log(`✅ Sign-in confirmed for ${opts.site} (${reason}) — saved to session "${opts.session}".`);
    } else {
      log(
        closedByUser
          ? `The ${opts.site} window was closed before a sign-in was detected — nothing saved.`
          : `No sign-in detected for ${opts.site} within ${Math.round(budgetMs / 1000)}s — nothing saved.`
      );
    }

    return {
      success,
      session: opts.session,
      url: finalUrl,
      reason,
      closedByUser,
      cancelled,
      elapsedMs: Date.now() - startedAt,
      message: loginMessage({ site: opts.site, success, reason, detail: lastDetail, closedByUser, cancelled }),
    };
  } finally {
    await session_obj.close().catch(() => {});
  }
}

/**
 * Verification helper: after a signal fires, reload the original URL and see
 * whether it now lands somewhere that is not a sign-in page. Kept exported so
 * the executor can use it for extra confidence on real sessions.
 */
export async function loginLooksVerified(session_obj: AgentSession, originalUrl: string): Promise<boolean> {
  if (!isAuthUrl(originalUrl)) return true;
  try {
    await session_obj.goto(originalUrl);
    return !isAuthUrl(session_obj.url());
  } catch {
    return false;
  }
}

/* ----------------------------- REPLAY ----------------------------- */

export async function replayRecording(opts: {
  recording: BrowserRecording;
  log?: Logger;
  jobId?: string;
  /** Return true when the mission was aborted — replay stops between steps. */
  shouldStop?: () => boolean;
}): Promise<{ summary: string; url: string; steps: number; screenshots: string[]; cancelled?: boolean }> {
  const log = opts.log ?? (() => {});
  const rec = opts.recording;
  const session_obj = await createAgentSession({
    sessionName: rec.session ? `mission_${rec.session.replace(/[^\w-]/g, "_")}` : undefined,
  });
  const screenshots: string[] = [];
  let executed = 0;
  let cancelled = false;
  try {
    log(`▶️ Replaying "${rec.name}" (${rec.steps.length} step(s))`);
    for (const step of rec.steps) {
      if (opts.shouldStop?.()) {
        cancelled = true;
        log("🛑 Aborted by user — stopping the replay");
        break;
      }
      try {
        switch (step.kind) {
          case "navigate":
            if (step.url) await session_obj.goto(step.url);
            break;
          case "click":
            if (step.selector) await session_obj.page.click(step.selector, { timeout: 8000 });
            break;
          case "fill":
            if (step.selector) await session_obj.page.fill(step.selector, String(step.value ?? ""), { timeout: 8000 });
            break;
          case "select":
            if (step.selector) await session_obj.page.selectOption(step.selector, String(step.value ?? "")).catch(() => {});
            break;
          case "press":
            await session_obj.pressKey(String(step.value ?? "Enter"));
            break;
          case "scroll":
            await session_obj.page.evaluate(() => window.scrollBy(0, 600));
            break;
          case "wait":
            await session_obj.page.waitForTimeout(1000);
            break;
        }
        executed += 1;
        await session_obj.page.waitForTimeout(250);
      } catch (e) {
        log(`Replay step "${step.kind}" failed: ${String((e as Error).message).slice(0, 60)}`);
      }
    }
    if (opts.jobId) {
      try {
        const dataUrl = await session_obj.screenshotJpeg();
        const b64 = dataUrl.split(",")[1] ?? "";
        screenshots.push(saveArtifact(opts.jobId, `replay_${Date.now()}.jpg`, Buffer.from(b64, "base64")));
      } catch {
        // best effort
      }
    }
    const url = session_obj.url();
    rec.runs = (rec.runs ?? 0) + 1;
    saveRecording(rec);
    const snap = await session_obj.snapshot().catch(() => ({ text: "", title: "" }));
    return {
      summary: cancelled
        ? `Aborted "${rec.name}" — ${executed}/${rec.steps.length} step(s) executed before you stopped it.`
        : `Replayed "${rec.name}" — ${executed}/${rec.steps.length} step(s) executed on ${snap.title || url}.`,
      url,
      steps: executed,
      screenshots,
      cancelled,
    };
  } finally {
    await session_obj.close().catch(() => {});
  }
}
