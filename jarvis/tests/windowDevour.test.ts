// Window Devourer — dossier parsing and the API contract.
// Run with: npx tsx tests/windowDevour.test.ts

import {
  buildDevourPrompt,
  devourLabel,
  devourSuggestions,
  parseWindowTitle,
} from "../src/lib/orb/windowDevour";
import { POST } from "../src/app/api/orb/window-devour/route";
import { NextRequest } from "next/server";

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

// ─────────────────────────────────────────────────────────────────────────
section("1. Reading a window title");

const code = parseWindowTitle("main.ts — jarvis — Visual Studio Code");
check("editor: app is VS Code", code.app === "VS Code", code.app);
check("editor: document is the file", code.document === "main.ts", code.document);
check("editor: kind is code", code.kind === "code", code.kind);

const chrome = parseWindowTitle("GitHub - Pull requests - Google Chrome");
check("browser: app is Chrome", chrome.app === "Google Chrome", chrome.app);
check("browser: page title kept whole", chrome.document === "GitHub - Pull requests", chrome.document);
check("browser: kind is browser", chrome.kind === "browser", chrome.kind);

const many = parseWindowTitle("Docs, Pricing and 3 more pages - Google Chrome");
check("browser: 'and N more pages' stripped", !/more pages/i.test(many.document), many.document);

const dirty = parseWindowTitle("* draft.md - Notepad");
check("dirty flag read from the leading asterisk", dirty.dirty === true);
check("dirty: document still clean", dirty.document === "draft.md", dirty.document);

const shell = parseWindowTitle("Windows PowerShell");
check("terminal: app recognised", shell.app === "PowerShell", shell.app);
check("terminal: kind is terminal", shell.kind === "terminal", shell.kind);
check("terminal: bare app title has no fake document", shell.document === "", shell.document);

const chat = parseWindowTitle("#standup - Acme - Slack");
check("chat: app is Slack", chat.app === "Slack", chat.app);
check("chat: channel kept", chat.document === "#standup", chat.document);

const blank = parseWindowTitle("   ");
check("empty title does not throw", blank.app === "Unknown window", blank.app);
check("empty title is unknown", blank.kind === "unknown");

// ─────────────────────────────────────────────────────────────────────────
section("2. Asking about the swallowed window");

const prompt = buildDevourPrompt(code, { blank: false });
check("prompt tags the window", prompt.includes("[WINDOW DEVOURED]"), prompt.slice(0, 60));
check("prompt carries the app", prompt.includes("App: VS Code"));
check("prompt carries the document", prompt.includes("Open: main.ts"));
check("prompt states the frame is attached", prompt.includes("live frame attached"));

const blankPrompt = buildDevourPrompt(code, { blank: true });
check("blank capture is admitted, not hidden", blankPrompt.includes("came back blank"));

const asked = buildDevourPrompt(code, { question: "what broke the build?" });
check("a follow-up question replaces the default ask", asked.includes("Question: what broke the build?"));

const suggestions = devourSuggestions(code);
check("three suggestions offered", suggestions.length === 3, JSON.stringify(suggestions));
check("suggestions are code-flavoured", /bug|file|changed/i.test(suggestions.join(" ")));

check("card label prefers the document", devourLabel(code) === "main.ts", devourLabel(code));
check("card label falls back to the app", devourLabel(parseWindowTitle("Windows PowerShell")) === "PowerShell");

// ─────────────────────────────────────────────────────────────────────────
section("3. POST /api/orb/window-devour");

async function run() {
  {
    const req = new NextRequest("http://localhost:3000/api/orb/window-devour", {
      method: "POST",
      body: JSON.stringify({ title: "main.ts — jarvis — Visual Studio Code", hasFrame: true }),
    });
    const res = await POST(req);
    const json = await res.json();
    check("status 200", res.status === 200, String(res.status));
    check("ok is true", json.ok === true);
    check("app parsed server-side", json.app === "VS Code", json.app);
    check("kind is code", json.kind === "code");
    check("context is a ready-to-use prompt", String(json.context).startsWith("[WINDOW DEVOURED]"));
    check("suggestions returned", Array.isArray(json.suggestions) && json.suggestions.length === 3);
    check("blank flag is not invented", json.blank === false);
  }

  {
    const req = new NextRequest("http://localhost:3000/api/orb/window-devour", {
      method: "POST",
      body: JSON.stringify({ title: "Blender" }),
    });
    const res = await POST(req);
    const json = await res.json();
    check("recognises a design app", json.kind === "design", json.kind);
    check("no frame reported when none was sent", json.hasFrame === false);
  }

  {
    const req = new NextRequest("http://localhost:3000/api/orb/window-devour", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    check("empty title is rejected", res.status === 400, String(res.status));
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
