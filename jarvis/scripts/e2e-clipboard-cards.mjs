/**
 * End-to-end: the clipboard detection card.
 *
 * Proves the two things the feature promises:
 *   1. A copied snippet is DETECTED and its own buttons appear (no model call
 *      needed to name it) - here: a JS function -> "Code detected" with
 *      Fix / Explain / Optimize / Test.
 *   2. Clicking one of those buttons actually runs it and comes back with a
 *      finished result (here a fixed version of the function).
 *
 * The system clipboard is not involved: we POST the clip to the capture route
 * exactly like the OS watcher does, and the browser receives it over SSE.
 *
 * Run the dev server first, then:  npx tsx scripts/e2e-clipboard-cards.mjs
 * (or: node scripts/e2e-clipboard-cards.mjs)
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

// Unique clip per run so the server's dedupe window never swallows it.
const SNIPPET = `export function total(items) {\n  return items.reduce((s, i) => s + i.price);\n}\n// e2e ${Date.now()}`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  permissions: ["notifications"],
});
const page = await context.newPage();
page.setDefaultTimeout(120_000);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });

  // Boot the HUD the way a user does: click through the intro, skip the rest.
  // The window is generous on purpose - on a cold dev server the page chunk
  // alone can take the better part of a minute to compile.
  const input = page.locator('input[placeholder*="type a command" i]');
  for (let i = 0; i < 20; i++) {
    await page.mouse.click(800, 450).catch(() => {});
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(2500);
    if (await input.isVisible().catch(() => false)) break;
  }
  check("JARVIS UI booted", await input.isVisible().catch(() => false));

  // Let the SSE stream connect (the overlay learns about clips from it).
  await page.waitForTimeout(4000);

  // The watcher's auto path: analyse + broadcast. (Fire and forget - the
  // response goes to the OS popup, the browser hears it on the event stream.)
  const res = await fetch(`${BASE}/api/clipboard/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: SNIPPET, source: "Code - cart.ts" }),
  });
  const body = await res.json();
  if (!body?.success) {
    console.log(`  (server skipped the clip: ${body?.skipped || "unknown"})`);
  }

  // 1. The detection card.
  const card = page.locator('[data-testid="clipboard-offer"]');
  await card.waitFor({ state: "visible", timeout: 90_000 });
  const cardText = await card.innerText();
  check("detection card appears after a copy", true);
  check("card names the kind", /Code detected/i.test(cardText), cardText.split("\n")[0]);
  const chips = ["Fix", "Explain", "Optimize", "Test"];
  for (const chip of chips) {
    const visible = await card.getByRole("button", { name: chip, exact: true }).first().isVisible().catch(() => false);
    check(`card offers "${chip}"`, visible);
  }
  // The chips must read left to right - in rows, never as a diagonal
  // staircase down the card. (The desktop card shipped that bug once.)
  const cardBox = await card.boundingBox();
  const chipBoxes = [];
  for (const chip of [...chips, "Dismiss"]) {
    const box = await card.getByRole("button", { name: chip, exact: true }).first().boundingBox();
    chipBoxes.push({ chip, box });
  }
  check(
    "every action chip is laid out",
    chipBoxes.every(({ box }) => box && box.width > 0 && box.height > 0),
    JSON.stringify(chipBoxes.map(({ chip, box }) => `${chip}:${box ? Math.round(box.x) + "," + Math.round(box.y) : "none"}`))
  );
  check("the detection card is compact", cardBox.width <= 300, `card width=${Math.round(cardBox.width)}`);
  check(
    "action chips stay inside the card",
    chipBoxes.every(({ box }) => box.x >= cardBox.x - 1 && box.x + box.width <= cardBox.x + cardBox.width + 1),
    JSON.stringify(chipBoxes.map(({ chip, box }) => `${chip}:${Math.round(box.x)}+${Math.round(box.width)}`))
  );
  const rowKeys = [...new Set(chipBoxes.map(({ box }) => Math.round(box.y / 4)))];
  check(
    `action chips use ${rowKeys.length} row(s) for ${chipBoxes.length} chips (not one per chip)`,
    rowKeys.length < chipBoxes.length,
    chipBoxes.map(({ chip, box }) => `${chip}@${Math.round(box.x)},${Math.round(box.y)}`).join(" ")
  );
  for (const key of rowKeys) {
    const line = chipBoxes
      .filter(({ box }) => Math.round(box.y / 4) === key)
      .map(({ chip, box }) => ({ chip, x: box.x, width: box.width }))
      .sort((a, b) => a.x - b.x);
    const overlaps = line.some((b, i) => i > 0 && b.x < line[i - 1].x + line[i - 1].width - 0.5);
    check(`row at y~${key * 4} sits side by side (${line.map((l) => l.chip).join(", ")})`, !overlaps);
  }

  await page.screenshot({ path: `${SHOT_DIR}/clipboard-card.png` });

  // 2. Running an action.
  await card.getByRole("button", { name: "Fix", exact: true }).first().click();
  const panel = page.locator('[data-testid="explain-overlay"]');
  await panel.waitFor({ state: "visible", timeout: 30_000 });
  check("clicking an action opens the panel", true);

  // Wait for the result to land (model call).
  const code = panel.locator("pre code");
  await code.waitFor({ state: "visible", timeout: 90_000 });
  const heading = await panel.locator("h2").first().innerText();
  const codeText = await code.innerText();
  check("result is titled by the action", /fixed code/i.test(heading), heading);
  check("result contains the fixed code", /reduce\(/.test(codeText), codeText.slice(0, 80));
  check(
    "the fix is offered as applyable",
    await panel.getByRole("button", { name: /copy fix/i }).first().isVisible().catch(() => false)
  );
  check(
    "the action strip lets you switch actions",
    (await panel.getByRole("button", { name: "Optimize", exact: true }).count()) > 0
  );
  await page.screenshot({ path: `${SHOT_DIR}/clipboard-panel.png` });

  console.log(`\n${passes} passed, ${fails} failed`);
  console.log(`screenshots: ${SHOT_DIR}/clipboard-card.png, ${SHOT_DIR}/clipboard-panel.png`);
  process.exitCode = fails > 0 ? 1 : 0;
} catch (err) {
  console.error("\nE2E aborted:", err?.message || err);
  await page.screenshot({ path: `${SHOT_DIR}/clipboard-e2e-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
