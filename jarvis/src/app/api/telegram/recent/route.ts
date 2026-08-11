import { NextRequest, NextResponse } from "next/server";
import { ensurePollerStarted } from "@/lib/telegram/poller";
import { getRecent, getRecentForChat } from "@/lib/telegram/queue";

// GET /api/telegram/recent?chatId=123&limit=50
// Returns recent messages from the queue, ordered by createdAt ASC so
// the React panel can render them in chronological order.
export async function GET(req: NextRequest) {
  ensurePollerStarted();
  const { searchParams } = req.nextUrl;
  const chatIdRaw = searchParams.get("chatId");
  const limit = Math.min(
    parseInt(searchParams.get("limit") ?? "100", 10) || 100,
    500
  );

  if (chatIdRaw) {
    const chatId = parseInt(chatIdRaw, 10);
    if (!Number.isFinite(chatId)) {
      return NextResponse.json({ error: "invalid chatId" }, { status: 400 });
    }
    const messages = await getRecentForChat(chatId, limit);
    return NextResponse.json({ success: true, messages });
  }

  const messages = await getRecent(limit);
  return NextResponse.json({ success: true, messages });
}
