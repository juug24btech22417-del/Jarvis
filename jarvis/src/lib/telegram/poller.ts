// Server-side Telegram poller. Replaces the in-browser polling loop.
// Runs as a singleton on the Next.js server process; initialized lazily
// on the first hit to any /api/telegram/* route.

import cron from "node-cron";
import {
  isChatAllowed,
  pollMessagesAndCallbacks,
  setTypingAction,
  sendReply,
  sendVoiceNote,
  sendFile,
  answerCallbackQuery,
} from "./index";
import {
  claimNextPendingInbound,
  enqueueTelegramMessage,
  getRecentForChat,
  getSeenChatIds,
  markRejected,
  markSent,
} from "./queue";
import { dispatchFromQueueRow } from "./handleInbound";
import { replayPendingOnBoot } from "./queueReplay";

const POLL_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const POLL_CRON = process.env.TELEGRAM_POLL_CRON ?? "*/3 * * * * *"; // every 3s by default

/**
 * Process-level singleton. Next.js dev compilation can load this module
 * in multiple contexts (HMR, route on-demand compilation), each with its
 * own module state. If we used a module-level `started` flag, each
 * context would start its own cron, and each cron would poll Telegram
 * and dispatch the same inbound message — producing duplicate replies.
 *
 * Pinning to `globalThis` guarantees one and only one cron loop per
 * Node process, regardless of how many times the module is evaluated.
 */
const POLLER_KEY = Symbol.for("jarvis.telegram.poller");
type GlobalWithPoller = typeof globalThis & {
  [POLLER_KEY]?: { started: boolean };
};

export function ensurePollerStarted() {
  const g = globalThis as GlobalWithPoller;
  if (g[POLLER_KEY]?.started) return;
  if (!POLL_TOKEN || POLL_TOKEN === "your_bot_token_here") {
    console.warn(
      "[telegram/poller] TELEGRAM_BOT_TOKEN not set — server-side polling disabled"
    );
    return;
  }
  g[POLLER_KEY] = { started: true };

  console.log(
    `[telegram/poller] starting (cron='${POLL_CRON}', allowed=${
      (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").filter(Boolean).length
    } chats)`
  );

  // Cron expression validation — node-cron throws if invalid.
  if (!cron.validate(POLL_CRON)) {
    console.error(
      `[telegram/poller] invalid TELEGRAM_POLL_CRON='${POLL_CRON}' — falling back to */3 seconds`
    );
  } else {
    cron.schedule(POLL_CRON, () => {
      tick().catch((err) =>
        console.error("[telegram/poller] tick error:", err)
      );
    });
  }

  // Initial replay sweep + a first tick without waiting for the cron.
  setTimeout(() => {
    replayPendingOnBoot(POLL_TOKEN!).catch((err) =>
      console.error("[telegram/poller] replay error:", err)
    );
    tick().catch((err) =>
      console.error("[telegram/poller] initial tick error:", err)
    );
  }, 500);
}

// Pin to globalThis for the same reason as POLLER_KEY above: Next.js
// dev may evaluate this module in multiple contexts and we'd otherwise
// get several ticks racing the same Telegram updates.
const TICK_KEY = Symbol.for("jarvis.telegram.tickInFlight");
type GlobalWithTick = typeof globalThis & {
  [TICK_KEY]?: boolean;
};

async function tick() {
  if (!POLL_TOKEN) return;
  const g = globalThis as GlobalWithTick;
  if (g[TICK_KEY]) return; // overlap guard
  g[TICK_KEY] = true;
  try {
    const { messages, callbackQueries } = await pollMessagesAndCallbacks(
      POLL_TOKEN
    );

    // 1. Handle text messages
    for (const m of messages) {
      const chatId = m.chat.id;
      if (!m.text) continue; // ignore stickers/photos/voice for v1
      const text = m.text.trim();
      if (!text) continue;

      if (!isChatAllowed(chatId)) {
        // Persist as "rejected" for visibility, but don't reply.
        const row = await enqueueTelegramMessage({
          chatId,
          telegramMsgId: m.message_id,
          direction: "inbound",
          text,
          status: "rejected",
          error: "chat not in TELEGRAM_ALLOWED_CHAT_IDS",
        }).catch(() => null);
        if (row) {
          await markRejected(row.id, "unauthorized");
        }
        console.log(
          `[telegram/poller] rejected inbound from chat ${chatId} (not allowed)`
        );
        continue;
      }

      // Persist as pending — the dispatcher will claim and process it.
      const row = await enqueueTelegramMessage({
        chatId,
        telegramMsgId: m.message_id,
        direction: "inbound",
        text,
        status: "pending",
      });
      console.log(
        `[telegram/poller] enqueued inbound ${row.id.slice(0, 8)} from chat ${chatId} (msg_id=${m.message_id}, ${text.length} chars)`
      );
    }

    // 2. Handle button taps
    for (const cb of callbackQueries) {
      const chatId = cb.chat?.id ?? cb.from?.id;
      if (!chatId || !isChatAllowed(chatId)) {
        await answerCallbackQuery(
          POLL_TOKEN,
          cb.id,
          "Not authorized"
        ).catch(() => {});
        continue;
      }
      // Acknowledge immediately so the button doesn't spin.
      await answerCallbackQuery(POLL_TOKEN, cb.id).catch(() => {});

      // Treat the button data as a new prompt.
      const data = (cb.data ?? "").trim();
      if (!data) continue;
      await enqueueTelegramMessage({
        chatId,
        direction: "inbound",
        text: data,
        status: "pending",
        metadata: { fromCallback: true, callbackId: cb.id },
      });
    }

    // 3. Drain the queue.
    await drainQueue();
  } finally {
    (globalThis as GlobalWithTick)[TICK_KEY] = false;
  }
}

async function drainQueue() {
  if (!POLL_TOKEN) return;
  // Process at most 3 messages per tick to keep the loop responsive.
  for (let i = 0; i < 3; i++) {
    const row = await claimNextPendingInbound();
    if (!row) return;
    try {
      await dispatchFromQueueRow(row, {
        token: POLL_TOKEN,
        sendTyping: () => setTypingAction(POLL_TOKEN!, row.chatId),
        sendReply: (text, opts) =>
          sendReply(POLL_TOKEN!, row.chatId, text, opts),
        sendVoice: (url, caption) =>
          sendVoiceNote(POLL_TOKEN!, row.chatId, url, caption),
        sendFile: (url, caption) =>
          sendFile(POLL_TOKEN!, row.chatId, url, caption),
      });
    } catch (err: any) {
      console.error(
        `[telegram/poller] dispatch failed for row ${row.id}:`,
        err?.message || err
      );
    }
  }
}

/**
 * Test/manual trigger. Useful from the React panel's "Refresh" button
 * and from `npm run telegram:tick` style scripts during development.
 */
export async function runTickOnce() {
  await tick();
}

export { getRecentForChat, getSeenChatIds };
