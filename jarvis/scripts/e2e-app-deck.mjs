/**
 * End-to-end: the App Deck.
 *
 * The top-left corner used to hold fourteen floating launcher buttons. Now it
 * is ONE button that opens a frosted panel where every tool is a row in the
 * rail and its own page on the right. This checks exactly that:
 *   - one launcher, and the old launchers are gone
 *   - the rail lists every tool, the page shows the selected one with live state
 *   - arrow keys walk the rail
 *   - launching a tool opens its real panel
 *   - the "Glass" slider really changes the panel's backdrop filter
 *
 * Dev server first, then:  node scripts/e2e-app-deck.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.JARVIS_BASE || "http://localhost:3000";
const SHOT_DIR = "scratch";

let passes = 0;
let fails = 0;
const check = (name, ok, detail = "") => {
  if (ok) {
    passes++;
    console.log(`  PASS ${name}`);
  } else {
    fails++;
    console.error(`  FAIL ${name}${detail ? ` - ${detail}` : ""}`);
  }
};

const RAIL = [
  "Sentinel",
  "Second Brain",
  "Command Deck",
  "Telegram",
  "Connected Apps",
  "QR Teleporter",
  "Proximity Radar",
  "Video Director",
  "Room Scanner",
  "Whiteboard OCR",
  "Meeting Shadow",
  "Face to CRM",
  "Task Agent",
  "MCP Hub",
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });

  const input = page.locator('input[placeholder*="type a command" i]');
  for (let i = 0; i < 6; i++) {
    await page.mouse.click(800, 450).catch(() => {});
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(2500);
    if (await input.isVisible().catch(() => false)) break;
  }
  check("JARVIS UI booted", await input.isVisible().catch(() => false));

  // 1. One button, and the old dock is gone.
  const launcher = page.locator('[aria-label="Open the App Deck"]');
  check("the App Deck launcher is present", await launcher.isVisible().catch(() => false));
  check("exactly one launcher", (await launcher.count()) === 1, String(await launcher.count()));
  const oldLaunchers = await page
    .locator(
      '[aria-label="Open Telegram Bot Relay"], [aria-label="Open Connected Apps"], [aria-label="Quantum QR Teleporter"], [aria-label="Proximity Radar"], [aria-label="Spatial Room Scanner"], [aria-label="AI Video Director"], [aria-label="Whiteboard OCR"], [aria-label="Meeting Shadow"], [aria-label="Face-to-CRM"], [aria-label="Autonomous Task Agent"], [aria-label="MCP Hub"]'
    )
    .count();
  check("the old floating launchers are gone", oldLaunchers === 0, `${oldLaunchers} still there`);

  // 2. Open the deck.
  await launcher.click();
  const deck = page.locator('[role="dialog"][aria-label="App Deck"]');
  await deck.waitFor({ state: "visible", timeout: 20_000 });
  check("clicking it opens the glass deck", true);

  const railText = await deck.locator("button").allInnerTexts();
  const missing = RAIL.filter((label) => !railText.some((t) => t.trim() === label));
  check("the rail lists all 14 tools", missing.length === 0, `missing: ${missing.join(", ")}`);

  // 3. The selected tool's own page.
  // The h2 is CSS-uppercased (like the mock's "DISPLAY"), so compare folded.
  // Pages cross-fade, so poll instead of sampling a half-switched title.
  const titleNow = async () => (await deck.locator("h2").last().innerText()).trim().toLowerCase();
  const titleBecomes = async (want, timeout = 4000) => {
    const t0 = Date.now();
    for (;;) {
      const titles = (await deck.locator("h2").allInnerTexts()).map((t) => t.trim().toLowerCase());
      if (titles.includes(want)) return true;
      if (Date.now() - t0 > timeout) return false;
      await page.waitForTimeout(120);
    }
  };
  check("the page opens on Sentinel", await titleBecomes("sentinel"), await titleNow());
  const pageText = await deck.innerText();
  check("its page shows live state", /Face watcher/.test(pageText) && /(Armed|Disarmed)/.test(pageText));
  check("its page has the inline arm control", /Quick arm/.test(pageText));
  check(
    "its page has a wide Open row",
    await deck.getByRole("button", { name: /Open the Security panel/i }).first().isVisible()
  );
  check("the hint bar is there", /Navigate/.test(pageText) && /Open/.test(pageText));

  // 4. The Glass slider is a real control.
  const slider = deck.locator('input[type="range"]');
  await slider.fill("90");
  await page.waitForTimeout(250);
  const blur = await deck.evaluate((el) => getComputedStyle(el).backdropFilter);
  check("the Glass slider changes the real backdrop blur", /blur\((3[5-9]|4\d)px\)/.test(blur), blur);
  await slider.fill("55");

  // 4b. The glass is real translucency: the rendered pixels change with it,
  // and the panel is not a flat opaque block.
  const stats = async () => {
    const buf = await deck.screenshot();
    const dataUrl = "data:image/png;base64," + buf.toString("base64");
    return page.evaluate(async (url) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = url;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 28) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += l;
        sum2 += l * l;
        n++;
      }
      const mean = sum / n;
      return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
    }, dataUrl);
  };
  await slider.fill("10");
  await page.waitForTimeout(300);
  const thin = await stats();
  await slider.fill("95");
  await page.waitForTimeout(300);
  const thick = await stats();
  await slider.fill("55");
  check(
    "glass 10 vs 95 render measurably different pixels",
    Math.abs(thick.mean - thin.mean) > 3,
    `${thin.mean.toFixed(1)} vs ${thick.mean.toFixed(1)}`
  );
  check("the panel is not a flat opaque block", thin.std > 4, `std ${thin.std.toFixed(2)}`);

  // 5. Arrow keys walk the rail.
  await page.keyboard.press("ArrowDown");
  check("arrow keys move the selection", await titleBecomes("second brain"), await titleNow());
  check("the memory count is live state", /Memories stored/.test(await deck.innerText()));

  await page.screenshot({ path: `${SHOT_DIR}/app-deck.png` });

  // 6. Launching a tool opens its real panel and closes the deck.
  const railMCP = deck.getByRole("button", { name: "MCP Hub", exact: true }).first();
  await railMCP.click();
  await page.waitForTimeout(600);
  check("the deck closes on launch", (await deck.count()) === 0);
  check(
    "the tool's real panel opened",
    await page.getByText(/CLOSE \[ESC\]/i).first().isVisible().catch(() => false)
  );

  console.log(`\n${passes} passed, ${fails} failed`);
  console.log(`screenshot: ${SHOT_DIR}/app-deck.png`);
  process.exitCode = fails > 0 ? 1 : 0;
} catch (err) {
  console.error("\nE2E aborted:", err?.message || err);
  await page.screenshot({ path: `${SHOT_DIR}/app-deck-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
