/**
 * End-to-end: panels are movable, resizable windows.
 *
 * Every panel used to be a fixed-size modal — a hand-rolled `fixed inset-0`
 * wrapper, or a panel that positioned itself at (say) `w-[420px] h-[650px]`.
 * This drives the real UI and proves the replacement behaviour:
 *
 *   1. a panel opens inside a window frame (not a full-screen overlay)
 *   2. the panel content is clipped to the window, not the viewport
 *   3. dragging the title strip moves the window, and it cannot be dragged
 *      off-screen; double-clicking the strip resets it
 *   4. every edge/corner resizes, with a 320x220 floor and a viewport ceiling
 *   5. two windows can be open at once, the clicked one comes to the front,
 *      and moving one does not move the other
 *   6. the desktop underneath (command bar, app deck) stays usable — the
 *      windows are not modal
 *   7. a panel that wraps itself in a full-screen backdrop is collapsed into
 *      the window by the fill rules instead of covering the screen
 *   8. the geometry survives a reload (per-panel localStorage)
 *
 * Dev server first, then:  node scripts/e2e-panel-windows.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.JARVIS_BASE || "http://localhost:3000";
const SHOT_DIR = "scratch";
const VW = 1600;
const VH = 1000;

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
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;
const rect = (b) =>
  b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
const box = (b) => (b ? `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)},${Math.round(b.y)}` : "none");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: VW, height: VH } });
const page = await context.newPage();
page.setDefaultTimeout(60_000);

/** Drag from a point by (dx, dy) with real mouse events. */
async function dragAt(from, dx, dy) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(160);
}

/** Always re-measure: a stale box means dragging empty space. */
async function dragHandle(locator, dx, dy) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("handle has no box");
  await dragAt({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, dx, dy);
}

const boot = async () => {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const input = page.locator('input[placeholder*="type a command" i]');
  for (let i = 0; i < 8; i++) {
    await page.mouse.click(800, 500).catch(() => {});
    await page.waitForTimeout(1200);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(2000);
    if (await input.isVisible().catch(() => false)) break;
  }
  return input.isVisible().catch(() => false);
};

const openDeck = async () => {
  await page.locator('[aria-label="Open the App Deck"]').first().click();
  const deck = page.locator('[role="dialog"][aria-label="App Deck"]');
  await deck.waitFor({ state: "visible", timeout: 20_000 });
  return deck;
};

/** Windows that are actually on screen (the Command Deck stays mounted, hidden). */
const visibleWindows = () => page.locator("[data-panel-window]:visible");

try {
  check("JARVIS UI booted", await boot());

  // ── 1. A panel opens as a window ────────────────────────────────────
  let deck = await openDeck();
  await deck.getByRole("button", { name: /Open the Security panel/i }).first().click();
  const security = page.locator('[data-panel-window="security"]');
  await security.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(400);

  const start = await security.boundingBox();
  check("a panel opens inside a window frame", !!start, box(start));
  check("the window is not the old hardcoded 384px drawer", !!start && start.width > 400, `width ${start?.width}`);

  const bodyBox = await security.locator("[data-panel-window-body]").boundingBox();
  const panelRoot = await security.locator("[data-panel-window-body] > *").first().boundingBox();
  check(
    "the panel is clipped to the window, not the viewport",
    !!panelRoot && !!bodyBox && near(panelRoot.width, bodyBox.width, 2),
    `panel ${box(panelRoot)} vs body ${box(bodyBox)}`
  );
  check(
    "the panel does not cover the screen",
    !!panelRoot && panelRoot.width < VW - 20 && panelRoot.height < VH - 20,
    box(panelRoot)
  );

  // ── 2. Move it ──────────────────────────────────────────────────────
  await dragHandle(security.locator("[data-panel-window-strip]"), -260, -60);
  const moved = await security.boundingBox();
  check(
    "dragging the title strip moves the window",
    near(moved.x, start.x - 260) && near(moved.y, start.y - 60),
    `${box(start)} -> ${box(moved)}`
  );

  // A drag that ends past the edge clamps instead of losing the window.
  await dragHandle(security.locator("[data-panel-window-strip]"), -4000, -4000);
  const clamped = await security.boundingBox();
  check(
    "a window cannot be dragged off-screen",
    clamped.x >= 0 && clamped.y >= 0 && clamped.width === Math.round(moved.width),
    box(clamped)
  );

  // ── 3. Double-click the strip to reset ──────────────────────────────
  await security.locator("[data-panel-window-strip]").dblclick();
  await page.waitForTimeout(250);
  const reset = await security.boundingBox();
  // The first open may cascade a few px off centre; the reset goes to the true
  // centred default, so compare the size and the horizontal centre.
  check(
    "double-clicking the strip restores the default geometry",
    near(reset.width, start.width, 2) &&
      near(reset.height, start.height, 2) &&
      Math.abs(reset.x + reset.width / 2 - VW / 2) <= 30,
    `${box(reset)} vs first open ${box(start)}`
  );

  // ── 4. Resize ───────────────────────────────────────────────────────
  const handleCount = await security.locator("[data-panel-resize]").count();
  check("all eight resize handles are present", handleCount === 8, `${handleCount} handles`);

  const base = await security.boundingBox();
  await dragHandle(security.locator('[data-panel-resize="se"]'), 200, 40);
  const bigger = await security.boundingBox();
  check(
    "the se corner resizes the window",
    near(bigger.width, base.width + 200) && near(bigger.height, base.height + 40),
    `${box(base)} -> ${box(bigger)}`
  );

  await dragHandle(security.locator('[data-panel-resize="nw"]'), 900, 900);
  const tiny = await security.boundingBox();
  check(
    "resizing down stops at the 320x220 floor",
    Math.round(tiny.width) === 320 && Math.round(tiny.height) === 220,
    box(tiny)
  );

  // Back to a known geometry for the single-edge checks.
  await security.locator("[data-panel-window-strip]").dblclick();
  await page.waitForTimeout(250);

  await dragHandle(security.locator('[data-panel-resize="e"]'), 1200, 0);
  const wide = await security.boundingBox();
  check(
    "the east edge widens the window to the screen edge, not past it",
    Math.round(wide.x + wide.width) <= VW && wide.width > 400,
    box(wide)
  );

  await security.locator("[data-panel-window-strip]").dblclick();
  await page.waitForTimeout(250);
  await dragHandle(security.locator('[data-panel-resize="s"]'), 0, 1200);
  const tall = await security.boundingBox();
  check(
    "the south edge stops at the command-bar band",
    Math.round(tall.y + tall.height) <= VH && tall.height > 220 && tall.height < 900,
    box(tall)
  );

  const beforeReload = rect(await security.boundingBox());

  // ── 5. Two windows at once, front-most wins ─────────────────────────
  deck = await openDeck();
  await deck.getByRole("button", { name: "MCP Hub", exact: true }).first().click();
  const mcp = page.locator('[data-panel-window="mcp-hub"]');
  await mcp.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(500);

  const windowCount = await visibleWindows().count();
  check("two panels can be open at the same time", windowCount === 2, `${windowCount} visible windows`);

  const zOf = (loc) => loc.evaluate((el) => Number(getComputedStyle(el).zIndex) || 0);
  check("the newly opened window is on top", (await zOf(mcp)) > (await zOf(security)));

  // Move the new window out of the way first — a click can only land on a
  // window that is not covered.
  await dragHandle(mcp.locator("[data-panel-window-strip]"), -520, 320);
  await security.locator("[data-panel-window-strip]").click();
  await page.waitForTimeout(200);
  check("clicking a window brings it to the front", (await zOf(security)) > (await zOf(mcp)));

  // Resize the topmost window from a corner that no other window covers, then
  // prove the neighbour below is untouched in all four numbers.
  await mcp.locator("[data-panel-window-strip]").click();
  await page.waitForTimeout(200);
  const securityBefore = rect(await security.boundingBox());
  const mcpBefore = rect(await mcp.boundingBox());
  await dragHandle(mcp.locator('[data-panel-resize="nw"]'), 60, 40);
  const securityAfter = rect(await security.boundingBox());
  const mcpAfter = rect(await mcp.boundingBox());
  check(
    "resizing one window leaves the other exactly where it was",
    securityBefore.x === securityAfter.x &&
      securityBefore.y === securityAfter.y &&
      securityBefore.w === securityAfter.w &&
      securityBefore.h === securityAfter.h,
    `${JSON.stringify(securityBefore)} -> ${JSON.stringify(securityAfter)}`
  );
  check(
    "the resized window is the one that changed",
    mcpAfter.w < mcpBefore.w && mcpAfter.h < mcpBefore.h,
    `${JSON.stringify(mcpBefore)} -> ${JSON.stringify(mcpAfter)}`
  );

  check(
    "the command bar stays usable while a window is open",
    await page.locator('input[placeholder*="type a command" i]').isVisible()
  );
  check(
    "the app deck stays reachable while a window is open",
    await page.locator('[aria-label="Open the App Deck"]').first().isVisible()
  );

  // ── 6. The window close button ──────────────────────────────────────
  // The MCP window was raised above; its close button is the topmost element
  // at that point, which is exactly what a real click requires.
  await mcp.locator('[aria-label="Close MCP Hub"]').click();
  await page.waitForTimeout(400);
  check("the window close button closes that window", (await mcp.count()) === 0);
  check("the other window survives the close", (await security.count()) === 1);

  await page.screenshot({ path: `${SHOT_DIR}/panel-windows.png` });

  // ── 7. A self-wrapped overlay panel is collapsed into its window ────
  await page
    .locator('[data-testid="widget-rail"] button')
    .filter({ hasText: /widgets/i })
    .first()
    .click();
  const widgets = page.locator('[data-panel-window="widgets"]');
  await widgets.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(400);

  const fillMode = await widgets.locator("[data-panel-window-body]").getAttribute("data-panel-fill");
  check("a panel with its own backdrop is detected", fillMode === "overlay", `data-panel-fill=${fillMode}`);

  const wBody = await widgets.locator("[data-panel-window-body]").boundingBox();
  const wInnerEl = widgets.locator("[data-panel-window-body] > *").first();
  const wInner = await wInnerEl.boundingBox();
  const wInnerPos = await wInnerEl.evaluate((el) => getComputedStyle(el).position);
  check(
    "its full-screen backdrop is collapsed to the window",
    wInnerPos === "absolute" && !!wInner && wInner.width < VW - 20,
    `${wInnerPos} ${box(wInner)}`
  );
  check(
    "the wrapping content fills the window",
    !!wInner && !!wBody && near(wInner.width, wBody.width, 2) && near(wInner.height, wBody.height, 2),
    `${box(wInner)} vs ${box(wBody)}`
  );

  // ── 8. Geometry survives a reload ───────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  check("JARVIS UI rebooted", await boot());
  deck = await openDeck();
  await deck.getByRole("button", { name: /Open the Security panel/i }).first().click();
  await security.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(400);
  const restored = rect(await security.boundingBox());
  check(
    "the window reopens where it was left",
    near(restored.x, beforeReload.x, 2) &&
      near(restored.y, beforeReload.y, 2) &&
      near(restored.w, beforeReload.w, 2) &&
      near(restored.h, beforeReload.h, 2),
    `${JSON.stringify(beforeReload)} vs ${JSON.stringify(restored)}`
  );

  console.log(`\n${passes} passed, ${fails} failed`);
  console.log(`screenshot: ${SHOT_DIR}/panel-windows.png`);
  process.exitCode = fails > 0 ? 1 : 0;
} catch (err) {
  console.error("\nE2E aborted:", err?.message || err);
  await page.screenshot({ path: `${SHOT_DIR}/panel-windows-failure.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
