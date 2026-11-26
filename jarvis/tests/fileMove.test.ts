// File moves — where a spoken destination really points.
// Run with: npx tsx tests/fileMove.test.ts

import path from "path";
import {
  fallbackTable,
  kindForName,
  normalizeDestination,
  resolveDestination,
  type FolderTable,
} from "../src/lib/files/destinations";

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

// A stand-in for a machine whose Documents/Pictures live in OneDrive.
const HOME = path.join("C:", "Users", "tester");
const table: FolderTable = {
  ...fallbackTable(HOME),
  documents: path.join(HOME, "OneDrive", "Documents"),
  pictures: path.join(HOME, "OneDrive", "Pictures"),
};

section("Spoken names normalise");
check("articles and 'folder' drop out", normalizeDestination("to the Desktop folder") === "desktop");
check("'my' drops out", normalizeDestination("my desktop") === "desktop");
check("trailing punctuation drops out", normalizeDestination("desktop!") === "desktop");

section("Destinations people actually type");
check("plain desktop", resolveDestination("desktop", table) === table.desktop);
check("my desktop", resolveDestination("my desktop", table) === table.desktop);
check("the desktop folder", resolveDestination("the desktop folder", table) === table.desktop);
check("works with 'on'", resolveDestination("on my desktop", table) === table.desktop);
check("downloads", resolveDestination("downloads", table) === table.downloads);
check("documents uses the real folder", resolveDestination("documents", table) === table.documents);
check("documents is NOT the homedir guess", resolveDestination("documents", table) !== path.join(HOME, "Documents"));
check("pictures uses the real folder", resolveDestination("pics", table) === table.pictures);

section("Typos still land somewhere sane");
check("dekstop", kindForName("dekstop") === "desktop");
check("dekstop resolves", resolveDestination("dekstop", table) === table.desktop);
check("documnets", resolveDestination("documnets", table) === table.documents);
check("dowloads", resolveDestination("dowloads", table) === table.downloads);

section("Subfolders");
check("desktop/Projects", resolveDestination("desktop/Projects", table) === path.join(table.desktop, "Projects"));
check(
  "a folder called Reports on desktop",
  resolveDestination("a folder called Reports on the desktop", table) ===
    path.join(table.desktop, "Reports")
);
check("absolute paths are taken as given", resolveDestination("C:\\Temp\\out", table) === "C:\\Temp\\out");

section("Unknown destinations are refused, not guessed");
check("'the moon' resolves to nothing", resolveDestination("the moon", table) === null);
check("gibberish resolves to nothing", resolveDestination("zzzzqqq", table) === null);
check("empty resolves to nothing", resolveDestination("   ", table) === null);
// The old behaviour sent anything unrecognised to Downloads, which is what
// produced a success message for a move that never happened.
check("unknown is not silently Downloads", resolveDestination("the moon", table) !== table.downloads);

section(`\nSummary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
