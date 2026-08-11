import { NextResponse } from "next/server";
import { ensurePollerStarted } from "@/lib/telegram/poller";
import { getSeenChatIds } from "@/lib/telegram/queue";
import { getAllowedChatIds } from "@/lib/telegram";

// GET /api/telegram/seen-chats
// Returns the unique chat IDs we've ever received a message from, and
// the IDs currently in the allow-list. The panel uses this to show an
// "Authorize this chat ID" banner when ALLOWED is empty.
export async function GET() {
  ensurePollerStarted();
  const seen = await getSeenChatIds();
  const allowed = Array.from(getAllowedChatIds());
  return NextResponse.json({
    success: true,
    seen,
    allowed,
    needsAuth: seen.length > 0 && allowed.length === 0,
  });
}
