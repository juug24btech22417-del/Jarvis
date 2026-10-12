// Circle to Search — end-to-end check against a running JARVIS dev server.
//
// This is the real thing: it renders two little "screen" images, POSTs them to
// /api/circle/search exactly the way the OS overlay does, and validates the
// card payload the watcher renders. It exercises the live vision model AND the
// live Serper search, so it is the only check that proves the whole chain.
//
// Run (dev server must be up):
//   npm run dev                 # in one terminal
//   node scripts/e2e-circle-search.mjs
//   node scripts/e2e-circle-search.mjs --api http://localhost:3000
//
// Exits non-zero on the first contract violation.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const apiArg = process.argv.indexOf("--api");
const API = apiArg !== -1 ? process.argv[apiArg + 1] : "http://localhost:3000";
const OUT_DIR = join(root, "scratch");

let passed = 0;
let failed = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

// ── Render the two test "screens" with GDI+ (no image deps needed) ─────────
function render(name, lines) {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `circle-e2e-${name}.png`);
  const esc = (s) => s.replace(/'/g, "''");
  const draws = lines
    .map(
      (l) =>
        `$g.DrawString('${esc(l.text)}', $f${l.size}, [System.Drawing.Brushes]::Black, 40, ${l.y})`
    )
    .join("\n");
  const ps = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 700, 440
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$f1 = New-Object System.Drawing.Font 'Segoe UI', 30, ([System.Drawing.FontStyle]::Bold)
$f2 = New-Object System.Drawing.Font 'Segoe UI', 17
$f3 = New-Object System.Drawing.Font 'Segoe UI', 24, ([System.Drawing.FontStyle]::Bold)
${draws}
$g.Dispose()
$bmp.Save('${esc(file.replace(/\\/g, "/"))}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host 'rendered'
`;
  const res = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
  if (!existsSync(file)) {
    console.error("could not render test image:", res.stderr || res.stdout);
    process.exit(1);
  }
  return file;
}

const toDataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

async function circle(body) {
  const res = await fetch(`${API}/api/circle/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* reported below */
  }
  return { status: res.status, json, text };
}

const KINDS = ["product", "place", "person", "text", "question", "code", "chart", "image", "other"];

// ─────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Circle to Search E2E against ${API}\n`);

  console.log("GET /api/circle/search (kind catalog)");
  const catalog = await fetch(`${API}/api/circle/search`).then((r) => r.json()).catch(() => null);
  check("catalog returns", Boolean(catalog?.success));
  check("catalog lists every kind", Array.isArray(catalog?.kinds) && catalog.kinds.length === KINDS.length);
  check(
    "every kind maps to a google surface",
    Array.isArray(catalog?.kinds) && catalog.kinds.every((k) => typeof k.surface === "string" && k.label)
  );

  // ── 1. a product card on screen ─────────────────────────────────────────
  const productFile = render("product", [
    { text: "SONY WH-1000XM5", size: 1, y: 50 },
    { text: "Wireless Noise Cancelling Headphones", size: 2, y: 130 },
    { text: "$348.00", size: 3, y: 200 },
    { text: "Amazon.in - In stock", size: 2, y: 270 },
  ]);

  console.log("\nPOST a circled product card");
  const p = await circle({ image: toDataUrl(productFile), maxItems: 4 });
  check("HTTP 200", p.status === 200, `status ${p.status}`);
  check("success is true", p.json?.success === true, p.text.slice(0, 200));
  check("kind is one of ours", KINDS.includes(p.json?.kind), String(p.json?.kind));
  check("a title came back", Boolean(p.json?.title), String(p.json?.title));
  check("a search query came back", Boolean(p.json?.query), String(p.json?.query));
  check(
    "searchUrl is a google url",
    typeof p.json?.searchUrl === "string" && p.json.searchUrl.startsWith("https://www.google.com"),
    String(p.json?.searchUrl)
  );
  check("items is an array", Array.isArray(p.json?.items));
  check("provider is reported", Boolean(p.json?.provider), String(p.json?.provider));
  // The whole point of the parallel race: a throttled provider must never make
  // the user wait for its timeout.
  check(
    "answered fast (under 15s)",
    typeof p.json?.elapsedMs === "number" && p.json.elapsedMs < 15_000,
    `${p.json?.elapsedMs}ms`
  );
  check("reported vision state", typeof p.json?.visionFailed === "boolean");
  check(
    "the search leg really ran (SERPER_API_KEY wired)",
    typeof p.json?.provider === "string" && !p.json.provider.includes("no SERPER_API_KEY"),
    String(p.json?.provider)
  );
  console.log("       result:", JSON.stringify({
    kind: p.json?.kind,
    kindLabel: p.json?.kindLabel,
    title: p.json?.title,
    query: p.json?.query,
    surface: p.json?.surface,
    elapsedMs: p.json?.elapsedMs,
    provider: p.json?.provider,
    items: (p.json?.items ?? []).map((i) => `${i.title} [${i.price || i.source}]`),
  }, null, 2).split("\n").join("\n       "));

  // ── 2. a circled question ───────────────────────────────────────────────
  const questionFile = render("question", [
    { text: "A ball is dropped from a height of 20 m.", size: 2, y: 60 },
    { text: "How long does it take to reach the ground?", size: 2, y: 120 },
    { text: "(ignore air resistance, g = 9.8 m/s^2)", size: 2, y: 180 },
  ]);

  console.log("\nPOST a circled question");
  const q = await circle({ image: toDataUrl(questionFile), maxItems: 3 });
  check("HTTP 200", q.status === 200, `status ${q.status}`);
  check("success is true", q.json?.success === true, q.text.slice(0, 200));
  check("an answer came back", typeof q.json?.answer === "string" && q.json.answer.length > 0);
  console.log("       answer:", String(q.json?.answer).slice(0, 260).replace(/\n/g, " "));
  console.log("       query :", String(q.json?.query));
  console.log("       took  :", `${q.json?.elapsedMs}ms`);

  // ── 3. a bad request is refused, not crashed ────────────────────────────
  console.log("\nPOST without an image");
  const bad = await circle({ question: "nothing here" });
  check("missing image is a 400", bad.status === 400, `status ${bad.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\nE2E failed:", e?.message || e);
  process.exit(1);
});
