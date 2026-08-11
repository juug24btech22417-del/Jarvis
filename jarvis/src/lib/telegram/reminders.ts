// Telegram reminder scheduler.
//
// Stores pending reminders in the `Reminder` Prisma table and runs a
// 30-second cron loop to dispatch due ones to the user's chat. Quiet
// hours default to IST 23:00–07:00 and can be overridden per-reminder
// by storing different `quietStartMin` / `quietEndMin` columns.
//
// The loop is pinned to globalThis for the same Next.js HMR safety
// reasons as the poller.

import cron from "node-cron";
import { prisma } from "@/lib/db/queries";
import { sendReply } from "./index";

const LOOP_KEY = Symbol.for("jarvis.telegram.reminderLoop");
type GlobalWithReminderLoop = typeof globalThis & {
  [LOOP_KEY]?: { started: boolean };
};

const REMINDER_CRON = process.env.REMINDER_CRON ?? "*/30 * * * * *";

// ─── Prisma model wrappers ─────────────────────────────────────────────────

type ReminderModel = {
  create: (args: { data: Record<string, unknown> }) => Promise<any>;
  findMany: (args: Record<string, unknown>) => Promise<any>;
  findFirst: (args: Record<string, unknown>) => Promise<any>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<any>;
  updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<any>;
};

const rm = (): ReminderModel =>
  (prisma as unknown as { reminder: ReminderModel }).reminder;

// ─── Public API ────────────────────────────────────────────────────────────

export interface CreateReminderInput {
  chatId: number;
  fireAt: Date;
  text: string;
  idempotencyKey?: string;
  createdFromMsgId?: number | null;
  quietStartMin?: number;
  quietEndMin?: number;
}

export interface ReminderRow {
  id: string;
  chatId: number;
  fireAt: Date;
  text: string;
  status: string;
  quietStartMin: number;
  quietEndMin: number;
}

function toShape(row: any): ReminderRow {
  return {
    id: row.id,
    chatId:
      typeof row.chatId === "bigint" ? Number(row.chatId) : row.chatId,
    fireAt: row.fireAt,
    text: row.text,
    status: row.status,
    quietStartMin: row.quietStartMin ?? 1380,
    quietEndMin: row.quietEndMin ?? 420,
  };
}

export async function createReminder(
  input: CreateReminderInput
): Promise<ReminderRow> {
  const row = await rm().create({
    data: {
      chatId: BigInt(input.chatId),
      fireAt: input.fireAt,
      text: input.text,
      idempotencyKey: input.idempotencyKey ?? null,
      createdFromMsgId: input.createdFromMsgId
        ? BigInt(input.createdFromMsgId)
        : null,
      quietStartMin: input.quietStartMin ?? 1380,
      quietEndMin: input.quietEndMin ?? 420,
      status: "pending",
    },
  });
  return toShape(row);
}

export async function cancelReminder(
  id: string,
  chatId: number
): Promise<boolean> {
  const existing = await rm().findFirst({
    where: { id, chatId: BigInt(chatId) },
  });
  if (!existing) return false;
  if (existing.status !== "pending") return false;
  await rm().update({
    where: { id },
    data: { status: "cancelled" },
  });
  return true;
}

export async function listForChat(chatId: number): Promise<ReminderRow[]> {
  const rows = await rm().findMany({
    where: { chatId: BigInt(chatId) },
    orderBy: { fireAt: "asc" },
  });
  return rows.map(toShape);
}

export async function listPendingForChat(
  chatId: number
): Promise<ReminderRow[]> {
  const rows = await rm().findMany({
    where: { chatId: BigInt(chatId), status: "pending" },
    orderBy: { fireAt: "asc" },
  });
  return rows.map(toShape);
}

// ─── Quiet hours ───────────────────────────────────────────────────────────

/**
 * Returns true if `d` (a Date) falls inside the user's quiet window.
 * `startMin` and `endMin` are minutes-of-day in IST (0-1439). The
 * default IST 23:00-07:00 wraps midnight, so we treat
 * `startMin > endMin` as "wraps".
 */
export function isInQuietHours(
  d: Date,
  startMin: number = 1380,
  endMin: number = 420
): boolean {
  // Convert the date's UTC instant to IST hour:minute.
  const istStr = d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const ist = new Date(istStr);
  const min = ist.getHours() * 60 + ist.getMinutes();
  if (startMin === endMin) return false; // degenerate; treat as no quiet hours
  if (startMin < endMin) {
    return min >= startMin && min < endMin;
  }
  // Wraps midnight: e.g. 23:00 (1380) → 07:00 (420).
  return min >= startMin || min < endMin;
}

// ─── Atomic claim ──────────────────────────────────────────────────────────

/**
 * Claim up to 10 due reminders atomically (SQLite has no SKIP LOCKED).
 * Marks them `processing` so the next tick won't pick them up again.
 */
export async function claimDueReminders(): Promise<ReminderRow[]> {
  return prisma.$transaction(async (tx) => {
    const model = (tx as unknown as { reminder: ReminderModel }).reminder;
    const rows = await model.findMany({
      where: { status: "pending", fireAt: { lte: new Date() } },
      orderBy: { fireAt: "asc" },
      take: 10,
    });
    if (rows.length === 0) return [];
    await model.updateMany({
      where: { id: { in: rows.map((r: any) => r.id) } },
      data: { status: "processing" },
    });
    return rows.map(toShape);
  });
}

// ─── Cron loop ─────────────────────────────────────────────────────────────

async function claimAndDispatch(): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "your_bot_token_here") return 0;

  const due = await claimDueReminders();
  let sent = 0;
  for (const row of due) {
    const silent = isInQuietHours(
      new Date(),
      row.quietStartMin,
      row.quietEndMin
    );
    try {
      await sendReply(token, row.chatId, `⏰ ${row.text}`, { silent });
      await rm().update({
        where: { id: row.id },
        data: { status: "dispatched", dispatchedAt: new Date() },
      });
      sent++;
    } catch (err: any) {
      await rm().update({
        where: { id: row.id },
        data: { status: "failed", error: String(err?.message || err) },
      });
      console.error(
        `[telegram/reminders] dispatch failed for ${row.id}:`,
        err?.message || err
      );
    }
  }
  return sent;
}

/**
 * Start the 30s reminder-dispatch loop. Idempotent (globalThis-pinned),
 * safe to call from module top-level or from `ensurePollerStarted`.
 */
export function startReminderLoop(): void {
  const g = globalThis as GlobalWithReminderLoop;
  if (g[LOOP_KEY]?.started) return;
  g[LOOP_KEY] = { started: true };

  if (!cron.validate(REMINDER_CRON)) {
    console.error(
      `[telegram/reminders] invalid REMINDER_CRON='${REMINDER_CRON}' — falling back to */30 seconds`
    );
  } else {
    cron.schedule(REMINDER_CRON, () => {
      claimAndDispatch()
        .then((n) => {
          if (n > 0) {
            console.log(
              `[telegram/reminders] dispatched ${n} reminder${n === 1 ? "" : "s"}`
            );
          }
        })
        .catch((err) =>
          console.error("[telegram/reminders] tick error:", err)
        );
    });
    console.log(`[telegram/reminders] starting (cron='${REMINDER_CRON}')`);
  }

  // Initial sweep without waiting for the cron.
  setTimeout(() => {
    claimAndDispatch().catch((err) =>
      console.error("[telegram/reminders] initial tick error:", err)
    );
  }, 800);
}
