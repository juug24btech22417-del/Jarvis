// Telegram queue — thin Prisma wrapper over the TelegramMessage model.
// Used by the live poller and the boot-time replay so the laptop can
// pick up messages sent while it was asleep, and so the React panel
// can read history from a single source of truth.

import { prisma } from "@/lib/db/queries";

// Type the Prisma client with a partial override so the queue lib compiles
// before `prisma migrate dev` has been run. After the user applies the
// migration in 20260811120000_add_telegram_queue/, the generated client
// already knows about `telegramMessage` and these casts become no-ops.
type TelegramMessageModel = {
  create: (args: { data: Record<string, unknown> }) => Promise<any>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<any>;
  findFirst: (args: Record<string, unknown>) => Promise<any>;
  findMany: (args: Record<string, unknown>) => Promise<any>;
  groupBy: (args: Record<string, unknown>) => Promise<any>;
};
const tm = (): TelegramMessageModel =>
  (prisma as unknown as { telegramMessage: TelegramMessageModel }).telegramMessage;

export type TelegramDirection = "inbound" | "outbound" | "system";
export type TelegramStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "rejected";

export interface TelegramMessageRow {
  id: string;
  chatId: number; // BigInt → number for caller convenience
  telegramMsgId: number | null;
  direction: TelegramDirection;
  text: string;
  status: TelegramStatus;
  replyToId: string | null;
  metadata: Record<string, unknown> | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function rowToShape(row: any): TelegramMessageRow {
  return {
    id: row.id,
    chatId: typeof row.chatId === "bigint" ? Number(row.chatId) : row.chatId,
    telegramMsgId:
      row.telegramMsgId == null
        ? null
        : typeof row.telegramMsgId === "bigint"
        ? Number(row.telegramMsgId)
        : row.telegramMsgId,
    direction: row.direction as TelegramDirection,
    text: row.text,
    status: row.status as TelegramStatus,
    replyToId: row.replyToId,
    metadata: row.metadata ? safeParseJson(row.metadata) : null,
    error: row.error,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeParseJson(s: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

function toBigInt(n: number | null | undefined): bigint | null {
  if (n == null) return null;
  return BigInt(n);
}

export interface EnqueueInput {
  chatId: number;
  telegramMsgId?: number | null;
  direction: TelegramDirection;
  text: string;
  status?: TelegramStatus;
  replyToId?: string | null;
  metadata?: Record<string, unknown> | null;
  error?: string | null;
}

export async function enqueueTelegramMessage(
  input: EnqueueInput
): Promise<TelegramMessageRow> {
  // Idempotency: if we already enqueued this Telegram message_id for
  // this chat in this direction, return the existing row instead of
  // creating a duplicate. The poller can re-fetch the same update if
  // `lastUpdateId` falls behind (e.g. after a dev-server restart),
  // and we don't want to dispatch the same message twice.
  if (input.telegramMsgId != null) {
    const existing = await tm().findFirst({
      where: {
        chatId: BigInt(input.chatId),
        telegramMsgId: BigInt(input.telegramMsgId),
        direction: input.direction,
      },
    });
    if (existing) return rowToShape(existing);
  }

  const row = await tm().create({
    data: {
      chatId: BigInt(input.chatId),
      telegramMsgId: toBigInt(input.telegramMsgId ?? null),
      direction: input.direction,
      text: input.text,
      status: input.status ?? "pending",
      replyToId: input.replyToId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      error: input.error ?? null,
    },
  });
  return rowToShape(row);
}

export async function markProcessing(id: string): Promise<void> {
  await tm().update({
    where: { id },
    data: { status: "processing" },
  });
}

export async function markSent(
  id: string,
  opts?: {
    telegramMsgId?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await tm().update({
    where: { id },
    data: {
      status: "sent",
      telegramMsgId: toBigInt(opts?.telegramMsgId ?? null) ?? undefined,
      metadata: opts?.metadata
        ? JSON.stringify({ ...(opts.metadata ?? {}) })
        : undefined,
    },
  });
}

export async function markFailed(id: string, error: string): Promise<void> {
  await tm().update({
    where: { id },
    data: { status: "failed", error },
  });
}

export async function markRejected(id: string, reason: string): Promise<void> {
  await tm().update({
    where: { id },
    data: { status: "rejected", error: reason },
  });
}

/**
 * Claim and atomically mark the next pending inbound message as processing.
 * Returns null if nothing is pending. The caller is responsible for calling
 * markSent or markFailed; if the process crashes, the row stays in
 * "processing" — reaper logic can recover if needed (not in v1).
 */
export async function claimNextPendingInbound(): Promise<TelegramMessageRow | null> {
  // SQLite has no SKIP LOCKED; use a transaction with a conditional update
  // to claim a row atomically.
  const claimed = await prisma.$transaction(async (tx) => {
    const model = (tx as unknown as { telegramMessage: TelegramMessageModel }).telegramMessage;
    const row = await model.findFirst({
      where: { direction: "inbound", status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (!row) return null;
    const updated = await model.update({
      where: { id: row.id },
      data: { status: "processing" },
    });
    return updated;
  });
  return claimed ? rowToShape(claimed) : null;
}

export async function getRecentForChat(
  chatId: number,
  limit = 20
): Promise<TelegramMessageRow[]> {
  const rows = await tm().findMany({
    where: { chatId: BigInt(chatId) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(rowToShape).reverse();
}

export async function getRecent(limit = 100): Promise<TelegramMessageRow[]> {
  const rows = await tm().findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(rowToShape);
}

/**
 * Return the unique chat IDs we've ever seen inbound messages from,
 * used by the panel's "auth helper" banner to show the user which IDs
 * to add to TELEGRAM_ALLOWED_CHAT_IDS.
 */
export async function getSeenChatIds(): Promise<number[]> {
  const groups = (await tm().groupBy({
    by: ["chatId"],
    where: { direction: "inbound" },
  })) as Array<{ chatId: bigint | number }>;
  return groups
    .map((g) => (typeof g.chatId === "bigint" ? Number(g.chatId) : g.chatId))
    .sort((a, b) => a - b);
}
