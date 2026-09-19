/**
 * Diagnostic v3: capture the SANDBOXED iframe's own console + errors via
 * CDP (sandboxed opaque-origin frames don't forward console to the parent
 * page), then click buttons inside the sandbox and watch what happens.
 */
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });

const cdpLogs = [];

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  // CDP console capture — covers sandboxed child frames too.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  cdp.on("Runtime.consoleAPICalled", (e) => {
    const text = (e.args || [])
      .map((a) => a.description || a.value || a.type)
      .join(" ")
      .slice(0, 250);
    cdpLogs.push(`[console.${e.type}] ${text}`);
  });
  cdp.on("Runtime.exceptionThrown", (e) => {
    const d = e.exceptionDetails || {};
    const desc = d.exception?.description || d.text || "(unknown)";
    cdpLogs.push(`[EXCEPTION] ${String(desc).slice(0, 400)}`);
  });
  cdp.on("Log.entryAdded", (e) => {
    cdpLogs.push(`[log.${e.entry.level}] ${String(e.entry.text).slice(0, 250)}`);
  });

  // ── Boot ──
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);
  for (let i = 0; i < 3; i++) {
    const gate = page.getByText(/press to power on/i).first();
    if (await gate.isVisible().catch(() => false)) await gate.click().catch(() => {});
    await page.waitForTimeout(5000);
    if (await page.locator('input[placeholder*="type a command" i]').isVisible().catch(() => false)) break;
  }
  const input = page.locator('input[placeholder*="type a command" i]');
  await input.waitFor({ state: "visible", timeout: 120000 });
  await page.waitForTimeout(2000);

  // ── Ask + Run ──
  await input.click();
  await input.fill("write an html for calculator");
  await input.press("Enter");
  await page.getByText(/code forge/i).first().waitFor({ state: "visible", timeout: 150000 });
  await page.getByRole("button", { name: /^run$/i }).first().click();
  await page.locator('iframe[title="Code Forge preview"]').waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2500);

  cdpLogs.length = 0; // drop boot noise; we only care about the artifact

  // ── Click inside the sandbox ──
  const frame = page.frameLocator('iframe[title="Code Forge preview"]');
  const click = async (label) => {
    const b = frame.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible().catch(() => false)) { await b.click(); return true; }
    return false;
  };
  const r1 = await click("8");
  const r2 = await click("×");
  const r3 = await click("7");
  const r4 = await click("=");
  console.log(`clicks landed: 8=${r1} ×=${r2} 7=${r3} =${r4}`);
  await page.waitForTimeout(1500);

  // Display readout via generic selectors.
  for (const sel of ["#out", "#display", ".display", ".screen", "input[readonly]", "input[type=text]"]) {
    const el = frame.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      const tag = await el.evaluate((n) => n.tagName);
      const v = tag === "INPUT" ? await el.inputValue() : (await el.innerText()).trim();
      console.log(`display(${sel}) = "${v}"`);
      break;
    }
  }

  console.log("=== sandbox console/exceptions (last 20) ===");
  console.log(cdpLogs.slice(-20).join("\n") || "(nothing captured)");
  await page.screenshot({ path: "/tmp/forge-diag-v3.png" });
} catch (e) {
  console.log("crash:", String(e).slice(0, 300));
  if (cdpLogs.length) console.log("=== cdp logs before crash ===\n" + cdpLogs.slice(-10).join("\n"));
} finally { await browser.close(); }
