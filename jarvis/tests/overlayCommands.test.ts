// The overlay's shortcuts live in two processes: the HUD page declares them
// (src/lib/overlay/shortcuts.ts, which also renders the ⌘ help panel) and the
// Electron shell registers them globally (overlay/main.js) so they work while
// the call app has focus.
//
// Two lists that must agree is exactly the kind of thing that rots silently —
// a shortcut that shows up in the help panel but does nothing is worse than no
// shortcut at all. This test reads both files and fails on any drift, and also
// checks the preload bridge actually exposes the channel the shell uses.
//
// Run with:  npx tsx tests/overlayCommands.test.ts

import { readFileSync } from "node:fs";
import path from "node:path";
import { SHORTCUTS, resolveCommand, modeForDigit } from "../src/lib/overlay/shortcuts";
import { MODES } from "../src/lib/overlay/modes";

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

const mainSrc = readFileSync(path.resolve("overlay/main.js"), "utf8");
const preloadSrc = readFileSync(path.resolve("overlay/preload.js"), "utf8");

/** Pull `{ accel: "…", command: "…" }` pairs out of the shell's COMMANDS table. */
function shellCommands(): Array<{ accel: string; command: string }> {
  const out: Array<{ accel: string; command: string }> = [];
  const re = /\{\s*accel:\s*"([^"]+)",\s*command:\s*"([^"]+)"\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mainSrc))) out.push({ accel: m[1], command: m[2] });
  return out;
}

const shell = shellCommands();

/** Electron wants "Control+…"; the HUD shows the user "Ctrl+…". Same key. */
const normaliseAccel = (accel: string) => accel.replace(/^Ctrl\+/i, "Control+");

section("The shell registers every shortcut the page advertises");

check("the shell has a command table", shell.length > 0, `${shell.length} found`);

for (const s of SHORTCUTS) {
  if (!s.shell) {
    check(`${s.id}: intentionally shell-less (${s.inPage})`, !shell.some((c) => c.command === s.id));
    continue;
  }
  const match = shell.find((c) => c.command === s.id);
  check(`${s.id} is registered in the shell`, !!match, match ? "" : `missing — add ${s.shell} to overlay/main.js`);
  check(
    `${s.id} uses the advertised accelerator`,
    match?.accel === normaliseAccel(s.shell),
    `shell=${match?.accel} page=${s.shell}`
  );
}

section("The shell does not send commands the page cannot handle");

const known = new Set(SHORTCUTS.map((s) => s.id));
for (const c of shell) {
  check(`${c.command} exists in the page's shortcut table`, known.has(c.command as never), c.command);
}

section("The preload bridge exposes the channel the shell sends on");

check("preload exposes onCommand", /onCommand:/.test(preloadSrc));
check(
  "preload subscribes to overlay:command",
  /ipcRenderer\.on\(\s*"overlay:command"/.test(preloadSrc)
);
check("the shell emits overlay:command", /webContents\.send\(\s*"overlay:command"/.test(mainSrc));

section("In-window keys map to the right commands");

const key = (over: Partial<KeyboardEvent>) =>
  resolveCommand({ key: "a", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...over } as KeyboardEvent);

check("Alt+L toggles listening", key({ key: "l", altKey: true }) === "toggle-listen");
check("Alt+M toggles mute", key({ key: "m", altKey: true }) === "toggle-mute");
check("Alt+A answers now", key({ key: "a", altKey: true }) === "ask-now");
check("Alt+S summarises", key({ key: "s", altKey: true }) === "summarize");
check("Alt+E goes deeper", key({ key: "e", altKey: true }) === "expand");
check("Alt+R repeats", key({ key: "r", altKey: true }) === "repeat");
check("Alt+D changes length", key({ key: "d", altKey: true }) === "cycle-density");
check("Alt+P opens privacy", key({ key: "p", altKey: true }) === "toggle-privacy");
check("Alt+C opens context", key({ key: "c", altKey: true }) === "toggle-context");
check("Alt+X forgets everything", key({ key: "x", altKey: true }) === "clear-all");
check("Alt+K opens this list", key({ key: "k", altKey: true }) === "help");
check("Escape hides", key({ key: "Escape" }) === "hide");
check("Ctrl+Enter is send/focus", key({ key: "Enter", ctrlKey: true }) === "focus-ask");

check("a plain letter is NOT a command (it is type-to-ask)", key({ key: "j" }) === null);
check("Alt+j is not bound", key({ key: "j", altKey: true }) === null);
check("Ctrl+L is left to the browser", key({ key: "l", ctrlKey: true }) === null);

section("Alt+digit picks a mode, and every mode is reachable");

check("Alt+1 is the first mode", modeForDigit({ key: "1", altKey: true }) === 0);
check("Alt+7 reaches the last mode", modeForDigit({ key: String(MODES.length), altKey: true }) === MODES.length - 1);
check("there are not more modes than digits", MODES.length <= 9, `${MODES.length}`);
check("plain digits are not a mode switch", modeForDigit({ key: "1" }) === null);
// The page guards with `MODES[index]`, so a digit past the end must be ignorable.
check("a digit past the last mode resolves to nothing selectable", MODES[modeForDigit({ key: "9", altKey: true }) ?? 0] === undefined);
check("the last real digit still selects the last mode", MODES[modeForDigit({ key: String(MODES.length), altKey: true }) ?? 0]?.id === MODES[MODES.length - 1].id);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
