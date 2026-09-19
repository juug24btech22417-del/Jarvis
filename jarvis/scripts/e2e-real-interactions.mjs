/**
 * Deep-interaction probe against the REAL LLM artifact.
 * compute → clear → compute — the exact failure class reported by the user.
 */
import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(120000);

try {
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
  await input.click();
  await input.fill("write an html for calculator");
  await input.press("Enter");

  await page.getByText(/code forge/i).first().waitFor({ state: "visible", timeout: 150000 });
  await page.getByRole("button", { name: /^run$/i }).first().click();
  await page.locator('iframe[title="Code Forge preview"]').waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2000);

  const frame = page.frameLocator('iframe[title="Code Forge preview"]');
  const buttons = await frame.locator("button").allInnerTexts();
  console.log("artifact buttons:", JSON.stringify(buttons.slice(0, 24)));

  // Generic clicker: find a button by visible text (works for any design).
  const click = async (label) => {
    const b = frame.locator(`button:has-text("${label}")`).first();
    if (await b.isVisible().catch(() => false)) { await b.click(); return true; }
    return false;
  };
  const readScreen = async () => {
    // Try common display selectors; fall back to any large-text node.
    for (const sel of ["#out", "#display", ".display", ".screen", "input[readonly]", "input[type=text]"]) {
      const el = frame.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        const tag = await el.evaluate((e) => e.tagName);
        return tag === "INPUT" ? await el.inputValue() : (await el.innerText()).trim();
      }
    }
    return "?";
  };

  // Round 1: 8 × 7 =
  await click("8"); await click("×") || await click("*") || await click("x") || await click("X");
  await click("7"); await click("=");
  await page.waitForTimeout(700);
  const r1 = await readScreen();
  console.log(`round1 8×7 → "${r1}"  ${r1 === "56" ? "PASS" : "CHECK"}`);

  // Round 2: clear → 6 + 4 =
  let cleared = await click("C") || await click("AC") || await click("Clear") || await click("CLR");
  await click("6"); await click("+"); await click("4"); await click("=");
  await page.waitForTimeout(700);
  const r2 = await readScreen();
  console.log(`round2 ${cleared ? "C," : ""}6+4 → "${r2}"  ${r2 === "10" ? "PASS" : "CHECK"}`);

  // Round 3: chained 50 ÷ 5 − 3 =
  await click("5"); await click("0"); await click("÷") || await click("/");
  await click("5"); await click("−") || await click("-");
  await click("3"); await click("=");
  await page.waitForTimeout(700);
  const r3 = await readScreen();
  console.log(`round3 50÷5−3 → "${r3}"  ${r3 === "7" ? "PASS" : "CHECK"}`);

  await page.screenshot({ path: "/tmp/forge-real-deep.png" });
  console.log("screenshot: /tmp/forge-real-deep.png");
} catch (e) {
  console.log("crash:", String(e).slice(0, 300));
} finally { await browser.close(); }
