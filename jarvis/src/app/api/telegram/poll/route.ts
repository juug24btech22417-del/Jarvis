import { NextResponse } from "next/server";
import { ensurePollerStarted, runTickOnce } from "@/lib/telegram/poller";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// GET /api/telegram/poll
// Backward-compat endpoint used by the React panel. Now mostly a status
// probe + manual tick trigger; the actual polling happens server-side
// via the node-cron singleton in ensurePollerStarted().
export async function GET(req: Request) {
  ensurePollerStarted();

  if (!TELEGRAM_TOKEN || TELEGRAM_TOKEN === "your_bot_token_here") {
    return NextResponse.json(
      {
        success: false,
        error:
          "Telegram bot token not configured. Add TELEGRAM_BOT_TOKEN to .env.local",
        serverPolling: false,
      },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const trigger = url.searchParams.get("trigger");
  if (trigger === "1") {
    // Manual tick — useful from the panel's "Check now" button.
    runTickOnce().catch((err) =>
      console.error("[telegram/poll] manual tick failed:", err)
    );
  }

  return NextResponse.json({
    success: true,
    serverPolling: true,
    note: "Polling is server-side. Use /api/telegram/recent to read messages.",
  });
}
