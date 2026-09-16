import { NextRequest, NextResponse } from "next/server";
import { fetchEvents, isCalendarConfigured, getMockEvents, createEvent, deleteEvent, type CalendarEvent } from "@/lib/googleCalendar";
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const maxResults = parseInt(searchParams.get("maxResults") || "10", 10);

    const { events, authenticated } = await fetchEvents("primary", maxResults);

    return NextResponse.json({
      success: true,
      events: events.map((event) => ({
        id: event.id,
        title: event.summary,
        description: event.description,
        start: event.start.dateTime || event.start.date,
        end: event.end.dateTime || event.end.date,
        location: event.location,
        attendees: event.attendees,
        meetLink: event.hangoutLink,
        link: event.htmlLink,
        status: event.status,
        isAllDay: !event.start.dateTime,
      })),
      authenticated,
    });
  } catch (error) {
    console.error("Calendar API error:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch calendar events",
        details: String(error),
        events: getMockEvents(),
        authenticated: false,
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create": {
        const { summary, description, start, end, location } = body;
        if (!summary || !start || !end) {
          return NextResponse.json(
            { error: "Missing required fields" },
            { status: 400 }
          );
        }

        const token = isCalendarConfigured();
        if (!token) {
          // Demo mode - create mock event
          return NextResponse.json({
            success: true,
            event: {
              id: `demo-${Date.now()}`,
              title: summary,
              description,
              start,
              end,
              location,
              status: "confirmed",
              isDemo: true,
            },
            demo: true,
          });
        }

        const event = await createEvent({ summary, description, start, end, location });
        if (!event) {
          return NextResponse.json(
            { success: false, error: "Failed to create event" },
            { status: 500 }
          );
        }
        // Transform to frontend format
        const formattedEvent = {
          id: event.id,
          title: event.summary,
          description: event.description,
          start: event.start.dateTime || event.start.date,
          end: event.end.dateTime || event.end.date,
          location: event.location,
          attendees: event.attendees,
          meetLink: event.hangoutLink,
          link: event.htmlLink,
          status: event.status,
          isAllDay: !event.start.dateTime,
        };
        return NextResponse.json({ success: true, event: formattedEvent });
      }

      case "delete": {
        const { eventId } = body;
        if (!eventId) {
          return NextResponse.json(
            { error: "Event ID required" },
            { status: 400 }
          );
        }

        const token = isCalendarConfigured();
        if (!token) {
          return NextResponse.json(
            { error: "Not authenticated", demo: true },
            { status: 401 }
          );
        }

        const success = await deleteEvent(eventId);
        return NextResponse.json({ success });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Calendar API error:", error);
    return NextResponse.json(
      { error: "Calendar command failed", details: String(error) },
      { status: 500 }
    );
  }
}
