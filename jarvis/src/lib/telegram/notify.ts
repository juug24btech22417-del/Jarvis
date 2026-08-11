// Telegram proactive push helper.
//
// Cross-codebase "tell the user something via Telegram" entry point.
// Used by the scheduler, briefing service, agent, research pipeline,
// sentinel, and the React panel's debug "Test push" button. When the
// caller omits `chatId`, we resolve to the first entry in
// TELEGRAM_ALLOWED_CHAT_IDS so a single-user setup "just works".

import {
  enqueueTelegramMessage,
  type TelegramMessageRow,
} from "./queue";
import { sendReply, getAllowedChatIds, type InlineKeyboardButton } from "./index";
import { synthesizeSpeech } from "./tts";
import { sendVoiceNoteMultipart } from "./voiceMultipart";

export interface NotifyOpts {
  /** disable_notification (silent delivery during quiet hours). */
  silent?: boolean;
  /** Inline keyboard buttons to attach. */
  buttons?: InlineKeyboardButton[][];
  /** "MarkdownV2" or "HTML" — defaults to plain. */
  parseMode?: "MarkdownV2" | "HTML";
  /** Telegram message_id to reply to. */
  replyToMessageId?: number;
  /** Send as a voice note (TTS) instead of a text message. */
  voice?: boolean;
  /** Synthetic source tag (e.g. "scheduler", "briefing"). */
  fromSource?: string;
}

export interface NotifyResult {
  sent: boolean;
  messageIds?: number[];
  error?: string;
}

function defaultChatId(): number | null {
  const ids = getAllowedChatIds();
  if (ids.size === 0) return null;
  return Array.from(ids)[0];
}

export async function notifyUser(
  chatId: number | null | undefined,
  text: string,
  opts: NotifyOpts = {}
): Promise<NotifyResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "your_bot_token_here") {
    return { sent: false, error: "no_token" };
  }
  const target = chatId ?? defaultChatId();
  if (target == null) {
    return { sent: false, error: "no_target" };
  }

  try {
    let ids: number[] = [];
    if (opts.voice) {
      const filePath = await synthesizeSpeech(text);
      await sendVoiceNoteMultipart(token, target, filePath);
    } else {
      ids = await sendReply(token, target, text, {
        silent: opts.silent,
        buttons: opts.buttons,
        parseMode: opts.parseMode,
        replyToMessageId: opts.replyToMessageId,
      });
    }

    // Mirror the outbound into the queue so the panel shows it.
    // We tag direction="system" so the panel can distinguish pushes
    // from chat-replies; buildChatHistory already filters "system"
    // rows out of LLM context (it only consumes inbound + outbound).
    try {
      await enqueueSystemMessage({
        chatId: target,
        text,
        status: "sent",
        metadata: {
          fromNotify: true,
          fromSource: opts.fromSource ?? null,
          silent: !!opts.silent,
          voice: !!opts.voice,
        },
      });
    } catch {
      // Non-fatal — don't fail the push because the queue mirror broke.
    }
    return { sent: true, messageIds: ids };
  } catch (e: any) {
    return { sent: false, error: e?.message || "send_failed" };
  }
}

// ─── System-direction queue helper ─────────────────────────────────────────

export async function enqueueSystemMessage(input: {
  chatId: number;
  text: string;
  status?: "pending" | "sent" | "failed";
  metadata?: Record<string, unknown> | null;
}): Promise<TelegramMessageRow | null> {
  try {
    return await enqueueTelegramMessage({
      chatId: input.chatId,
      direction: "system",
      text: input.text,
      status: input.status ?? "sent",
      metadata: input.metadata ?? null,
    });
  } catch (e: any) {
    console.error(
      "[telegram/notify] enqueueSystemMessage failed:",
      e?.message || e
    );
    return null;
  }
}

