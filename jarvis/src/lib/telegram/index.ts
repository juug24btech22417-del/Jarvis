// Telegram Bot API client
// Simple polling-based implementation

export { getFileMeta, downloadTelegramFile, saveToTmp, tmpPathFor } from "./media";

const TELEGRAM_API = "https://api.telegram.org/bot";

interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramLocation {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
  heading?: number;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number; first_name?: string; username?: string };
  from?: { id: number; is_bot: boolean };
  text?: string;
  voice?: { file_id: string; duration: number };
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  caption?: string;
  location?: TelegramLocation;
  date: number;
  isFromMe?: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// In-memory storage for messages.
// These globals are pinned to globalThis so Next.js dev HMR / on-demand
// route compilation doesn't reset them on every module reload — a reset
// would cause the poller to re-fetch and re-dispatch every buffered
// Telegram update, producing duplicate replies.
const STATE_KEY = Symbol.for("jarvis.telegram.state");
type GlobalState = {
  messages: TelegramMessage[];
  lastUpdateId: number;
  botUserId: number | null;
};
const g = globalThis as typeof globalThis & { [STATE_KEY]?: GlobalState };
const state: GlobalState =
  g[STATE_KEY] ??
  (g[STATE_KEY] = { messages: [], lastUpdateId: 0, botUserId: null });

let messages: TelegramMessage[] = state.messages;
let lastUpdateId: number = state.lastUpdateId;
let botUserId: number | null = state.botUserId;

// Set bot user ID (used to identify outgoing messages)
export function setBotUserId(id: number) {
  botUserId = id;
  state.botUserId = id;
}

// Get bot user ID
export function getBotUserId(): number | null {
  return botUserId;
}

// Add a sent message locally (since Telegram doesn't include sent messages in updates)
export function addSentMessage(chatId: number, text: string) {
  const now = Math.floor(Date.now() / 1000);
  messages.push({
    message_id: now, // Use timestamp as temporary ID
    chat: { id: chatId, first_name: undefined, username: undefined },
    from: { id: botUserId || 0, is_bot: true },
    text: text,
    date: now,
    isFromMe: true, // Mark as sent by us
  });
  state.messages = messages;
}

// Always re-sync the module-level `let` variables from the globalThis
// pin. Next.js dev can re-evaluate this module in different contexts
// (HMR, route on-demand compilation), and when it does the `let`
// bindings are re-initialized from the original `state.lastUpdateId = 0`
// value — which silently throws away every update_id we've ever
// acknowledged, causing Telegram to redeliver the same updates and
// our idempotency check to fall through. Pulling from globalThis each
// time we read the value keeps the local view consistent with the
// shared store.
function refreshStateFromGlobal() {
  const fresh = (globalThis as typeof globalThis & { [STATE_KEY]?: GlobalState })[STATE_KEY];
  if (!fresh) return;
  messages = fresh.messages;
  lastUpdateId = fresh.lastUpdateId;
  botUserId = fresh.botUserId;
}

// Get bot info
export async function getBotInfo(token: string) {
  const res = await fetch(`${TELEGRAM_API}${token}/getMe`);
  return res.json();
}

// Poll for new messages
export async function pollMessages(token: string): Promise<TelegramUpdate[]> {
  try {
    refreshStateFromGlobal();
    const res = await fetch(
      `${TELEGRAM_API}${token}/getUpdates?offset=${lastUpdateId + 1}&limit=100`,
      { cache: "no-store" }
    );
    const data = await res.json();

    if (data.ok && data.result.length > 0) {
      data.result.forEach((update: TelegramUpdate) => {
        if (update.update_id > lastUpdateId) {
          lastUpdateId = update.update_id;
          state.lastUpdateId = lastUpdateId;
        }
        if (update.message) {
          messages.push(update.message);
          state.messages = messages;
        }
      });
    }

    return data.result || [];
  } catch (error) {
    console.error("[Telegram] Poll error:", error);
    return [];
  }
}

// Send text message
export async function sendMessage(
  token: string,
  chatId: number,
  text: string
): Promise<{ success: boolean; error?: string; description?: string }> {
  try {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error("[Telegram] Send failed:", data);
    }   
    return {
      success: data.ok,
      error: data.description || undefined
    };
  } catch (error) {
    console.error("[Telegram] Send error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send",
    };
  }
}

// Get stored messages
export function getMessages(): TelegramMessage[] {
  return messages.sort((a, b) => b.date - a.date);
}

// Clear messages (optional)
export function clearMessages() {
  messages = [];
}

// Get unique chats from messages
export function getChats(): { id: number; name: string; username?: string }[] {
  const chats = new Map<number, { id: number; name: string; username?: string }>();

  messages.forEach((msg) => {
    if (!chats.has(msg.chat.id)) {
      chats.set(msg.chat.id, {
        id: msg.chat.id,
        name: msg.chat.first_name || `Chat ${msg.chat.id}`,
        username: msg.chat.username,
      });
    }
  });

  return Array.from(chats.values());
}

// Get messages for specific chat
export function getChatMessages(chatId: number): TelegramMessage[] {
  return messages
    .filter((msg) => msg.chat.id === chatId)
    .sort((a, b) => a.date - b.date);
}

// ---------------------------------------------------------------------------
// Remote-control transport additions
// ---------------------------------------------------------------------------
//
// The original file above is the in-memory display buffer used by the
// React panel. Everything below is the server-side transport used by the
// new dispatcher (`handleInbound.ts`). The two layers don't share state
// on purpose: the in-memory buffer is a UI cache, the queue in
// `lib/telegram/queue.ts` is the authoritative store.

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
  url?: string;
}

export interface ReplyOpts {
  parseMode?: "MarkdownV2" | "HTML" | undefined;
  replyToMessageId?: number;
  buttons?: InlineKeyboardButton[][];
  silent?: boolean;
}

let cachedAllowedChatIds: { raw: string; set: Set<number> } | null = null;

/**
 * Read TELEGRAM_ALLOWED_CHAT_IDS from env (comma-separated numeric IDs).
 * Returns an empty set if unset. Cached per-token to keep hot paths cheap.
 */
export function getAllowedChatIds(): Set<number> {
  const raw = process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "";
  if (cachedAllowedChatIds && cachedAllowedChatIds.raw === raw) {
    return cachedAllowedChatIds.set;
  }
  const set = new Set<number>();
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const n = Number(trimmed);
    if (Number.isFinite(n) && n !== 0) set.add(n);
  }
  cachedAllowedChatIds = { raw, set };
  return set;
}

export function isChatAllowed(chatId: number): boolean {
  return getAllowedChatIds().has(chatId);
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  chat: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
}

/**
 * Long-poll for messages AND callback_queries. Returns both kinds so the
 * dispatcher can route button taps the same way as text messages.
 */
export interface PollResult {
  messages: TelegramMessage[];
  callbackQueries: TelegramCallbackQuery[];
}

export async function pollMessagesAndCallbacks(
  token: string
): Promise<PollResult> {
  const out: PollResult = { messages: [], callbackQueries: [] };
  try {
    refreshStateFromGlobal();
    const res = await fetch(
      `${TELEGRAM_API}${token}/getUpdates?offset=${lastUpdateId + 1}&limit=100&timeout=25`,
      { cache: "no-store" }
    );
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.result)) return out;

    for (const update of data.result as any[]) {
      if (typeof update.update_id === "number" && update.update_id > lastUpdateId) {
        lastUpdateId = update.update_id;
        state.lastUpdateId = lastUpdateId;
      }
      if (update.message) {
        messages.push(update.message);
        state.messages = messages;
        out.messages.push(update.message);
      }
      if (update.callback_query) {
        out.callbackQueries.push(update.callback_query as TelegramCallbackQuery);
      }
    }
  } catch (error) {
    console.error("[Telegram] Poll error:", error);
  }
  return out;
}

/** Send a "typing…" chat action; Telegram expires it after 5s. */
export async function setTypingAction(
  token: string,
  chatId: number
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch (error) {
    // Non-fatal — the user will just not see the typing indicator.
    console.error("[Telegram] typing action failed:", error);
  }
}

export async function answerCallbackQuery(
  token: string,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: false,
      }),
    });
  } catch (error) {
    console.error("[Telegram] answerCallbackQuery failed:", error);
  }
}

/**
 * Send a text reply. Splits into 4096-char chunks to respect Telegram's
 * limit, returning the message_ids Telegram assigned (in order) so the
 * caller can edit them later for progress updates.
 */
export async function sendReply(
  token: string,
  chatId: number,
  text: string,
  opts: ReplyOpts = {}
): Promise<number[]> {
  const ids: number[] = [];
  const chunks = chunkForTelegram(text, 4000); // 4000 leaves headroom for formatting
  for (const chunk of chunks) {
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        parse_mode: opts.parseMode,
        reply_to_message_id: opts.replyToMessageId,
        disable_notification: opts.silent,
        reply_markup: opts.buttons
          ? { inline_keyboard: opts.buttons }
          : undefined,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error("[Telegram] sendReply failed:", data);
      throw new Error(data.description ?? "sendMessage failed");
    }
    if (typeof data.result?.message_id === "number") {
      ids.push(data.result.message_id);
    }
  }
  return ids;
}

export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  newText: string,
  opts: Omit<ReplyOpts, "replyToMessageId"> = {}
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${token}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text: newText,
        parse_mode: opts.parseMode,
        reply_markup: opts.buttons
          ? { inline_keyboard: opts.buttons }
          : undefined,
      }),
    });
  } catch (error) {
    console.error("[Telegram] editMessageText failed:", error);
  }
}

/**
 * Send a voice note. `audioUrl` may be a remote URL or a file:// / local
 * path; for v1 we just pass the URL to Telegram and let it fetch.
 */
export async function sendVoiceNote(
  token: string,
  chatId: number,
  audioUrl: string,
  caption?: string
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${token}/sendVoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        voice: audioUrl,
        caption,
      }),
    });
  } catch (error) {
    console.error("[Telegram] sendVoiceNote failed:", error);
  }
}

export async function sendFile(
  token: string,
  chatId: number,
  fileUrl: string,
  caption?: string
): Promise<void> {
  try {
    await fetch(`${TELEGRAM_API}${token}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        document: fileUrl,
        caption,
      }),
    });
  } catch (error) {
    console.error("[Telegram] sendFile failed:", error);
  }
}

/**
 * Telegram has a 4096-char limit on a single message. We split on
 * paragraph boundaries when possible to keep chunks readable. Markdown
 * code fences are kept intact by tracking open/close state across chunks.
 */
function chunkForTelegram(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;
  let fenceOpen = false;

  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf(" ", maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;

    let head = remaining.slice(0, cut);
    if (fenceOpen && !head.includes("```")) {
      head = head + "\n```";
    }
    chunks.push(head);
    remaining = remaining.slice(cut).trimStart();
    fenceOpen = (head.match(/```/g) ?? []).length % 2 === 1;
  }
  if (remaining) {
    if (fenceOpen) remaining = "```\n" + remaining + "\n```";
    chunks.push(remaining);
  }
  return chunks;
}

