// Tests for the pasted-path cleanup used by the MCP providers.
//
// Regression guard for the bug where a path copied with Windows Explorer's
// "Copy as path" (which wraps it in double quotes) reached fs.existsSync
// verbatim, so a file that plainly existed was reported as
// `File does not exist: "C:\Users\…\AML4.pdf"`.
//
// Pure — no filesystem, no network, no Next runtime.
//
// Run with:  npx tsx tests/localPaths.test.ts

import os from "os";
import path from "path";
import { hadPathDecoration, normalizeLocalPath, resolveLocalPath } from "../src/lib/mcp/localPaths";

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

const WIN = "C:\\Users\\dhruv\\Downloads\\AML4.pdf";

section("Explorer's \"Copy as path\" quotes are stripped");
check("double-quoted Windows path", normalizeLocalPath(`"${WIN}"`) === WIN, normalizeLocalPath(`"${WIN}"`));
check("single-quoted path", normalizeLocalPath(`'${WIN}'`) === WIN, normalizeLocalPath(`'${WIN}'`));
check("quotes with a trailing space", normalizeLocalPath(`"${WIN}" `) === WIN, normalizeLocalPath(`"${WIN}" `));
check("quotes with a trailing newline", normalizeLocalPath(`"${WIN}"\n`) === WIN, JSON.stringify(normalizeLocalPath(`"${WIN}"\n`)));
check("nested quotes are fully unwrapped", normalizeLocalPath(`""${WIN}""`) === WIN, normalizeLocalPath(`""${WIN}""`));

section("file:// URLs become real paths");
check(
  "file:///C:/Users path loses the scheme and the leading slash",
  normalizeLocalPath("file:///C:/Users/dhruv/Downloads/AML4.pdf") === "C:/Users/dhruv/Downloads/AML4.pdf",
  normalizeLocalPath("file:///C:/Users/dhruv/Downloads/AML4.pdf")
);
check(
  "percent-encoded characters are decoded",
  normalizeLocalPath("file:///C:/Users/dhruv/My%20Docs/paper.pdf") === "C:/Users/dhruv/My Docs/paper.pdf",
  normalizeLocalPath("file:///C:/Users/dhruv/My%20Docs/paper.pdf")
);
check(
  "a quoted file:// URL (drag-and-drop shape) still resolves",
  normalizeLocalPath('"file:///C:/Users/dhruv/Downloads/AML4.pdf"') === "C:/Users/dhruv/Downloads/AML4.pdf",
  normalizeLocalPath('"file:///C:/Users/dhruv/Downloads/AML4.pdf"')
);

section("~ expands to the home directory");
check("~ alone", normalizeLocalPath("~") === os.homedir(), normalizeLocalPath("~"));
check(
  "~/docs/paper.pdf",
  normalizeLocalPath("~/docs/paper.pdf") === path.join(os.homedir(), "docs/paper.pdf"),
  normalizeLocalPath("~/docs/paper.pdf")
);

section("ordinary input is left alone");
check("plain path unchanged", normalizeLocalPath(WIN) === WIN, normalizeLocalPath(WIN));
check("whitespace trimmed", normalizeLocalPath(`  ${WIN}  `) === WIN, normalizeLocalPath(`  ${WIN}  `));
check("forward slashes preserved", normalizeLocalPath("C:/Users/dhruv/a.pdf") === "C:/Users/dhruv/a.pdf");
check("UNC path preserved", normalizeLocalPath("\\\\server\\share\\a.pdf") === "\\\\server\\share\\a.pdf");
check("empty input", normalizeLocalPath("") === "");
check("null/undefined input", normalizeLocalPath(null) === "" && normalizeLocalPath(undefined) === "");

section("resolveLocalPath makes the path absolute");
check("relative path becomes absolute", path.isAbsolute(resolveLocalPath("scratch/docling-test.pdf")));
check("absolute path is unchanged", resolveLocalPath(WIN) === path.resolve(WIN), resolveLocalPath(WIN));
check("quoted absolute path resolves like the bare one", resolveLocalPath(`"${WIN}"`) === resolveLocalPath(WIN));

section("hadPathDecoration reports what the user pasted");
check("quoted path flagged", hadPathDecoration(`"${WIN}"`) === true);
check("file:// flagged", hadPathDecoration("file:///C:/a.pdf") === true);
check("plain path not flagged", hadPathDecoration(WIN) === false);

console.log(`\n------------------------------------------------------------`);
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
