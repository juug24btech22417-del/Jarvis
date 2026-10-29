import { NextRequest, NextResponse } from "next/server";
import {
  ensureAutoJoinStarted,
  forgetAutoJoinedEvent,
  getAutoJoinStatus,
  joinEventNow,
  previewAutoJoin,
  resetAutoJoinHistory,
  runAutoJoinTick,
  updateAutoJoinSettings,
} from "@/services/MeetingAutoJoinService";

// Auto-attend from Google Calendar.
//
// GET             → current settings, the upcoming linked events with their
//                   verdicts, and what the last check did.
// POST action:
//   tick          → full check; joins a due meeting (the heartbeat calls this)
//   preview       → same decisions, never joins (panel + tests)
//   settings      → update the auto-attend knobs
//   join-now      → force-join one calendar event
//   forget        → allow an event to be attended again
//   reset-history → clear the attended ledger
export async function GET() {
  ensureAutoJoinStarted();
  return NextResponse.json({ success: true, ...getAutoJoinStatus() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}) as Record<string, unknown>);
    const action = typeof body?.action === "string" ? body.action : "tick";
    ensureAutoJoinStarted();

    switch (action) {
      case "tick": {
        // Dev/e2e seam: a synthetic calendar lets the test prove an unattended
        // join without waiting for a real meeting to land on the calendar. In a
        // production build this branch does not exist.
        const events =
          process.env.NODE_ENV !== "production" && Array.isArray(body.events)
            ? (body.events as Record<string, unknown>[])
            : undefined;
        const result = await runAutoJoinTick({ events });
        return NextResponse.json({ success: true, ...result, status: getAutoJoinStatus() });
      }

      case "preview": {
        const events =
          process.env.NODE_ENV !== "production" && Array.isArray(body.events)
            ? (body.events as Record<string, unknown>[])
            : undefined;
        const result = await previewAutoJoin({ events });
        return NextResponse.json({ success: true, ...result, status: getAutoJoinStatus() });
      }

      case "settings": {
        updateAutoJoinSettings(body.settings ?? {});
        return NextResponse.json({ success: true, ...getAutoJoinStatus() });
      }

      case "join-now": {
        const eventId = typeof body.eventId === "string" ? body.eventId : "";
        if (!eventId) {
          return NextResponse.json({ success: false, error: "eventId is required" }, { status: 400 });
        }
        const result = await joinEventNow(eventId);
        return NextResponse.json({ success: result.joined, ...result, status: getAutoJoinStatus() });
      }

      case "forget": {
        const eventId = typeof body.eventId === "string" ? body.eventId : "";
        const forgotten = forgetAutoJoinedEvent(eventId);
        return NextResponse.json({ success: forgotten, ...getAutoJoinStatus() });
      }

      case "reset-history": {
        const cleared = resetAutoJoinHistory();
        return NextResponse.json({ success: true, cleared, ...getAutoJoinStatus() });
      }

      case "status":
        return NextResponse.json({ success: true, ...getAutoJoinStatus() });

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "auto-join request failed";
    console.error("Meeting Auto-Join API Error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
