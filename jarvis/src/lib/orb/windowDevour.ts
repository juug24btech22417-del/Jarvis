/**
 * Window Devourer — pure helpers.
 *
 * A desktop window announces itself only as a title string
 * ("main.ts — jarvis — Visual Studio Code"), so everything the orb can say
 * before a model gets involved has to be read out of that string. Keeping this
 * pure means the dossier is instant (no second model round-trip) and testable
 * without Electron.
 */

export type DevourKind =
  | "code"
  | "browser"
  | "terminal"
  | "chat"
  | "document"
  | "sheet"
  | "media"
  | "design"
  | "unknown";

export interface WindowIdentity {
  /** The title exactly as the OS reported it. */
  raw: string;
  /** The application that owns the window. */
  app: string;
  /** What is open inside it — file, page, thread, document. */
  document: string;
  kind: DevourKind;
  /** True when the window had unsaved changes (`* ` prefix on Windows). */
  dirty: boolean;
}

type AppRule = {
  /** Matched against the whole title, case-insensitively. */
  test: RegExp;
  app: string;
  kind: DevourKind;
};

/**
 * Ordered: the most specific application first. Browsers are matched before
 * editors because Chrome's title can contain "Visual Studio Code" (a docs tab).
 */
const APP_RULES: AppRule[] = [
  { test: /google chrome|chrome$/i, app: "Google Chrome", kind: "browser" },
  { test: /microsoft.?edge/i, app: "Microsoft Edge", kind: "browser" },
  { test: /brave/i, app: "Brave", kind: "browser" },
  { test: /mozilla firefox/i, app: "Firefox", kind: "browser" },
  { test: /opera/i, app: "Opera", kind: "browser" },
  { test: /visual studio code/i, app: "VS Code", kind: "code" },
  { test: /cursor/i, app: "Cursor", kind: "code" },
  { test: /sublime text/i, app: "Sublime Text", kind: "code" },
  { test: /notepad\+\+/i, app: "Notepad++", kind: "code" },
  { test: /webstorm|intellij|pycharm|goland|rider/i, app: "JetBrains IDE", kind: "code" },
  { test: /windows terminal/i, app: "Windows Terminal", kind: "terminal" },
  { test: /powershell/i, app: "PowerShell", kind: "terminal" },
  { test: /command prompt|cmd\.exe/i, app: "Command Prompt", kind: "terminal" },
  { test: /git bash|mintty/i, app: "Git Bash", kind: "terminal" },
  { test: /slack/i, app: "Slack", kind: "chat" },
  { test: /discord/i, app: "Discord", kind: "chat" },
  { test: /whatsapp/i, app: "WhatsApp", kind: "chat" },
  { test: /microsoft teams|zoom|webex/i, app: "Meeting", kind: "chat" },
  { test: /outlook|thunderbird/i, app: "Mail", kind: "chat" },
  { test: /microsoft excel|google sheets/i, app: "Spreadsheet", kind: "sheet" },
  { test: /microsoft word|google docs/i, app: "Document", kind: "document" },
  { test: /microsoft powerpoint|google slides/i, app: "Slides", kind: "document" },
  { test: /notion|obsidian|evernote/i, app: "Notes", kind: "document" },
  { test: /spotify|vlc|netflix|youtube/i, app: "Media", kind: "media" },
  { test: /figma|photoshop|illustrator|blender/i, app: "Design", kind: "design" },
  { test: /file explorer/i, app: "File Explorer", kind: "unknown" },
  { test: /notepad/i, app: "Notepad", kind: "document" },
];

/** Browsers append their own name to every tab title; strip it before parsing. */
const BROWSER_SUFFIX =
  /\s*[-—|]\s*(google chrome|microsoft.?edge|brave|mozilla firefox|opera)(\s*\(.*\))?\s*$/i;

/** "… and 3 more pages - Google Chrome" */
const MORE_PAGES = /\s+and\s+\d+\s+more\s+pages?/i;

const SEPARATOR = /\s+[-—|]\s+/;

function clean(raw: string): string {
  return String(raw ?? "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Read a window title the way a person would.
 *
 * Windows titles are `"document — application"`, but both halves are optional
 * and every app invents its own separator. Rather than pretend otherwise, this
 * returns the best available reading and an `unknown` kind when the title says
 * nothing useful (a lone "Untitled", a blank window).
 */
export function parseWindowTitle(raw: string): WindowIdentity {
  const title = clean(raw);
  const dirty = /^\*\s*/.test(title);
  const body = title.replace(/^\*\s*/, "").replace(BROWSER_SUFFIX, "").replace(MORE_PAGES, "").trim();

  const rule = APP_RULES.find((r) => r.test.test(title));
  const kind: DevourKind = rule?.kind ?? "unknown";

  // Application name: the rule's canonical name, or the last segment of the
  // title (that is where Windows puts it almost everywhere).
  const segments = body.split(SEPARATOR).map((s) => s.trim()).filter(Boolean);
  const app = rule?.app ?? (segments.length > 1 ? segments[segments.length - 1] : segments[0] ?? "");

  // Document: browsers hold the page title in the first segment; editors use
  // the file name; anything unrecognised keeps all but the app segment.
  let document = "";
  if (kind === "browser") {
    // The browser's own suffix is already stripped, so what remains IS the
    // page — keeping it whole is right even when it contains " - ".
    document = body;
  } else if (segments.length > 1) {
    document = segments[0];
  } else if (kind === "unknown") {
    document = body;
  }
  // A window titled only "Windows PowerShell" has no document at all; echoing
  // the app name back as one would put noise on the card.

  // A document that is just the app name again is noise.
  if (document.toLowerCase() === app.toLowerCase()) document = "";

  return {
    raw: title,
    app: app || "Unknown window",
    document,
    kind,
    dirty,
  };
}

const SUGGESTIONS: Record<DevourKind, string[]> = {
  code: ["Find the bug on screen", "Explain this file", "What changed here?"],
  browser: ["Summarize this page", "Pull the key numbers", "What am I looking at?"],
  terminal: ["Explain this error", "What just failed?", "Give me the fix"],
  chat: ["Draft a reply", "What's the ask here?", "Summarize this thread"],
  document: ["Summarize this doc", "Find the action items", "Tighten the intro"],
  sheet: ["Explain these numbers", "What looks wrong?", "Chart this"],
  media: ["What am I watching?", "Summarize so far", "Worth my time?"],
  design: ["Critique this design", "Name the issues", "Suggest a better layout"],
  unknown: ["What is this?", "Summarize this window", "What should I do next?"],
};

/** Three tappable follow-ups, chosen for what the window actually is. */
export function devourSuggestions(id: WindowIdentity): string[] {
  return SUGGESTIONS[id.kind] ?? SUGGESTIONS.unknown;
}

/**
 * The instruction the orb hands to the real assistant after a swallow.
 *
 * Deliberately short and declarative: the pipeline already has the frame (the
 * orb attaches it as the current screenshot), so this only has to say what it
 * is looking at and what shape of answer is wanted.
 */
export function buildDevourPrompt(
  id: WindowIdentity,
  opts: { blank?: boolean; question?: string } = {}
): string {
  const lines = [
    `[WINDOW DEVOURED] "${id.raw}"`,
    `App: ${id.app}`,
    id.document ? `Open: ${id.document}` : "",
    `Kind: ${id.kind}`,
    id.dirty ? "State: unsaved changes visible in the title bar" : "",
    opts.blank ? "Capture: the frame came back blank (protected or hardware window)" : "Capture: live frame attached",
  ].filter(Boolean);

  const ask = opts.question?.trim()
    ? `Question: ${opts.question.trim()}`
    : `Tell me what this window is and the single most useful next action. Max 3 short sentences, then one action line.`;

  return `${lines.join("\n")}\n\n${ask}`;
}

/** One-line label for the devour card while the orb holds a window. */
export function devourLabel(id: WindowIdentity): string {
  if (id.document && id.document !== id.app) return id.document;
  return id.app;
}
