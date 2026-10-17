// E2E: the eye-control overlay in a REAL browser.
//
// What this can and cannot prove. It CANNOT prove gaze accuracy — that needs a
// physical camera and a human looking at things. It CAN prove the things that
// broke the feature in practice:
//
//   • the overlay mounts, the toggle works, and enabling eye control throws
//     nothing (the refactor added adapter state and a new drive loop),
//   • the drive loop does not saturate the main thread. The reported "eye
//     control is laggy / doesn't work" was a loop pumped by two clocks that
//     re-armed another self-perpetuating chain on every ticker tick, so chains
//     multiplied ~60/s. Chromium's fake camera produces no face, which is
//     exactly the state that used to spin hardest, so main-thread cadence is
//     measured here over a sustained window,
//   • with no face detected, the cursor is NOT moved (zero OS-input sends).
//
// Requires the dev server on port 3000:  npm run dev   (then)  npm run e2e:eyes

import { chromium } from "playwright";

const BASE_URL = process.env.JARVIS_E2E_URL || "http://localhost:3000";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      // A synthetic camera: getUserMedia succeeds without a real webcam, and
      // the tracker runs on a feed with no face in it.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const context = await browser.newContext({ permissions: ["camera"] });
  const page = await context.newPage();

  // esbuild (via tsx) injects a `__name()` helper into every closure it
  // transforms to keep function names. Functions passed to page.evaluate are
  // serialised into the page and re-created there, where that helper does not
  // exist. Defined before the first navigation so it is in place for every
  // evaluation below. Harness-only: the app itself runs through SWC.
  await page.addInitScript(() => {
    (globalThis as unknown as { __name: unknown }).__name = (fn: unknown) => fn;
    // Count setTimeout scheduling so the loop-multiplication probe below has a
    // signal. Wraps the real function, behaviour unchanged.
    const raw = window.setTimeout.bind(window);
    (window as unknown as { __timerCalls: number }).__timerCalls = 0;
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
      (window as unknown as { __timerCalls: number }).__timerCalls++;
      return raw(fn as () => void, ms, ...(rest as []));
    }) as typeof window.setTimeout;
  });

  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  const osInputCalls: string[] = [];
  await page.route("**/api/os/input", async (route) => {
    const body = route.request().postData() ?? "";
    osInputCalls.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' });
  });

  try {
    console.log("\nLoading the app");
    await page.goto(BASE_URL, { waitUntil: "load", timeout: 60_000 });

    // JARVIS boots into a power gate; nothing else (including the eye overlay)
    // is mounted until it is dismissed. The gate is in the server-rendered HTML,
    // so it is on screen BEFORE React hydrates — an interaction that lands in
    // that window hits a page with no listeners and is silently lost. So: click
    // the gate, then check whether the UI actually came up, and click again
    // while the gate is still there.
    const gate = page.locator("text=PRESS OR CLICK ANYWHERE TO POWER ON").first();
    const toggle = page.locator('button[title^="Enable eye control"]');
    await gate.waitFor({ state: "visible", timeout: 60_000 });
    for (let attempt = 0; attempt < 15; attempt++) {
      if ((await toggle.count()) > 0) break;
      if (await gate.isVisible().catch(() => false)) {
        await gate.click({ force: true }).catch(() => {});
      }
      await page.waitForTimeout(1500);
    }
    await toggle.waitFor({ state: "visible", timeout: 60_000 });
    check("the app rendered with the eye-control toggle present", await toggle.isVisible());
    check("no uncaught exception during load", pageErrors.length === 0, pageErrors.join(" | "));

    console.log("\nEnabling eye control (synthetic camera, no face in frame)");
    await toggle.click();
    await page.waitForTimeout(9000); // engine boot: wasm + face landmarker

    const status = await page
      .locator("text=/EYES:|CURSOR:/")
      .first()
      .textContent()
      .catch(() => null);
    check("the eye-control HUD is showing", !!status, status ?? "no HUD text");
    console.log(`    HUD: ${status ?? "(none)"}`);
    check(
      "it reports a real tracking state, not a stuck error",
      !!status && /searching for face|tracking|loading models|signal stuck/.test(status),
      status ?? ""
    );
    check("no uncaught exception after enabling", pageErrors.length === 0, pageErrors.join(" | "));

    console.log("\nCursor mode: the drive loop must not multiply itself");
    await page.keyboard.press("Control+Shift+E"); // targets → cursor
    await page.waitForTimeout(2500);

    // ── Regression probe ────────────────────────────────────────────────
    // The reported failure ("eye control is laggy / doesn't work") was that BOTH
    // loops — the inference loop and this cursor drive loop — were pumped by two
    // clocks at once: their own setTimeout chain AND the 60Hz background ticker,
    // each tick re-arming ANOTHER self-perpetuating chain. Chains multiplied by
    // ~2/second, so the drive got worse the longer it ran and saturated the
    // thread within seconds. Successive setTimeout counts detect exactly that:
    // a multiplying loop climbs window over window, a single-flight loop holds.
    //
    // Deliberately NOT an fps assertion. This harness runs headless on a CPU-only
    // box where the app is thread-saturated with eye control OFF (measured:
    // ~1150ms median rAF gap, long tasks covering the whole window), so an
    // absolute frame budget would measure the machine, not the feature. The rAF
    // numbers below are printed for context only; the assertions are on growth
    // and on boundedness, which are machine-independent.
    const timerRate = async () => {
      const before = await page.evaluate(
        () => (window as unknown as { __timerCalls: number }).__timerCalls
      );
      await page.waitForTimeout(2000);
      const after = await page.evaluate(
        () => (window as unknown as { __timerCalls: number }).__timerCalls
      );
      return (after - before) / 2;
    };
    const rate1 = await timerRate();
    await page.waitForTimeout(6000);
    const rate2 = await timerRate();
    console.log(
      `    timer scheduling: ${rate1.toFixed(0)}/s, then ${rate2.toFixed(0)}/s six seconds later`
    );
    check(
      "the drive loop does not multiply itself (rate holds steady)",
      rate2 <= Math.max(rate1 * 1.6, rate1 + 40),
      `${rate1.toFixed(0)}/s → ${rate2.toFixed(0)}/s`
    );
    check("and stays bounded overall", rate2 <= 300, `${rate2.toFixed(0)}/s`);

    // Context only: requestAnimationFrame intervals over 3s, printed so a
    // regression in this area is visible even though no threshold is asserted.
    const cadence = await page.evaluate(
      () =>
        new Promise<{ median: number; p95: number; frames: number }>((resolve) => {
          const gaps: number[] = [];
          let last = performance.now();
          const started = last;
          const tick = (now: number) => {
            gaps.push(now - last);
            last = now;
            if (now - started < 3000) requestAnimationFrame(tick);
            else {
              gaps.shift();
              const sorted = [...gaps].sort((a, b) => a - b);
              resolve({
                median: sorted[Math.floor(sorted.length / 2)] ?? 0,
                p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
                frames: gaps.length,
              });
            }
          };
          requestAnimationFrame(tick);
        })
    );
    console.log(
      `    cadence (context): median ${cadence.median.toFixed(1)}ms, p95 ${cadence.p95.toFixed(1)}ms over ${cadence.frames} frames`
    );
    check(
      "the page is still animating at all (not frozen)",
      cadence.frames >= 2,
      `${cadence.frames} frames in 3s`
    );

    console.log("\nBlink-click learning: the page read it depends on");
    // A blink click teaches the map by reading the controls near the cursor
    // (see gazeClickLesson). That path cannot fire here — the synthetic camera
    // has no face, so no blink ever happens — but the DOM read it depends on
    // can still be checked on the real page: the selector must parse, and every
    // rectangle must be readable and finite. The geometry itself is unit-tested.
    const domRead = await page.evaluate(() => {
      const SELECTOR =
        'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"], [onclick], [tabindex]:not([tabindex="-1"])';
      let count = 0;
      let finite = true;
      for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
        const r = el.getBoundingClientRect();
        count++;
        if (![r.left, r.top, r.width, r.height].every(Number.isFinite)) finite = false;
      }
      return { count, finite };
    });
    check(
      "the click-target selector finds real controls on the page",
      domRead.count > 5,
      `${domRead.count} candidates`
    );
    check("and every one of them reports usable geometry", domRead.finite);

    console.log("\nNo false cursor movement");
    nonEmpty(osInputCalls, "os-input requests");
    const moves = osInputCalls.filter((b) => b.includes('"move"'));
    check(
      "no cursor moves are sent when no face is tracked",
      moves.length === 0,
      `${moves.length} moves of ${osInputCalls.length} requests`
    );

    console.log("\nDisabling again");
    await page.keyboard.press("Control+E");
    await page.waitForTimeout(800);
    check("the overlay tears down without throwing", pageErrors.length === 0, pageErrors.join(" | "));
  } finally {
    await browser.close();
    if (consoleErrors.length) {
      console.log("\nConsole errors seen (for review):");
      for (const e of consoleErrors.slice(0, 10)) console.log(`    - ${e.slice(0, 160)}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

/** Report counts; kept separate so the output stays readable. */
function nonEmpty(items: string[], label: string) {
  console.log(`    ${items.length} ${label} observed`);
}

main().catch((err) => {
  console.error("eye-overlay e2e crashed:", err);
  process.exit(1);
});
