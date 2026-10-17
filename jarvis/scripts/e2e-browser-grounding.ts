// E2E: on-screen understanding, against a REAL Chromium and a REAL page.
//
// Unit tests cover the ranker and the comparison maths. This harness covers the
// integration the user actually depends on:
//
//   1. the agent's own observe() reads a live page and produces element refs,
//   2. local grounding resolves a spoken-style request ("the blue Subscribe
//      button") to the right live element — twice, across a re-render that
//      re-issues every ref, which is the situation ref-based clicking breaks in,
//   3. a click that WORKS is detected as a change,
//   4. a click on a dead element is detected as NO change (the failure the
//      browser agent used to be blind to).
//
// Run with:  npm run e2e:grounding

import { chromium } from "playwright";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  observe,
  resolveTarget,
  renderObservation,
  type BrowserStep,
} from "../src/lib/agent/browserAgent";
import { bestMatch } from "../src/lib/screen/elementGrounding";
import { changeNote, classifyChange } from "../src/lib/screen/screenChange";

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

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Stark Industries — Video</title></head>
<body style="font-family:sans-serif">
  <nav>
    <a href="#home">Home</a>
    <a href="#trending">Trending</a>
    <a href="#signin">Sign in</a>
    <input id="q" type="search" aria-label="Search" placeholder="Search">
  </nav>
  <main>
    <h1>Repulsor calibration, episode 7</h1>
    <p id="body">Subscribe to this channel for more videos about circuits rockets orbits telemetry guidance and recovery systems. Subscribe for weekly updates and full build logs.</p>
    <button id="subscribe" style="background:#0088ff;color:#fff">Subscribe</button>
    <button id="newsletter">Subscribe to newsletter</button>
    <button id="share">Share</button>
    <button id="more">More</button>
    <div id="dead" role="button" tabindex="0">Decorative panel</div>
    <select aria-label="Sort by"><option>Newest</option><option>Oldest</option></select>
  </main>
  <script>
    // A real change: text plus a new interactive element.
    document.getElementById('subscribe').addEventListener('click', () => {
      document.getElementById('subscribe').textContent = 'Subscribed';
      document.getElementById('body').textContent =
        'You are subscribed. Turn on notifications to hear about new episodes, live streams and behind the scenes footage.';
      const b = document.createElement('button');
      b.id = 'notify'; b.textContent = 'Turn on notifications';
      document.body.appendChild(b);
    });
    document.getElementById('share').addEventListener('click', () => {
      document.getElementById('body').textContent = 'Link copied to clipboard.';
    });
    // A DEAD control: perfectly clickable, does absolutely nothing. This is the
    // case the agent must notice instead of retrying forever.
    document.getElementById('dead').addEventListener('click', (e) => e.preventDefault());
  </script>
</body></html>`;

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "jarvis-e2e-"));
  const file = join(dir, "page.html");
  writeFileSync(file, PAGE, "utf8");
  const url = pathToFileURL(file).href;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // esbuild (via tsx) injects a `__name()` helper into every closure it
    // transforms to keep function names. Functions passed to page.evaluate are
    // serialised into the page and re-created there, where that helper does not
    // exist — so define it in the page. Nothing else about the evaluation
    // changes, and this is a harness-only shim (the app runs through SWC).
    await page.addInitScript(() => {
      (globalThis as unknown as { __name: unknown }).__name = (fn: unknown) => fn;
    });
    await page.goto(url, { waitUntil: "load" });

    // ── 1. The agent's own observation of a live page ────────────────────
    console.log("\nObservation (the real observe() against live Chromium)");
    const first = await observe(page);
    check("the page was read", first.elements.length >= 7, `${first.elements.length} elements`);
    check("the title came through", /Stark Industries/.test(first.title), first.title);
    check("every element carries a ref", first.elements.every((e) => /^j\d+$/.test(e.ref)));
    check(
      "the labels are usable text",
      first.elements.some((e) => e.name === "Subscribe"),
      first.elements.map((e) => e.name).join(" | ")
    );
    check("the prompt rendering works", /INTERACTIVE ELEMENTS/.test(renderObservation(first)));

    // ── 2. Grounding against the LIVE element list ───────────────────────
    console.log("\nGrounding (natural language -> live element)");
    const request = "click the blue Subscribe button";
    const match = bestMatch(request, first.elements);
    const expected = first.elements.find((e) => e.name === "Subscribe");
    check("a described button resolved", !!match, "no match");
    check(
      "and it resolved to the RIGHT element, not a sibling",
      match?.ref === expected?.ref,
      `got ${match?.name} (${match?.ref}) want Subscribe (${expected?.ref})`
    );
    check("with confidence above the accept threshold", (match?.confidence ?? 0) >= 0.5, `${match?.confidence}`);

    const field = bestMatch("type the rocket name in the Search field", first.elements);
    check("a field request resolves to the search box", /search/i.test(field?.name ?? ""), field?.name ?? "null");
    const sort = bestMatch("open the Sort by dropdown", first.elements);
    check("a combobox resolves by label", sort?.name === "Sort by", sort?.name ?? "null");

    // The exact decision path the agent runs on a click.
    const decision = { action: "click", find: request };
    const entry: BrowserStep = { step: 1, thought: "click subscribe", action: "click", ok: false };
    const ref = resolveTarget(decision, first, entry);
    check("resolveTarget returns the grounded ref", ref === expected?.ref, `${ref} vs ${expected?.ref}`);
    check("and records why, for the step log", /found/.test(entry.detail ?? ""), entry.detail ?? "");

    // A target that does not exist must FAIL, not click something plausible.
    let failedAsExpected = false;
    try {
      resolveTarget(
        { action: "click", find: "click Delete my account" },
        first,
        { step: 2, thought: "", action: "click", ok: false }
      );
    } catch (err) {
      failedAsExpected = /could not resolve/.test(String((err as Error).message));
    }
    check("an impossible target fails loudly instead of guessing", failedAsExpected);

    // ── 3. A click that WORKS must be seen as a change ───────────────────
    console.log("\nVerification (did the click actually do anything?)");
    const beforeClick = await observe(page);
    await page.click('[data-jarvis-ref="' + expected!.ref + '"]');
    await page.waitForTimeout(150);
    const afterClick = await observe(page);
    const goodChange = classifyChange(beforeClick, afterClick);
    check("a working click registers as a change", goodChange.changed, JSON.stringify(goodChange.verdict));
    check("the verdict names what changed", goodChange.verdict === "content" || goodChange.verdict === "layout", goodChange.verdict);
    check("and no misleading 'nothing happened' note is produced", changeNote("click", goodChange) === null);

    // The button now reads "Subscribed" — grounding must follow the label, not
    // a remembered ref.
    const reGrounded = bestMatch(request, afterClick.elements);
    const expected2 = afterClick.elements.find((e) => e.name === "Subscribed");
    check(
      "the same request still resolves after the label changed",
      reGrounded?.ref === expected2?.ref,
      `re-grounded ${reGrounded?.ref} "${reGrounded?.name}"`
    );

    // Now force a genuine REF RE-ISSUE: prepend a link, which shifts the index
    // of every element after it, so every ref changes. This is exactly the
    // situation a cached ref breaks in — and the one grounding exists to fix.
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "#new";
      a.textContent = "New";
      document.querySelector("nav")?.prepend(a);
    });
    const shifted = await observe(page);
    const shiftedMatch = bestMatch(request, shifted.elements);
    const shiftedExpected = shifted.elements.find((e) => e.name === "Subscribed");
    check(
      "and after every ref on the page was re-issued",
      shiftedMatch?.ref === shiftedExpected?.ref && shiftedMatch?.ref !== reGrounded?.ref,
      `before=${reGrounded?.ref} after=${shiftedMatch?.ref} (want ${shiftedExpected?.ref})`
    );

    // ── 4. A click on a DEAD element must be caught ──────────────────────
    const beforeDead = await observe(page);
    const dead = beforeDead.elements.find((e) => e.name === "Decorative panel");
    check("the dead control is in the observation", !!dead);
    await page.click(`[data-jarvis-ref="${dead!.ref}"]`);
    await page.waitForTimeout(150);
    const afterDead = await observe(page);
    const deadChange = classifyChange(beforeDead, afterDead);
    check("a dead click registers as NO change", !deadChange.changed, JSON.stringify(deadChange));
    const note = changeNote("click", deadChange);
    check("and produces the feedback note the agent acts on", !!note && /NO visible change/.test(note), note ?? "null");
    check(
      "the note tells the model to try something else",
      /different element|covering/.test(note ?? ""),
      note ?? "null"
    );
    check("an observation-only action is still not judged", changeNote("extract", deadChange) === null);

    // ── 5. The run must not be confused by a title-only update ───────────
    await page.evaluate(() => (document.title = "Stark Industries — Video (3)"));
    const afterTitle = await observe(page);
    const titleChange = classifyChange(afterDead, afterTitle);
    check("a churning page title alone is not treated as an action result", !titleChange.changed);
    check("but it is still reported", titleChange.titleChanged);
  } finally {
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("e2e harness crashed:", err);
  process.exit(1);
});
