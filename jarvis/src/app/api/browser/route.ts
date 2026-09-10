import { NextRequest, NextResponse } from "next/server";
import { chromium, Browser, Page } from "playwright";

// Browser automation route.
//
// Design rules (learned the hard way):
//  - NEVER wait for "networkidle" on big sites — Amazon/Google ping forever
//    and the page never settles. Use "domcontentloaded" + explicit waits.
//  - Always send a real user-agent + viewport, or bot detection eats you.
//  - Fail soft per action: a missing field or a bot page should not kill
//    the whole workflow. Collect errors, still return the screenshot.
//  - Prefer URL params over form filling when a site supports it
//    (Google Flights accepts ?q=Flights from X to Y).

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  // Reuse the singleton only if it's actually alive (dev hot-reloads can
  // orphan the old one, after which every launch cache hit would fail).
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }
  browserInstance = await chromium.launch({ headless: true });
  return browserInstance;
}

interface BrowserAction {
  type:
    | "navigate"
    | "click"
    | "fill"
    | "fillAny"
    | "type"
    | "press"
    | "select"
    | "screenshot"
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
  optional?: boolean; // if true, failure is recorded but doesn't stop the run
}

interface ActionOutcome {
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

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    // Realistic desktop Chrome on Windows — enough to pass most bot checks.
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    viewport: { width: 1440, height: 900 },
    locale: "en-US",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  // Attach the context to the page so callers can close both.
  (page as Page & { __context?: unknown }).__context = context;
  return page;
}

async function closePage(page: Page): Promise<void> {
  try {
    const ctx = (page as Page & { __context?: { close(): Promise<void> } }).__context;
    if (ctx) await ctx.close();
    else await page.close();
  } catch {
    // ignore
  }
}

async function safeGoto(page: Page, url: string, timeout = 25_000): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  // Give client-side apps a beat to hydrate without hanging on idle networks.
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
}

async function executeActions(actions: BrowserAction[]): Promise<ActionOutcome[]> {
  const browser = await getBrowser();
  const page = await newPage(browser);
  const results: ActionOutcome[] = [];

  try {
    for (const action of actions) {
      try {
        switch (action.type) {
          case "navigate": {
            if (!action.url) throw new Error("URL required for navigate");
            await safeGoto(page, action.url, action.timeout);
            results.push({ action: "navigate", url: action.url, success: true });
            break;
          }

          case "click": {
            if (!action.selector) throw new Error("Selector required for click");
            await page.click(action.selector, { timeout: action.timeout });
            results.push({ action: "click", selector: action.selector, success: true });
            break;
          }

          case "fill": {
            if (!action.selector || !action.value)
              throw new Error("Selector and value required for fill");
            await page.fill(action.selector, action.value, { timeout: action.timeout });
            results.push({ action: "fill", selector: action.selector, success: true });
            break;
          }

          case "fillAny": {
            // Try candidate selectors in order until one fills. Candidates
            // are separated by "||" because commas are CSS syntax.
            if (!action.selector || !action.value)
              throw new Error("Selector and value required for fillAny");
            const candidates = action.selector.split("||").map((s) => s.trim()).filter(Boolean);
            const attempts: string[] = [];
            let matched = false;
            for (const sel of candidates) {
              try {
                await page.fill(sel, action.value, { timeout: action.timeout ?? 4_000 });
                results.push({ action: "fillAny", selector: sel, success: true });
                matched = true;
                break;
              } catch (e) {
                attempts.push(sel);
              }
            }
            if (!matched) {
              throw new Error(`No candidate matched (${attempts.length} tried)`);
            }
            break;
          }

          case "type": {
            if (!action.selector || !action.value)
              throw new Error("Selector and value required for type");
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
            if (!action.selector || !action.value)
              throw new Error("Selector and value required for select");
            await page.selectOption(action.selector, action.value, { timeout: action.timeout });
            results.push({ action: "select", selector: action.selector, success: true });
            break;
          }

          case "waitForSelector": {
            if (!action.selector) throw new Error("Selector required for waitForSelector");
            await page.waitForSelector(action.selector, {
              timeout: action.timeout ?? 10_000,
              state: "visible",
            });
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
            const screenshot = await page.screenshot({ type: "png" });
            results.push({
              action: "screenshot",
              data: `data:image/png;base64,${screenshot.toString("base64")}`,
              success: true,
            });
            break;
          }

          case "getText": {
            if (!action.selector) throw new Error("Selector required for getText");
            await page.waitForSelector(action.selector, { timeout: action.timeout ?? 8_000 }).catch(() => {});
            const text = (await page
              .textContent(action.selector, { timeout: action.timeout ?? 8_000 })
              .catch(() => null)) ?? undefined;
            results.push({ action: "getText", selector: action.selector, text, success: true });
            break;
          }

          case "getTexts": {
            if (!action.selector) throw new Error("Selector required for getTexts");
            const texts = await page
              .$$eval(action.selector, (els) =>
                els.slice(0, 10).map((e) => (e.textContent || "").trim()).filter(Boolean)
              )
              .catch(() => [] as string[]);
            results.push({ action: "getTexts", selector: action.selector, texts, success: true });
            break;
          }

          case "getAttribute": {
            if (!action.selector || !action.value)
              throw new Error("Selector and attribute name required");
            const attr = (await page
              .getAttribute(action.selector, action.value, { timeout: action.timeout })
              .catch(() => null)) ?? undefined;
            results.push({
              action: "getAttribute",
              selector: action.selector,
              attribute: action.value,
              value: attr,
              success: true,
            });
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
        if (!action.optional) break; // hard stop for required actions; optional ones continue
      }
    }
    return results;
  } finally {
    await closePage(page);
  }
}

// ─── Predefined workflows ───────────────────────────────────────────

const WORKFLOWS: Record<
  string,
  { name: string; description: string; actions: BrowserAction[] }
> = {
  search_flight: {
    name: "Search Flight",
    description: "Search flights on Google Flights",
    // Google Flights accepts a natural-language q= param — no fragile
    // autocomplete form filling needed.
    actions: [
      {
        type: "navigate",
        url: "https://www.google.com/travel/flights?q=Flights%20from%20{{origin}}%20to%20{{destination}}",
      },
      { type: "wait", timeout: 3500 },
      { type: "screenshot" },
    ],
  },

  check_price: {
    name: "Check Price",
    description: "Check product price on Amazon",
    actions: [
      { type: "navigate", url: "https://www.amazon.com" },
      { type: "fill", selector: "#twotabsearchtextbox", value: "{{product}}" },
      { type: "click", selector: "#nav-search-submit-button" },
      { type: "waitForSelector", selector: "div[data-component-type='s-search-result']", timeout: 12_000 },
      {
        // Top 3 results: title + price pairs, evaluated in-page.
        type: "evaluate",
        script: `
          JSON.stringify(
            Array.from(document.querySelectorAll("div[data-component-type='s-search-result']"))
              .slice(0, 3)
              .map((el) => ({
                title: (el.querySelector("h2 span")?.textContent || "").trim().slice(0, 90),
                price: (el.querySelector(".a-price .a-offscreen")?.textContent || "").trim(),
              }))
              .filter((r) => r.title)
          )
        `,
      },
      { type: "screenshot" },
    ],
  },

  form_fill: {
    name: "Fill Form",
    description: "Fill out contact forms",
    actions: [
      { type: "navigate", url: "{{url}}" },
      {
        type: "fillAny",
        selector: 'input[name="name"] || #name || input[name="custname"] || input[placeholder*="Name" i] || input[autocomplete="name"]',
        value: "{{name}}",
        optional: true,
        timeout: 3_000, // per candidate: fail fast, try the next
      },
      {
        type: "fillAny",
        selector: 'input[type="email"] || input[name="email"] || #email || input[name="custemail"]',
        value: "{{email}}",
        optional: true,
        timeout: 3_000,
      },
      {
        type: "fillAny",
        selector: 'textarea[name="message"] || #message || textarea',
        value: "{{message}}",
        optional: true,
        timeout: 3_000,
      },
      { type: "wait", timeout: 500 },
      { type: "screenshot" },
    ],
  },

  book_ticket: {
    name: "Book Ticket",
    description: "Book a movie ticket (example workflow)",
    actions: [
      { type: "navigate", url: "{{url}}" },
      { type: "wait", timeout: 2000 },
      { type: "screenshot" },
    ],
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const { workflow, actions, variables = {} } = body as {
      workflow?: string;
      actions?: BrowserAction[];
      variables?: Record<string, string>;
    };

    let actionsToExecute: BrowserAction[];

    if (workflow) {
      const workflowConfig = WORKFLOWS[workflow];
      if (!workflowConfig) {
        return NextResponse.json(
          { error: "Unknown workflow", availableWorkflows: Object.keys(WORKFLOWS) },
          { status: 400 }
        );
      }

      // Replace {{variables}} in url/value/selector fields.
      const substitute = (s: string) =>
        s.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] || `{{${key}}}`);

      actionsToExecute = workflowConfig.actions.map((action) => ({
        ...action,
        ...(action.url ? { url: substitute(action.url) } : {}),
        ...(action.value ? { value: substitute(action.value) } : {}),
        ...(action.selector ? { selector: substitute(action.selector) } : {}),
      }));
    } else if (Array.isArray(actions) && actions.length > 0) {
      actionsToExecute = actions.slice(0, 40);
    } else {
      return NextResponse.json(
        { error: "Either 'workflow' or 'actions' required" },
        { status: 400 }
      );
    }

    const results = await executeActions(actionsToExecute);
    const succeeded = results.filter((r) => r.success).length;
    const screenshot = results.find((r) => r.action === "screenshot" && r.data)?.data;

    return NextResponse.json({
      success: succeeded > 0,
      workflow: workflow || "custom",
      results,
      screenshot,
      summary: `${succeeded}/${results.length} actions succeeded`,
    });
  } catch (error) {
    console.error("Browser automation error:", error);
    return NextResponse.json(
      { error: "Browser automation failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    usage: {
      method: "POST",
      endpoint: "/api/browser",
      workflows: Object.fromEntries(
        Object.entries(WORKFLOWS).map(([id, w]) => [id, { name: w.name, description: w.description }])
      ),
      customActions: {
        navigate: { description: "Navigate to URL", required: ["url"] },
        click: { description: "Click element", required: ["selector"] },
        fill: { description: "Fill input field", required: ["selector", "value"] },
        fillAny: { description: "Fill first matching candidate (selectors joined by ||)", required: ["selector", "value"] },
        type: { description: "Type like a human (click + keystrokes)", required: ["selector", "value"] },
        press: { description: "Press a keyboard key", required: ["value"] },
        select: { description: "Select dropdown option", required: ["selector", "value"] },
        waitForSelector: { description: "Wait for element to be visible", required: ["selector"] },
        wait: { description: "Wait for milliseconds (max 15000)", required: ["timeout"] },
        screenshot: { description: "Take screenshot" },
        getText: { description: "Get element text", required: ["selector"] },
        getTexts: { description: "Get texts of matching elements", required: ["selector"] },
        getAttribute: { description: "Get element attribute", required: ["selector", "value"] },
        evaluate: { description: "Execute JavaScript", required: ["script"] },
      },
    },
    note: "Playwright-based. Navigation uses domcontentloaded + real UA; actions fail soft so screenshots still return.",
  });
}
