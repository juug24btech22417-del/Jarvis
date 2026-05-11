import { NextRequest, NextResponse } from "next/server";
import { sendMessage, getChatMessages, addSentMessage } from "@/lib/telegram";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// POST /api/telegram/send - Send a message
export async function POST(req: NextRequest) {
  if (!TELEGRAM_TOKEN) {
    return NextResponse.json(
      { success: false, error: "Telegram bot token not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await req.json();
    const { chatId, text } = body;

    if (!chatId || !text) {
      return NextResponse.json(
        { success: false, error: "chatId and text are required" },
        { status: 400 }
      );
    }

    const chatIdNum = parseInt(chatId);
    const result = await sendMessage(TELEGRAM_TOKEN, chatIdNum, text);

    if (result.success) {
      // Add sent message to local storage since Telegram doesn't include sent messages in updates
      addSentMessage(chatIdNum, text);

      return NextResponse.json({
        success: true,
        message: "Message sent",
        chatMessages: getChatMessages(chatIdNum),
      });
    } else {
      return NextResponse.json(
        { success: false, error: result.error || result.description },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("[Telegram Send] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to send message",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
