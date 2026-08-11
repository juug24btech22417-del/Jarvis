// POST /api/telegram/notify — fire-and-forget push helper for any
// non-Telegram caller (React panel, agent, scheduler, briefing).
//
// Body: { chatId?: number, text: string, silent?: boolean, voice?: boolean, buttons?: InlineKeyboardButton[][] }
//
// Auth: caller must be reachable on localhost. (Same trust model as
// /api/os/command — we don't expose this to the open internet.)

import { NextRequest, NextResponse } from "next/server";
import { notifyUser } from "@/lib/telegram/notify";
import { getAllowedChatIds } from "@/lib/telegram";

interface NotifyBody {
  chatId?: number;
  text?: string;
  silent?: boolean;
  voice?: boolean;
  buttons?: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
  parseMode?: "MarkdownV2" | "HTML";
  fromSource?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as NotifyBody;
    if (!body.text || !body.text.trim()) {
      return NextResponse.json(
        { error: "text is required" },
        { status: 400 }
      );
    }
    // If chatId omitted, fall through to notifyUser's default which
    // resolves to TELEGRAM_ALLOWED_CHAT_IDS[0]. If that env var is
    // empty, we'll get { sent: false, error: "no_target" }.
    const result = await notifyUser(body.chatId ?? null, body.text, {
      silent: !!body.silent,
      voice: !!body.voice,
      buttons: body.buttons as any,
      parseMode: body.parseMode,
      fromSource: body.fromSource,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("[api/telegram/notify] error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "telegram/notify",
    allowedChatIds: Array.from(getAllowedChatIds()),
  });
}