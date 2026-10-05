// JARVIS Browser Engine — one hardened Playwright core for everything.
//
// Used by /api/browser (panel workflows), the AI agent, and watchers.
// Design rules:
//  - Stealth: playwright-extra + stealth plugin (bot pages are the #1 killer)
//  - Navigation: domcontentloaded + capped load wait. NEVER networkidle.
//  - Fail soft per action; a global deadline still yields a screenshot.
//  - JPEG screenshots (quality 70) — ~5x lighter than PNG for the panel.
//  - Launch mutex: concurrent requests must not race the browser launch.
//  - Captcha detection: report bot-walls in plain language instead of
//    timing out on selectors that will never appear.

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { mkdir } from "fs/promises";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import path from "path";

chromiumExtra.use(StealthPlugin());

// Must match the ACTUAL Chromium version Playwright drives. A UA claiming
// 131 while the binary is 143 is one of the strongest bot tells there is —
// Amazon's wall keys on it. Keep in sync with the installed playwright pkg.
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// Exact brand/version list Chrome 143 sends. Mismatched or missing
// sec-ch-ua brands make the client hints disagree with the UA string —
// another easy bot fingerprint.
const CHROME_BRANDS = "\"Chromium\";v=\"143\", \"Google Chrome\";v=\"143\", \"Not:A-Brand\";v=\"24\"";

// Warm, non-headless-shaped viewport. Amazon/Swiggy/Zomato walls flag the
// classic 1280x720 (and identical-across-runs) viewports.
const VIEWPORT_POOL = [
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1600, height: 900 },
  { width: 1512, height: 982 },
];

function pickViewport() {
  const v = VIEWPORT_POOL[Math.floor(Math.random() * VIEWPORT_POOL.length)];
  return { width: v.width, height: v.height };
}

// ─── Launch mutex + singleton ───────────────────────────────────────

let browserInstance: Browser | null = null;
let launchPromise: Promise<Browser> | null = null;

export async function getBrowser(headed = false): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    // Can't flip headed/headless on a live instance; caller gets what exists.
    return browserInstance;
  }
  if (!launchPromise) {
    launchPromise = (headed ? chromium : chromiumExtra)
      .launch({
        headless: !headed,
        args: [
          // The #1 tell headless Chrome leaks. navigator.webdriver must be
          // undefined, not true, or Flipkart/Amazon walls the session.
          "--disable-blink-features=AutomationControlled",
          // Playwright injects --enable-automation by default; it flips
          // navigator.webdriver and shows the "browser is being controlled"
          // infobar. Amazon's captcha farm detects it instantly.
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-infobars",
          "--window-size=1536,864",
          "--lang=en-IN",
        ],
        ignoreDefaultArgs: ["--enable-automation"],
      })
      .then((b) => {
        browserInstance = b;
        return b;
      })
      .finally(() => {
        launchPromise = null;
      });
  }
  return launchPromise;
}

// ─── Contexts: fresh or persistent (logged-in sessions) ─────────────

export interface SessionOptions {
  sessionName?: string; // use a persistent profile (stays logged in)
  headed?: boolean;
  /**
   * Drive the user's REAL Chrome (attached or freshly launched) instead of the
   * bundled Chromium. No amount of stealth patching fixes the bundled binary:
   * YouTube/Instagram/Amazon wall it on the executable fingerprint alone, and
   * the user is not signed in there anyway. A real Chrome has their session.
   */
  realBrowser?: boolean;
}

export async function newContext(browser: Browser, opts: SessionOptions = {}): Promise<BrowserContext> {
  const stealthContext = {
    userAgent: BROWSER_UA,
    // Randomized per context: identical viewports across runs are a
    // fingerprint; a stable pool of real desktop sizes looks human.
    viewport: pickViewport(),
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
      // Client hints must agree with the UA string or walls flag the session.
      "sec-ch-ua": CHROME_BRANDS,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
    },
  };
  if (opts.sessionName) {
    const dir = path.join(process.cwd(), ".browser-sessions", opts.sessionName.replace(/[^\w-]/g, "_"));
    await mkdir(dir, { recursive: true });
    return (headed(opts) ? chromium : chromiumExtra).launchPersistentContext(dir, {
      headless: !headed(opts),
      ...stealthContext,
    });
  }
  const ctx = browser.newContext({ ...stealthContext, ignoreHTTPSErrors: true });
  return ctx.then(async (c) => {
    await applyStealthInitScript(c);
    return c;
  });
}

// Patch the leakiest JS fingerprints BEFORE any page script runs. The
// stealth plugin only fixes the launch binary — per-context JS patches
// still need doing by hand.
async function applyStealthInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // navigator.webdriver must be undefined, never true.
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => undefined });
    // A chrome object with a plausible runtime (headless omits it).
    if (!(window as unknown as { chrome?: unknown }).chrome) {
      (window as unknown as { chrome: unknown }).chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}) };
    }
    // Permissions.query must not contradict itself for notifications.
    const origQuery = window.Notification && navigator.permissions?.query?.bind(navigator.permissions);
    if (origQuery) {
      navigator.permissions.query = (p: PermissionDescriptor) =>
        p.name === "notifications" ? Promise.resolve({ state: Notification.permission } as PermissionStatus) : origQuery(p);
    }
    // Consistent plugins/mimeTypes lengths (headless reports 0).
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-IN", "en-GB", "en"] });
    // WebGL vendor/renderer: real GPU strings, not SwiftShader.
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (p: number) {
      if (p === 37445) return "Google Inc. (NVIDIA)";
      if (p === 37446) return "ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)";
      return getParameter.call(this, p);
    };
    // hardwareConcurrency: 4+ looks like a real machine.
    if (navigator.hardwareConcurrency < 4) {
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    }
  });
}

function headed(opts: SessionOptions): boolean {
  return !!opts.headed;
}

// Attach context to page for paired cleanup.
export function tagPage(page: Page, context: BrowserContext): void {
  (page as Page & { __context?: unknown }).__context = context;
}

export async function closePage(page: Page): Promise<void> {
  try {
    const ctx = (page as Page & { __context?: { close(): Promise<void> } }).__context;
    if (ctx) await ctx.close();
    else await page.close();
  } catch {
    // ignore
  }
}

// ─── Real browser (the user's own Chrome) ───────────────────────────
//
// Resolution order:
//   1. ATTACH to a Chrome already listening on the debug port — that is the
//      browser launch-jarvis-browser.bat opens (it also carries the proxy).
//   2. LAUNCH real chrome.exe with the debug port on a persistent profile.
//
// We deliberately never pass the DEFAULT Chrome user-data-dir: Chrome ≥136
// ignores --remote-debugging-port there for security, and a second instance
// pointed at a profile Chrome is already using just exits. A dedicated profile
// is used instead — sign in ONCE there and the session persists.

const DEBUG_PORT = Number(process.env.JARVIS_CHROME_DEBUG_PORT) || 9222;
const DEBUG_ENDPOINT = `http://127.0.0.1:${DEBUG_PORT}`;

export function realBrowserExecutable(): string | null {
  const env = process.env;
  const candidates = [
    path.join(env["PROGRAMFILES"] || "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(env["PROGRAMFILES"] || "C:\\Program Files", "Microsoft", "Edge", "Application", "msedge.exe"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? null;
}

/** Where the debug browser keeps its logins (override with JARVIS_CHROME_PROFILE). */
export function realBrowserProfileDir(): string {
  return process.env.JARVIS_CHROME_PROFILE || path.join(os.tmpdir(), "jarvis-chrome-profile");
}

async function debugPortUp(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${DEBUG_ENDPOINT}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function spawnChrome(executable: string, profileDir: string): void {
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(
    executable,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profileDir}`,
      // Never ride the JARVIS MITM proxy from here. These pages are real
      // browsing sessions, not overlay targets: routing them through the proxy
      // only adds latency and another thing that can corrupt a response.
      "--no-proxy-server",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
    ],
    { detached: true, stdio: "ignore" }
  );
  child.unref();
}

/** The user's existing browsing context — keeps their cookies and logins. */
function existingContext(browser: Browser): BrowserContext {
  return browser.contexts()[0] ?? browser.newContext({ ignoreHTTPSErrors: true });
}

export interface RealBrowserConnection {
  browser: Browser;
  context: BrowserContext;
  mode: "attached" | "launched";
  profileDir: string;
}

/**
 * Connect to a real Chrome: attach if one is already debugging, else launch it
 * and wait for the debug port to accept connections.
 */
export async function connectRealBrowser(): Promise<RealBrowserConnection> {
  const profileDir = realBrowserProfileDir();

  if (await debugPortUp()) {
    try {
      // A busy Chrome can accept the websocket and then never answer a single
      // command, so the default 30s handshake is far too patient here.
      const browser = await chromium.connectOverCDP(DEBUG_ENDPOINT, { timeout: 8000 });
      return { browser, context: existingContext(browser), mode: "attached", profileDir };
    } catch {
      // Launching a second Chrome on the same profile would just hit the profile
      // lock, so report the real situation instead of failing obscurely.
      throw new Error(
        `Chrome is running on port ${DEBUG_PORT} but isn't responding to DevTools. Close that browser window, then ask again.`
      );
    }
  }

  const executable = realBrowserExecutable();
  if (!executable) {
    throw new Error("No Chrome or Edge was found to drive. Install Chrome, or point JARVIS_CHROME_PROFILE at a profile.");
  }

  spawnChrome(executable, profileDir);

  // Cold start takes a few seconds (profile load + extension init).
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await debugPortUp()) {
      const browser = await chromium.connectOverCDP(DEBUG_ENDPOINT);
      return { browser, context: existingContext(browser), mode: "launched", profileDir };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(
    `Chrome did not open its debug port on ${DEBUG_PORT}. Your normal Chrome may already be running — quit it fully (it refuses a second instance) and try again.`
  );
}

// ─── Captcha / bot-wall detection ───────────────────────────────────

const CAPTCHA_SIGNS = [
  "enter the characters you see below",
  "type the characters you see in this image",
  "robot check",
  "captcha",
  "unusual traffic",
  "are you a robot",
  "verify you are a human",
  "press & hold",
  "pardon our interruption",
  "access denied",
  "you are not allowed to access",
  "apex__", // flipkart's bot-protection cookie names appear in the wall page
  "sorry, something went wrong on our end",
  "validate your request",
];

export async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    const content = (await page.content()).toLowerCase();
    return CAPTCHA_SIGNS.some((s) => content.includes(s));
  } catch {
    return false;
  }
}

// ─── Actions ────────────────────────────────────────────────────────

export interface BrowserAction {
  type:
    | "navigate"
    | "click"
    | "fill"
    | "fillAny"
    | "type"
    | "press"
    | "select"
    | "screenshot"
    | "pdf"
    | "evaluate"
    | "wait"
    | "waitForSelector"
    | "getText"
    | "getTexts"
    | "getAttribute";
  selector?: string;
  value?: string;
  url?: string;
  script?: string;
  timeout?: number;
  optional?: boolean; // failure recorded but doesn't stop the run
}

export interface ActionOutcome {
  action: string;
  success: boolean;
  error?: string;
  url?: string;
  selector?: string;
  value?: string;
  attribute?: string;
  data?: string;
  text?: string | undefined;
  texts?: string[];
  result?: unknown;
  timeout?: number;
}

export interface RunOptions {
  sessionName?: string;
  headed?: boolean;
  globalTimeoutMs?: number; // whole-run deadline (default 90s)
}

export interface RunResult {
  results: ActionOutcome[];
  captcha: boolean;
  finalUrl: string | null;
  durationMs: number;
}

async function safeGoto(page: Page, url: string, timeout = 25_000): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
}

export async function runActions(actions: BrowserAction[], opts: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const deadline = started + (opts.globalTimeoutMs ?? 90_000);
  const browser = await getBrowser(opts.headed);
  const context = await newContext(browser, opts);
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  tagPage(page, context);

  const results: ActionOutcome[] = [];
  let captcha = false;
  let finalUrl: string | null = null;

  try {
    for (const action of actions) {
      if (Date.now() > deadline) {
        results.push({ action: action.type, success: false, error: "Global run deadline exceeded" });
        break;
      }
      try {
        switch (action.type) {
          case "navigate": {
            if (!action.url) throw new Error("URL required for navigate");
            await safeGoto(page, action.url, action.timeout);
            finalUrl = page.url();
            captcha = await detectCaptcha(page);
            results.push({ action: "navigate", url: action.url, success: !captcha, error: captcha ? "Bot wall / captcha detected" : undefined });
            break;
          }

          case "click": {
            if (!action.selector) throw new Error("Selector required for click");
            await page.click(action.selector, { timeout: action.timeout });
            results.push({ action: "click", selector: action.selector, success: true });
            break;
          }

          case "fill": {
            if (!action.selector || !action.value) throw new Error("Selector and value required for fill");
            await page.fill(action.selector, action.value, { timeout: action.timeout });
            results.push({ action: "fill", selector: action.selector, success: true });
            break;
          }

          case "fillAny": {
            // Candidates separated by "||" — commas are CSS syntax.
            if (!action.selector || !action.value) throw new Error("Selector and value required for fillAny");
            const candidates = action.selector.split("||").map((s) => s.trim()).filter(Boolean);
            let matched = false;
            let tried = 0;
            for (const sel of candidates) {
              try {
                await page.fill(sel, action.value, { timeout: action.timeout ?? 4_000 });
                results.push({ action: "fillAny", selector: sel, success: true });
                matched = true;
                break;
              } catch {
                tried += 1;
              }
            }
            if (!matched) throw new Error(`No candidate matched (${tried} tried)`);
            break;
          }

          case "type": {
            if (!action.selector || !action.value) throw new Error("Selector and value required for type");
            await page.click(action.selector, { timeout: action.timeout });
            await page.type(action.selector, action.value, { delay: 40, timeout: action.timeout });
            results.push({ action: "type", selector: action.selector, success: true });
            break;
          }

          case "press": {
            if (!action.value) throw new Error("Key required for press");
            await page.keyboard.press(action.value);
            results.push({ action: "press", value: action.value, success: true });
            break;
          }

          case "select": {
            if (!action.selector || !action.value) throw new Error("Selector and value required for select");
            await page.selectOption(action.selector, action.value, { timeout: action.timeout });
            results.push({ action: "select", selector: action.selector, success: true });
            break;
          }

          case "waitForSelector": {
            if (!action.selector) throw new Error("Selector required for waitForSelector");
            await page.waitForSelector(action.selector, { timeout: action.timeout ?? 10_000, state: "visible" });
            results.push({ action: "waitForSelector", selector: action.selector, success: true });
            break;
          }

          case "wait": {
            const timeout = Math.min(action.timeout || 1000, 15_000);
            await page.waitForTimeout(timeout);
            results.push({ action: "wait", timeout, success: true });
            break;
          }

          case "screenshot": {
            const shot = await page.screenshot({ type: "jpeg", quality: 70 });
            results.push({
              action: "screenshot",
              data: `data:image/jpeg;base64,${shot.toString("base64")}`,
              success: true,
            });
            break;
          }

          case "pdf": {
            // Chromium-only; needs headless.
            const buf = await page.pdf({ format: "A4", printBackground: true });
            results.push({
              action: "pdf",
              data: `data:application/pdf;base64,${buf.toString("base64")}`,
              success: true,
            });
            break;
          }

          case "getText": {
            if (!action.selector) throw new Error("Selector required for getText");
            await page.waitForSelector(action.selector, { timeout: action.timeout ?? 8_000 }).catch(() => {});
            const text = (await page.textContent(action.selector, { timeout: action.timeout ?? 8_000 }).catch(() => null)) ?? undefined;
            results.push({ action: "getText", selector: action.selector, text, success: true });
            break;
          }

          case "getTexts": {
            if (!action.selector) throw new Error("Selector required for getTexts");
            const texts = await page
              .$$eval(action.selector, (els) => els.slice(0, 10).map((e) => (e.textContent || "").trim()).filter(Boolean))
              .catch(() => [] as string[]);
            results.push({ action: "getTexts", selector: action.selector, texts, success: true });
            break;
          }

          case "getAttribute": {
            if (!action.selector || !action.value) throw new Error("Selector and attribute name required");
            const attr = (await page.getAttribute(action.selector, action.value, { timeout: action.timeout }).catch(() => null)) ?? undefined;
            results.push({ action: "getAttribute", selector: action.selector, attribute: action.value, value: attr, success: true });
            break;
          }

          case "evaluate": {
            if (!action.script) throw new Error("Script required for evaluate");
            const evalResult = await page.evaluate((script) => {
              // eslint-disable-next-line no-eval
              return eval(script);
            }, action.script);
            results.push({ action: "evaluate", result: evalResult, success: true });
            break;
          }

          default:
            throw new Error(`Unknown action type: ${(action as BrowserAction).type}`);
        }
      } catch (actionError) {
        results.push({
          action: action.type,
          success: false,
          error: actionError instanceof Error ? actionError.message.split("\n")[0] : String(actionError),
          selector: action.selector,
        });
        if (!action.optional) break; // hard stop for required actions
      }
    }
    finalUrl = finalUrl ?? page.url();
    return { results, captcha, finalUrl, durationMs: Date.now() - started };
  } finally {
    await closePage(page);
  }
}

// ─── Helpers for watchers / agent ───────────────────────────────────

// ─── Product-page detection (shared by agent + workflows) ───────────

/** True when `url` looks like a product/restaurant detail page. */
export function looksLikeProductPage(url: string): boolean {
  // Amazon: /dp/ or /gp/product; Flipkart: /<slug>/p/itm<id>; Myntra:
  // numeric tail; Swiggy/Zomato: restaurant or item slugs.
  return /amazon\.[\w.]+\/((dp|gp\/product)\/|[^/]+\/dp\/)/.test(url)
    || /flipkart\.com\/.*\/p\/itm/.test(url)
    || /myntra\.com\/[^/]+\/\d+/.test(url)
    || /swiggy\.com\/(restaurants|instamart)\//.test(url)
    || /zomato\.com\/[^/]+\/restaurants?\//.test(url);
}

/** Resolve a page-relative href against a base URL. */
export function absolutize(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export async function extractValue(
  actions: BrowserAction[],
  selector: string,
  opts: RunOptions = {}
): Promise<{ text: string | null; captcha: boolean; finalUrl: string | null }> {
  const { results, captcha, finalUrl } = await runActions(
    [...actions, { type: "getText", selector, optional: true }],
    opts
  );
  const got = [...results].reverse().find((r) => r.action === "getText");
  return { text: got?.text ?? null, captcha, finalUrl };
}

export function parsePrice(text: string): number | null {
  // Prefer currency-anchored numbers (avoids grabbing "2.4" from
  // "2.4 GHz" or "185" from "M185" in a product title).
  const anchored = text.replace(/[, ]/g, "").match(/(?:₹|INR|Rs\.?|\$|USD|€)(\d+(?:\.\d+)?)/i);
  if (anchored) return parseFloat(anchored[1]);
  const bare = text.replace(/[, ]/g, "").match(/(\d+(?:\.\d+)?)/);
  return bare ? parseFloat(bare[1]) : null;
}

// ─── Agent sessions — a persistent page the LLM steers step by step ──

export interface PageElementRef {
  i: number;
  tag: string;
  txt: string;
  href: string | null;
  id: string | null;
  nm: string | null;
  ph: string | null;
  type: string | null;
}

export interface AgentSession {
  page: Page;
  goto(url: string): Promise<void>;
  /** Stamps interactive elements with data-jv indexes and returns them. */
  snapshot(): Promise<{ url: string; title: string; text: string; els: PageElementRef[] }>;
  /** Current page URL — used to record product links when the goal completes. */
  url(): string;
  /** Fresh context + page with a new fingerprint. Called when a bot wall appears. */
  freshen(): Promise<void>;
  /** Act on one element by its data-jv index. */
  clickRef(i: number): Promise<void>;
  fillRef(i: number, value: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  screenshotJpeg(): Promise<string>;
  captcha(): Promise<boolean>;
  close(): Promise<void>;
}

const SNAPSHOT_SCRIPT = `
  (() => {
    const els = Array.from(
      document.querySelectorAll("a, button, input, textarea, select, [role='button']")
    );
    const out = [];
    for (let i = 0; i < Math.min(els.length, 90); i++) {
      const e = els[i];
      e.setAttribute("data-jv", String(i));
      const txt = ((e.innerText || e.value || "") + "").trim().slice(0, 60);
      const id = e.id || null;
      const nm = e.getAttribute("name");
      const ph = e.getAttribute("placeholder");
      const type = e.getAttribute("type");
      // Product listings are links first — keep the href so the agent can
      // hand back a direct product URL when it answers.
      const href = e.getAttribute("href");
      if (txt || id || nm || ph) {
        out.push({ i, tag: e.tagName.toLowerCase(), txt, href, id, nm, ph, type });
      }
    }
    // Readable page text — prices, colors, specs live here, not in
    // interactive elements. The agent must SEE the page to answer from it.
    // Capped tight: every char here is prompt tokens on every turn.
    const text = (document.body.innerText || "")
      .replace(/\\n{2,}/g, "\\n")
      .slice(0, 2000);
    return JSON.stringify({ url: location.href, title: document.title, text, els: out });
  })()
`;

export async function createAgentSession(opts: SessionOptions = {}): Promise<AgentSession> {
  // Real browser first: no stealth patch beats being genuinely signed in.
  if (opts.realBrowser) return createRealBrowserSession(opts);
  const browser = await getBrowser(opts.headed);
  // let (not const): freshen() swaps these when a bot wall appears.
  let context = await newContext(browser, opts);
  let page = await context.newPage();
  page.setDefaultTimeout(12_000);
  tagPage(page, context);

  const session: AgentSession = {
    page,
    async goto(url) {
      await safeGoto(page, url);
      // Short settle — 800ms made every turn feel sluggish and bought
      // nothing: snapshot() re-reads the live DOM anyway.
      await page.waitForTimeout(300);
    },
    async snapshot() {
      const raw = await page.evaluate((s) => eval(s), SNAPSHOT_SCRIPT);
      return JSON.parse(raw as string) as { url: string; title: string; text: string; els: PageElementRef[] };
    },
    url() {
      try {
        return page.url();
      } catch {
        return "";
      }
    },
    // Bot-wall recovery: nuke context + page, open a new one with a fresh
    // viewport/fingerprint. Cheap because the browser process is reused.
    async freshen() {
      try {
        await context.close();
      } catch {
        // already dead
      }
      context = await newContext(browser, opts);
      page = await context.newPage();
      page.setDefaultTimeout(12_000);
      tagPage(page, context);
      this.page = page;
    },
    async clickRef(i) {
      await page.click(`[data-jv="${i}"]`, { timeout: 8_000 });
      await page.waitForLoadState("load", { timeout: 6_000 }).catch(() => {});
      await page.waitForTimeout(250);
    },
    async fillRef(i, value) {
      await page.fill(`[data-jv="${i}"]`, value, { timeout: 8_000 });
    },
    async pressKey(key) {
      await page.keyboard.press(key);
      await page.waitForLoadState("load", { timeout: 6_000 }).catch(() => {});
      await page.waitForTimeout(250);
    },
    async screenshotJpeg() {
      const shot = await page.screenshot({ type: "jpeg", quality: 70 });
      return `data:image/jpeg;base64,${shot.toString("base64")}`;
    },
    async captcha() {
      return detectCaptcha(page);
    },
    async close() {
      await closePage(page);
    },
  };

  return session;
}

/**
 * An agent session bound to the user's REAL browser.
 *
 * Differences from the bundled-Chromium session, and why:
 *  - The page opens as a NEW TAB in the user's own context, so every cookie /
 *    login they already have applies. That is what defeats the bot walls.
 *  - The tab is left visible; the user watches the run happen.
 *  - freshen() is a no-op: tearing down the context to dodge a bot wall would
 *    throw away the very logins that made the session work.
 *  - close() closes only OUR tab, never their browser.
 */
async function createRealBrowserSession(opts: SessionOptions): Promise<AgentSession> {
  const { context, mode, profileDir } = await connectRealBrowser();
  console.log(`[BrowserEngine] real browser ${mode} (profile: ${profileDir})`);

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  // Chrome throttles background tabs hard: timers, network and even CDP input
  // crawl, which made navigation time out and scrolling advance once every
  // ~7s. Bringing our tab to the front fixes both.
  await page.bringToFront().catch(() => {});

  const session: AgentSession = {
    page,
    async goto(url) {
      await page.bringToFront().catch(() => {});
      // "commit" resolves as soon as the navigation starts, which is all we need
      // before poking at the page. Heavy SPAs (YouTube Shorts) can take far
      // longer than a sane timeout to reach domcontentloaded.
      await page.goto(url, { waitUntil: "commit", timeout: 30_000 }).catch(async (e) => {
        console.warn("[BrowserEngine] real goto fell back:", e.message.split("\n")[0]);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      });
      await page.waitForTimeout(1200);
    },
    async snapshot() {
      const raw = await page.evaluate((s) => eval(s), SNAPSHOT_SCRIPT);
      return JSON.parse(raw as string) as { url: string; title: string; text: string; els: PageElementRef[] };
    },
    url() {
      try {
        return page.url();
      } catch {
        return "";
      }
    },
    // Nothing to freshen — see the note above.
    async freshen() {
      /* no-op on a real browser */
    },
    async clickRef(i) {
      await page.click(`[data-jv="${i}"]`, { timeout: 10_000 });
      await page.waitForTimeout(300);
    },
    async fillRef(i, value) {
      await page.fill(`[data-jv="${i}"]`, value, { timeout: 10_000 });
    },
    async pressKey(key) {
      await page.keyboard.press(key);
      await page.waitForTimeout(300);
    },
    async screenshotJpeg() {
      const shot = await page.screenshot({ type: "jpeg", quality: 70 });
      return `data:image/jpeg;base64,${shot.toString("base64")}`;
    },
    async captcha() {
      return detectCaptcha(page);
    },
    async close() {
      // Close only the tab we opened — never the user's browser.
      try {
        await page.close();
      } catch {
        /* already gone */
      }
    },
  };

  return session;
}
