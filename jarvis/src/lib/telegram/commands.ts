// Telegram bot-command router.
//
// Parses slash-commands out of inbound messages and returns a
// `ReplyPlan` describing how to handle them. Non-command text is
// returned as `kind: "chat"` so the dispatcher can fall through to
// the LLM chain. Natural-language OS commands ("lock my laptop")
// short-circuit to the OS bridge before the LLM is consulted.
//
// ReplyPlan is intentionally data, not side effects — the dispatch
// code in `handleInbound.ts` is the single side-effect boundary.

import type { InlineKeyboardButton, ReplyOpts } from "./index";
import { parseOsCommand } from "./osBridge";
import {
  createReminder,
  cancelReminder,
  listPendingForChat,
} from "./reminders";
import { getUserLocation } from "./location";
import { prisma } from "@/lib/db/queries";

export type ReplyKind =
  | "chat"               // not a recognized command; route to /api/chat
  | "reply"              // send a static text reply, no LLM
  | "execute_os"         // call /api/os/command directly
  | "confirm_destructive" // create PendingOsAction + send confirm buttons
  | "create_reminder"
  | "cancel_reminder"
  | "list_reminders"
  | "location_whereami"
  | "brief"
  | "clip"
  | "tasks_list"
  | "tasks_add"
  | "tasks_done"
  | "whoami"
  | "help"
  | "start"
  | "research";         // deep-research via OracleResearchService

export interface ReplyPlan {
  kind: ReplyKind;
  /** Final user-visible reply text (when kind is "reply"). */
  text?: string;
  /** Reply opts for `reply`/`confirm_destructive` kinds. */
  opts?: ReplyOpts;
  /** The structured args for OS / reminder / task operations. */
  payload?: Record<string, unknown>;
}

// ─── Top-level router ──────────────────────────────────────────────────────

export async function routeCommand(
  chatId: number,
  text: string,
  meta?: { fromCallback?: boolean }
): Promise<ReplyPlan> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "chat" };

  // Slash-commands (skip natural-language matching).
  if (trimmed.startsWith("/")) {
    return routeSlash(chatId, trimmed);
  }

  // Natural-language OS commands. Short-circuit before LLM.
  const osCmd = parseOsCommand(trimmed);
  if (osCmd) {
    if (osCmd.destructive) {
      return {
        kind: "confirm_destructive",
        payload: {
          action: osCmd.command,
          params: osCmd.params ?? {},
        },
      };
    }
    return {
      kind: "execute_os",
      payload: { command: osCmd.command, params: osCmd.params ?? {} },
    };
  }

  // Callback-query payloads — only treat known prefixes as commands,
  // fall through to LLM otherwise.
  if (meta?.fromCallback) return { kind: "chat" };

  // Natural-language research intent — intercept before the LLM.
  const researchQuery = detectResearchIntent(trimmed);
  if (researchQuery) {
    return {
      kind: "research",
      payload: { query: researchQuery },
    };
  }

  // Otherwise let the LLM handle it.
  return { kind: "chat" };
}

// ─── Research intent detector ───────────────────────────────────────────────
// Matches queries that are clearly asking Jarvis to research/compare/find
// something on the web. Returns the cleaned query string, or null if no
// research intent is detected. Keep patterns specific enough to avoid
// swallowing short conversational messages.

function detectResearchIntent(text: string): string | null {
  const t = text.trim();
  if (t.length < 15) return null; // Too short to be a real research query.

  const lower = t.toLowerCase();

  // Explicit research triggers
  const explicitPrefixes = [
    /^research\s+(.+)$/i,
    /^find\s+(?:me\s+)?the\s+best\s+(.+)$/i,
    /^what(?:'s|\s+is)\s+the\s+best\s+(.+?)(?:\s+to\s+buy|\s+in\s+india|\s+under\s+[\d,]+(?:rs|inr|₹|k)?)?\s*$/i,
    /^compare\s+(.+)\s+(?:and|vs\.?|versus)\s+(.+)$/i,
    /^which\s+is\s+better[,:]?\s+(.+)$/i,
    /^give\s+me\s+a\s+(?:report|summary|analysis|breakdown|comparison)\s+(?:on|of|about)\s+(.+)$/i,
    /^(?:deep\s+)?dive\s+into\s+(.+)$/i,
    /^analyse?\s+(?:the\s+market\s+for|the\s+best|all)\s+(.+)$/i,
    /^look\s+into\s+(.+)\s+and\s+(?:report|summarize|tell\s+me)$/i,
  ];

  for (const rx of explicitPrefixes) {
    const m = t.match(rx);
    if (m) return t; // Return the full original query — Oracle handles parsing.
  }

  // Implicit research signals — longer sentences mentioning web-knowledge tasks.
  const hasResearchSignal =
    lower.includes("best laptop") ||
    lower.includes("best phone") ||
    lower.includes("best monitor") ||
    lower.includes("best headphone") ||
    lower.includes("best tv") ||
    lower.includes("pros and cons") ||
    lower.includes("vs ") ||
    lower.includes(" versus ") ||
    (lower.includes("under ") && /under\s+[\d,]+(?:rs|inr|₹|k)/i.test(lower)) ||
    (lower.includes("top ") && /top\s+\d+\s+/i.test(lower));

  if (hasResearchSignal && t.length > 25) return t;

  return null;
}

// ─── Slash command parser ──────────────────────────────────────────────────

async function routeSlash(chatId: number, text: string): Promise<ReplyPlan> {
  const firstSpace = text.indexOf(" ");
  const cmd = (firstSpace === -1 ? text.slice(1) : text.slice(1, firstSpace)).toLowerCase();
  const args = firstSpace === -1 ? "" : text.slice(firstSpace + 1).trim();

  switch (cmd) {
    case "start":
      return {
        kind: "reply",
        text:
          "Hi, Boss. I'm Jarvis on your phone now.\n\n" +
          "Send me anything — text, voice, a photo, a PDF, your location.\n" +
          "Type /help for the command list.",
      };

    case "help":
    case "commands":
      return {
        kind: "reply",
        text: HELP_TEXT,
      };

    case "whoami":
      return {
        kind: "reply",
        text: `Your chat_id is ${chatId}, Boss.`,
      };

    case "brief":
      return { kind: "brief" };

    case "clip":
      return { kind: "clip" };

    case "whereami":
    case "loc":
      return { kind: "location_whereami" };

    case "remind":
    case "remindme":
      return await handleRemind(chatId, args);

    case "reminders":
      return { kind: "list_reminders" };

    case "cancel":
      return await handleCancel(chatId, args);

    case "tasks":
    case "todo":
      return { kind: "tasks_list" };

    case "task":
    case "todo":
      return { kind: "tasks_add", payload: { title: args } };

    case "done":
      return { kind: "tasks_done", payload: { id: args } };

    case "research": {
      if (!args) {
        return {
          kind: "reply",
          text: "Usage: /research <your query>\n\nExample: /research best laptop under 80000 rs",
        };
      }
      return { kind: "research", payload: { query: args } };
    }

    case "lock":
    case "sleep":
    case "screenshot":
    case "shot":
      return { kind: "execute_os", payload: { command: cmd, params: {} } };

    case "wake":
      // wake = wake_screen + play_sound in one reply.
      return {
        kind: "execute_os",
        payload: {
          command: "wake_screen",
          params: {},
        },
      };

    case "shutdown":
    case "restart":
    case "reboot":
      const action = cmd === "restart" || cmd === "reboot" ? "restart" : "shutdown";
      return {
        kind: "confirm_destructive",
        payload: {
          action,
          params: { delaySec: 30 },
        },
      };

    case "cancel_shutdown":
      return {
        kind: "execute_os",
        payload: { command: "cancel_shutdown", params: {} },
      };

    case "vol":
    case "volume":
      return handleVolume(args);

    case "brightness":
    case "bright":
    case "dim":
      return handleBrightness(args);

    case "open":
    case "launch":
      return handleOpen(args);

    case "search":
    case "google":
      return {
        kind: "execute_os",
        payload: {
          command: "web_search",
          params: { query: args },
        },
      };

    case "kill":
      return {
        kind: "execute_os",
        payload: {
          command: "kill_app",
          params: { app: args },
        },
      };

    default:
      // Unknown slash command — fall through to LLM, which can decide.
      return { kind: "chat" };
  }
}

// ─── Slash command handlers ────────────────────────────────────────────────

function handleVolume(args: string): ReplyPlan {
  const lower = args.toLowerCase().trim();
  if (!lower) return { kind: "reply", text: "Usage: /vol <level 0-100 | up | down | mute>" };
  if (lower === "up") return { kind: "execute_os", payload: { command: "volume_up", params: {} } };
  if (lower === "down") return { kind: "execute_os", payload: { command: "volume_down", params: {} } };
  if (lower === "mute" || lower === "unmute")
    return { kind: "execute_os", payload: { command: "mute", params: {} } };
  const n = parseInt(lower, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 100) {
    return {
      kind: "execute_os",
      payload: { command: "volume_set", params: { level: n } },
    };
  }
  return { kind: "reply", text: "Usage: /vol <0-100 | up | down | mute>" };
}

function handleBrightness(args: string): ReplyPlan {
  const lower = args.toLowerCase().trim();
  if (!lower)
    return { kind: "reply", text: "Usage: /brightness <0-100 | up | down>" };
  if (lower === "up" || lower === "+")
    return { kind: "execute_os", payload: { command: "brightness_up", params: {} } };
  if (lower === "down" || lower === "-")
    return { kind: "execute_os", payload: { command: "brightness_down", params: {} } };
  const n = parseInt(lower, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 100) {
    return {
      kind: "execute_os",
      payload: { command: "brightness_set", params: { level: n } },
    };
  }
  return { kind: "reply", text: "Usage: /brightness <0-100 | up | down>" };
}

function handleOpen(args: string): ReplyPlan {
  if (!args) return { kind: "reply", text: "Usage: /open <app or url>" };
  if (/^https?:\/\//i.test(args)) {
    return {
      kind: "execute_os",
      payload: { command: "open_url", params: { url: args } },
    };
  }
  if (/^[a-zA-Z]:[\\/]/.test(args) || /^\\\\/.test(args)) {
    return {
      kind: "execute_os",
      payload: { command: "open_path", params: { url: args } },
    };
  }
  return {
    kind: "execute_os",
    payload: { command: "open_app", params: { app: args } },
  };
}

async function handleRemind(chatId: number, args: string): Promise<ReplyPlan> {
  if (!args) {
    return { kind: "reply", text: "Usage: /remind in 5 min <text>  or  /remind at 3pm <text>" };
  }

  // Split "when" from "text" — everything before the first standalone
  // word that's NOT a time-relative marker is the "when" prefix.
  const m = args.match(
    /^(in\s+\d+\s*(?:min|minute|minutes|mins|hr|hour|hours|hrs|h)|at\s+[\dh:apm\s]+|tomorrow(?:\s+at\s+\d+\s*(?:am|pm|h)?)?|tonight|morning|noon|afternoon|evening|tonight)(?:\s+(?:to\s+)?)?\s+(.+)$/i
  );

  let whenExpr = "";
  let body = args;
  if (m) {
    whenExpr = m[1];
    body = m[2];
  } else {
    // Try simpler pattern: leading "in N min/hr" + rest.
    const simple = args.match(/^(in\s+\d+\s*\w+)\s+(.+)$/i);
    if (simple) {
      whenExpr = simple[1];
      body = simple[2];
    } else {
      // No time keyword — default to "in 1 minute" so we always have a fire time.
      whenExpr = "in 1 minute";
      body = args;
    }
  }

  const fireAt = parseUserTimeWhen(whenExpr, new Date());
  if (!fireAt) {
    return { kind: "reply", text: `Couldn't parse "${whenExpr}". Try "in 5 min" or "at 3pm".` };
  }

  const row = await createReminder({
    chatId,
    fireAt,
    text: body,
    idempotencyKey: `${fireAt.toISOString()}|${body}`,
  });

  return {
    kind: "reply",
    text: `⏰ Reminder set for ${formatLocalTime(fireAt)}: ${body}\n(id: ${row.id.slice(0, 8)})`,
  };
}

async function handleCancel(chatId: number, args: string): Promise<ReplyPlan> {
  if (!args) return { kind: "reply", text: "Usage: /cancel <id>  (use /reminders to list)" };
  // Allow partial / short IDs.
  const ok = await cancelReminder(args, chatId);
  return {
    kind: "reply",
    text: ok ? `Reminder ${args} cancelled.` : `Couldn't cancel ${args} — not found or already dispatched.`,
  };
}

// ─── Time parsing (IST defaults) ───────────────────────────────────────────

/**
 * Parse a human-friendly "when" expression into an absolute Date.
 * Supports:
 *   - "in N min/minute/minutes/mins"
 *   - "in N hr/hour/hours/hrs/h"
 *   - "at 3pm", "at 15:00", "at 3:30 pm"
 *   - "tomorrow" (defaults to 9am)
 *   - "tomorrow at 3pm"
 *   - "tonight" (defaults to 8pm)
 *   - "morning"/"noon"/"afternoon"/"evening" (defaults)
 *
 * Assumes IST for absolute times because the laptop is in IST and the
 * user speaks IST; "at 3pm" = 3pm IST, not 3pm UTC.
 */
export function parseUserTimeWhen(expr: string, now: Date): Date | null {
  const lower = expr.toLowerCase().trim();

  // Relative: "in N unit"
  const rel = lower.match(/^in\s+(\d+)\s*(min|minute|minutes|mins|m|hr|hour|hours|hrs|h)$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2].toLowerCase();
    const ms = unit.startsWith("m") ? n * 60_000 : n * 60 * 60_000;
    return new Date(now.getTime() + ms);
  }

  // "tomorrow [at N am/pm/h]"
  const tom = lower.match(/^tomorrow(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?)?$/i);
  if (tom) {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    if (tom[1]) {
      const hour = normalizeHour(parseInt(tom[1], 10), tom[3]?.toLowerCase());
      t.setHours(hour, tom[2] ? parseInt(tom[2], 10) : 0, 0, 0);
    } else {
      t.setHours(9, 0, 0, 0); // 9am tomorrow default
    }
    return t;
  }

  // "tonight" / "morning" / "noon" / "afternoon" / "evening"
  const named: Record<string, [number, number]> = {
    morning: [8, 0],
    noon: [12, 30],
    afternoon: [15, 0],
    evening: [18, 30],
    tonight: [20, 0],
  };
  if (named[lower]) {
    const [h, m] = named[lower];
    const t = new Date(now);
    t.setHours(h, m, 0, 0);
    if (t.getTime() <= now.getTime()) {
      // If the named slot is already past today, schedule for tomorrow.
      t.setDate(t.getDate() + 1);
    }
    return t;
  }

  // Absolute: "at 3pm" / "at 15:00" / "at 3:30 pm"
  const at = lower.match(/^at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|h)?$/i);
  if (at) {
    const hour = normalizeHour(parseInt(at[1], 10), at[3]?.toLowerCase());
    const minute = at[2] ? parseInt(at[2], 10) : 0;
    const t = new Date(now);
    t.setHours(hour, minute, 0, 0);
    if (t.getTime() <= now.getTime()) {
      // Past absolute time → tomorrow.
      t.setDate(t.getDate() + 1);
    }
    return t;
  }

  return null;
}

function normalizeHour(h: number, ampm?: string): number {
  if (!ampm || ampm === "h") return Math.min(23, h);
  if (ampm === "am") return h === 12 ? 0 : Math.min(11, h);
  if (ampm === "pm") return h === 12 ? 12 : Math.min(23, h + 12);
  return Math.min(23, h);
}

function formatLocalTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Public helpers used by handleInbound for ReplyPlan resolution ────────

/**
 * Read the user's pending reminders and return a chat-bubble-friendly
 * text. Used by `/reminders`.
 */
export async function formatRemindersList(chatId: number): Promise<string> {
  const rows = await listPendingForChat(chatId);
  if (rows.length === 0) {
    return "No pending reminders, Boss.";
  }
  return rows
    .map((r) => `• ${r.id.slice(0, 8)} — ${r.text} (at ${formatLocalTime(r.fireAt)})`)
    .join("\n");
}

/**
 * Build a friendly "where are you" reply from the latest location row.
 */
export async function formatWhereami(chatId: number): Promise<string> {
  const loc = await getUserLocation(chatId);
  if (!loc) {
    return "I don't have a location for you yet. Send a pin from the attachment menu, Boss.";
  }
  const map = `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`;
  return [
    `📍 Last known location (${loc.updatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}):`,
    `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`,
    map,
  ].join("\n");
}

// ─── Help text ─────────────────────────────────────────────────────────────

const HELP_TEXT =
  `*Jarvis Telegram commands*\n\n` +
  `*Research & Web*\n` +
  `/research <query> — deep web research + report\n` +
  `_Or just say:_ "find the best laptop under 80k" / "compare A vs B"\n\n` +
  `*Daily*\n` +
  `/brief — morning / evening briefing\n` +
  `/clip — laptop clipboard → here\n` +
  `/whereami — last shared location\n\n` +
  `*Reminders*\n` +
  `/remind in 5 min <text> — set a reminder\n` +
  `/reminders — list pending\n` +
  `/cancel <id> — cancel a reminder\n\n` +
  `*Laptop control*\n` +
  `/status · /lock · /sleep · /screenshot\n` +
  `/shutdown · /restart · /cancel_shutdown\n` +
  `/vol <0-100|up|down|mute> — or say "increase volume"\n` +
  `/brightness <0-100|up|down> — or say "dim the screen"\n` +
  `/open <app|url> · /kill <app> · /search <q>\n` +
  `/wake — wake screen + chime\n\n` +
  `*Tasks*\n` +
  `/tasks — list pending\n` +
  `/task <title> — add a task\n` +
  `/done <id> — mark done\n\n` +
  `*Other*\n` +
  `/whoami — show chat_id\n` +
  `/help — this list\n\n` +
  `_Anything else — just text, voice, a photo, a PDF, or a pin._`;