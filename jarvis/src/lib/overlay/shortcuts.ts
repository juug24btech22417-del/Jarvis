// One table for the overlay's commands, used by:
//
//   • the page        — to match in-window key presses (resolveCommand)
//   • the help panel  — to RENDER itself (no second list to drift out of date)
//   • the Electron shell — which registers the same accelerators globally so
//     they work while the call app has focus (overlay/main.js mirrors these ids
//     and shell accelerators; the ids are the contract between the two).
//
// Anything added here must also be registered in overlay/main.js — the test in
// tests/overlayCommands.test.ts reads that file and fails if the two lists
// disagree.

export type CommandId =
  | "toggle-listen"
  | "toggle-mute"
  | "focus-ask"
  | "ask-now"
  | "repeat"
  | "summarize"
  | "expand"
  | "cycle-density"
  | "clear-all"
  | "toggle-privacy"
  | "toggle-context"
  | "help"
  | "hide"
  | "close";

export interface ShortcutSpec {
  id: CommandId;
  /** What it does, in the imperative. */
  label: string;
  /** Why/when you would press it — the part that makes a shortcut usable. */
  detail: string;
  /** Electron global accelerator (works from any app). */
  shell: string | null;
  /** In-window fallback, shown to the user. */
  inPage: string | null;
}

export const SHORTCUTS: ShortcutSpec[] = [
  {
    id: "focus-ask",
    label: "Focus the ask box",
    detail: "Summons and focuses the overlay from inside another app — the caret is already in the box.",
    shell: "Ctrl+Shift+Space",
    inPage: "Ctrl+Enter",
  },
  {
    id: "hide",
    label: "Hide / show the overlay",
    detail: "The quiet exit during a call: the HUD disappears, the session keeps running.",
    shell: "Ctrl+Shift+H",
    inPage: "Esc",
  },
  {
    id: "toggle-listen",
    label: "Start / stop listening",
    detail: "Opens the ears (system audio + mic) or closes them and stops uploading audio.",
    shell: "Ctrl+Shift+L",
    inPage: "Alt+L",
  },
  {
    id: "toggle-mute",
    label: "Mute the ears",
    detail: "One key: nothing is captured while muted, but the session and context stay alive.",
    shell: "Ctrl+Shift+M",
    inPage: "Alt+M",
  },
  {
    id: "ask-now",
    label: "Answer now",
    detail: "Answers the strongest pending question immediately, without waiting for the next round.",
    shell: "Ctrl+Shift+A",
    inPage: "Alt+A",
  },
  {
    id: "repeat",
    label: "Repeat the last answer",
    detail: "Re-answers the last question shorter — for when the first answer went by too fast to read.",
    shell: "Ctrl+Shift+R",
    inPage: "Alt+R",
  },
  {
    id: "expand",
    label: "Go deeper",
    detail: "Expands the current answer into the long version with reasoning and an example.",
    shell: "Ctrl+Shift+E",
    inPage: "Alt+E",
  },
  {
    id: "summarize",
    label: "Summarise the conversation",
    detail: "What has been decided, who owns what, what is still open, key numbers and names.",
    shell: "Ctrl+Shift+S",
    inPage: "Alt+S",
  },
  {
    id: "cycle-density",
    label: "Change answer length",
    detail: "One line → brief → deep. The mode picks a sensible starting length.",
    shell: "Ctrl+Shift+D",
    inPage: "Alt+D",
  },
  {
    id: "toggle-privacy",
    label: "Privacy panel",
    detail: "Shows exactly what is being captured right now, and the mute / clear-history controls.",
    shell: "Ctrl+Shift+P",
    inPage: "Alt+P",
  },
  {
    id: "toggle-context",
    label: "Attached context",
    detail: "Show or hide the notes box (CV, job description, the brief) that rides with every question.",
    shell: "Ctrl+Shift+C",
    inPage: "Alt+C",
  },
  {
    id: "clear-all",
    label: "Clear context & history",
    detail: "Wipes the transcript, the answers, the facts and the summary — a genuinely new conversation.",
    shell: "Ctrl+Shift+X",
    inPage: "Alt+X",
  },
  {
    id: "help",
    label: "This list",
    detail: "Every shortcut, including the ones the shell owns.",
    shell: "Ctrl+Shift+K",
    inPage: "Alt+K",
  },
  {
    id: "close",
    label: "Close the overlay",
    detail: "Quits the overlay window. Ctrl+Shift+H hides it instead — hiding is usually what you want.",
    shell: null,
    inPage: "✕ button",
  },
];

export const SHORTCUT_BY_ID: Partial<Record<CommandId, ShortcutSpec>> = SHORTCUTS.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Partial<Record<CommandId, ShortcutSpec>>
);

/** In-window key → command. Alt is used deliberately: plain letters belong to
 * "type to ask", and Ctrl/Cmd+letter collides with the browser and the OS. */
export function resolveCommand(e: {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}): CommandId | null {
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    switch (e.key.toLowerCase()) {
      case "l":
        return "toggle-listen";
      case "m":
        return "toggle-mute";
      case "a":
        return "ask-now";
      case "r":
        return "repeat";
      case "e":
        return "expand";
      case "s":
        return "summarize";
      case "d":
        return "cycle-density";
      case "p":
        return "toggle-privacy";
      case "c":
        return "toggle-context";
      case "x":
        return "clear-all";
      case "k":
        return "help";
      default:
        return null;
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") return "focus-ask";
  if (e.key === "Escape") return "hide";
  return null;
}

/** Modes are picked with Alt+1..7 — one key, no menu. */
export function modeForDigit(e: { key: string; altKey?: boolean }): number | null {
  if (!e.altKey) return null;
  const n = Number(e.key);
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n - 1 : null;
}
