/**
 * E2E — Code Forge pipeline (LLM-mocked variant).
 *
 * NVIDIA/OpenRouter free tiers are rate-limited/unreachable in this
 * environment, so /api/chat is intercepted and answers with a scripted
 * Code Forge reply (exactly the shape the system prompt asks the real LLM
 * for). Everything downstream is tested for real: SSE parsing,
 * routeCodeToForge, store wiring, panel UI, sandboxed Run, console bridge,
 * and an interactive artifact.
 *
 * The scripted calculator intentionally avoids backticks so the reply can
 * live in a JS template literal without escaping surprises.
 *
 * Run:  node scripts/e2e-codeforge-mock.mjs   (dev server on :3000)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp";

/* A polished single-file calculator — the artifact "JARVIS wrote". */
const CALCULATOR = [
  "<!DOCTYPE html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  "<title>Calc</title>",
  "<style>",
  "  * { box-sizing: border-box; margin: 0; padding: 0; }",
  "  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #0a0f1a; font-family: system-ui, sans-serif; }",
  "  .calc { width: 320px; padding: 20px; border-radius: 20px; background: linear-gradient(160deg, #101828, #0a0f1a); box-shadow: 0 20px 60px rgba(0,212,255,.15), inset 0 1px 0 rgba(255,255,255,.06); }",
  "  .screen { background: #05080f; border-radius: 12px; padding: 16px; text-align: right; margin-bottom: 16px; border: 1px solid rgba(0,212,255,.2); }",
  "  .expr { color: #4a6076; font-size: 14px; min-height: 18px; }",
  "  .out { color: #00d4ff; font-size: 36px; font-weight: 600; text-shadow: 0 0 18px rgba(0,212,255,.5); }",
  "  .keys { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }",
  "  button { border: 0; border-radius: 12px; padding: 16px 0; font-size: 18px; color: #e8f4ff; background: #16202f; cursor: pointer; transition: filter .15s, transform .05s; }",
  "  button:hover { filter: brightness(1.3); }",
  "  button:active { transform: scale(.96); }",
  "  .op { color: #00d4ff; background: #0d1b29; }",
  "  .eq { background: #00d4ff; color: #04121c; font-weight: 700; }",
  "  .wide { grid-column: span 2; }",
  "</style>",
  "</head>",
  "<body>",
  '<div class="calc">',
  '  <div class="screen"><div class="expr" id="expr"></div><div class="out" id="out">0</div></div>',
  '  <div class="keys">',
  '    <button class="op" data-a="clear">C</button>',
  '    <button class="op" data-a="back">⌫</button>',
  '    <button class="op" data-a="/">÷</button>',
  '    <button class="op" data-a="*">×</button>',
  '    <button data-a="7">7</button><button data-a="8">8</button><button data-a="9">9</button>',
  '    <button class="op" data-a="-">−</button>',
  '    <button data-a="4">4</button><button data-a="5">5</button><button data-a="6">6</button>',
  '    <button class="op" data-a="+">+</button>',
  '    <button data-a="1">1</button><button data-a="2">2</button><button data-a="3">3</button>',
  '    <button class="eq" data-a="=">=</button>',
  '    <button class="wide" data-a="0">0</button><button data-a=".">.</button><button class="op" data-a="%">%</button>',
  "  </div>",
  "</div>",
  "<script>",
  '  var expr = "";',
  '  var outEl = document.getElementById("out");',
  '  var exprEl = document.getElementById("expr");',
  '  function render() { outEl.textContent = expr || "0"; exprEl.textContent = ""; }',
  "  function equals() {",
  "    try {",
  "      if (!expr) return;",
  '      var safe = expr.replace(/[^0-9+\\-*/%.() ]/g, "");',
  "      var r = Function('\"use strict\"; return (' + safe + ')')();",
  '      console.log("computed", safe, "=", r);',
  "      expr = String(r);",
  '    } catch (e) { expr = "Error"; console.error("bad expression"); }',
  "  }",
  '  document.querySelectorAll("button").forEach(function (b) {',
  "    b.addEventListener(\"click\", function () {",
  '      var a = b.getAttribute("data-a");',
  '      if (a === "clear") expr = "";',
  '      else if (a === "back") expr = expr.slice(0, -1);',
  '      else if (a === "=") equals();',
  "      else expr += a;",
  "      render();",
  "    });",
  "  });",
  '  console.log("calculator ready");',
  "  render();",
  "</script>",
  "</body>",
  "</html>",
].join("\n");

const JARVIS_REPLY = [
  "One calculator, Boss — arc-blue keys, keyboard-friendly, and it judges your arithmetic silently.",
  "",
  "<<<FORGE:html",
  CALCULATOR,
  "FORGE>>>",
].join("\n");

/** Fulfill /api/chat with the offline-path JSON reply. */
async function mockChat(route) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ content: JARVIS_REPLY }),
  });
}

const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(90000);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120000 });

  await page.route("**/api/chat", mockChat);
  console.log("[mock] /api/chat intercepted");

  // ── Power on & boot ─────────────────────────────────────────────────
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
  ok("booted to command bar", true);

  // ── Ask for code ────────────────────────────────────────────────────
  await input.click();
  await input.fill("write an html for calculator");
  await input.press("Enter");
  ok("prompt sent", true);

  // ── Forge panel auto-opens ──────────────────────────────────────────
  const forgeHeader = page.getByText(/code forge/i).first();
  await forgeHeader.waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOT_DIR}/forge-mock-03-panel.png` });
  ok("Code Forge panel auto-opened", true);

  // ── Chat hygiene ────────────────────────────────────────────────────
  const bodyText = await page.locator("body").innerText();
  ok("no forge markers in chat", !bodyText.includes("<<<FORGE") && !bodyText.includes("FORGE>>>"));
  ok("no <!DOCTYPE in chat", !/<!DOCTYPE/i.test(bodyText));
  ok("JARVIS prose reply present", /calculator/i.test(bodyText));

  // ── Run ─────────────────────────────────────────────────────────────
  const runBtn = page.getByRole("button", { name: /^run$/i }).first();
  await runBtn.waitFor({ state: "visible", timeout: 15000 });
  await runBtn.click();
  const iframeEl = page.locator('iframe[title="Code Forge preview"]');
  await iframeEl.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOT_DIR}/forge-mock-04-preview.png` });
  ok("sandboxed iframe running", true);

  const frame = page.frameLocator('iframe[title="Code Forge preview"]');
  const btnCount = await frame.locator("button").count();
  ok("artifact rendered buttons", btnCount >= 16, `${btnCount} buttons`);

  // ── Interact: 7 × 3 = ───────────────────────────────────────────────
  const clickA = async (a) => frame.locator(`button[data-a="${a}"]`).first().click();
  await clickA("7"); await clickA("*"); await clickA("3"); await clickA("=");
  await page.waitForTimeout(600);
  const out = await frame.locator("#out").innerText().catch(() => "");
  ok("calculator computes 7×3=21", out.trim() === "21", `display: "${out.trim()}"`);
  await page.screenshot({ path: `${SHOT_DIR}/forge-mock-05-interact.png` });

  // Second round — the exact failure class the user reported: the artifact
  // dies after repeated interaction. Compute, clear, compute again.
  await clickA("clear"); await clickA("9"); await clickA("+"); await clickA("1"); await clickA("=");
  await page.waitForTimeout(500);
  const out2 = await frame.locator("#out").innerText().catch(() => "");
  ok("survives second round (9+1=10)", out2.trim() === "10", `display: "${out2.trim()}"`);
  await clickA("back"); await clickA("5"); await clickA("=");
  await page.waitForTimeout(500);
  const out3 = await frame.locator("#out").innerText().catch(() => "");
  // 10 → back → 1 → append 5 → 15. Chained edit-and-recompute must hold.
  ok("backspace + recompute (10→1→15=15)", out3.trim() === "15", `display: "${out3.trim()}"`);

  // ── Console bridge ──────────────────────────────────────────────────
  await page.getByRole("button", { name: /console/i }).first().click();
  await page.waitForTimeout(500);
  const consoleText = await page.locator("body").innerText();
  ok("console captured artifact logs", /calculator ready|computed/i.test(consoleText));
  await page.screenshot({ path: `${SHOT_DIR}/forge-mock-06-console.png` });

  // ── Source tab ──────────────────────────────────────────────────────
  await page.getByRole("button", { name: /source/i }).first().click();
  await page.waitForTimeout(600);
  const srcText = await page.locator("pre code, pre").first().innerText().catch(() => "");
  ok("source tab shows full artifact", srcText.includes("<!DOCTYPE html>") && srcText.length > 500, `${srcText.length} chars`);
  await page.screenshot({ path: `${SHOT_DIR}/forge-mock-07-source.png` });

  // ── Close ───────────────────────────────────────────────────────────
  await page.locator('button[title="Close"]').click();
  await page.waitForTimeout(500);
  ok("panel closes cleanly", !(await forgeHeader.isVisible().catch(() => false)));

} catch (err) {
  ok("E2E flow crashed", false, String(err).slice(0, 300));
  await page.screenshot({ path: `${SHOT_DIR}/forge-mock-99-crash.png` }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
