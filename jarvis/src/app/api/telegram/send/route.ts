import { NextRequest, NextResponse } from "next/server";
import { sendMessage, addSentMessage } from "@/lib/telegram";
import { enqueueTelegramMessage } from "@/lib/telegram/queue";
import { ensurePollerStarted } from "@/lib/telegram/poller";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// POST /api/telegram/send - Send a message (also records in the queue so
// the panel shows it alongside inbound).
export async function POST(req: NextRequest) {
  ensurePollerStarted();

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
      // Add to local in-memory buffer (legacy display support) and to
      // the Prisma queue so the panel's display-only view sees it.
      addSentMessage(chatIdNum, text);
      await enqueueTelegramMessage({
        chatId: chatIdNum,
        direction: "outbound",
        text,
        status: "sent",
      }).catch((err) =>
        console.error("[telegram/send] queue insert failed:", err)
      );

      return NextResponse.json({
        success: true,
        message: "Message sent",
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
