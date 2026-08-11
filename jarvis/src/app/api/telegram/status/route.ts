import { NextResponse } from "next/server";
import { getBotInfo, getAllowedChatIds } from "@/lib/telegram";
import { ensurePollerStarted } from "@/lib/telegram/poller";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// GET /api/telegram/status - Check bot connection
export async function GET() {
  ensurePollerStarted();

  if (!TELEGRAM_TOKEN) {
    return NextResponse.json(
      { success: false, error: "Telegram bot token not configured" },
      { status: 500 }
    );
  }

  try {
    const data = await getBotInfo(TELEGRAM_TOKEN);

    if (data.ok) {
      return NextResponse.json({
        success: true,
        botName: data.result.first_name,
        botUsername: data.result.username,
        canReadMessages: true,
        allowedChatIds: Array.from(getAllowedChatIds()),
        serverPolling: true,
      });
    } else {
      return NextResponse.json(
        { success: false, error: "Invalid bot token" },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error("[Telegram Status] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to connect to Telegram",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
