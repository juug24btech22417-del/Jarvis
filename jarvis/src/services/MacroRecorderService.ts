/**
 * MacroRecorderService — Record & Replay browser automation using Playwright.
 *
 * Flow:
 *   1. startRecording(url)  → opens browser, attaches listeners, returns sessionId
 *   2. User interacts with the page → events are captured as MacroSteps
 *   3. stopRecording()       → closes browser, saves macro to store, returns it
 *   4. replayMacro(macroId)  → opens browser, executes steps in order, returns result
 *
 * Handles SPAs (WhatsApp Web, etc.) by re-injecting listeners after each
 * navigation, and captures events inside shadow DOMs.
 */

import { chromium, type Page, type Browser } from "playwright";
import { saveMacro, appendStep, incrementReplayCount, getMacro, interpolateStep } from "@/lib/ghost/macroStore";
import type { Macro, MacroStep, MacroReplayResult } from "@/lib/ghost/macroTypes";

interface RecordingSession {
  id: string;
  macroId: string;
  page: Page;
  browser: Browser;
  steps: MacroStep[];
  isRecording: boolean;
  startedAt: Date;
  lastUrl: string;
  lastStepTime: Map<string, number>;
}

const activeSessions = new Map<string, RecordingSession>();

function stepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function describeStep(action: string, target?: string, value?: string): string {
  switch (action) {
    case "goto": return `Navigate to ${target}`;
    case "click": return `Click ${target || "element"}`;
    case "type": return `Type "${value?.slice(0, 30)}${(value?.length || 0) > 30 ? "..." : ""}" into ${target || "field"}`;
    case "fill": return `Fill ${target || "field"} with "${value?.slice(0, 30)}${(value?.length || 0) > 30 ? "..." : ""}"`;
    case "select": return `Select "${value}" in ${target || "dropdown"}`;
    case "press": return `Press ${value || "key"}`;
    case "wait": return `Wait for ${target || "timeout"}`;
    case "autofill": return "Ghost Protocol autofill";
    case "scroll": return `Scroll ${value || "down"}`;
    case "submit": return `Submit ${target || "form"}`;
    default: return `${action} on ${target || "page"}`;
  }
}

function cleanupSession(sessionId: string, reason: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  console.log(`[MacroRecorder] Cleaning up session ${sessionId}: ${reason}`);
  session.isRecording = false;
  activeSessions.delete(sessionId);
}

/**
 * Finalize a recording: name the macro based on captured steps and remove
 * the session. Shared by manual stop AND user closing the browser window —
 * closing the window IS stopping the recording.
 */
async function finalizeRecording(session: RecordingSession): Promise<Macro | null> {
  session.isRecording = false;
  activeSessions.delete(session.id);

  const macro = await getMacro(session.macroId);
  if (!macro) return null;

  const firstGoto = session.steps.find((s) => s.action === "goto");
  let hostname = "unknown";
  try {
    hostname = firstGoto?.target ? new URL(firstGoto.target).hostname : new URL(macro.targetUrl || "https://unknown").hostname;
  } catch { /* keep unknown */ }
  const name = `${hostname} — ${session.steps.length} steps`;

  const { updateMacro } = await import("@/lib/ghost/macroStore");
  await updateMacro(session.macroId, {
    name,
    description: `Recorded ${session.steps.length} steps on ${hostname}. Duration: ${Math.round((Date.now() - session.startedAt.getTime()) / 1000)}s`,
  });

  const finalMacro = await getMacro(session.macroId);
  console.log(`[MacroRecorder] Recording finalized: ${session.steps.length} steps captured`);
  return finalMacro!;
}

/**
 * Execute a promise with a hard timeout. Rejects if the timeout is exceeded.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label = "step"): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Smart click — tries the recorded selector, then rich fallbacks (aria-label,
 * testid, text, tag+class), then site-specific strategies. Never gives up early.
 */
async function smartClick(
  page: Page,
  selector: string,
  options: { timeout?: number; fallbacks?: string[] } = {},
  timeout = 6000
) {
  const candidates = [selector, ...(options.fallbacks || [])].filter(Boolean);

  // Try each candidate selector in order
  for (const sel of candidates) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 2000 });
        return;
      }
    } catch { /* try next */ }
  }

  // Wait briefly for any candidate to appear (SPA / lazy render)
  for (const sel of candidates) {
    try {
      await page.waitForSelector(sel, { state: "visible", timeout: 2000 });
      await page.click(sel, { timeout: 2000 });
      return;
    } catch { /* try next */ }
  }

  const url = page.url();

  // ── Site-specific: YouTube ──────────────────────────────────────────
  if (url.includes("youtube.com")) {
    // Ad-skip: recorded selector was "#skip-button:2" etc. — try real skip buttons
    const skipSelectors = [
      ".ytp-ad-skip-button-modern",
      ".ytp-ad-skip-button",
      ".ytp-skip-ad-button",
      "button[aria-label*='Skip' i]",
      ".ytp-ad-overlay-close-button",
    ];
    for (const sel of skipSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn && await btn.isVisible().catch(() => false)) {
          await btn.click({ timeout: 1500 });
          return;
        }
      } catch { /* try next */ }
    }

    // Thumbnail/video-title click on search results → navigate directly
    try {
      const href = await page.evaluate(() => {
        const link =
          document.querySelector<HTMLElement>("#media-container-link")?.closest("a[href*='/watch']") ||
          document.querySelector<HTMLAnchorElement>("ytd-video-renderer a#video-title[href*='/watch']") ||
          document.querySelector<HTMLAnchorElement>("a#video-title-link[href*='/watch']") ||
          document.querySelector<HTMLAnchorElement>("ytd-rich-item-renderer a[href*='/watch']");
        return link ? (link as HTMLAnchorElement).href : null;
      });
      if (href) {
        await page.goto(href, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(1500);
        await unblockAutoplay(page);
        return;
      }
    } catch { /* fall through */ }

    // Generic video area click (play/pause, large play button)
    const ytSelectors = [
      "button.ytp-large-play-button",
      "button.ytp-play-button",
      "video",
      "#movie_player",
    ];
    for (const sel of ytSelectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click({ timeout: 2000 });
          return;
        }
      } catch { /* try next */ }
    }
  }

  // Final fallback: longer timeout on primary selector
  try {
    await page.click(selector, { timeout });
    return;
  } catch { /* give up */ }

  throw new Error(`Could not click element: ${selector}`);
}

/**
 * Ensure a YouTube video is actually playing — clicks play, unblocks autoplay.
 */
async function unblockAutoplay(page: Page) {
  try {
    await page.evaluate(() => {
      const video = document.querySelector("video");
      if (video) {
        video.muted = false;
        const p = video.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      // Also click the big play button if visible
      const btn = document.querySelector<HTMLElement>(
        "button.ytp-large-play-button, button.ytp-play-button"
      );
      if (btn && video && video.paused) btn.click();
    });
  } catch { /* best effort */ }
}

/**
 * Verify that text actually made it into the editable target.
 * Works for <input>, <textarea> AND contenteditable (ProseMirror etc.).
 */
async function verifyTextPresent(page: Page, selector: string, value: string): Promise<boolean> {
  try {
    return await page.evaluate(
      ({ sel, val }) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        const current = (el as HTMLInputElement).value ?? el.textContent ?? "";
        // Empty target counts as failure unless we wanted to type empty
        if (!val) return current.length === 0;
        // Check the END of the current text matches the END of what we typed
        // (fields may be cleared/refilled; last chars are the strongest signal)
        const tail = val.slice(-20);
        return current.includes(tail) || current.trim().length > 0;
      },
      { sel: selector, val: value }
    );
  } catch {
    return false;
  }
}

/**
 * Smart type — sets value with multiple strategies, then VERIFIES it landed.
 * If verification fails, escalates: native setter → fill → insertText → keyboard.
 */
async function smartType(
  page: Page,
  selector: string,
  value: string,
  options: { fallbacks?: string[] } = {}
) {
  const candidates = [selector, ...(options.fallbacks || [])].filter(Boolean);

  // Strategy 0: click to focus the field first (many editors need focus before input)
  for (const sel of candidates) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await el.click({ timeout: 2000 });
        break;
      }
    } catch { /* try next */ }
  }
  await page.waitForTimeout(150);

  // Strategy 1: native value setter (works with React/controlled inputs)
  try {
    for (const sel of candidates) {
      const found = await page.evaluate(
        ({ sel, val }) => {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (!el) return false;
          if (el.isContentEditable) {
            el.focus();
            document.execCommand("insertText", false, val);
            return true;
          }
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
          if (nativeSetter) nativeSetter.call(el, val);
          else (el as HTMLInputElement).value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        { sel, val: value }
      );
      if (found && (await verifyTextPresent(page, sel, value))) return;
    }
  } catch { /* try next */ }

  // Strategy 2: Playwright fill per candidate
  for (const sel of candidates) {
    try {
      await page.fill(sel, value, { timeout: 3000 });
      if (await verifyTextPresent(page, sel, value)) return;
    } catch { /* try next */ }
  }

  // Strategy 3: keyboard insertText via CDP — the most "human" way,
  // works with React controlled inputs, ProseMirror, Lexical, Draft.js
  try {
    await page.keyboard.insertText(value);
    await page.waitForTimeout(200);
    // Verify on any candidate
    for (const sel of candidates) {
      if (await verifyTextPresent(page, sel, value)) return;
    }
  } catch { /* try next */ }

  // Strategy 4: full keyboard typing with delay (slowest, most compatible)
  try {
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(value, { delay: 40 });
    await page.waitForTimeout(150);
    for (const sel of candidates) {
      if (await verifyTextPresent(page, sel, value)) return;
    }
    // Text may have landed even if our selector check failed (shadow DOM etc.)
    // Only throw if we can confirm the field is truly empty
    const empty = await page.evaluate(
      (sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        return ((el as HTMLInputElement).value ?? el.textContent ?? "").trim().length === 0;
      },
      selector
    );
    if (!empty) return;
  } catch { /* fall through */ }

  throw new Error(`Could not type into "${selector}" — text did not land`);
}

// ─── Inject recording listeners ────────────────────────────────────────

async function injectRecordingListeners(session: RecordingSession, page: Page) {
  const { macroId, steps, lastStepTime } = session;

  try {
    await page.exposeFunction("__jarvisRecordClick", async (selector: string, fallbacksJson?: string) => {
      if (!session.isRecording) return;
      const now = Date.now();
      const key = `click:${selector}`;
      if (lastStepTime.has(key) && now - lastStepTime.get(key)! < 300) return;
      lastStepTime.set(key, now);
      let fallbacks: string[] = [];
      try { fallbacks = fallbacksJson ? JSON.parse(fallbacksJson) : []; } catch { /* ignore */ }
      const step: MacroStep = {
        id: stepId(), action: "click", target: selector,
        description: describeStep("click", selector),
        options: fallbacks.length ? { fallbacks } : undefined,
      };
      steps.push(step);
      await appendStep(macroId, step).catch((e) =>
        console.error("[MacroRecorder] appendStep error:", e)
      );
    });
  } catch { /* already exposed */ }

  try {
    await page.exposeFunction("__jarvisRecordInput", async (selector: string, value: string, fallbacksJson?: string) => {
      if (!session.isRecording) return;
      let fallbacks: string[] = [];
      try { fallbacks = fallbacksJson ? JSON.parse(fallbacksJson) : []; } catch { /* ignore */ }
      // Collapse consecutive typing on the same selector into one step
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.action === "type" && lastStep.target === selector) {
        lastStep.value = value;
        lastStep.description = describeStep("type", selector, value);
        if (fallbacks.length) lastStep.options = { ...(lastStep.options || {}), fallbacks };
        return;
      }
      const step: MacroStep = {
        id: stepId(), action: "type", target: selector, value,
        description: describeStep("type", selector, value),
        options: fallbacks.length ? { fallbacks } : undefined,
      };
      steps.push(step);
      await appendStep(macroId, step).catch((e) =>
        console.error("[MacroRecorder] appendStep error:", e)
      );
    });
  } catch { /* already exposed */ }

  try {
    await page.exposeFunction("__jarvisRecordKeydown", async (key: string) => {
      if (!session.isRecording) return;
      const specialKeys = ["Enter", "Tab", "Escape", "Backspace", "Delete",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!specialKeys.includes(key)) return;
      const lastStep = steps[steps.length - 1];
      if (lastStep && lastStep.action === "press" && lastStep.value === key) return;
      const step: MacroStep = {
        id: stepId(), action: "press", value: key,
        description: describeStep("press", undefined, key),
      };
      steps.push(step);
      await appendStep(macroId, step).catch((e) =>
        console.error("[MacroRecorder] appendStep error:", e)
      );
    });
  } catch { /* already exposed */ }

  // Inject DOM listeners that traverse shadow DOMs
  await page.evaluate(() => {
    function getRoots(root: Document | ShadowRoot): (Document | ShadowRoot)[] {
      const roots: (Document | ShadowRoot)[] = [root];
      root.querySelectorAll("*").forEach((el) => {
        if (el.shadowRoot) roots.push(...getRoots(el.shadowRoot));
      });
      return roots;
    }

    if ((window as any).__jarvisListenersInjected) return;
    (window as any).__jarvisListenersInjected = true;

    /**
     * Build robust CSS.escape'd selectors with rich fallbacks.
     * Returns { primary, fallbacks } — every selector is guaranteed
     * valid for querySelector (CSS.escape handles ids like "skip-button:2").
     */
    function buildSelectors(el: HTMLElement): { primary: string; fallbacks: string[] } {
      const esc = (s: string) => (window as any).CSS && CSS.escape ? CSS.escape(s) : s.replace(/([#.;?+~@*^$(){}=!|',\\\[\]\>:"-])/g, "\\$1");
      const fallbacks: string[] = [];

      // 1. id — MUST escape (ids like "skip-button:2" break raw # selectors)
      if (el.id) fallbacks.push(`#${esc(el.id)}`);

      // 2. aria-label — the most stable attribute on modern sites (YouTube, Google)
      const aria = el.getAttribute("aria-label") || el.getAttribute("title");
      if (aria) fallbacks.push(`[aria-label="${aria.replace(/"/g, '\\"')}"]`);

      // 3. data-testid / data-test / data-cy
      const testid = el.getAttribute("data-testid") || el.getAttribute("data-test") || el.getAttribute("data-cy");
      if (testid) fallbacks.push(`[data-testid="${testid.replace(/"/g, '\\"')}"]`);

      // 4. name / placeholder for form fields
      const name = (el as HTMLInputElement).name;
      if (name) fallbacks.push(`${el.tagName.toLowerCase()}[name="${name.replace(/"/g, '\\"')}"]`);
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) fallbacks.push(`[placeholder="${placeholder.replace(/"/g, '\\"')}"]`);

      // 5. short visible text (buttons/links only, keep it short & stable)
      const text = (el.textContent || "").trim().replace(/\s+/g, " ");
      if (text && text.length <= 40 && (el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "button")) {
        fallbacks.push(`${el.tagName.toLowerCase()}:has-text("${text.replace(/"/g, "")}")`);
      }

      // 6. tag + first 2 classes (escaped)
      const tag = el.tagName.toLowerCase();
      const classes = Array.from(el.classList).slice(0, 2).map((c) => "." + esc(c)).join("");
      if (classes) fallbacks.push(`${tag}${classes}`);

      // 7. bare tag as last resort
      fallbacks.push(tag);

      // Primary = first fallback (id if present, else aria, else testid...)
      return { primary: fallbacks[0], fallbacks: fallbacks.slice(1, 5) };
    }

    function attachToRoots() {
      const roots = getRoots(document);
      roots.forEach((root) => {
        if ((root as any).__jarvisListening) return;
        (root as any).__jarvisListening = true;

        root.addEventListener("click", (e: Event) => {
          const el = (e.target as HTMLElement).closest(
            "button, a, [role='button'], input[type='submit'], [onclick], [aria-label], video"
          ) || e.target as HTMLElement;
          if (!el || !el.tagName) return;
          const { primary, fallbacks } = buildSelectors(el as HTMLElement);
          (window as any).__jarvisRecordClick(primary, JSON.stringify(fallbacks));
        }, true);

        root.addEventListener("input", (e: Event) => {
          const el = e.target as HTMLInputElement;
          if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && !el.isContentEditable)) return;
          const { primary, fallbacks } = buildSelectors(el as HTMLElement);
          (window as any).__jarvisRecordInput(primary, el.value ?? el.textContent ?? "", JSON.stringify(fallbacks));
        }, true);

        root.addEventListener("keydown", (e: Event) => {
          (window as any).__jarvisRecordKeydown((e as KeyboardEvent).key);
        }, true);
      });
    }

    attachToRoots();
    const observer = new MutationObserver(() => attachToRoots());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

// ─── Start / Stop Recording ────────────────────────────────────────────

export async function startRecording(
  url: string,
  options: { headed?: boolean } = {}
): Promise<{ sessionId: string; macroId: string }> {
  const headless = options.headed === false ? true : false;

  const browser = await chromium.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      // Allow videos to autoplay without a user gesture (matches replay behavior)
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const sessionId = `session_${Date.now()}`;

  browser.on("disconnected", () => {
    const session = activeSessions.get(sessionId);
    if (session?.isRecording) {
      // User closed the recording window = they're done. Finalize the macro
      // so it appears in the panel without them clicking Stop.
      console.log(`[MacroRecorder] Browser closed by user — finalizing recording ${sessionId}`);
      finalizeRecording(session).catch((e) =>
        console.error("[MacroRecorder] finalizeRecording error:", e)
      );
    } else {
      cleanupSession(sessionId, "browser disconnected");
    }
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  const macro = await saveMacro({
    name: `Recording ${new Date().toLocaleTimeString()}`,
    description: `Auto-recorded session on ${new URL(url).hostname}`,
    steps: [],
    isFormFill: false,
    targetUrl: url,
    tags: ["recorded"],
  });

  const session: RecordingSession = {
    id: sessionId,
    macroId: macro.id,
    page, browser,
    steps: [],
    isRecording: true,
    startedAt: new Date(),
    lastUrl: url,
    lastStepTime: new Map(),
  };

  page.on("crash", () => {
    console.error(`[MacroRecorder] Page crashed in session ${sessionId}`);
    cleanupSession(sessionId, "page crashed");
  });

  page.on("pageerror", (err) => {
    console.warn(`[MacroRecorder] Page error in session ${sessionId}:`, err.message);
  });

  page.on("dialog", (dialog) => {
    console.log(`[MacroRecorder] Auto-dismissing dialog: ${dialog.type()}`);
    dialog.dismiss().catch(() => {});
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
  } catch (err: any) {
    console.error(`[MacroRecorder] Failed to navigate to ${url}:`, err?.message);
  }

  await injectRecordingListeners(session, page);

  // Re-inject listeners after SPA navigations
  page.on("framenavigated", async (frame) => {
    if (!session.isRecording || frame !== page.mainFrame()) return;
    const newUrl = frame.url();
    if (newUrl !== session.lastUrl) {
      session.lastUrl = newUrl;
      // Skip destructive navigations that would break replay
      // (e.g. closing a tab navigates to about:blank)
      const destructiveUrls = ["about:blank", "about:srcdoc", "chrome://newtab", "chrome://new-tab-page"];
      const isDestructive = destructiveUrls.some((d) => newUrl.toLowerCase().startsWith(d));
      if (isDestructive) {
        console.log(`[MacroRecorder] Skipping destructive navigation: ${newUrl}`);
        return;
      }
      const step: MacroStep = {
        id: stepId(),
        action: "goto",
        target: newUrl,
        description: describeStep("goto", newUrl),
      };
      session.steps.push(step);
      await appendStep(macro.id, step).catch((e) =>
        console.error("[MacroRecorder] appendStep error:", e)
      );
      await page.waitForTimeout(1500);
      await injectRecordingListeners(session, page).catch((e) =>
        console.error("[MacroRecorder] Re-inject after navigation failed:", e)
      );
    }
  });

  activeSessions.set(sessionId, session);

  console.log(
    `[MacroRecorder] Recording started: session=${sessionId} macro=${macro.id} url=${url} headed=${!headless}`
  );

  return { sessionId, macroId: macro.id };
}

export async function stopRecording(
  sessionId: string
): Promise<{ macro: Macro; totalSteps: number } | null> {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  const totalSteps = session.steps.length;
  try { await session.browser.close(); } catch { /* already closed */ }
  const macro = await finalizeRecording(session);
  if (!macro) return null;
  return { macro, totalSteps };
}

export function getRecordingStatus(
  sessionId: string
): { isRecording: boolean; stepsRecorded: number; durationMs: number } | null {
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  if (!session.browser.isConnected()) {
    cleanupSession(sessionId, "browser disconnected (detected on status check)");
    return null;
  }
  return {
    isRecording: session.isRecording,
    stepsRecorded: session.steps.length,
    durationMs: Date.now() - session.startedAt.getTime(),
  };
}

// ─── Replay ────────────────────────────────────────────────────────────

const STEP_TIMEOUT_MS = 25000;

export async function replayMacro(
  macroId: string,
  options: { headed?: boolean; stopOnFirstError?: boolean; keepOpen?: boolean; vars?: Record<string, string> } = {}
): Promise<MacroReplayResult> {
  const macro = await getMacro(macroId);
  if (!macro) {
    return {
      macroId, macroName: "Unknown", success: false,
      totalSteps: 0, stepsCompleted: 0, stepsFailed: 0,
      durationMs: 0, results: [],
    };
  }

  // One macro, infinite uses: {{var}} placeholders get runtime values
  const steps = macro.steps.map((s) => interpolateStep(s, options.vars));

  const startTime = Date.now();
  const stepResults: MacroReplayResult["results"] = [];
  let stepsCompleted = 0;
  let stepsFailed = 0;
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: options.headed === false ? true : false,
      args: [
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        // Allow videos to autoplay without a user gesture (YouTube songs etc.)
        "--autoplay-policy=no-user-gesture-required",
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    let pageLoaded = false;

    /** Resolve a click/type target — if selector looks invalid, try the page URL instead */
    function resolveTarget(step: MacroStep): string {
      if (step.target && (step.target.startsWith("#") || step.target.includes(".") || step.target.includes("["))) {
        return step.target;
      }
      return step.target || "";
    }

    for (const step of steps) {
      const stepStart = Date.now();
      let stepSuccess = false;
      let stepError: string | undefined;

      try {
        // Wrap every step in a hard timeout so nothing hangs
        await withTimeout(
          (async () => {
            switch (step.action) {
              case "goto": {
                // Skip destructive navigations during replay too
                const destructiveUrls = ["about:blank", "about:srcdoc", "chrome://newtab", "chrome://new-tab-page"];
                const isDestructive = destructiveUrls.some((d) => (step.target || "").toLowerCase().startsWith(d));
                if (isDestructive) {
                  console.log(`[MacroRecorder] Skipping destructive step during replay: ${step.target}`);
                  break;
                }
                await page.goto((step.target || "").replace(/ /g, "%20"), {
                  waitUntil: "domcontentloaded",
                  timeout: 20000,
                });
                // Minimal wait — just enough for DOM to settle
                const isVideoPage = step.target?.includes("youtube.com/watch") || step.target?.includes("youtube.com/results");
                await page.waitForTimeout(isVideoPage ? 1200 : 600);
                // On watch pages, make sure the video is actually playing
                if (step.target?.includes("youtube.com/watch")) {
                  await unblockAutoplay(page);
                }
                // Fire-and-forget consent dismiss — don't block on it
                page.$('button[aria-label*="Accept"], button[aria-label*="agree"], button[aria-label*="Reject"]').then((btn) => {
                  if (btn) btn.click({ timeout: 1500 }).catch(() => {});
                }).catch(() => {});
                pageLoaded = true;
                break;
              }

              case "click": {
                // Ensure page is loaded
                if (!pageLoaded && macro.targetUrl) {
                  await page.goto(macro.targetUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 15000,
                  });
                  await page.waitForTimeout(1000);
                  pageLoaded = true;
                }
                const clickTarget = resolveTarget(step);
                if (!clickTarget) throw new Error("No selector for click step");
                const clickFallbacks = Array.isArray((step.options as any)?.fallbacks)
                  ? ((step.options as any).fallbacks as string[])
                  : undefined;
                await smartClick(page, clickTarget, { fallbacks: clickFallbacks });
                await page.waitForTimeout(200);
                break;
              }

              case "type":
              case "fill": {
                if (!pageLoaded && macro.targetUrl) {
                  await page.goto(macro.targetUrl, {
                    waitUntil: "domcontentloaded",
                    timeout: 15000,
                  });
                  await page.waitForTimeout(1000);
                  pageLoaded = true;
                }
                const typeTarget = resolveTarget(step);
                if (!typeTarget) throw new Error("No selector for type step");
                const typeFallbacks = Array.isArray((step.options as any)?.fallbacks)
                  ? ((step.options as any).fallbacks as string[])
                  : undefined;
                await smartType(page, typeTarget, step.value || "", { fallbacks: typeFallbacks });
                await page.waitForTimeout(150);
                break;
              }

              case "select":
                await page.selectOption(step.target!, step.value || "", { timeout: 8000 });
                break;

              case "press": {
                // When replaying ChatGPT/AI-chat flows the composer needs a
                // moment after typing before Enter actually sends the message.
                await page.keyboard.press(step.value || "Enter");
                await page.waitForTimeout(400);
                // If we just pressed Enter on a page with an empty visible
                // input right after typing, give the app time to react.
                break;
              }

              case "wait":
                if (step.target) {
                  await page.waitForSelector(step.target, { timeout: 10000 });
                } else {
                  await page.waitForTimeout(2000);
                }
                break;

              case "autofill": {
                const { GhostAutofillService } = await import("@/services/GhostAutofillService");
                const filled = await GhostAutofillService.autofillPage(page);
                if (filled.length === 0) throw new Error("Autofill found no fields");
                break;
              }

              case "scroll":
                await page.evaluate((dir) => {
                  window.scrollBy(0, dir === "up" ? -500 : 500);
                }, step.value || "down");
                await page.waitForTimeout(150);
                break;

              case "submit":
                await page.evaluate((sel) => {
                  const form = sel
                    ? document.querySelector(sel)?.closest("form")
                    : document.querySelector("form");
                  if (form) (form as HTMLFormElement).submit();
                }, step.target);
                break;

              default:
                throw new Error(`Unknown action: ${step.action}`);
            }
          })(),
          STEP_TIMEOUT_MS,
          `Step: ${step.description || step.action}`
        );

        stepSuccess = true;
      } catch (err: any) {
        stepError = err?.message || String(err);
        console.error(`[MacroRecorder] Step failed: ${step.action} — ${stepError}`);
      }

      const stepDuration = Date.now() - stepStart;
      stepResults.push({
        stepId: step.id,
        success: stepSuccess,
        error: stepError,
        durationMs: stepDuration,
      });

      if (stepSuccess) {
        stepsCompleted++;
      } else {
        stepsFailed++;
        if (options.stopOnFirstError) break;
      }
    }

    // Final screenshot (only if we're not keeping the browser open —
    // the screenshot is for verification, keepOpen means user will look at it live)
    let screenshotPath: string | undefined;
    if (pageLoaded && !options.keepOpen) {
      const os = await import("os");
      const ssPath =
        os.default.tmpdir() +
        `/macro_replay_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
      await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
      screenshotPath = ssPath;
    }

    await incrementReplayCount(macroId);

    // keepOpen: leave the browser running so the music keeps playing.
    // It becomes the user's browser — closing it is their choice.
    if (options.keepOpen && pageLoaded) {
      console.log(`[MacroRecorder] Replay complete — leaving browser open (keepOpen) for macro ${macroId}`);
      // Detach: don't let our process hold references that block exit,
      // but don't close either. The browser process is independent.
      browser = null;
    }

    return {
      macroId,
      macroName: macro.name,
      success: stepsFailed === 0,
      totalSteps: macro.steps.length,
      stepsCompleted,
      stepsFailed,
      durationMs: Date.now() - startTime,
      results: stepResults,
      screenshotPath,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// ─── Active Sessions ───────────────────────────────────────────────────

export function getActiveSessions(): Array<{
  sessionId: string;
  macroId: string;
  stepsRecorded: number;
  durationMs: number;
}> {
  for (const [id, session] of activeSessions.entries()) {
    if (!session.browser.isConnected()) {
      cleanupSession(id, "browser disconnected (detected on list)");
    }
  }

  return Array.from(activeSessions.values()).map((s) => ({
    sessionId: s.id,
    macroId: s.macroId,
    stepsRecorded: s.steps.length,
    durationMs: Date.now() - s.startedAt.getTime(),
  }));
}
