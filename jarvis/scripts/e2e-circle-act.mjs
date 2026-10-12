// Circle to Act — end-to-end check against a running JARVIS dev server.
//
// Proves the "nothing is hardcoded" claim: it renders a little "screen",
// circles it with a natural-language instruction, and asserts that the agent
// picked a REAL tool and did the thing — with no intent list anywhere in the
// path. Two very different instructions on purpose:
//
//   1. "translate this into Hindi"        → text.translate
//   2. "email this to <address> asking…"  → email.send (a real Gmail send)
//
// The second one sends a real email, so it only runs when a recipient is
// passed:  node scripts/e2e-circle-act.mjs --to you@example.com
//
// Run (dev server must be up):
//   node scripts/e2e-circle-act.mjs
//   node scripts/e2e-circle-act.mjs --to dhruvbijapur67@gmail.com
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
const toArg = process.argv.indexOf("--to");
const RECIPIENT = toArg !== -1 ? process.argv[toArg + 1] : "";
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

function render(name, lines) {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `circle-act-${name}.png`);
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

/** POST the crop as a RAW image body, exactly like the watcher does. */
async function act(file, instruction) {
  const bytes = readFileSync(file);
  const res = await fetch(
    `${API}/api/circle/act?instruction=${encodeURIComponent(instruction)}`,
    {
      method: "POST",
      headers: { "Content-Type": "image/png" },
      body: bytes,
      signal: AbortSignal.timeout(180_000),
    }
  );
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* reported below */
  }
  return { status: res.status, json, text };
}

const toolsOf = (j) => (Array.isArray(j?.actions) ? j.actions.map((a) => a.tool) : []);

async function main() {
  console.log(`Circle to Act E2E against ${API}\n`);

  // ── 1. translate, in natural language ─────────────────────────────────────
  const french = render("french", [
    { text: "Recette de cuisine", size: 1, y: 50 },
    { text: "Faites chauffer le beurre dans une poele.", size: 2, y: 130 },
    { text: "Ajoutez les oignons et laissez cuire.", size: 2, y: 180 },
    { text: "Servez chaud avec du pain frais.", size: 2, y: 230 },
  ]);

  console.log('POST a circled paragraph with "translate this into Hindi"');
  const t = await act(french, "translate this into Hindi");
  check("HTTP 200", t.status === 200, `status ${t.status} ${t.text.slice(0, 200)}`);
  check("success is true", t.json?.success === true, t.text.slice(0, 200));
  check("the region was identified", Boolean(t.json?.subject), String(t.json?.subject));
  check(
    "the agent chose text.translate",
    toolsOf(t.json).includes("text.translate"),
    JSON.stringify(toolsOf(t.json))
  );
  check("a translation came back", Boolean(t.json?.translation), String(t.json?.translation));
  check("and it is not the source text", t.json?.translation !== t.json?.subject);
  check(
    "it answered inside 60s",
    typeof t.json?.elapsedMs === "number" && t.json.elapsedMs < 60_000,
    `${t.json?.elapsedMs}ms`
  );
  console.log(`       subject    : ${t.json?.subject}`);
  console.log(`       translation: ${String(t.json?.translation).slice(0, 200).replace(/\n/g, " ")}`);
  console.log(`       tools      : ${toolsOf(t.json).join(", ")} (${t.json?.elapsedMs}ms)`);

  // ── 2. a real email, composed by the agent, from a circled thing ──────────
  if (!RECIPIENT) {
    console.log('\n  SKIP  email leg — pass --to <address> to send a real email');
  } else {
    const invoice = render("invoice", [
      { text: "INVOICE 2026-114", size: 1, y: 50 },
      { text: "Consulting services - Rs 48,500", size: 2, y: 130 },
      { text: "Due: 30 October 2026", size: 2, y: 175 },
      { text: "GSTIN 29ABCDE1234F1Z5", size: 2, y: 220 },
    ]);

    console.log(`\nPOST a circled invoice with "email this to ${RECIPIENT} asking for payment"`);
    const e = await act(invoice, `email this to ${RECIPIENT} asking to pay this invoice by the due date`);
    check("HTTP 200", e.status === 200, `status ${e.status} ${e.text.slice(0, 200)}`);
    check("success is true", e.json?.success === true, e.text.slice(0, 200));
    check(
      "the agent chose email.send",
      toolsOf(e.json).includes("email.send"),
      JSON.stringify(toolsOf(e.json))
    );
    check("the send is reported as done", Boolean(e.json?.ok), String(e.json?.summary));
    const sendOut = (e.json?.actions || []).find((a) => a.tool === "email.send")?.output || "";
    check("the tool reports the recipient", sendOut.includes(RECIPIENT), sendOut.slice(0, 200));
    console.log(`       summary: ${String(e.json?.summary).slice(0, 220).replace(/\n/g, " ")}`);
    console.log(`       output : ${sendOut.slice(0, 220).replace(/\n/g, " ")}`);
  }

  // ── 3. a bad request is refused, not crashed ──────────────────────────────
  console.log("\nPOST without an image");
  const bad = await fetch(`${API}/api/circle/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instruction: "nothing here" }),
  });
  check("refused with 400", bad.status === 400, `status ${bad.status}`);

  const noInstruction = await fetch(`${API}/api/circle/act`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" }),
  });
  check("refused without an instruction", noInstruction.status === 400, `status ${noInstruction.status}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("e2e-circle-act crashed:", e);
  process.exit(1);
});
