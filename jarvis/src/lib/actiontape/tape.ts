// ACTION TAPE — reversible outbound actions with time-travel undo.
//
// Every side-effecting action JARVIS performs (file move, write, send,
// clipboard overwrite, browser navigation) is recorded here as a tape entry
// carrying enough payload to undo it. "Undo what I did 10 minutes ago" then
// becomes: parse the time window, walk the tape newest-first, and reverse
// each reversible entry until hitting an irreversible one or the window edge.
//
// Pure module — no fs, no prisma, no network. Persistence and execution live
// in the API routes; this file is the brain (and is unit-tested directly).

export type TapeActionKind =
  | "file_move"
  | "file_write"
  | "file_create"
  | "file_delete"
  | "dir_create"
  | "clipboard_set"
  | "email_send"
  | "message_send"
  | "browser_navigate"
  | "shell"
  | "generic";

export type TapeStatus = "applied" | "undone" | "undo_failed" | "skipped";

/** One recorded action. `undo` is null when the action cannot be reversed. */
export interface TapeEntry {
  id: string;
  kind: TapeActionKind;
  /** Human label shown on the tape, e.g. "Moved report.pdf into Archive/". */
  label: string;
  /** Primary target (path, URL, recipient) — for display and lookup. */
  target?: string;
  /** Executor id + payload needed to reverse this entry. */
  undo?: { executor: UndoExecutorId; payload: Record<string, unknown> };
  status: TapeStatus;
  /** "assistant" | "user" | "agent" | "telegram" — who triggered it. */
  source: string;
  /** Epoch ms when the action was applied. */
  at: number;
  /** Epoch ms when the undo ran (if it did). */
  undoneAt?: number;
  meta?: Record<string, unknown>;
}

export type UndoExecutorId =
  | "fs_move_back"
  | "fs_restore_backup"
  | "fs_remove_created"
  | "clipboard_restore"
  | "noop";

// ─── Undo-request parsing ──────────────────────────────────────────────
// "undo what I did 10 minutes ago" / "undo the last 3 actions" / "undo that"

export interface UndoRequest {
  /** Restrict undo to entries newer than now - sinceMinutes. */
  sinceMinutes?: number;
  /** Restrict undo to at most N entries (newest first). */
  count?: number;
  /** Undo only the single most recent action (default when nothing given). */
  onlyLatest: boolean;
}

const WINDOW_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => number]> = [
  // "10 minutes ago", "5 min ago", "2 hours ago", "1 minute ago"
  [/(\d+)\s*(?:m|min|mins|minute|minutes)\s*(?:ago)?/i, (m) => parseInt(m[1], 10)],
  [/(\d+)\s*(?:h|hr|hrs|hour|hours)\s*(?:ago)?/i, (m) => parseInt(m[1], 10) * 60],
  [/(\d+)\s*(?:s|sec|secs|second|seconds)\s*(?:ago)?/i, (m) => Math.max(1, Math.round(parseInt(m[1], 10) / 60))],
  [/(\d+)\s*(?:d|day|days)\s*(?:ago)?/i, (m) => parseInt(m[1], 10) * 1440],
];

/**
 * Parse a natural-language undo command. Returns null when the text is not
 * an undo request at all (so callers can route it to the normal chat path).
 */
export function parseUndoRequest(text: string): UndoRequest | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  // Must contain an undo/rewind signal.
  if (!/\b(undo|revert|roll back|rewind|take back|unsend|un-do)\b/.test(t)) return null;

  const req: UndoRequest = { onlyLatest: true };

  // "undo the last 3 actions" / "undo my last 2"
  const countMatch = t.match(/\b(?:last|past)\s+(\d+)\b/);
  if (countMatch) {
    req.count = Math.max(1, parseInt(countMatch[1], 10));
    req.onlyLatest = false;
  }

  for (const [re, toMinutes] of WINDOW_PATTERNS) {
    const m = t.match(re);
    if (m) {
      req.sinceMinutes = toMinutes(m);
      req.onlyLatest = false;
      break;
    }
  }

  // "undo everything from this session" → no window, full tape
  if (/\b(everything|all)\b/.test(t)) {
    req.sinceMinutes = undefined;
    req.onlyLatest = false;
    req.count = undefined;
  }

  return req;
}

// ─── Undo planning ─────────────────────────────────────────────────────

export interface UndoPlanStep {
  entry: TapeEntry;
  /** Lower runs first. Normally reverse chronological (newest undone first). */
  order: number;
}

export interface UndoPlan {
  steps: UndoPlanStep[];
  /** Entries the plan refuses to touch, with reasons (for the HUD). */
  skipped: Array<{ entry: TapeEntry; reason: string }>;
}

/**
 * Build the undo plan for a request: newest-first within the time window,
 * stopping at anything already undone, and flagging irreversible entries.
 *
 * The tape is expected newest-last (insertion order); this function does not
 * assume it is sorted.
 */
export function buildUndoPlan(entries: TapeEntry[], req: UndoRequest, now = Date.now()): UndoPlan {
  const windowStart = req.sinceMinutes !== undefined ? now - req.sinceMinutes * 60_000 : undefined;

  const sorted = [...entries].sort((a, b) => b.at - a.at);
  const steps: UndoPlanStep[] = [];
  const skipped: Array<{ entry: TapeEntry; reason: string }> = [];

  for (const entry of sorted) {
    if (windowStart !== undefined && entry.at < windowStart) continue;
    if (entry.status === "undone") {
      skipped.push({ entry, reason: "already undone" });
      continue;
    }
    if (entry.status === "undo_failed") continue;
    if (!entry.undo) {
      // Irreversible barrier: record it but keep scanning older entries only
      // when a time window was requested (user asked for a range, not a chain).
      skipped.push({ entry, reason: "no undo payload — irreversible" });
      if (req.onlyLatest) break;
      continue;
    }
    steps.push({ entry, order: steps.length });
    if (req.onlyLatest) break;
    if (req.count !== undefined && steps.length >= req.count) break;
  }

  return { steps, skipped };
}

/** One-line spoken summary of what the tape is about to reverse. */
export function describeUndoPlan(plan: UndoPlan): string {
  if (plan.steps.length === 0) return "Nothing on the tape is reversible right now, Boss.";
  const labels = plan.steps.slice(0, 3).map((s) => s.entry.label);
  const more = plan.steps.length > 3 ? ` and ${plan.steps.length - 3} more` : "";
  return `Reversing ${plan.steps.length} action${plan.steps.length === 1 ? "" : "s"}: ${labels.join("; ")}${more}.`;
}

// ─── Tape helpers ──────────────────────────────────────────────────────

/** Enforce the tape cap (oldest dropped first). */
export function pruneTape<T extends { at: number }>(entries: T[], max = 500): T[] {
  if (entries.length <= max) return entries;
  return [...entries].sort((a, b) => b.at - a.at).slice(0, max).sort((a, b) => a.at - b.at);
}

/** Recent-action context line for the ambient agent ("last thing done"). */
export function recentActivityLine(entries: TapeEntry[], max = 5): string {
  return [...entries]
    .sort((a, b) => b.at - a.at)
    .slice(0, max)
    .map((e) => `- ${e.label} (${new Date(e.at).toLocaleTimeString()})`)
    .join("\n");
}
