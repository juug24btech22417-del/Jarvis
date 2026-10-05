// Feed scrolling API.
//
// POST { action: "start", goal }  → opens the feed in the user's REAL browser
//                                   and scrolls it until stopped
// POST { action: "stop", id? }    → stops one session, or all of them
// GET                             → list running sessions
//
// Runs against the user's own Chrome rather than the bundled Chromium: Shorts
// and Reels both bot-wall the bundled binary before the first video loads.

import { NextRequest, NextResponse } from "next/server";
import { startFeedScroll, stopFeedScroll, listFeedSessions } from "@/services/BrowserAgentService";

export async function GET() {
  return NextResponse.json({ success: true, sessions: listFeedSessions() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";

  if (action === "start") {
    try {
      const started = await startFeedScroll({
        goal: typeof body.goal === "string" ? body.goal : undefined,
        site: typeof body.site === "string" ? body.site : undefined,
        intervalMs: typeof body.intervalMs === "number" ? body.intervalMs : undefined,
        jobId: typeof body.jobId === "string" ? body.jobId : undefined,
      });
      return NextResponse.json({ success: true, ...started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Feed API] start failed:", message);
      return NextResponse.json({ success: false, error: message }, { status: 500 });
    }
  }

  if (action === "stop") {
    const id = typeof body.id === "string" ? body.id : undefined;
    return NextResponse.json({ success: true, ...stopFeedScroll(id) });
  }

  return NextResponse.json(
    { success: false, error: "action must be 'start' or 'stop'" },
    { status: 400 }
  );
}
