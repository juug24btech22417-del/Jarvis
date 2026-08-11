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
  downloadTelegramFile,
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
import { startReminderLoop } from "./reminders";
import { startClipboardWatcher } from "./clipboard";
import { transcribeOggOpus } from "./transcribe";
import { describeImage } from "./vision";
import { parseDocument } from "./documents";
import { upsertUserLocation } from "./location";
import { saveToTmp } from "./media";
import { resolveDestructiveCallback } from "./osBridge";
import { setMyCommands } from "./setMyCommands";

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

  // Boot the related cron loops + watchers. These are idempotent on
  // their own globalThis pins, so calling them from here is safe even
  // if some other route also touched them.
  startReminderLoop();
  startClipboardWatcher();
  // Register the bot's slash-command menu. Safe to call repeatedly;
  // Telegram replaces the existing menu on each call.
  setMyCommands(POLL_TOKEN).catch((err) =>
    console.warn("[telegram/poller] setMyCommands failed:", err?.message || err)
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

    // 1. Handle inbound media. Each branch downloads eagerly (because
    //    Telegram file_path URLs expire ~1h), transcribes / describes /
    //    parses, then enqueues the processed text with metadata so the
    //    dispatcher can show a "voice note" / "photo" / "document"
    //    badge in the panel.
    for (const m of messages) {
      const chatId = m.chat.id;
      if (!isChatAllowed(chatId)) {
        continue; // reject logic below for text messages; media from
                  // unauthorized chats is dropped silently for now.
      }

      // 1a. Voice.
      if (m.voice && !m.text) {
        try {
          const fileId = m.voice.file_id;
          const buf = await downloadTelegramFile(POLL_TOKEN, fileId);
          const tmpPath = await saveToTmp(chatId, "ogg", buf);
          const { text } = await transcribeOggOpus(buf);
          const row = await enqueueTelegramMessage({
            chatId,
            telegramMsgId: m.message_id,
            direction: "inbound",
            text,
            status: "pending",
            metadata: {
              kind: "voice",
              tmpPath,
              duration: m.voice.duration,
            },
          });
          console.log(
            `[telegram/poller] enqueued voice ${row.id.slice(0, 8)} (${text.length} chars)`
          );
        } catch (err: any) {
          console.error("[telegram/poller] voice error:", err?.message || err);
          // Acknowledge to the user that the voice note failed.
          await sendReply(
            POLL_TOKEN,
            chatId,
            `Couldn't transcribe that voice note, Boss: ${err?.message || err}`
          ).catch(() => {});
        }
        continue;
      }

      // 1b. Photo (largest size).
      if (m.photo && m.photo.length > 0 && !m.text) {
        try {
          const largest = m.photo[m.photo.length - 1];
          const buf = await downloadTelegramFile(POLL_TOKEN, largest.file_id);
          const caption =
            m.caption?.trim() || "Describe this image in detail.";
          const text = await describeImage(buf, "image/jpeg", caption);
          const row = await enqueueTelegramMessage({
            chatId,
            telegramMsgId: m.message_id,
            direction: "inbound",
            text,
            status: "pending",
            metadata: {
              kind: "photo",
              caption,
              width: largest.width,
              height: largest.height,
            },
          });
          console.log(
            `[telegram/poller] enqueued photo ${row.id.slice(0, 8)} (${text.length} chars)`
          );
        } catch (err: any) {
          console.error("[telegram/poller] photo error:", err?.message || err);
          await sendReply(
            POLL_TOKEN,
            chatId,
            `Couldn't analyze that photo, Boss: ${err?.message || err}`
          ).catch(() => {});
        }
        continue;
      }

      // 1c. Document.
      if (m.document && !m.text) {
        try {
          const { file_id, mime_type, file_name } = m.document;
          const buf = await downloadTelegramFile(POLL_TOKEN, file_id);
          const parsed = await parseDocument(buf, mime_type ?? "application/octet-stream", file_name ?? "file");
          const caption =
            m.caption?.trim() ||
            `Summarize "${file_name}" in 5 bullet points.`;
          const combined = `${caption}\n\n---\n${parsed.text.slice(0, 6000)}`;
          const row = await enqueueTelegramMessage({
            chatId,
            telegramMsgId: m.message_id,
            direction: "inbound",
            text: combined,
            status: "pending",
            metadata: {
              kind: "document",
              fileName: file_name,
              mime: mime_type,
              pages: parsed.meta.pages,
              parser: parsed.meta.parser,
            },
          });
          console.log(
            `[telegram/poller] enqueued document ${row.id.slice(0, 8)} (${parsed.text.length} chars, parser=${parsed.meta.parser})`
          );
        } catch (err: any) {
          console.error("[telegram/poller] document error:", err?.message || err);
          await sendReply(
            POLL_TOKEN,
            chatId,
            `Couldn't read that file, Boss: ${err?.message || err}`
          ).catch(() => {});
        }
        continue;
      }

      // 1d. Location — short-circuit; ack directly without LLM round-trip.
      if ((m as any).location && !m.text) {
        try {
          const loc = (m as any).location;
          await upsertUserLocation(chatId, {
            latitude: Number(loc.latitude),
            longitude: Number(loc.longitude),
            accuracyM:
              typeof loc.horizontal_accuracy === "number"
                ? loc.horizontal_accuracy
                : null,
            livePeriodSeconds:
              typeof loc.live_period === "number" ? loc.live_period : null,
            heading: typeof loc.heading === "number" ? loc.heading : null,
          });
          const row = await enqueueTelegramMessage({
            chatId,
            telegramMsgId: m.message_id,
            direction: "inbound",
            text: `📍 Location received: ${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}`,
            status: "sent",
            metadata: {
              kind: "location",
              lat: Number(loc.latitude),
              lng: Number(loc.longitude),
            },
          });
          await sendReply(
            POLL_TOKEN,
            chatId,
            `📍 Got it, Boss. Saved your location (${Number(loc.latitude).toFixed(4)}, ${Number(loc.longitude).toFixed(4)}).`
          ).catch(() => {});
          await markSent(row.id);
        } catch (err: any) {
          console.error("[telegram/poller] location error:", err?.message || err);
        }
        continue;
      }

      // 1e. Plain text (existing path).
      if (!m.text) continue;
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

    // 2. Handle button taps.
    for (const cb of callbackQueries) {
      const chatId = cb.chat?.id ?? cb.from?.id;
      if (!chatId || !isChatAllowed(chatId)) {
        await answerCallbackQuery(POLL_TOKEN, cb.id, "Not authorized").catch(
          () => {}
        );
        continue;
      }
      // Acknowledge immediately so the button doesn't spin.
      await answerCallbackQuery(POLL_TOKEN, cb.id).catch(() => {});

      const data = (cb.data ?? "").trim();
      if (!data) continue;

      // 2a. OS-action confirm/cancel buttons (handled inline; no LLM).
      if (data.startsWith("os:")) {
        const parts = data.split(":");
        const action = parts[1] as "confirm" | "cancel";
        const shortId = parts.slice(2).join(":");
        if (!shortId || (action !== "confirm" && action !== "cancel")) {
          await sendReply(
            POLL_TOKEN,
            chatId,
            "Malformed confirmation button, Boss."
          ).catch(() => {});
          continue;
        }
        const result = await resolveDestructiveCallback(
          chatId,
          action,
          shortId
        );
        if (result.notFound) {
          await sendReply(
            POLL_TOKEN,
            chatId,
            "Couldn't find that pending action. Send the command again if you still want it."
          ).catch(() => {});
        } else if (result.expired) {
          await sendReply(
            POLL_TOKEN,
            chatId,
            "⏰ That action expired, Boss. Send the command again if you still want it."
          ).catch(() => {});
        } else if (!result.ok) {
          await sendReply(
            POLL_TOKEN,
            chatId,
            `❌ ${result.error ?? "Action failed."}`
          ).catch(() => {});
        } else if (action === "cancel") {
          await sendReply(POLL_TOKEN, chatId, "Cancelled.").catch(() => {});
        } else {
          await sendReply(
            POLL_TOKEN,
            chatId,
            `✅ ${result.description ?? "Done."}`
          ).catch(() => {});
        }
        continue;
      }

      // 2b. Anything else — treat the button data as a new prompt.
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
