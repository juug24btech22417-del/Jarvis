// Telegram OS-bridge — translates natural-language OS commands into
// shape that /api/os/command understands, and handles the
// destructive-action confirmation flow for shutdown/restart.
//
// Allowlist is hard-coded (not from env) so a misconfigured env can't
// escalate privileges. Destructive actions write a `PendingOsAction` row
// (5-minute TTL) and surface an inline-keyboard confirmation; the
// callback_query handler in the poller resolves them.

import { prisma } from "@/lib/db/queries";
import type { InlineKeyboardButton } from "./index";

const API_BASE = process.env.INTERNAL_API_URL || "http://localhost:3000";

// Mirror of /api/os/command's accepted command set. If a new command
// is added there, it must be added here too — and the parseOsCommand
// regex set must know how to surface it.
export const OS_ALLOWLIST = new Set([
  "open_url",
  "open_app",
  "open_path",
  "web_search",
  "volume_up",
  "volume_down",
  "mute",
  "volume_set",
  "brightness_up",
  "brightness_down",
  "brightness_set",
  "screenshot",
  "lock",
  "sleep",
  "shutdown",
  "cancel_shutdown",
  "restart",
  "wake_screen",
  "play_sound",
  "kill_app",
]);

export const OS_DESTRUCTIVE = new Set(["shutdown", "restart"]);

export const DESTRUCTIVE_CONFIRM_TTL_MS = 5 * 60 * 1000;

export interface ParsedOsCommand {
  command: string;
  params?: Record<string, unknown>;
  destructive: boolean;
  raw: string;
}

// ─── Natural-language → ParsedOsCommand ───────────────────────────────────
// Lightweight regex-driven parser. Common patterns only; messy cases
// fall through to the LLM intent route (handled by handleInbound).

export function parseOsCommand(text: string): ParsedOsCommand | null {
  const t = text.trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  // lock
  if (/^(lock|lock\s+(my\s+)?(laptop|computer|workstation|pc))$/i.test(t)) {
    return { command: "lock", destructive: false, raw: t };
  }
  // sleep
  if (/^sleep(\s+(my\s+)?(laptop|computer|pc))?$/i.test(t)) {
    return { command: "sleep", destructive: false, raw: t };
  }
  // shutdown / shut down
  if (/^(shut\s?down|power\s?off)$/i.test(lower)) {
    return {
      command: "shutdown",
      params: { delaySec: 30 },
      destructive: true,
      raw: t,
    };
  }
  // restart / reboot
  if (/^(restart|reboot)$/i.test(lower)) {
    return { command: "restart", destructive: true, raw: t };
  }
  // cancel shutdown
  if (/^(cancel(\s+the)?\s+(shutdown|power\s?off)|abort\s+shutdown)$/i.test(lower)) {
    return {
      command: "cancel_shutdown",
      destructive: false,
      raw: t,
    };
  }
  // screenshot
  if (/^(screenshot|take\s+(a\s+)?screenshot|shot|grab\s+screen)$/i.test(lower)) {
    return { command: "screenshot", destructive: false, raw: t };
  }
  // wake / wake up screen
  if (/^(wake(\s+(up|screen))?|wake\s+my\s+screen|bring\s+(up|the)\s+screen)$/i.test(lower)) {
    return { command: "wake_screen", destructive: false, raw: t };
  }
  // play sound / beep
  if (/^(beep|play\s+sound|play\s+a\s+sound|chime)$/i.test(lower)) {
    return { command: "play_sound", destructive: false, raw: t };
  }

  // volume up/down/mute — expanded NL patterns
  if (/^(volume\s+up|vol\s+up|louder|increase\s+(the\s+)?volume|raise\s+(the\s+)?volume|turn\s+up\s+(the\s+)?volume|boost\s+(the\s+)?volume|volume\s+badhao|volume\s+tez\s+karo)$/i.test(lower)) {
    return { command: "volume_up", destructive: false, raw: t };
  }
  if (/^(volume\s+down|vol\s+down|quieter|softer|decrease\s+(the\s+)?volume|lower\s+(the\s+)?volume|turn\s+down\s+(the\s+)?volume|reduce\s+(the\s+)?volume|volume\s+kam\s+karo)$/i.test(lower)) {
    return { command: "volume_down", destructive: false, raw: t };
  }
  if (/^(mute|unmute|toggle\s+mute|silence)$/i.test(lower)) {
    return { command: "mute", destructive: false, raw: t };
  }

  // set volume to N / volume N / vol N
  const setVol = lower.match(
    /^(?:set\s+)?(?:volume|vol)\s+(?:to\s+)?(\d{1,3})\s*(?:%|percent)?$/
  );
  if (setVol) {
    const level = Math.max(0, Math.min(100, parseInt(setVol[1], 10)));
    return {
      command: "volume_set",
      params: { level },
      destructive: false,
      raw: t,
    };
  }

  // ─── Brightness controls ─────────────────────────────────────────────────
  if (/^(brightness\s+up|increase\s+(the\s+)?brightness|raise\s+(the\s+)?brightness|turn\s+up\s+(the\s+)?brightness|screen\s+brighter|brighter|brighten\s+(the\s+|my\s+)?(screen|display)?)$/i.test(lower)) {
    return { command: "brightness_up", destructive: false, raw: t };
  }
  if (/^(brightness\s+down|decrease\s+(the\s+)?brightness|lower\s+(the\s+)?brightness|turn\s+down\s+(the\s+)?brightness|dim\s+(the\s+|my\s+)?(screen|display)?|screen\s+dimmer|dimmer)$/i.test(lower)) {
    return { command: "brightness_down", destructive: false, raw: t };
  }

  // set brightness to N%
  const setBright = lower.match(
    /^(?:set\s+)?(?:brightness|bright|screen\s+brightness)\s+(?:to\s+)?(\d{1,3})\s*(?:%|percent)?$/
  );
  if (setBright) {
    const level = Math.max(0, Math.min(100, parseInt(setBright[1], 10)));
    return {
      command: "brightness_set",
      params: { level },
      destructive: false,
      raw: t,
    };
  }

  // open app: "open spotify"
  const openApp = lower.match(/^(?:launch|start|open)\s+(.+)$/i);
  if (openApp) {
    const target = openApp[1].trim();
    // URL?
    if (/^https?:\/\//i.test(target)) {
      return {
        command: "open_url",
        params: { url: target },
        destructive: false,
        raw: t,
      };
    }
    // path?
    if (/^[a-zA-Z]:[\\/]/.test(target) || /^\\\\/.test(target)) {
      return {
        command: "open_path",
        params: { url: target },
        destructive: false,
        raw: t,
      };
    }
    return {
      command: "open_app",
      params: { app: target },
      destructive: false,
      raw: t,
    };
  }

  // search for QUERY / google QUERY
  const search = lower.match(/^(?:search(\s+(?:the\s+web|for))?|google|look\s+up)\s+(.+)$/i);
  if (search) {
    return {
      command: "web_search",
      params: { query: search[2].trim() },
      destructive: false,
      raw: t,
    };
  }

  // kill APP / close APP
  const kill = lower.match(/^(?:kill|force\s+kill|close|terminate)\s+(.+)$/i);
  if (kill) {
    return {
      command: "kill_app",
      params: { app: kill[1].trim() },
      destructive: false,
      raw: t,
    };
  }

  return null;
}

// ─── Direct execution (non-destructive) ────────────────────────────────────

export async function executeOsCommand(
  command: string,
  params: Record<string, unknown> = {}
): Promise<{ ok: boolean; description?: string; error?: string; filePath?: string }> {
  if (!OS_ALLOWLIST.has(command)) {
    return { ok: false, error: `command not allowed: ${command}` };
  }
  try {
    const res = await fetch(`${API_BASE}/api/os/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, ...params }),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.success === false) {
      return {
        ok: false,
        error: data?.error ?? data?.description ?? `HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      description: data.description ?? "Done.",
      filePath: typeof data.filePath === "string" ? data.filePath : undefined,
      error: data.error,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ─── Destructive-action confirm flow ───────────────────────────────────────

type PendingOsActionModel = {
  create: (args: { data: Record<string, unknown> }) => Promise<any>;
  findFirst: (args: Record<string, unknown>) => Promise<any>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<any>;
};

const po = (): PendingOsActionModel =>
  (prisma as unknown as { pendingOsAction: PendingOsActionModel }).pendingOsAction;

export async function createDestructivePending(
  chatId: number,
  action: string,
  params: Record<string, unknown>
): Promise<{ id: string; shortId: string }> {
  if (!OS_DESTRUCTIVE.has(action)) {
    throw new Error(`Not a destructive action: ${action}`);
  }
  const row = await po().create({
    data: {
      chatId: BigInt(chatId),
      action,
      params: JSON.stringify(params ?? {}),
      status: "pending",
      expiresAt: new Date(Date.now() + DESTRUCTIVE_CONFIRM_TTL_MS),
    },
  });
  return { id: row.id, shortId: row.id.slice(0, 8) };
}

export function destructiveConfirmButtons(
  shortId: string
): InlineKeyboardButton[][] {
  return [
    [
      { text: "Yes, do it", callback_data: `os:confirm:${shortId}` },
      { text: "Cancel", callback_data: `os:cancel:${shortId}` },
    ],
  ];
}

export async function resolveDestructiveCallback(
  chatId: number,
  action: "confirm" | "cancel",
  shortId: string
): Promise<{
  ok: boolean;
  description?: string;
  error?: string;
  expired?: boolean;
  notFound?: boolean;
}> {
  const pending = await po().findFirst({
    where: {
      chatId: BigInt(chatId),
      status: "pending",
      expiresAt: { gt: new Date() },
      id: { startsWith: shortId },
    },
  });
  if (!pending) {
    // Look at any row regardless of status to differentiate "expired" from
    // "never existed".
    const stale = await po().findFirst({
      where: {
        chatId: BigInt(chatId),
        id: { startsWith: shortId },
      },
    });
    if (!stale) return { ok: false, notFound: true };
    return { ok: false, expired: true };
  }
  if (action === "cancel") {
    await po().update({
      where: { id: pending.id },
      data: { status: "cancelled" },
    });
    return { ok: true, description: "Cancelled." };
  }
  // Confirm — execute, then update status.
  let params: Record<string, unknown> = {};
  try {
    params = pending.params ? JSON.parse(pending.params) : {};
  } catch {
    params = {};
  }
  const result = await executeOsCommand(pending.action, params);
  await po().update({
    where: { id: pending.id },
    data: { status: "confirmed" },
  });
  return result;
}
