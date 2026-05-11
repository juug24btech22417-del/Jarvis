// Telegram Bot API client
// Simple polling-based implementation

const TELEGRAM_API = "https://api.telegram.org/bot";

interface TelegramMessage {
  message_id: number;
  chat: { id: number; first_name?: string; username?: string };
  from?: { id: number; is_bot: boolean };
  text?: string;
  voice?: { file_id: string; duration: number };
  date: number;
  isFromMe?: boolean;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// In-memory storage for messages
let messages: TelegramMessage[] = [];
let lastUpdateId = 0;
let botUserId: number | null = null;

// Set bot user ID (used to identify outgoing messages)
export function setBotUserId(id: number) {
  botUserId = id;
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
}

// Get bot info
export async function getBotInfo(token: string) {
  const res = await fetch(`${TELEGRAM_API}${token}/getMe`);
  return res.json();
}

// Poll for new messages
export async function pollMessages(token: string): Promise<TelegramUpdate[]> {
  try {
    const res = await fetch(
      `${TELEGRAM_API}${token}/getUpdates?offset=${lastUpdateId + 1}&limit=100`,
      { cache: "no-store" }
    );
    const data = await res.json();

    if (data.ok && data.result.length > 0) {
      data.result.forEach((update: TelegramUpdate) => {
        if (update.update_id > lastUpdateId) {
          lastUpdateId = update.update_id;
        }
        if (update.message) {
          messages.push(update.message);
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
