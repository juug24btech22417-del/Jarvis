// Regression guard for the two run options the price scrape needed.
//
// THE BUG: reading one Amazon product page took 61–90 seconds. Two causes were
// structural, not network-bound:
//   1. Every navigation waited out a 10s ceiling for the page's `load` event,
//      which on a page full of images frequently never fires. The price scrape
//      reads a selector instead, so that wait bought nothing.
//   2. The scrape refused to block anything, so an image-heavy page had to
//      pull every image before the event waited on in (1) could fire.
//
// Both knobs are exercised here against a local page whose image never
// finishes loading, so the assertions do not depend on any external site.
//
// Run with:  npx tsx tests/browserRunOptions.test.ts

import http from "http";
import { runActions } from "../src/lib/browser/engine";

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
function section(title: string) {
  console.log(`\n${title}`);
}

const PAGE_TEXT = "hello-from-the-page";
const IMAGE_PATH = "/slow-image.png";

// Paths the browser actually asked for. This is the only honest way to prove a
// resource was blocked: the point is that the request never leaves the process.
const requested: string[] = [];

const server = http.createServer((req, res) => {
  const url = req.url || "";
  requested.push(url);

  if (url === IMAGE_PATH) {
    // Deliberately never respond. The socket stays open, so the document's
    // `load` event can never fire — exactly the situation a product page with
    // a stalled image puts us in.
    return;
  }
  if (url === "/" || url === "/page.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      `<!doctype html><html><head><title>run options</title></head><body>` +
        `<div id="t">${PAGE_TEXT}</div><img src="${IMAGE_PATH}">` +
        `</body></html>`
    );
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

// tsx compiles this project to CJS, so there is no top-level await here.
async function main() {
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const port = (server.address() as { port: number }).port;
const pageUrl = `http://127.0.0.1:${port}/page.html`;

const readPage = [{ type: "navigate" as const, url: pageUrl }, { type: "getText" as const, selector: "#t", optional: true }];

async function timed(opts: Parameters<typeof runActions>[1]) {
  const t0 = Date.now();
  const run = await runActions(readPage, opts);
  const elapsed = Date.now() - t0;
  const text = run.results.find((r) => r.action === "getText")?.text ?? null;
  return { elapsed, text, run };
}

async function waitForRequest(path: string, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (requested.includes(path)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

section("Without the options, an unloadable image holds the run up");
{
  // A short ceiling keeps the suite quick while still proving the ceiling is
  // paid in full when `load` cannot fire.
  const baseline = await timed({ globalTimeoutMs: 30_000, loadWaitMs: 4_000 });
  check("the page text is readable even though the image never loads", baseline.text === PAGE_TEXT, String(baseline.text));
  check("the load ceiling is paid in full when load never fires", baseline.elapsed >= 3_900, `${baseline.elapsed}ms`);
  check("the unblocked image was requested from the server", await waitForRequest(IMAGE_PATH, 3_000), JSON.stringify(requested));

  section("loadWaitMs: 0 reads the selector and returns immediately");
  const fast = await timed({ globalTimeoutMs: 30_000, loadWaitMs: 0 });
  check("the same text is still read", fast.text === PAGE_TEXT, String(fast.text));
  check(
    "no load ceiling is paid",
    fast.elapsed < baseline.elapsed - 1_500,
    `fast=${fast.elapsed}ms baseline=${baseline.elapsed}ms`
  );

  section("blockResources stops the request before it leaves the process");
  requested.length = 0;
  const blocked = await timed({ globalTimeoutMs: 30_000, loadWaitMs: 4_000, blockResources: ["image", "media", "font"] });
  check("the text is still read with images refused", blocked.text === PAGE_TEXT, String(blocked.text));
  check(
    "the image was never requested",
    !(await waitForRequest(IMAGE_PATH, 1_500)),
    JSON.stringify(requested)
  );
  check("only the document was fetched", requested.every((u) => u === "/page.html" || u === "/favicon.ico"), JSON.stringify(requested));
}
}

main()
  .catch((err) => {
    console.error("\n  \u2717 the browser could not be driven:", err instanceof Error ? err.message : err);
    failed++;
  })
  .finally(() => {
    server.closeAllConnections?.();
    server.close();
    console.log(`\n${passed} passed, ${failed} failed`);
    // The browser is a process-wide singleton that keeps the event loop alive,
    // so this must exit explicitly or the suite never returns.
    process.exit(failed > 0 ? 1 : 0);
  });
