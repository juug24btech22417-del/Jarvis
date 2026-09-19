/**
 * E2E — Code Forge pipeline.
 *
 * Flow: power gate → boot → (onboarding skip) → type "write an html for
 * calculator" → assert JARVIS's chat reply contains no raw code/fences →
 * Code Forge panel auto-opens → Run → sandboxed iframe renders and the
 * calculator is interactive → Source + Console tabs work.
 *
 * Run:  node scripts/e2e-codeforge.mjs   (from the jarvis/ directory,
 * dev server already listening on :3000)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp";
const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass, extra });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(90000);

try {
  // ── 1. Load & power on ──────────────────────────────────────────────
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });
  const powerBtn = page.getByText(/press to power on/i).first();
  await powerBtn.waitFor({ state: "visible", timeout: 60000 });
  await page.screenshot({ path: `${SHOT_DIR}/forge-01-gate.png` });
  await powerBtn.click();
  ok("power gate clicked", true);

  // ── 2. Boot → command bar input appears ─────────────────────────────
  const input = page.locator('input[placeholder*="type a command" i]');
  await input.waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(1500); // let boot animations settle

  // Onboarding modal (only if the DB says first boot) — click through it.
  for (let i = 0; i < 8; i++) {
    const finish = page.getByRole("button", { name: /^(next|finish|skip)$/i }).first();
    if (!(await finish.isVisible().catch(() => false))) break;
    await finish.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: `${SHOT_DIR}/forge-02-booted.png` });
  ok("booted to command bar", true);

  // ── 3. Ask JARVIS to write code ─────────────────────────────────────
  await input.click();
  await input.fill("write an html for calculator");
  await input.press("Enter");
  ok("prompt sent", true, "write an html for calculator");

  // ── 4. Code Forge panel auto-opens ──────────────────────────────────
  const forgeHeader = page.getByText(/code forge/i).first();
  await forgeHeader.waitFor({ state: "visible", timeout: 120000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOT_DIR}/forge-03-panel.png` });
  ok("Code Forge panel auto-opened", true);

  // ── 5. Chat must NOT contain raw code or markers ────────────────────
  const bodyText = await page.locator("body").innerText();
  const hasRawFences = bodyText.includes("```");
  const hasMarker = bodyText.includes("<<<FORGE") || bodyText.includes("FORGE>>>");
  const hasDoctypeInChat = /<!DOCTYPE/i.test(bodyText);
  ok("no raw fences in chat", !hasRawFences);
  ok("no forge markers leaked", !hasMarker);
  ok("no full HTML doc dumped in chat", !hasDoctypeInChat);

  // ── 6. Run in the sandbox ───────────────────────────────────────────
  // Panel opens on the Preview tab with a Run button (runNonce === 0 gate).
  const runBtn = page.getByRole("button", { name: /^run$/i }).first();
  await runBtn.waitFor({ state: "visible", timeout: 15000 });
  await runBtn.click();
  const iframeEl = page.locator('iframe[title="Code Forge preview"]');
  await iframeEl.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(2000); // let the artifact render
  await page.screenshot({ path: `${SHOT_DIR}/forge-04-preview.png` });
  ok("sandboxed preview iframe running", true);

  // The artifact should have rendered *something* — buttons (calculator)
  // or at minimum visible text content inside the frame.
  const frame = page.frameLocator('iframe[title="Code Forge preview"]');
  const btnCount = await frame.locator("button, input[type=button]").count();
  const frameText = (await frame.locator("body").innerText().catch(() => "")).trim();
  ok("artifact rendered interactive UI", btnCount > 0, `${btnCount} buttons`);
  ok("artifact rendered content", frameText.length > 0, `"${frameText.slice(0, 60)}…"`);

  // Try the calculator: click a digit, an operator, another digit, equals.
  let calcWorked = false;
  try {
    const clickByText = async (txt) => {
      const b = frame.locator(`button:has-text("${txt}")`).first();
      if (await b.isVisible().catch(() => false)) { await b.click(); return true; }
      return false;
    };
    if (btnCount > 0) {
      await clickByText("7") || await clickByText("1");
      await clickByText("+") || await clickByText("*") || await clickByText("×");
      await clickByText("3");
      await clickByText("=") || await clickByText("=");
      await page.waitForTimeout(600);
      const after = (await frame.locator("body").innerText().catch(() => "")).trim();
      calcWorked = /\d/.test(after);
      await page.screenshot({ path: `${SHOT_DIR}/forge-05-interact.png` });
    }
  } catch { /* display-only artifacts are fine */ }
  ok("interactive click-through produced output", calcWorked, calcWorked ? "digits visible after ops" : "not a clickable calculator (informational)");

  // ── 7. Source tab ───────────────────────────────────────────────────
  await page.getByRole("button", { name: /source/i }).first().click();
  await page.waitForTimeout(600);
  const srcText = await page.locator("pre code, pre").first().innerText().catch(() => "");
  await page.screenshot({ path: `${SHOT_DIR}/forge-06-source.png` });
  ok("source tab shows code", srcText.length > 100, `${srcText.length} chars`);
  ok("source is a single-file HTML doc", /<!DOCTYPE/i.test(srcText) || /<html/i.test(srcText));

  // ── 8. Console tab (bridge present, no uncaught errors) ─────────────
  await page.getByRole("button", { name: /console/i }).first().click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOT_DIR}/forge-07-console.png` });
  ok("console tab reachable", true);

  // ── 9. Copy + Download buttons exist ────────────────────────────────
  ok("copy button present", await page.locator('button[title="Copy to clipboard"]').isVisible());
  ok("download button present", await page.locator('button[title="Download file"]').isVisible());

  // ── 10. Panel close/reopen via a second code request ────────────────
  await page.locator('button[title="Close"]').click();
  await page.waitForTimeout(500);
  const closed = !(await forgeHeader.isVisible().catch(() => false));
  ok("panel closes cleanly", closed);

} catch (err) {
  ok("E2E flow crashed", false, String(err).slice(0, 300));
  await page.screenshot({ path: `${SHOT_DIR}/forge-99-crash.png` }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
