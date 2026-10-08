// Generic browser agent for JARVIS.
//
// WHY THIS EXISTS: the previous browser layer was a library of hand-written
// methods (searchFlights, searchFood, comparePrices, ...) each with selectors
// baked in for one specific site. It could do exactly those things and nothing
// else. This module replaces that with a single loop:
//
//     observe -> decide -> act -> observe -> ... -> done
//
// There are NO site-specific selectors here. Each turn we tag whatever the page
// currently contains with stable refs, hand that to the model, and let it pick
// the next move from a small generic tool set. Works on sites nobody wrote code
// for, and keeps working when a site redesigns.
//
// Observation is the accessibility/DOM surface (cheap, structured, reliable).
// A screenshot is available as a fallback for pixel-only UIs.

import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, Page } from "playwright";
import { callJsonLlm } from "@/lib/llm/fastJson";
import { describeShopperProfile } from "@/lib/agent/shopperProfile";

// Apply the stealth plugin once per process (matches PlaywrightService).
if (!(chromium as any)._plugins?.some((p: any) => p.name === "stealth")) {
  chromium.use(stealthPlugin());
}

export interface BrowserStep {
  step: number;
  thought: string;
  action: string;
  target?: string;
  detail?: string;
  ok: boolean;
}

export interface BrowserTaskResult {
  success: boolean;
  answer: string;
  steps: BrowserStep[];
  finalUrl: string;
  finalTitle: string;
  screenshot?: string;
  error?: string;
  reason?: string;
}

export interface BrowserTaskOptions {
  /** Hard ceiling on decide/act cycles. */
  maxSteps?: number;
  /** Run with a visible window (useful for logins / watching it work). */
  headed?: boolean;
  /** Start here before the agent decides anything. */
  startUrl?: string;
  /** Per-action timeout. */
  actionTimeoutMs?: number;
  /** Per-decision LLM ceiling. */
  thinkTimeoutMs?: number;
  /**
   * Leave the browser running after the run returns. Defaults to TRUE for a
   * VISIBLE run, so the window the user is watching stays on screen until they
   * close it themselves; headless runs always close.
   */
  keepOpen?: boolean;
}

/**
 * Browsers deliberately left open after a visible run. Holding a reference
 * keeps the Chromium process (and the page the user is reading) alive instead
 * of letting it be reclaimed when the finished request goes out of scope.
 */
const openBrowsers = new Set<Browser>();

/** Close every browser a visible run left open. */
export async function closeOpenBrowsers(): Promise<void> {
  const all = [...openBrowsers];
  openBrowsers.clear();
  await Promise.all(all.map((b) => b.close().catch(() => {})));
}

// ── Visibility ──────────────────────────────────────────────────────────────
// The whole point of an agentic browser is that you can WATCH it think and act.
// Default is a real, on-screen window with a visible cursor, a highlight ring on
// whatever it is about to touch, and a HUD strip narrating the current step.
// Set JARVIS_BROWSER_VISIBLE=0 (or pass headed:false) to run headless.
const BROWSER_VISIBLE = process.env.JARVIS_BROWSER_VISIBLE !== "0";
/** Human-watchable pacing between actions, in ms. 0 when headless. */
const SLOW_MO = 60;

const DEFAULT_MAX_STEPS = 18;
const DEFAULT_ACTION_TIMEOUT = 12_000;
// Each step waits on this at most. Kept just under the provider budget so a slow
// provider fails fast and the run moves on instead of hanging on one decision.
const DEFAULT_THINK_TIMEOUT = 9_000;

/**
 * Ceiling on how many interactive elements we describe per turn. Keeps the
 * prompt small and the decision fast; the agent can scroll to reach more.
 *
 * Deliberately modest: the description of every element is re-sent on EVERY
 * decision, so a large list multiplies straight into the provider's per-minute
 * token budget. At 140 elements plus a long page excerpt each turn cost roughly
 * 1.5-2.5k tokens, which exhausted Groq's 7k/min after three or four decisions
 * and left the run with no model at all — it would navigate to the right page
 * and then die without reporting. Half the prompt buys twice as many decisions.
 */
const MAX_ELEMENTS = 70;
/** Readable page excerpt used to ground the answer. Same per-turn cost logic. */
const MAX_TEXT_CHARS = 1200;

/**
 * Observation shape returned from the page. `elements` is the interactive
 * surface; `text` is a short readable excerpt for grounding.
 */
interface PageObservation {
  url: string;
  title: string;
  elements: { ref: string; role: string; name: string; value?: string }[];
  text: string;
  truncated: boolean;
}

const TOOLS = `- goto: {"action":"goto","url":"..."} navigate to a URL
- click: {"action":"click","ref":"j3"} click a tagged element
- type: {"action":"type","ref":"j5","text":"hello","submit":false} focus + type into a field
- press: {"action":"press","key":"Enter"} press one key ("Enter","Tab","Escape","ArrowDown")
- scroll: {"action":"scroll","direction":"down"} scroll the viewport ("down","up")
- extract: {"action":"extract","ref":"j2"} read the text of an element or the page ("ref":"page")
- wait: {"action":"wait","ms":1500} pause for the page to settle
- screenshot: {"action":"screenshot"} take a screenshot (only for pixel-only UIs)
- done: {"action":"done","answer":"..."} finish and report the result`;

const SYSTEM = `You are JARVIS's browser pilot. You control a real Chrome browser one step at a time to accomplish the user's goal.

Reply with ONLY a JSON object:
{"thought":"<one short sentence: what you see and why this step>","action":"<tool name>",...tool args}

Available tools:
${TOOLS}

Rules:
- Take exactly ONE step per reply.
- Use the ref ids from the CURRENT observation. Refs are re-issued every turn, so never reuse a ref from an earlier turn.
- If a field is already filled or a required input is missing, fix that before continuing.
- If a cookie/consent dialog blocks the goal, dismiss it first.
- Use "extract" to read content, and "done" ONLY when the goal is finished or provably impossible.
- If the goal is unachievable on this page, use "done" with an honest answer explaining what blocked it. Never invent results or claim success you did not observe.
- Prefer the shortest path. Do not wander the site.
- ORDERING / CHECKOUT: go through cart, delivery details and delivery options, then STOP at the payment step. NEVER confirm payment, place the order, or enter card/UPI/OTP details. Finish by reporting the item, the total payable, and exactly what the user must do to complete the purchase.
- ADDRESS: if the site already offers a saved delivery address, use that. Only type an address from the saved details below if the site provides none.
- SIGN-IN: if you reach a sign-in / password page, do NOT enter credentials or create an account. Reply with "done" explaining a sign-in is required (the system normally pauses for the user automatically).`;

/**
 * Tag every currently-interactive element with a stable ref and return a
 * compact description. This runs INSIDE the page, so it must be self-contained
 * and must not reference anything from module scope.
 */
async function observe(page: Page): Promise<PageObservation> {
  const raw = await page.evaluate(
    ({ maxElements, maxTextChars }) => {
      const SELECTOR = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "[role=button]",
        "[role=link]",
        "[role=tab]",
        "[role=menuitem]",
        "[role=menuitemcheckbox]",
        "[role=option]",
        "[role=checkbox]",
        "[role=switch]",
        "[role=combobox]",
        "[role=searchbox]",
        "[role=textbox]",
        "[contenteditable=true]",
        "[onclick]",
      ].join(",");

      const visible = (el: Element): boolean => {
        const he = el as HTMLElement;
        if (he.hidden) return false;
        const cs = window.getComputedStyle(he);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = he.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };

      const labelOf = (el: Element): string => {
        const he = el as HTMLElement;
        const aria = he.getAttribute("aria-label");
        if (aria && aria.trim()) return aria.trim();
        // For inputs, a linked <label> is the real name.
        const id = he.getAttribute("id");
        if (id) {
          const escaped = id.replace(/["\\]/g, "\\$&");
          const lab = document.querySelector(`label[for="${escaped}"]`);
          if (lab && (lab as HTMLElement).innerText.trim()) {
            return (lab as HTMLElement).innerText.trim();
          }
        }
        const ph = he.getAttribute("placeholder");
        const nm = he.getAttribute("name");
        const val = (he as HTMLInputElement).value;
        const own = (he.innerText || "").replace(/\s+/g, " ").trim();
        const title = he.getAttribute("title");
        const alt = he.querySelector("img[alt]")?.getAttribute("alt");
        const parts = [own, title, alt, ph, nm, val && String(val)].filter(
          (s) => s && String(s).trim()
        );
        return parts.length ? String(parts[0]).slice(0, 120) : "";
      };

      const roleOf = (el: Element): string => {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit.toLowerCase();
        const tag = el.tagName.toLowerCase();
        if (tag === "a") return "link";
        if (tag === "button") return "button";
        if (tag === "select") return "select";
        if (tag === "textarea") return "textbox";
        if (tag === "input") {
          const t = (el.getAttribute("type") || "text").toLowerCase();
          if (t === "checkbox" || t === "radio" || t === "submit" || t === "button") return t;
          if (t === "search") return "searchbox";
          return "textbox";
        }
        return tag;
      };

      // Clear refs from the previous turn so stale ids never resolve.
      document
        .querySelectorAll("[data-jarvis-ref]")
        .forEach((el) => el.removeAttribute("data-jarvis-ref"));

      const nodes = Array.from(document.querySelectorAll(SELECTOR))
        .filter((el) => visible(el) && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-hidden") !== "true")
        .slice(0, maxElements);

      const elements = nodes.map((el, i) => {
        const ref = `j${i + 1}`;
        el.setAttribute("data-jarvis-ref", ref);
        const role = roleOf(el);
        const name = labelOf(el);
        const isField = role === "textbox" || role === "searchbox" || role === "select" || role === "textarea";
        const v = isField ? String((el as HTMLInputElement).value ?? "") : "";
        return { ref, role, name: name || "(unnamed)", value: v ? v.slice(0, 60) : undefined };
      });

      const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim();

      return {
        url: location.href,
        title: document.title || "",
        elements,
        text: bodyText.slice(0, maxTextChars),
        truncated: nodes.length >= maxElements,
      };
    },
    { maxElements: MAX_ELEMENTS, maxTextChars: MAX_TEXT_CHARS }
  );

  return raw as PageObservation;
}

/** Render an observation into the compact text the model reasons over. */
function render(obs: PageObservation): string {
  const lines = obs.elements.map((e) => {
    const val = e.value ? ` value="${e.value}"` : "";
    return `${e.ref}\t${e.role}\t${e.name}${val}`;
  });
  return [
    `URL: ${obs.url}`,
    `TITLE: ${obs.title}`,
    ``,
    `INTERACTIVE ELEMENTS (ref / role / name):`,
    lines.length ? lines.join("\n") : "(none found)",
    obs.truncated ? "(list truncated — scroll to reveal more)" : "",
    ``,
    `PAGE TEXT (excerpt):`,
    obs.text,
  ]
    .filter(Boolean)
    .join("\n");
}

interface Decision {
  thought?: string;
  action?: string;
  ref?: string;
  url?: string;
  text?: string;
  key?: string;
  direction?: string;
  ms?: number;
  submit?: boolean;
  answer?: string;
}

/**
 * Ask the model for the next single step.
 * Returns null when every provider failed — the caller then stops honestly
 * instead of guessing.
 */
async function decide(
  task: string,
  obs: PageObservation,
  history: BrowserStep[],
  timeoutMs: number
): Promise<Decision | null> {
  const trail = history.length
    ? history
        .map((h) => `${h.step}. ${h.action}${h.target ? ` ${h.target}` : ""}${h.detail ? ` "${h.detail}"` : ""} -> ${h.ok ? "ok" : "FAILED"}`)
        .join("\n")
    : "(nothing yet)";

  const profile = describeShopperProfile();
  const profileBlock = profile
    ? `

SAVED PERSONAL DETAILS — when a checkout/order/address form asks for one of these, use the saved value verbatim (do NOT invent values for fields not listed here; prefer any address the site already has saved):
${profile}`
    : "";

  return callJsonLlm<Decision>({
    system: SYSTEM,
    user: `GOAL: ${task}${profileBlock}

STEPS YOU ALREADY TOOK (do not repeat a step that failed; try a different approach):
${trail}

CURRENT PAGE STATE:
${render(obs)}

Decide the single next step.`,
    maxTokens: 320,
    temperature: 0.1,
    timeoutMs,
    label: "BrowserAgent",
  });
}

/**
 * Is the agent parked on a sign-in wall it cannot pass on its own?
 *
 * Strong signal only: an actual password field PLUS auth-looking page copy or
 * URL. That is the moment to stop driving and let the human log in, rather than
 * the model flailing at a login form or inventing credentials.
 */
async function atSignInWall(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      const hasPassword = !!document.querySelector('input[type="password"]');
      if (!hasPassword) return false;
      const url = location.href.toLowerCase();
      const text = (document.body?.innerText || "").toLowerCase();
      const looksAuth =
        /(login|signin|sign-in|sign_in|\/auth|account\/login)/.test(url) ||
        /(sign in|log in|login|enter your password|your password)/.test(text);
      return looksAuth;
    })
    .catch(() => false);
}

/**
 * Wait for the human to sign in inside the visible window, then hand control
 * back to the agent. Polls until the password field is gone (they logged in) or
 * the budget runs out. Returns false on timeout, or if the window was closed.
 */
async function waitForSignIn(page: Page, visible: boolean): Promise<boolean> {
  const waitMs = Number(process.env.JARVIS_LOGIN_WAIT_MS) || 240_000;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500).catch(() => {
      throw new Error("browser closed while waiting for sign-in");
    });
    if (!(await atSignInWall(page))) return true;
    await showStatus(page, "waiting for you to sign in \u00b7 finish the login and I'll continue", visible);
  }
  return false;
}

/**
 * Last-resort answer straight from the page the agent is standing on.
 *
 * Without this, a provider blip on the final decision threw away everything the
 * run had already achieved — the GitHub task actually REACHED
 * `github.com/vercel/next.js/releases/tag/v16.4.0` and then returned an empty
 * answer because one model call failed. The work was already done; only the
 * report was missing, so assemble it from the live DOM instead.
 *
 * Grounded by construction: the text comes from the page itself, and the model
 * is explicitly told to say so when the answer is not present rather than
 * invent one.
 */
async function harvest(page: Page, goal: string, timeoutMs: number): Promise<string> {
  const text = await page
    .evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim())
    .then((t: string) => t.slice(0, 6000))
    .catch(() => "");
  if (!text) return "";

  const synthesised = await callJsonLlm<{ answer?: string }>({
    system:
      "You answer a user's goal using ONLY the supplied web page text. " +
      "Never invent facts. If the page text does not contain the answer, reply with exactly: NOT_FOUND",
    user: `GOAL: ${goal}\n\nPAGE TEXT:\n${text}\n\nAnswer the goal in 1-3 sentences, or reply NOT_FOUND.`,
    maxTokens: 200,
    temperature: 0,
    timeoutMs,
    label: "BrowserAgentHarvest",
  }).catch(() => null);

  const answer = String(synthesised?.answer || "").trim();
  if (answer && !/^not_found/i.test(answer)) return answer;

  // Every model is down. Hand back the page's own words rather than nothing.
  const excerpt = text.slice(0, 400);
  return excerpt
    ? `My models were unreachable for the final summary, but here is what the page at that step actually said: "${excerpt}"`
    : "";
}

/** Resolve a ref to a locator. Refs are per-turn, so a stale one simply fails. */
function refLocator(page: Page, ref: string) {
  const clean = String(ref).replace(/[^\w-]/g, "");
  return page.locator(`[data-jarvis-ref="${clean}"]`).first();
}

/**
 * Fly the real cursor to an element and ring it in cyan, so the moment before
 * a click is visible instead of instantaneous. Purely cosmetic: every failure
 * here is swallowed, because visibility must never break the task.
 */
async function spotlight(page: Page, loc: any, visible: boolean, label?: string) {
  if (!visible) return;
  try {
    await loc.scrollIntoViewIfNeeded({ timeout: 2500 }).catch(() => {});
    const box = await loc.boundingBox();
    if (!box) return;
    // Move the OS-visible cursor in steps so the travel is actually seen.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
    await loc
      .evaluate(
        (el: HTMLElement, text: string | undefined) => {
          const prevOutline = el.style.outline;
          const prevShadow = el.style.boxShadow;
          const prevLabel = el.getAttribute("data-jarvis-label");
          el.style.outline = "3px solid #22d3ee";
          el.style.outlineOffset = "2px";
          el.style.boxShadow = "0 0 0 7px rgba(34,211,238,0.30)";
          if (text) el.setAttribute("data-jarvis-label", text);
          setTimeout(() => {
            el.style.outline = prevOutline;
            el.style.boxShadow = prevShadow;
            if (prevLabel) el.setAttribute("data-jarvis-label", prevLabel);
            else el.removeAttribute("data-jarvis-label");
          }, 850);
        },
        label
      )
      .catch(() => {});
    await page.waitForTimeout(120);
  } catch {
    /* cosmetic only */
  }
}

/**
 * A small strip pinned to the bottom of the page narrating the current step, so
 * an onlooker can read what JARVIS is doing and why while it happens.
 */
async function showStatus(page: Page, text: string, visible: boolean) {
  if (!visible || !text) return;
  try {
    await page
      .evaluate((msg: string) => {
        let el = document.getElementById("__jarvis_hud") as HTMLElement | null;
        if (!el) {
          el = document.createElement("div");
          el.id = "__jarvis_hud";
          el.style.cssText = [
            "position:fixed",
            "z-index:2147483647",
            "left:50%",
            "transform:translateX(-50%)",
            "bottom:18px",
            "max-width:82vw",
            "padding:9px 16px",
            "border-radius:999px",
            "background:rgba(6,10,22,0.93)",
            "border:1px solid rgba(34,211,238,0.55)",
            "box-shadow:0 8px 28px rgba(0,0,0,0.55)",
            "color:#5eead4",
            "font:600 13px/1.35 system-ui,-apple-system,Segoe UI,sans-serif",
            "white-space:nowrap",
            "overflow:hidden",
            "text-overflow:ellipsis",
            "pointer-events:none",
          ].join(";");
          document.body.appendChild(el);
        }
        el.textContent = "JARVIS \u00b7 " + msg;
      }, text)
      .catch(() => {});
  } catch {
    /* cosmetic only */
  }
}

/**
 * Run one goal to completion in a real browser.
 *
 * A VISIBLE run is left OPEN when it finishes (unless `keepOpen:false`), so the
 * user can keep reading the page it landed on; a headless run always closes.
 */
export async function runBrowserTask(
  task: string,
  options: BrowserTaskOptions = {}
): Promise<BrowserTaskResult> {
  const maxSteps = Math.max(1, Math.min(options.maxSteps ?? DEFAULT_MAX_STEPS, 40));
  const actionTimeout = options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT;
  const thinkTimeout = options.thinkTimeoutMs ?? DEFAULT_THINK_TIMEOUT;

  const steps: BrowserStep[] = [];
  let browser: Browser | null = null;

  // Visible by default: a real window you can watch, with watchable pacing.
  const visible = options.headed !== false && BROWSER_VISIBLE;
  // A window someone is watching must STAY on screen when the task ends. The
  // old behaviour closed it the instant the answer was ready, which read as the
  // browser "running off". Headless runs still clean up after themselves.
  const keepOpen = options.keepOpen ?? visible;

  try {
    const goal = String(task || "").trim();
    if (!goal) {
      return { success: false, answer: "", steps, finalUrl: "", finalTitle: "", error: "A task description is required." };
    }

    browser = await chromium.launch({
      headless: !visible,
      slowMo: visible ? SLOW_MO : 0,
      // `--disable-blink-features=AutomationControlled` is what the stealth
      // plugin needs to actually hide `navigator.webdriver`; without it the
      // remaining stealth patches are cosmetic and bot walls (IMDb, LinkedIn)
      // still fire. Matches createStealthContext in PlaywrightService.
      args: visible
        ? ["--start-maximized", "--window-position=40,40", "--disable-blink-features=AutomationControlled"]
        : ["--disable-blink-features=AutomationControlled"],
    });
    const context = await browser.newContext({
      // null = use the real window size, so a maximised window is fully used.
      viewport: visible ? null : { width: 1280, height: 860 },
      // A realistic UA keeps more sites in their normal (non-bot) layout.
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    let page = await context.newPage();
    page.setDefaultTimeout(actionTimeout);

    // Never let a page-level dialog hang the loop.
    page.on("dialog", (d) => d.dismiss().catch(() => {}));

    if (options.startUrl) {
      await page.goto(options.startUrl, { waitUntil: "domcontentloaded", timeout: actionTimeout }).catch(() => {});
    }

    let lastScreenshot: string | undefined;

    for (let step = 1; step <= maxSteps; step++) {
      let obs = await observe(page);

      // A still-rendering page looks empty. Resolve that here instead of burning
      // model turns on "wait" and hoping — DDG-style result pages render after
      // navigation and used to cost 3 wasted decisions per task.
      for (let settle = 0; settle < 2 && obs.elements.length === 0 && !obs.text.trim(); settle++) {
        await page.waitForTimeout(450);
        obs = await observe(page);
      }

      // Sign-in wall: the human, not the model, owns credentials. Pause the run
      // in place — the window stays up — and resume automatically once they are
      // logged in. Only possible in a VISIBLE run; headless cannot be helped.
      if (visible && (await atSignInWall(page))) {
        const heading = await page.title().catch(() => "");
        await showStatus(page, "waiting for you to sign in \u00b7 finish the login and I'll continue", visible);
        const signedIn = await waitForSignIn(page, visible).catch(() => false);
        if (!signedIn) {
          const msg = `I reached a sign-in page (${heading || page.url()}) and waited ${Math.round(
            (Number(process.env.JARVIS_LOGIN_WAIT_MS) || 240_000) / 1000
          )}s for you to sign in. Sign in there and ask me again, Boss.`;
          return {
            success: false,
            answer: msg,
            steps,
            finalUrl: page.url(),
            finalTitle: heading,
            screenshot: lastScreenshot,
            error: msg,
          };
        }
        // Logged in — re-read the page and carry on with the real goal.
        steps.push({
          step: steps.length + 1,
          thought: "Waited for the user to sign in",
          action: "wait",
          target: "sign-in",
          detail: "sign-in completed",
          ok: true,
        });
        obs = await observe(page);
      }

      // A blank/blocked page can't be reasoned about; give the model one
      // explicit note rather than an empty element list it may misread.
      // One decision call can flake out on a transient provider/DNS failure.
      // Retry once before concluding the model is actually unavailable.
      let decision = await decide(goal, obs, steps, thinkTimeout);
      if (!decision?.action) {
        await page.waitForTimeout(400);
        decision = await decide(goal, obs, steps, thinkTimeout);
      }

      if (!decision?.action) {
        const salvaged = await harvest(page, goal, thinkTimeout);
        return {
          success: salvaged.length > 0,
          answer: salvaged,
          steps,
          finalUrl: page.url(),
          finalTitle: await page.title().catch(() => ""),
          screenshot: lastScreenshot,
          reason: salvaged
            ? "Answered from the live page after the model became unreachable."
            : undefined,
          error: salvaged
            ? undefined
            : "The language model did not return a usable next step. Check the configured AI keys.",
        };
      }

      const action = String(decision.action).toLowerCase().trim();
      const thought = String(decision.thought || "").slice(0, 300);
      const entry: BrowserStep = { step, thought, action, ok: false };

      // Narrate the step on the page itself while it happens.
      await showStatus(page, `step ${step} \u00b7 ${action}${thought ? ` \u2014 ${thought}` : ""}`, visible);

      try {
        switch (action) {
          case "goto": {
            const url = String(decision.url || "").trim();
            if (!url) throw new Error("goto needs a url");
            const target = /^https?:\/\//i.test(url) ? url : `https://${url.replace(/^\/+/, "")}`;
            entry.target = target;
            await page.goto(target, { waitUntil: "domcontentloaded", timeout: actionTimeout });
            break;
          }

          case "click": {
            const ref = String(decision.ref || "");
            entry.target = ref;
            const loc = refLocator(page, ref);
            if ((await loc.count()) === 0) throw new Error(`ref ${ref} is no longer on the page`);
            // Cursor travel + highlight, so the click is watchable.
            await spotlight(page, loc, visible, (decision.thought || "").slice(0, 80));
            // Watch for a popup: many real flows (auth, checkout) open one.
            const popupPromise = context.waitForEvent("page", { timeout: 2500 }).catch(() => null);
            await loc.click({ timeout: actionTimeout });
            const popup = await popupPromise;
            if (popup) {
              page = popup as Page;
              page.setDefaultTimeout(actionTimeout);
              page.on("dialog", (d) => d.dismiss().catch(() => {}));
              await page.waitForLoadState("domcontentloaded").catch(() => {});
              entry.detail = "opened a new tab";
            }
            await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
            break;
          }

          case "type": {
            const ref = String(decision.ref || "");
            const text = String(decision.text ?? "");
            entry.target = ref;
            entry.detail = text;
            const loc = refLocator(page, ref);
            if ((await loc.count()) === 0) throw new Error(`ref ${ref} is no longer on the page`);
            await spotlight(page, loc, visible, text.slice(0, 40));
            await loc.fill(text, { timeout: actionTimeout }).catch(async () => {
              // Some widgets reject fill(); fall back to real keystrokes.
              await loc.click({ timeout: actionTimeout });
              await page.keyboard.type(text);
            });
            if (decision.submit) {
              await page.keyboard.press("Enter");
              await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
            }
            break;
          }

          case "press": {
            const key = String(decision.key || "Enter");
            entry.target = key;
            await page.keyboard.press(key);
            await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
            break;
          }

          case "scroll": {
            const dir = String(decision.direction || "down").toLowerCase();
            entry.target = dir;
            await page.mouse.wheel(0, dir === "up" ? -900 : 900);
            await page.waitForTimeout(500);
            break;
          }

          case "extract": {
            const ref = String(decision.ref || "page");
            entry.target = ref;
            const text =
              ref === "page"
                ? (await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim())).slice(0, 4000)
                : (await refLocator(page, ref).innerText({ timeout: actionTimeout })).slice(0, 4000);
            entry.detail = text.slice(0, 400);
            break;
          }

          case "wait": {
            const ms = Math.max(0, Math.min(Number(decision.ms) || 1000, 10_000));
            entry.target = `${ms}ms`;
            await page.waitForTimeout(ms);
            break;
          }

          case "screenshot": {
            const buf = await page.screenshot({ type: "jpeg", quality: 70 });
            lastScreenshot = buf.toString("base64");
            entry.target = "captured";
            break;
          }

          case "done": {
            const answer = String(decision.answer || "").trim();
            entry.ok = true;
            entry.detail = answer.slice(0, 400);
            steps.push(entry);
            return {
              success: true,
              answer,
              steps,
              finalUrl: page.url(),
              finalTitle: await page.title().catch(() => ""),
              screenshot: lastScreenshot,
            };
          }

          default:
            throw new Error(`unknown action "${action}"`);
        }
        entry.ok = true;
      } catch (e: any) {
        entry.ok = false;
        entry.detail = e?.message ? String(e.message).slice(0, 200) : "action failed";
      }

      steps.push(entry);
      // Small settle so the next observation reflects the result.
      await page.waitForTimeout(120);
    }

    // Out of steps: the agent is plainly standing on SOME page holding real
    // content. Answer from it instead of returning an empty string.
    const salvaged = await harvest(page, goal, thinkTimeout);
    return {
      success: salvaged.length > 0,
      answer: salvaged,
      steps,
      finalUrl: page.url(),
      finalTitle: await page.title().catch(() => ""),
      screenshot: lastScreenshot,
      reason: salvaged
        ? "Step limit reached; answered from the page the agent ended on."
        : undefined,
      error: salvaged
        ? undefined
        : `Reached the ${maxSteps}-step limit without finishing. Raise maxSteps or narrow the goal.`,
    };
  } catch (e: any) {
    return {
      success: false,
      answer: "",
      steps,
      finalUrl: "",
      finalTitle: "",
      error: e?.message || "Browser agent failed to start.",
    };
  } finally {
    if (keepOpen && browser) {
      // Hold a reference so Chromium and the page the user is reading survive
      // the response being sent. Dropped automatically if it is closed by hand.
      openBrowsers.add(browser);
      const open = browser;
      open.on("disconnected", () => openBrowsers.delete(open));
      console.log("[browserAgent] Task finished — leaving the browser open for you to inspect.");
    } else {
      await browser?.close().catch(() => {});
    }
  }
}
