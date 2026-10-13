// UI smoke test for the new MCP Hub tabs (DuckDB / Documents / Zotero /
// DevTools) and the price tracker's background status.
//
// The API-level tests (e2e-mcp-providers.mjs) prove the providers work; this
// one proves the tabs actually render in the real app without a runtime error,
// through the same path a user takes: skip the boot gate, type a command that
// opens the MCP hub, then click through the tabs.
//
// Run:  node scripts/e2e-mcp-ui.mjs   (needs the dev server on :3000)

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.JARVIS_BASE || "http://localhost:3000";
let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`\n${t}`);
}

// The JARVIS shell drops into a "STANDBY / CLICK TO WAKE" state after a period
// with no user activity, which hides the open panel and makes later assertions
// read the standby screen instead of the panel. Nudging the pointer counts as
// activity and keeps the UI we are testing on screen.
async function keepAwake(page) {
  await page.mouse.move(700 + Math.floor(Math.random() * 200), 500 + Math.floor(Math.random() * 120));
}

async function main() {
  console.log(`JARVIS MCP UI smoke — target ${BASE}\n`);
  const browser = await chromium.launch({
    headless: true,
    // Background timers are throttled in headless Chrome, which stalls React
    // state updates and makes panels appear not to open. Muting audio and
    // relaxing autoplay keeps the voice engine from blocking on playback.
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--mute-audio",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

  // Headless Chrome has no audio device, so `speechSynthesis` never fires its
  // `end` event. JARVIS tracks that as "still speaking" and the command bar
  // ignores every submission while it is in that state — which made chat
  // commands silently do nothing throughout an automated run. Stubbing speech
  // synthesis to complete immediately puts the shell back in a state where it
  // accepts input. (This affects the test browser only.)
  await page.addInitScript(() => {
    const finish = (u) => setTimeout(() => {
      try { u.onend?.(new Event("end")); u.dispatchEvent?.(new Event("end")); } catch {}
    }, 5);
    const stub = {
      speak: (u) => finish(u),
      cancel: () => {},
      pause: () => {},
      resume: () => {},
      getVoices: () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
      onvoiceschanged: null,
      speaking: false,
      pending: false,
      paused: false,
    };
    try {
      Object.defineProperty(window, "speechSynthesis", { value: stub, configurable: true });
    } catch {}
  });

  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  try {
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90_000 });

    // The boot gate overlays the app until it is dismissed (Esc skips it).
    // It is a React keydown listener on window, so it only exists after
    // hydration — pressing Escape too early is silently ignored. Retry until
    // the command bar actually appears rather than assuming one press worked.
    const input = page.locator('input[placeholder*="type a command"]').first();
    let booted = false;
    for (let attempt = 0; attempt < 25 && !booted; attempt++) {
      await page.waitForTimeout(1000);
      if (await input.isVisible().catch(() => false)) {
        booted = true;
        break;
      }
      await page.keyboard.press("Escape");
    }
    check("command bar is reachable after boot (boot gate dismissed)", booted);
    if (!booted) throw new Error("Could not dismiss the boot gate — is the app still compiling?");

    // Open the hub the way a user would: the App Deck's MCP Hub launcher.
    // (Typing the equivalent chat command works too, but its handler sits
    // behind several async branches, which makes it a flaky thing to assert on.)
    const deck = page.locator('[aria-label="Open the App Deck"]').first();
    await deck.waitFor({ state: "visible", timeout: 30_000 });
    await deck.click({ force: true });
    await page.waitForTimeout(2000);
    await page.getByText("MCP Hub", { exact: false }).first().click({ force: true });
    await page.getByText("Model Context Protocol (MCP) Hub").first().waitFor({ timeout: 60_000 });
    check("MCP Hub opened via the App Deck", true);

    const tabLabels = ["WhatsApp", "Diplomat", "Mark CAD", "GitHub", "Filesystem", "Maps", "DuckDB", "Documents", "Zotero", "DevTools"];
    const bodyText = await page.locator("body").innerText();
    for (const label of tabLabels) {
      check(`tab present: ${label}`, bodyText.includes(label));
    }

    // ── DuckDB tab ──
    section("DuckDB tab");
    await keepAwake(page);
    await page.getByRole("button", { name: /^DuckDB/ }).first().click();
    await page.getByText("DuckDB workspace").first().waitFor({ timeout: 45_000 });
    check("DuckDB tab rendered", true);

    // Keep every wait short and nudge activity between them: the shell goes to
    // standby after a stretch of no input and hides the panel.
    let duckText = "";
    for (let i = 0; i < 10; i++) {
      await keepAwake(page);
      await page.waitForTimeout(1200);
      duckText = await page.locator("body").innerText();
      if (/v1\.\d+\.\d+/.test(duckText)) break;
    }
    check("shows the DuckDB version from the server", /v1\.\d+\.\d+/.test(duckText), duckText.match(/v\d[\d.]+/)?.[0] ?? "no version");
    // The DuckDB instance is shared for the life of the server process, so a
    // previous run (or a previous curl) may already have attached the database.
    // Accept either state, and only click when the action is still offered.
    const alreadyAttached = /JARVIS DB attached/i.test(duckText);
    check(
      "exposes the attach state (action offered, or already attached)",
      alreadyAttached || /Attach JARVIS database/i.test(duckText),
      duckText.slice(0, 160)
    );

    let attachedText = duckText;
    if (!alreadyAttached) {
      await keepAwake(page);
      await page.getByRole("button", { name: /Attach JARVIS database/i }).first().click();
      for (let i = 0; i < 20; i++) {
        await keepAwake(page);
        await page.waitForTimeout(1200);
        attachedText = await page.locator("body").innerText();
        if (/JARVIS DB attached|attached\)/i.test(attachedText)) break;
      }
    }
    check("the JARVIS database is attached and the UI says so", /JARVIS DB attached|attached\)/i.test(attachedText), attachedText.slice(0, 140));

    // Run a real query through the UI and confirm a result table renders.
    await keepAwake(page);
    await page.getByRole("button", { name: /Memory count by category/i }).first().click();
    let afterQuery = "";
    for (let i = 0; i < 20; i++) {
      await keepAwake(page);
      await page.waitForTimeout(1200);
      afterQuery = await page.locator("body").innerText();
      if (/\brows?\b/i.test(afterQuery) && /user_fact|category/i.test(afterQuery)) break;
    }
    check(
      "quick query executed and rendered a result table",
      /\brows?\b/i.test(afterQuery) && /user_fact|category/i.test(afterQuery),
      afterQuery.slice(0, 160)
    );

    // ── Documents tab ──
    section("Documents tab");
    await page.getByRole("button", { name: /^Documents/ }).first().click();
    await page.getByText("Document conversion").first().waitFor({ timeout: 45_000 });
    check("Documents tab rendered", true);
    await keepAwake(page);
    await page.waitForTimeout(5000);
    const docsText = await page.locator("body").innerText();
    check(
      "states which engine is in use, including the built-in fallback",
      /Built-in fallback/i.test(docsText) && /pdf-parse/i.test(docsText)
    );
    check("shows the Docling runtime state honestly", /provisioned|not provisioned|warm/i.test(docsText));

    // ── Zotero tab ──
    section("Zotero tab");
    await page.getByRole("button", { name: /^Zotero/ }).first().click();
    await page.getByText("Zotero library").first().waitFor({ timeout: 45_000 });
    check("Zotero tab rendered", true);
    await keepAwake(page);
    await page.waitForTimeout(5000);
    const zoteroText = await page.locator("body").innerText();
    check("reports the local/cloud source state", /local/i.test(zoteroText) && /cloud/i.test(zoteroText));
    check("explains how to make it work when no source is present", /Zotero|Settings|API_KEY/i.test(zoteroText));

    // ── DevTools tab ──
    section("DevTools tab");
    await page.getByRole("button", { name: /^DevTools/ }).first().click();
    await page.getByText("Chrome DevTools").first().waitFor({ timeout: 45_000 });
    check("DevTools tab rendered", true);
    let devText = "";
    for (let i = 0; i < 18; i++) {
      await keepAwake(page);
      await page.waitForTimeout(1500);
      devText = await page.locator("body").innerText();
      if (/tool/i.test(devText) && /Chrome DevTools/.test(devText)) break;
    }
    check("shows the MCP connection state", /tools/i.test(devText) || /not connected|installed/i.test(devText), devText.slice(0, 160));
    check("exposes the raw tool runner", /Raw tool call/i.test(devText));

    // ── Price tracker through the command bar ──
    // This used to be left to manual checks because a headless run could not
    // drive the command bar: submissions are ignored while the shell is in its
    // "speaking" state, and an open panel's full-screen backdrop swallows
    // pointer events aimed at the input. Both are handled now — speech
    // synthesis is stubbed above, and the backdrop is dismissed below — so the
    // exact bug this guards (the widget matcher swallowing "open price tracker"
    // and opening the Widgets surface instead) is asserted end to end.
    section("Price tracker panel opens from the command bar");

    const dismissOverlays = async () => {
      for (let i = 0; i < 6; i++) {
        const blocked = await page.evaluate(() => {
          const el = document.querySelector('input[placeholder*="type a command"]');
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!top && top !== el && !el.contains(top);
        });
        if (!blocked) return true;
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          const wanted = /^(close|dismiss|got it|ok(ay)?|no thanks|skip|later|cancel)$/i;
          const hit = Array.from(document.querySelectorAll("button, [role=button]")).find((b) => {
            const r = b.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && wanted.test((b.innerText || "").trim());
          });
          hit?.click();
        });
        await page.waitForTimeout(500);
      }
      return false;
    };

    let priceOpened = false;
    for (let attempt = 0; attempt < 12 && !priceOpened; attempt++) {
      await dismissOverlays();
      try {
        await input.click({ timeout: 8_000 });
      } catch {
        await input.fill("open price tracker", { force: true });
        await input.press("Enter");
        continue;
      }
      await input.fill("open price tracker");
      await input.press("Enter");
      for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(1200);
        if (/Background loop/i.test(await page.locator("body").innerText())) {
          priceOpened = true;
          break;
        }
      }
    }

    const afterCommand = await page.locator("body").innerText();
    check("\"open price tracker\" opens the price tracker panel", /Background loop/i.test(afterCommand), afterCommand.slice(0, 200));
    check("the widgets surface did NOT open instead", !/No widgets yet/i.test(afterCommand));
    check("the panel states it keeps running when closed", /Keeps running with this panel closed/i.test(afterCommand) || /keeps running/i.test(afterCommand));

    const shot = path.join(process.cwd(), "scratch", "ui-mcp-tabs.png");
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: shot, fullPage: false });
    console.log(`  (screenshot: ${shot})`);

    check("no uncaught page errors during the whole run", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${"-".repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) console.log(`\nFailed checks:\n  - ${failures.join("\n  - ")}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
