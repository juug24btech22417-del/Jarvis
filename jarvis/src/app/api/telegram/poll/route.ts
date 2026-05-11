import { NextResponse } from "next/server";
import { pollMessages, getChats, getMessages } from "@/lib/telegram";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// GET /api/telegram/poll - Get updates and messages
export async function GET() {
  if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === "your_bot_token_here") {
    return NextResponse.json(
      { success: false, error: "Telegram bot token not configured. Add TELEGRAM_BOT_TOKEN to .env.local" },
      { status: 500 }
    );
  }

  try {
    // Poll for new messages
    await pollMessages(TELEGRAM_TOKEN);

    // Return current state
    return NextResponse.json({
      success: true,
      chats: getChats(),
      messages: getMessages(),
    });
  } catch (error) {
    console.error("[Telegram Poll] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to poll messages",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
