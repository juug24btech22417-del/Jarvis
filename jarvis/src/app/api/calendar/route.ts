import { NextRequest, NextResponse } from "next/server";

// Google Calendar API configuration
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime: string; date?: string };
  end: { dateTime: string; date?: string };
  location?: string;
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  hangoutLink?: string;
  htmlLink: string;
  status: string;
  created: string;
  updated: string;
}

// Token cache
let cachedToken: { access_token: string; expires_at: number } | null = null;

// Get access token using refresh token
async function getAccessToken(): Promise<string | null> {
  // Return cached token if still valid (with 5 minute buffer)
  if (cachedToken && cachedToken.expires_at > Date.now() + 5 * 60 * 1000) {
    return cachedToken.access_token;
  }

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    console.log("Calendar: Missing credentials, using demo mode");
    return null;
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error("Token refresh failed:", error);
      return null;
    }

    const data = await response.json();

    // Cache the token
    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    };

    console.log("Calendar: Access token refreshed successfully");
    return data.access_token;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    return null;
  }
}

// Fetch events from Google Calendar
async function fetchEvents(
  calendarId: string = "primary",
  maxResults: number = 10
): Promise<{ events: CalendarEvent[]; authenticated: boolean }> {
  const token = await getAccessToken();

  if (!token) {
    console.log("Calendar: No token available, returning demo events");
    return { events: getMockEvents(), authenticated: false };
  }

  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 7); // Next 7 days

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(
        calendarId
      )}/events?maxResults=${maxResults}&timeMin=${encodeURIComponent(
        timeMin
      )}&timeMax=${encodeURIComponent(
        timeMax.toISOString()
      )}&orderBy=startTime&singleEvents=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired, clear cache and retry once
        cachedToken = null;
        const newToken = await getAccessToken();
        if (newToken) {
          return fetchEvents(calendarId, maxResults);
        }
      }
      throw new Error(`Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Calendar: Fetched ${data.items?.length || 0} real events`);
    return { events: data.items || [], authenticated: true };
  } catch (error) {
    console.error("Failed to fetch calendar events:", error);
    return { events: getMockEvents(), authenticated: false };
  }
}

// Create a new event
async function createEvent(eventData: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
}): Promise<CalendarEvent | null> {
  const token = await getAccessToken();

  if (!token) {
    throw new Error("Not authenticated with Google Calendar");
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: eventData.summary,
        description: eventData.description,
        start: { dateTime: eventData.start },
        end: { dateTime: eventData.end },
        location: eventData.location,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to create event: ${response.status}`);
  }

  return response.json();
}

// Delete an event
async function deleteEvent(eventId: string): Promise<boolean> {
  const token = await getAccessToken();

  if (!token) {
    throw new Error("Not authenticated with Google Calendar");
  }

  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(
      eventId
    )}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  return response.ok || response.status === 204;
}

// Mock events for demo mode
function getMockEvents(): CalendarEvent[] {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dayAfter = new Date(now);
  dayAfter.setDate(dayAfter.getDate() + 2);

  return [
    {
      id: "mock-1",
      summary: "Team Standup (Demo)",
      description: "Daily team sync meeting - This is a demo event. Connect Google Calendar to see your real events.",
      start: { dateTime: new Date(now.setHours(9, 0, 0, 0)).toISOString() },
      end: { dateTime: new Date(now.setHours(9, 30, 0, 0)).toISOString() },
      location: "Conference Room A",
      htmlLink: "#",
      status: "confirmed",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      attendees: [
        { email: "team@example.com", responseStatus: "accepted" },
      ],
    },
    {
      id: "mock-2",
      summary: "Project Review (Demo)",
      description: "Review Q1 project milestones - Demo event",
      start: {
        dateTime: new Date(tomorrow.setHours(14, 0, 0, 0)).toISOString(),
      },
      end: {
        dateTime: new Date(tomorrow.setHours(15, 0, 0, 0)).toISOString(),
      },
      location: "Zoom Meeting",
      hangoutLink: "https://zoom.us/j/123456789",
      htmlLink: "#",
      status: "confirmed",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    {
      id: "mock-3",
      summary: "Lunch with Client (Demo)",
      description: "Discuss new project requirements - Demo event",
      start: {
        dateTime: new Date(dayAfter.setHours(12, 0, 0, 0)).toISOString(),
      },
      end: {
        dateTime: new Date(dayAfter.setHours(13, 30, 0, 0)).toISOString(),
      },
      location: "Downtown Bistro",
      htmlLink: "#",
      status: "tentative",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  ];
}

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

        const token = await getAccessToken();
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

        const token = await getAccessToken();
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
