import { NextRequest, NextResponse } from "next/server";
import { chromium, Browser, Page } from "playwright";

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: true,
    });
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

interface BrowserAction {
  type: "navigate" | "click" | "fill" | "select" | "screenshot" | "evaluate" | "wait" | "getText" | "getAttribute";
  selector?: string;
  value?: string;
  url?: string;
  script?: string;
  timeout?: number;
}

async function executeActions(actions: BrowserAction[]): Promise<any[]> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  const results: any[] = [];

  try {
    for (const action of actions) {
      switch (action.type) {
        case "navigate": {
          if (!action.url) throw new Error("URL required for navigate");
          await page.goto(action.url, { waitUntil: "networkidle" });
          results.push({ action: "navigate", url: action.url, success: true });
          break;
        }

        case "click": {
          if (!action.selector) throw new Error("Selector required for click");
          await page.click(action.selector);
          results.push({ action: "click", selector: action.selector, success: true });
          break;
        }

        case "fill": {
          if (!action.selector || !action.value)
            throw new Error("Selector and value required for fill");
          await page.fill(action.selector, action.value);
          results.push({
            action: "fill",
            selector: action.selector,
            value: action.value,
            success: true,
          });
          break;
        }

        case "select": {
          if (!action.selector || !action.value)
            throw new Error("Selector and value required for select");
          await page.selectOption(action.selector, action.value);
          results.push({
            action: "select",
            selector: action.selector,
            value: action.value,
            success: true,
          });
          break;
        }

        case "wait": {
          const timeout = action.timeout || 1000;
          await page.waitForTimeout(timeout);
          results.push({ action: "wait", timeout, success: true });
          break;
        }

        case "screenshot": {
          const screenshot = await page.screenshot({
            type: "png",
          });
          const base64Screenshot = screenshot.toString("base64");
          results.push({
            action: "screenshot",
            data: `data:image/png;base64,${base64Screenshot}`,
            success: true,
          });
          break;
        }

        case "getText": {
          if (!action.selector) throw new Error("Selector required for getText");
          const text = await page.textContent(action.selector);
          results.push({
            action: "getText",
            selector: action.selector,
            text,
            success: true,
          });
          break;
        }

        case "getAttribute": {
          if (!action.selector || !action.value)
            throw new Error("Selector and attribute name required");
          const attr = await page.getAttribute(action.selector, action.value);
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
            return eval(script);
          }, action.script);
          results.push({
            action: "evaluate",
            result: evalResult,
            success: true,
          });
          break;
        }

        default:
          throw new Error(`Unknown action type: ${action.type}`);
      }
    }

    return results;
  } catch (error) {
    throw error;
  } finally {
    await context.close();
  }
}

// Predefined workflows
const WORKFLOWS: Record<
  string,
  { name: string; description: string; actions: BrowserAction[] }
> = {
  search_flight: {
    name: "Search Flight",
    description: "Search for flights on Google Flights",
    actions: [
      { type: "navigate", url: "https://www.google.com/travel/flights" },
      { type: "fill", selector: 'input[placeholder*="Where from"]', value: "{{origin}}" },
      { type: "fill", selector: 'input[placeholder*="Where to"]', value: "{{destination}}" },
      { type: "click", selector: 'button[aria-label*="Search"]' },
      { type: "wait", timeout: 3000 },
      { type: "screenshot" },
    ],
  },

  book_ticket: {
    name: "Book Ticket",
    description: "Book a movie ticket (example workflow)",
    actions: [
      { type: "navigate", url: "https://www.example-cinema.com" },
      { type: "click", selector: 'a[href*="movies"]' },
      { type: "wait", timeout: 1000 },
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
      { type: "wait", timeout: 2000 },
      { type: "getText", selector: ".a-price .a-offscreen" },
      { type: "screenshot" },
    ],
  },

  form_fill: {
    name: "Fill Form",
    description: "Fill out a contact form",
    actions: [
      { type: "navigate", url: "{{url}}" },
      { type: "fill", selector: 'input[name="name"], #name', value: "{{name}}" },
      { type: "fill", selector: 'input[name="email"], #email', value: "{{email}}" },
      { type: "fill", selector: 'textarea[name="message"], #message', value: "{{message}}" },
      { type: "screenshot" },
    ],
  },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { workflow, actions, variables = {} } = body;

    let actionsToExecute: BrowserAction[];

    // Use predefined workflow
    if (workflow) {
      const workflowConfig = WORKFLOWS[workflow];
      if (!workflowConfig) {
        return NextResponse.json(
          {
            error: "Unknown workflow",
            availableWorkflows: Object.keys(WORKFLOWS),
          },
          { status: 400 }
        );
      }

      // Replace variables in actions
      actionsToExecute = workflowConfig.actions.map((action) => {
        const replacedAction = { ...action };
        if (replacedAction.url) {
          replacedAction.url = replacedAction.url.replace(
            /\{\{(\w+)\}\}/g,
            (_, key) => variables[key] || `{{${key}}}`
          );
        }
        if (replacedAction.value) {
          replacedAction.value = replacedAction.value.replace(
            /\{\{(\w+)\}\}/g,
            (_, key) => variables[key] || `{{${key}}}`
          );
        }
        if (replacedAction.selector) {
          replacedAction.selector = replacedAction.selector.replace(
            /\{\{(\w+)\}\}/g,
            (_, key) => variables[key] || `{{${key}}}`
          );
        }
        return replacedAction;
      });
    } else if (actions) {
      // Use custom actions
      actionsToExecute = actions;
    } else {
      return NextResponse.json(
        { error: "Either 'workflow' or 'actions' required" },
        { status: 400 }
      );
    }

    const results = await executeActions(actionsToExecute);

    return NextResponse.json({
      success: true,
      workflow: workflow || "custom",
      results,
    });
  } catch (error) {
    console.error("Browser automation error:", error);
    return NextResponse.json(
      { error: "Browser automation failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    usage: {
      method: "POST",
      endpoint: "/api/browser",
      workflows: WORKFLOWS,
      customActions: {
        navigate: { description: "Navigate to URL", required: ["url"] },
        click: { description: "Click element", required: ["selector"] },
        fill: { description: "Fill input field", required: ["selector", "value"] },
        select: { description: "Select dropdown option", required: ["selector", "value"] },
        wait: { description: "Wait for milliseconds", required: ["timeout"] },
        screenshot: { description: "Take screenshot" },
        getText: { description: "Get element text", required: ["selector"] },
        getAttribute: { description: "Get element attribute", required: ["selector", "value"] },
        evaluate: { description: "Execute JavaScript", required: ["script"] },
      },
    },
    note: "Playwright is used for browser automation. First run may take time to download browser.",
  });
}
