/**
 * End-to-end check for the desktop orb.
 *
 * Drives the REAL Electron window over the Chrome DevTools Protocol (the shell
 * exposes one when JARVIS_ORB_DEBUG=1) and asserts the things that can silently
 * break: transparency, the mounted-but-hidden CommandBar, a live animation
 * loop, the orb's state machine, and an actual answer coming back from a real
 * instruction typed into the orb.
 *
 *   npm run orb:debug      (in one terminal)
 *   node scripts/e2e-orb.mjs
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.JARVIS_ORB_DEBUG_PORT || "9228";
const OUT = path.resolve("scratch", "orb");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const deadline = Date.now() + 40_000;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch (e) {
      lastErr = e.message;
      await sleep(700);
    }
  }
  throw new Error(`could not reach the orb's debug port ${PORT}: ${lastErr}`);
}

const browser = await connect();
const context = browser.contexts()[0];
const page =
  context.pages().find((p) => p.url().includes("/orb")) ?? context.pages()[0];
if (!page) throw new Error("the orb window has no page");

// globals.css still @imports Google Fonts, which this app's CSP blocks in the
// Electron renderer. That is pre-existing and app-wide (the main window has the
// same line); it is not an orb fault, so it is excluded — everything else is
// expected to be silent.
const KNOWN_NOISE = /fonts\.googleapis\.com/;
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error" || KNOWN_NOISE.test(m.text())) return;
  // Keep where it came from: a bare "Event" message is impossible to act on.
  let where = "";
  try {
    const loc = m.location();
    if (loc?.url) where = ` @ ${loc.url}:${loc.lineNumber}`;
  } catch {}
  consoleErrors.push(`${m.text()}${where}`);
});
page.on("pageerror", (e) => consoleErrors.push(String(e?.stack ?? e)));

await page.waitForSelector("main.orb-surface", { timeout: 45_000 });
await sleep(1200);

// ── 1. Transparent window ────────────────────────────────────────────────
const bg = await page.evaluate(() => ({
  body: getComputedStyle(document.body).backgroundColor,
  html: getComputedStyle(document.documentElement).backgroundColor,
}));
const transparent = (c) => c === "rgba(0, 0, 0, 0)" || c === "transparent";
check("body paints nothing (window is see-through)", transparent(bg.body), bg.body);
check("html paints nothing", transparent(bg.html), bg.html);

// ── 2. The real assistant is mounted, just not painted ───────────────────
const hiddenBar = await page.evaluate(() => {
  const hosts = [...document.querySelectorAll("div[aria-hidden].hidden")];
  const bar = hosts.find((h) => h.querySelector("input"));
  if (!bar) return { present: false };
  return {
    present: true,
    display: getComputedStyle(bar).display,
    inputs: bar.querySelectorAll("input").length,
  };
});
check("CommandBar is mounted (real pipeline, not a copy)", hiddenBar.present, JSON.stringify(hiddenBar));
check("CommandBar is not painted", hiddenBar.display === "none", hiddenBar.display);

// ── 3. The orb art ───────────────────────────────────────────────────────
const art = await page.evaluate(() => {
  // .orb-svg, not the first <svg> in <main> — the hidden CommandBar's lucide
  // icons are SVGs too and come first in document order.
  const svg = document.querySelector("main.orb-surface .orb-svg");
  return {
    svg: !!svg,
    eyes: svg ? svg.querySelectorAll(".orb-eyes ellipse").length : 0,
    rings: svg ? svg.querySelectorAll("[data-orb-spin]").length : 0,
  };
});
check("orb renders (sphere + two eyes + hairline ring)", art.svg && art.eyes === 2 && art.rings >= 2, JSON.stringify(art));

// Minimal by design: at rest the orb carries no caption at all.
const idleLabel = await page.evaluate(() => {
  const el = document.querySelector("[data-orb-state]");
  if (!el) return { present: false };
  return { present: true, opacity: getComputedStyle(el).opacity, text: (el.textContent ?? "").trim() };
});
check(
  "idle orb shows no caption",
  idleLabel.present && Number(idleLabel.opacity) === 0,
  JSON.stringify(idleLabel)
);

// ── 4. The animation loop is actually running ────────────────────────────
const fps = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const t0 = last;
      const tick = (t) => {
        deltas.push(t - last);
        last = t;
        if (t - t0 < 2000) requestAnimationFrame(tick);
        else {
          const avg = (t - t0) / deltas.length;
          resolve({
            frames: deltas.length,
            fps: Math.round(1000 / avg),
            worst: Math.round(Math.max(...deltas)),
          });
        }
      };
      requestAnimationFrame(tick);
    })
);
check("animation loop is smooth", fps.fps >= 45, JSON.stringify(fps));

// ── 5. Motion is happening (the orb is not a static image) ───────────────
const moved = await page.evaluate(async () => {
  const label = () => document.querySelector("[data-orb-spin]")?.getAttribute("transform") ?? "";
  const a = label();
  await new Promise((r) => setTimeout(r, 400));
  return { a, b: label(), changed: a !== label() };
});
check("rings are rotating", moved.changed, JSON.stringify(moved));

await page.screenshot({ path: path.join(OUT, "01-idle.png"), omitBackground: true });

// ── 6. Click the orb → the input opens ───────────────────────────────────
const orbBox = await page.locator("[data-orb-hit]").first().boundingBox();
if (!orbBox) throw new Error("the orb has no hit box");
await page.mouse.move(orbBox.x + orbBox.width / 2, orbBox.y + orbBox.height / 2);
await page.mouse.down();
await page.mouse.up();

const input = page.locator("main.orb-surface form input");
await input.waitFor({ state: "visible", timeout: 5000 });
check("clicking the orb opens the command input", await input.isVisible());
await page.screenshot({ path: path.join(OUT, "02-input.png"), omitBackground: true });

// ── 7. A real instruction actually runs ──────────────────────────────────
await input.fill("what time is it");
await input.press("Enter");

// The orb should leave standby immediately — that is the reaction.
const reacted = await page
  .waitForFunction(
    () => /THINKING|SPEAKING|LISTENING/.test(document.querySelector("main.orb-surface")?.textContent ?? ""),
    null,
    { timeout: 8000 }
  )
  .then(() => true)
  .catch(() => false);
check("orb reacts to the instruction (state changes)", reacted);

// …and the reaction must be on the orb, not only in the card. A still sphere
// with three dots in a panel is what "it does nothing while thinking" looks
// like, so this asserts the state arc is actually lit.
// NOTE: the loop writes opacity on the spinning <g>, not on the circle inside
// it, so read the group. The circle carries the dash length.
const arcLit = await page
  .waitForFunction(
    () => {
      const g = document.querySelector('[data-orb-spin="fast"]');
      return !!g && Number(g.getAttribute("opacity")) > 0.35;
    },
    null,
    { timeout: 10_000 }
  )
  .then(() => true)
  .catch(() => false);
const arcNow = await page.evaluate(() => {
  const g = document.querySelector('[data-orb-spin="fast"]');
  const c = g?.querySelector("circle:last-child");
  return g
    ? { opacity: g.getAttribute("opacity"), dash: c?.getAttribute("stroke-dasharray"), r: c?.getAttribute("r") }
    : null;
});
check("the orb's state arc lights up while it works", arcLit, JSON.stringify(arcNow));

// The whole ball has to react, not just the ring around it: interior plasma lit
// and the sphere out of round (squashing on a slow cycle).
// Plasma eases in over ~0.7s, so wait for it rather than sampling the fade.
const plasmaLit = await page
  .waitForFunction(
    () => {
      const p = document.querySelector("[data-orb-plasma]");
      return !!p && Number(getComputedStyle(p).opacity) > 0.6;
    },
    null,
    { timeout: 4000 }
  )
  .then(() => true)
  .catch(() => false);

const whole = await page.evaluate(() => {
  const plasma = document.querySelector("[data-orb-plasma]");
  const sp = document.querySelector("[data-orb-sphere]")?.getAttribute("transform") ?? "";
  const m = sp.match(/scale\(([-\d.]+) ([-\d.]+)\)/);
  return {
    plasma: plasma ? Number(getComputedStyle(plasma).opacity) : null,
    sx: m ? Number(m[1]) : null,
    sy: m ? Number(m[2]) : null,
    transform: sp,
  };
});
check("the sphere's interior lights up while working", plasmaLit, `plasma=${whole.plasma}`);
check(
  "the sphere deforms while working (alive, not a still ball)",
  whole.sx !== null && whole.sy !== null && Math.abs(whole.sx - whole.sy) > 0.004,
  `sx=${whole.sx} sy=${whole.sy}`
);

await page.screenshot({ path: path.join(OUT, "03-thinking.png"), omitBackground: true });

// …and an answer comes back through the same pipeline as the main app.
const answered = await page
  .waitForFunction(
    () => {
      const panel = document.querySelector("main.orb-surface .orb-panel");
      const text = panel?.textContent ?? "";
      return /(\d{1,2}:\d{2})|time is|Boss/i.test(text) && !/thinking/i.test(text);
    },
    null,
    { timeout: 60_000 }
  )
  .then(() => true)
  .catch(() => false);
const answerText = await page.evaluate(
  () => document.querySelector("main.orb-surface .orb-panel")?.textContent ?? ""
);
check("an answer streams back into the orb", answered, JSON.stringify(answerText.slice(0, 160)));
await page.screenshot({ path: path.join(OUT, "04-answer.png"), omitBackground: true });

// ── 8. Nothing blew up ───────────────────────────────────────────────────
check("no console errors in the orb window", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed — screenshots in ${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
