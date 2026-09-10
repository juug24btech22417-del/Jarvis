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
import path from "path";

chromiumExtra.use(StealthPlugin());

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
        ],
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
}

export async function newContext(browser: Browser, opts: SessionOptions = {}): Promise<BrowserContext> {
  const stealthContext = {
    userAgent: BROWSER_UA,
    viewport: { width: 1440, height: 900 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      "Accept-Language": "en-IN,en-GB;q=0.9,en;q=0.8",
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
  return browser.newContext({ ...stealthContext, ignoreHTTPSErrors: true });
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
    for (let i = 0; i < Math.min(els.length, 120); i++) {
      const e = els[i];
      e.setAttribute("data-jv", String(i));
      const txt = ((e.innerText || e.value || "") + "").trim().slice(0, 60);
      const id = e.id || null;
      const nm = e.getAttribute("name");
      const ph = e.getAttribute("placeholder");
      const type = e.getAttribute("type");
      if (txt || id || nm || ph) {
        out.push({ i, tag: e.tagName.toLowerCase(), txt, id, nm, ph, type });
      }
    }
    // Readable page text — prices, colors, specs live here, not in
    // interactive elements. The agent must SEE the page to answer from it.
    const text = (document.body.innerText || "")
      .replace(/\\n{2,}/g, "\\n")
      .slice(0, 3500);
    return JSON.stringify({ url: location.href, title: document.title, text, els: out });
  })()
`;

export async function createAgentSession(opts: SessionOptions = {}): Promise<AgentSession> {
  const browser = await getBrowser(opts.headed);
  const context = await newContext(browser, opts);
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  tagPage(page, context);

  return {
    page,
    async goto(url) {
      await safeGoto(page, url);
      // Human-ish settle time — pages lazily load and bot walls sometimes
      // appear only after the first paint.
      await page.waitForTimeout(800);
    },
    async snapshot() {
      const raw = await page.evaluate((s) => eval(s), SNAPSHOT_SCRIPT);
      return JSON.parse(raw as string) as { url: string; title: string; text: string; els: PageElementRef[] };
    },
    async clickRef(i) {
      await page.click(`[data-jv="${i}"]`, { timeout: 8_000 });
      await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(600);
    },
    async fillRef(i, value) {
      await page.fill(`[data-jv="${i}"]`, value, { timeout: 8_000 });
    },
    async pressKey(key) {
      await page.keyboard.press(key);
      await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(700);
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
}
