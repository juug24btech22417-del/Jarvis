/**
 * MacroRecorderService — Record & Replay browser automation using Playwright.
 *
 * Flow:
 *   1. startRecording(url)  → opens browser, attaches listeners, returns sessionId
 *   2. User interacts with the page → events are captured as MacroSteps
 *   3. stopRecording()       → closes browser, saves macro to store, returns it
 *   4. replayMacro(macroId)  → opens browser, executes steps in order, returns result
 *
 * The recorder captures: navigation, clicks, typing, form fills, key presses,
 * and scrolling. Each step is a serializable MacroStep that can be stored and
 * replayed later.
 */

import { chromium, type Page, type Browser } from "playwright";
import { saveMacro, appendStep, incrementReplayCount, getMacro } from "@/lib/ghost/macroStore";
import type { Macro, MacroStep, MacroReplayResult } from "@/lib/ghost/macroTypes";

interface RecordingSession {
  id: string;
  macroId: string;
  page: Page;
  browser: Browser;
  steps: MacroStep[];
  isRecording: boolean;
  startedAt: Date;
  /** Last known URL to detect navigations */
  lastUrl: string;
}

// Active recording sessions (keyed by session id)
const activeSessions = new Map<string, RecordingSession>();

function stepId(): string {
  return `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function describeStep(action: string, target?: string, value?: string): string {
  switch (action) {
    case "goto":
      return `Navigate to ${target}`;
    case "click":
      return `Click ${target || "element"}`;
    case "type":
      return `Type "${value?.slice(0, 30)}${(value?.length || 0) > 30 ? "..." : ""}" into ${target || "field"}`;
    case "fill":
      return `Fill ${target || "field"} with "${value?.slice(0, 30)}${(value?.length || 0) > 30 ? "..." : ""}"`;
    case "select":
      return `Select "${value}" in ${target || "dropdown"}`;
    case "press":
      return `Press ${value || "key"}`;
    case "wait":
      return `Wait for ${target || "timeout"}`;
    case "autofill":
      return "Ghost Protocol autofill";
    case "scroll":
      return `Scroll ${value || "down"}`;
    case "submit":
      return `Submit ${target || "form"}`;
    default:
      return `${action} on ${target || "page"}`;
  }
}

/**
 * Clean up a dead session — remove it from the active map.
 */
function cleanupSession(sessionId: string, reason: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;
  console.log(`[MacroRecorder] Cleaning up session ${sessionId}: ${reason}`);
  session.isRecording = false;
  activeSessions.delete(sessionId);
}

/**
 * Start recording browser actions.
 * Opens a new Playwright browser, navigates to the URL, and attaches
 * event listeners that capture user interactions as MacroSteps.
 *
 * By default opens a headed (visible) browser so the user can see and
 * interact with the page. Pass { headed: false } for headless mode.
 */
export async function startRecording(
  url: string,
  options: { headed?: boolean } = {}
): Promise<{ sessionId: string; macroId: string }> {
  // Default to headed=true so user can see and interact with the page
  const headless = options.headed === false ? true : false;

  const browser = await chromium.launch({
    headless,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const sessionId = `session_${Date.now()}`;

  // ─── Guard: if browser dies, clean up the session automatically ────
  browser.on("disconnected", () => {
    cleanupSession(sessionId, "browser disconnected");
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  // Create macro in store (will be updated as steps are recorded)
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
    page,
    browser,
    steps: [],
    isRecording: true,
    startedAt: new Date(),
    lastUrl: url,
  };

  // ─── Page error handlers — log but don't kill the session ──────────
  page.on("crash", () => {
    console.error(`[MacroRecorder] Page crashed in session ${sessionId}`);
    cleanupSession(sessionId, "page crashed");
  });

  page.on("pageerror", (err) => {
    console.warn(`[MacroRecorder] Page error in session ${sessionId}:`, err.message);
    // Don't kill the session — page errors are common (JS errors on the site)
  });

  page.on("dialog", (dialog) => {
    // Auto-dismiss alerts/confirms so they don't block interaction
    console.log(`[MacroRecorder] Auto-dismissing dialog: ${dialog.type()}`);
    dialog.dismiss().catch(() => {});
  });

  // ─── Navigate to the target URL ────────────────────────────────────
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Give the page time to fully render (SPAs, WhatsApp Web, etc.)
    await page.waitForTimeout(2000);
  } catch (err: any) {
    console.error(`[MacroRecorder] Failed to navigate to ${url}:`, err?.message);
    // Don't abort — the user might still be able to interact if the page partially loaded
    // Record the navigation attempt anyway
  }

  // ─── Attach event listeners via exposeFunction ─────────────────────
  // We inject a listener into the page context that calls back into Node.js
  // when clicks, inputs, and keydowns happen.

  await page.exposeFunction("__jarvisRecordClick", async (selector: string) => {
    if (!session.isRecording) return;
    const step: MacroStep = {
      id: stepId(),
      action: "click",
      target: selector,
      description: describeStep("click", selector),
    };
    session.steps.push(step);
    await appendStep(macro.id, step).catch((e) =>
      console.error("[MacroRecorder] appendStep error:", e)
    );
  });

  await page.exposeFunction("__jarvisRecordInput", async (selector: string, value: string) => {
    if (!session.isRecording) return;
    const lastStep = session.steps[session.steps.length - 1];
    if (lastStep && lastStep.action === "type" && lastStep.target === selector) {
      lastStep.value = value;
      lastStep.description = describeStep("type", selector, value);
    } else {
      const step: MacroStep = {
        id: stepId(),
        action: "type",
        target: selector,
        value,
        description: describeStep("type", selector, value),
      };
      session.steps.push(step);
      await appendStep(macro.id, step).catch((e) =>
        console.error("[MacroRecorder] appendStep error:", e)
      );
    }
  });

  await page.exposeFunction("__jarvisRecordKeydown", async (key: string) => {
    if (!session.isRecording) return;
    const specialKeys = ["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!specialKeys.includes(key)) return;
    const lastStep = session.steps[session.steps.length - 1];
    if (lastStep && lastStep.action === "press" && lastStep.value === key) return;
    const step: MacroStep = {
      id: stepId(),
      action: "press",
      value: key,
      description: describeStep("press", undefined, key),
    };
    session.steps.push(step);
    await appendStep(macro.id, step).catch((e) =>
      console.error("[MacroRecorder] appendStep error:", e)
    );
  });

  // Inject the event listeners into the page
  await page.evaluate(() => {
    document.addEventListener("click", (e) => {
      const el = e.target as HTMLElement;
      let selector = "";
      if (el.id) selector = `#${el.id}`;
      else {
        const tag = el.tagName.toLowerCase();
        const classes = Array.from(el.classList).slice(0, 2).join(".");
        selector = classes ? `${tag}.${classes}` : tag;
      }
      (window as any).__jarvisRecordClick(selector);
    }, true);

    document.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return;
      let selector = "";
      if (el.id) selector = `#${el.id}`;
      else if (el.name) selector = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
      else selector = el.tagName.toLowerCase();
      (window as any).__jarvisRecordInput(selector, el.value);
    }, true);

    document.addEventListener("keydown", (e) => {
      (window as any).__jarvisRecordKeydown(e.key);
    }, true);
  });

  // Detect navigation (page.goto, link clicks that cause full navigation)
  page.on("framenavigated", async (frame) => {
    if (!session.isRecording || frame !== page.mainFrame()) return;
    const newUrl = frame.url();
    if (newUrl !== session.lastUrl) {
      session.lastUrl = newUrl;
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
    }
  });

  activeSessions.set(sessionId, session);

  console.log(
    `[MacroRecorder] Recording started: session=${sessionId} macro=${macro.id} url=${url} headed=${!headless}`
  );

  return { sessionId, macroId: macro.id };
}

/**
 * Stop recording and finalize the macro.
 */
export async function stopRecording(
  sessionId: string
): Promise<{ macro: Macro; totalSteps: number } | null> {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  session.isRecording = false;

  // Close the browser
  try {
    await session.browser.close();
  } catch {
    // Already closed
  }

  // Fetch the saved macro and update its name
  const macro = await getMacro(session.macroId);
  activeSessions.delete(sessionId);

  if (!macro) return null;

  // Auto-name the macro based on steps
  const firstGoto = session.steps.find((s) => s.action === "goto");
  const hostname = firstGoto?.target
    ? new URL(firstGoto.target).hostname
    : "unknown";
  const name = `${hostname} — ${session.steps.length} steps`;

  const { updateMacro } = await import("@/lib/ghost/macroStore");
  await updateMacro(session.macroId, {
    name,
    description: `Recorded ${session.steps.length} steps on ${hostname}. Duration: ${Math.round((Date.now() - session.startedAt.getTime()) / 1000)}s`,
  });

  // Re-fetch to get updated macro
  const finalMacro = await getMacro(session.macroId);

  console.log(
    `[MacroRecorder] Recording stopped: ${session.steps.length} steps captured`
  );

  return {
    macro: finalMacro!,
    totalSteps: session.steps.length,
  };
}

/**
 * Get the current recording status.
 * Also checks if the browser is still alive — cleans up dead sessions.
 */
export function getRecordingStatus(
  sessionId: string
): { isRecording: boolean; stepsRecorded: number; durationMs: number } | null {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  // Check if browser is still connected
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

/**
 * Replay a saved macro.
 * Opens a new browser and executes each step in sequence.
 */
export async function replayMacro(
  macroId: string,
  options: { headed?: boolean; stopOnFirstError?: boolean } = {}
): Promise<MacroReplayResult> {
  const macro = await getMacro(macroId);
  if (!macro) {
    return {
      macroId,
      macroName: "Unknown",
      success: false,
      totalSteps: 0,
      stepsCompleted: 0,
      stepsFailed: 0,
      durationMs: 0,
      results: [],
    };
  }

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
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();
    let pageLoaded = false;

    for (const step of macro.steps) {
      const stepStart = Date.now();
      let stepSuccess = false;
      let stepError: string | undefined;

      try {
        switch (step.action) {
          case "goto":
            await page.goto(step.target!, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
            await page.waitForTimeout(1000);
            pageLoaded = true;
            stepSuccess = true;
            break;

          case "click":
            if (!pageLoaded && macro.targetUrl) {
              await page.goto(macro.targetUrl, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
              });
              await page.waitForTimeout(1500);
              pageLoaded = true;
            }
            await page.click(step.target!, { timeout: 10000 });
            await page.waitForTimeout(300);
            stepSuccess = true;
            break;

          case "type":
          case "fill":
            if (!pageLoaded && macro.targetUrl) {
              await page.goto(macro.targetUrl, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
              });
              await page.waitForTimeout(1500);
              pageLoaded = true;
            }
            // Use native value setter approach for React/Google Forms
            await page.evaluate(
              ({ selector, value }) => {
                const el = document.querySelector(selector);
                if (!el) throw new Error(`Element not found: ${selector}`);
                const nativeSetter = Object.getOwnPropertyDescriptor(
                  HTMLInputElement.prototype,
                  "value"
                )?.set;
                if (nativeSetter) {
                  nativeSetter.call(el, value);
                } else {
                  (el as HTMLInputElement).value = value;
                }
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
              },
              { selector: step.target || "", value: step.value || "" }
            );
            await page.waitForTimeout(200);
            stepSuccess = true;
            break;

          case "select":
            await page.selectOption(step.target!, step.value || "", {
              timeout: 5000,
            });
            stepSuccess = true;
            break;

          case "press":
            await page.keyboard.press(step.value || "Enter");
            await page.waitForTimeout(200);
            stepSuccess = true;
            break;

          case "wait":
            if (step.target) {
              await page.waitForSelector(step.target, { timeout: 10000 });
            } else {
              await page.waitForTimeout(1000);
            }
            stepSuccess = true;
            break;

          case "autofill": {
            const { GhostAutofillService } = await import(
              "@/services/GhostAutofillService"
            );
            const filled = await GhostAutofillService.autofillPage(page);
            stepSuccess = filled.length > 0;
            break;
          }

          case "scroll":
            await page.evaluate((dir) => {
              window.scrollBy(0, dir === "up" ? -500 : 500);
            }, step.value || "down");
            await page.waitForTimeout(300);
            stepSuccess = true;
            break;

          case "submit":
            await page.evaluate((sel) => {
              const form = sel
                ? document.querySelector(sel)?.closest("form")
                : document.querySelector("form");
              if (form) (form as HTMLFormElement).submit();
            }, step.target);
            stepSuccess = true;
            break;

          default:
            stepError = `Unknown action: ${step.action}`;
        }
      } catch (err: any) {
        stepError = err?.message || String(err);
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

    // Take final screenshot
    let screenshotPath: string | undefined;
    if (pageLoaded) {
      const os = await import("os");
      const ssPath =
        os.default.tmpdir() +
        `/macro_replay_${Date.now()}_${Math.random().toString(36).slice(2)}.png`;
      await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
      screenshotPath = ssPath;
    }

    await incrementReplayCount(macroId);

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

/**
 * List active recording sessions.
 * Automatically cleans up sessions whose browsers have died.
 */
export function getActiveSessions(): Array<{
  sessionId: string;
  macroId: string;
  stepsRecorded: number;
  durationMs: number;
}> {
  // Clean up dead sessions first
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
