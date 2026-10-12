// Email dispatcher ticker.
//
// Polls the PendingEmail table for rows with status="pending" and
// fireAt<=now, sends each via composio GMAIL_SEND_EMAIL, and updates the
// row's status. Started by the composio listener runner so it shares the
// same Prisma client + lifecycle.
//
// Idempotency: we flip status to "sending" before calling composio, so a
// concurrent tick (multi-instance deploys in the future) won't double-send.

import { prisma } from "@/lib/db/queries";
import { sendViaComposio } from "./email";
import { readComposioEnv } from "./client";

const POLL_INTERVAL_MS = 5_000;
const MAX_ATTEMPTS = 3;

// Pinned to globalThis for the same reason as the Composio client and the
// Prisma client: Next.js dev recompiles a route module on demand, and a
// module-local timer would be duplicated (or lost) across recompiles. One
// timer per server process, whoever asks for it first.
const STATE_KEY = Symbol.for("jarvis.composio.emailDispatcher");
type GlobalState = { timer: NodeJS.Timeout | null; stopRequested: boolean };
const g = globalThis as typeof globalThis & { [STATE_KEY]?: GlobalState };
const state: GlobalState = g[STATE_KEY] ?? (g[STATE_KEY] = { timer: null, stopRequested: false });

export function requestEmailDispatcherStop(): void {
  state.stopRequested = true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

/**
 * Start the pending-email ticker. Idempotent: calling it twice in the same
 * process starts one timer, and it is safe to call from instrumentation.
 *
 * NOTE: this had no caller at all for a while, so every scheduled email sat at
 * status="pending" past its fireAt forever (the composer and the cancel window
 * both worked, which made it look like an outbound-mail problem rather than a
 * missing heartbeat). instrumentation.ts now starts it at boot, and
 * POST /api/composio/email/dispatch can drive a tick on demand.
 */
export function startEmailDispatcher(): void {
  if (state.timer) return;
  state.stopRequested = false;
  void tick();
}

/** Is the ticker alive in this process? (used by the diagnostics route) */
export function isEmailDispatcherRunning(): boolean {
  return state.timer !== null && !state.stopRequested;
}

async function tick(): Promise<void> {
  if (state.stopRequested) return;
  try {
    await processBatch();
  } catch (e) {
    console.error("[composio/emailDispatcher] tick failed:", e);
  }
  if (!state.stopRequested) {
    state.timer = setTimeout(tick, POLL_INTERVAL_MS);
  }
}

/** One pass over the due rows. Exported so a route can force a tick (tests,
 *  and any environment where a background timer is not desirable). */
export async function processBatch(): Promise<{ processed: number; sent: number; failed: number }> {
  const now = new Date();
  // Atomic-ish claim: find up to 5 due rows, flip to "sending" so
  // concurrent ticks skip them.
  const due = await prisma.pendingEmail.findMany({
    where: { status: "pending", fireAt: { lte: now } },
    orderBy: { fireAt: "asc" },
    take: 5,
  });
  if (due.length === 0) return { processed: 0, sent: 0, failed: 0 };

  const { userId } = readComposioEnv();
  const counts = { processed: 0, sent: 0, failed: 0 };

  for (const row of due) {
    // Claim it.
    const claimed = await prisma.pendingEmail.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "sending" },
    });
    if (claimed.count === 0) continue; // someone else already took it (or user cancelled)
    counts.processed++;

    console.log(
      `[composio/emailDispatcher] sending pendingEmail=${row.id} to=${row.toEmail} subject="${row.subject}"`
    );

    let result;
    try {
      result = await sendViaComposio({
        userId,
        connectedAccountId: row.connectedAccountId,
        toEmail: row.toEmail,
        subject: row.subject,
        body: row.body,
      });
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.ok) {
      await prisma.pendingEmail.update({
        where: { id: row.id },
        data: {
          status: "sent",
          sentAt: new Date(),
          sentMessageId: result.messageId ?? null,
          error: null,
        },
      });
      console.log(
        `[composio/emailDispatcher] sent pendingEmail=${row.id} (gmail id=${result.messageId})`
      );
      void notifyOutcome(row.chatId, row.callbackMessageId, true, row.toEmail, row.subject).catch(
        (e) => console.error("[composio/emailDispatcher] outcome notify failed:", e)
      );
      counts.sent++;
    } else {
      // Failure path — but only retry up to MAX_ATTEMPTS. On the final
      // attempt, mark failed.
      const nextAttempt = row.error ? row.error.split("|")[0] : "";
      const attempts = (() => {
        const m = row.error?.match(/attempt=(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      })();
      if (attempts + 1 >= MAX_ATTEMPTS) {
        counts.failed++;
        await prisma.pendingEmail.update({
          where: { id: row.id },
          data: {
            status: "failed",
            error: `attempt=${attempts + 1} ${result.error ?? "unknown"}`,
          },
        });
        void notifyOutcome(
          row.chatId,
          row.callbackMessageId,
          false,
          row.toEmail,
          row.subject,
          result.error
        ).catch(() => {});
      } else {
        // Reset to pending and try again next tick.
        await prisma.pendingEmail.update({
          where: { id: row.id },
          data: {
            status: "pending",
            // 5s backoff
            fireAt: new Date(Date.now() + 5_000),
            error: `attempt=${attempts + 1} ${result.error ?? "unknown"}`,
          },
        });
      }
    }
  }

  return counts;
}

async function notifyOutcome(
  chatId: bigint | null,
  callbackMessageId: bigint | null,
  ok: boolean,
  to: string,
  subject: string,
  error?: string
): Promise<void> {
  if (!chatId || !callbackMessageId) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const { editMessageText } = await import("@/lib/telegram");
  const text = ok
    ? `✅ Sent email to ${to}\nSubject: ${subject}`
    : `❌ Email to ${to} failed: ${error ?? "unknown error"}`;
  await editMessageText(token, Number(chatId), Number(callbackMessageId), text).catch((e) =>
    console.error("[composio/emailDispatcher] edit telegram failed:", e)
  );
}