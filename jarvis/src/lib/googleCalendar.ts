// Google Calendar core — shared by /api/calendar (panel + API) and the
// chat route's live calendar shortcut. Kept here so chat can call it
// in-process (self-HTTP fetches race the dev server and abort under load).

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface CalendarEvent {
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
  if (cachedToken && cachedToken.expires_at > Date.now() + 5 * 60 * 1000) {
    return cachedToken.access_token;
  }

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    return null;
  }

  try {
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000,
    };
    return cachedToken.access_token;
  } catch {
    return null;
  }
}

/** True when real Google Calendar credentials exist. */
export function isCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

interface ComposioCalEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  status?: string;
  created?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
}

/**
 * Fetch upcoming events through composio's GOOGLECALENDAR_FIND_EVENT action
 * (uses the connected googlecalendar account — the primary path, since the
 * direct OAuth refresh token in .env.local is often stale/expired).
 * Returns null when composio isn't configured/connected.
 */
export async function fetchEventsViaComposio(maxResults = 12): Promise<{ events: CalendarEvent[]; authenticated: boolean } | null> {
  if (!process.env.COMPOSIO_API_KEY) return null;
  try {
    const prisma = (await import("@/lib/db/queries")).prisma;
    const conn = await prisma.composioConnection.findFirst({
      where: { toolkitSlug: "googlecalendar", status: { in: ["SUCCESS", "ACTIVE"] } },
      orderBy: { updatedAt: "desc" },
    });
    if (!conn) return null;

    const { Composio } = await import("@composio/core");
    const c = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });
    const timeMin = new Date().toISOString();
    const res = await c.tools.execute(
      "GOOGLECALENDAR_FIND_EVENT",
      {
        userId: process.env.COMPOSIO_USER_ID?.trim() || "jarvis-local",
        connectedAccountId: conn.connectedAccountId,
        dangerouslySkipVersionCheck: true,
        arguments: { calendar_id: "primary", max_results: maxResults, time_min: timeMin, single_events: true, order_by: "startTime" },
      },
      { signal: AbortSignal.timeout(15_000) }
    );
    if (!res.successful) return null;

    const data = (res.data ?? {}) as { events?: ComposioCalEvent[] } | ComposioCalEvent[];
    const raw = Array.isArray(data) ? data : (data.events ?? (data as { data?: ComposioCalEvent[] }).data ?? []);
    const events: CalendarEvent[] = (raw as ComposioCalEvent[])
      .filter((e) => e && (e.start?.dateTime || e.start?.date))
      .map((e) => ({
        id: e.id ?? "composio-event",
        summary: e.summary ?? "(untitled)",
        description: e.description,
        start: { dateTime: e.start?.dateTime ?? "", date: e.start?.date },
        end: { dateTime: e.end?.dateTime ?? e.start?.dateTime ?? "", date: e.end?.date },
        location: e.location,
        attendees: e.attendees,
        hangoutLink: e.hangoutLink,
        htmlLink: e.htmlLink ?? "#",
        status: e.status ?? "confirmed",
        created: e.created ?? new Date().toISOString(),
        updated: e.updated ?? new Date().toISOString(),
      }));
    return { events, authenticated: true };
  } catch (e) {
    console.warn("[gcal] composio fetch failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Fetch upcoming events. Composio first, then direct OAuth, then demo events. */
export async function fetchEvents(
  calendarId: string = "primary",
  maxResults: number = 10
): Promise<{ events: CalendarEvent[]; authenticated: boolean }> {
  const viaComposio = await fetchEventsViaComposio(maxResults);
  if (viaComposio) return viaComposio;
  const token = await getAccessToken();
  if (!token) {
    return { events: getMockEvents(), authenticated: false };
  }

  try {
    const timeMin = new Date().toISOString();
    const timeMax = new Date();
    timeMax.setDate(timeMax.getDate() + 7);

    const response = await fetch(
      `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?maxResults=${maxResults}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax.toISOString())}&orderBy=startTime&singleEvents=true`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );

    if (!response.ok) {
      if (response.status === 401) {
        cachedToken = null;
        const newToken = await getAccessToken();
        if (newToken) return fetchEvents(calendarId, maxResults);
      }
      throw new Error(`Calendar API error: ${response.status}`);
    }

    const data = await response.json();
    return { events: data.items || [], authenticated: true };
  } catch {
    return { events: getMockEvents(), authenticated: false };
  }
}

/** Create an event. Throws when unauthenticated. */
export async function createEvent(eventData: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
}): Promise<CalendarEvent | null> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated with Google Calendar");

  const response = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: eventData.summary,
      description: eventData.description,
      start: { dateTime: eventData.start },
      end: { dateTime: eventData.end },
      location: eventData.location,
    }),
  });
  if (!response.ok) throw new Error(`Failed to create event: ${response.status}`);
  return response.json();
}

/** Delete an event. */
export async function deleteEvent(eventId: string): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated with Google Calendar");
  const response = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  return response.ok || response.status === 204;
}

export function getMockEvents(): CalendarEvent[] {
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
      attendees: [{ email: "team@example.com", responseStatus: "accepted" }],
    },
    {
      id: "mock-2",
      summary: "Project Review (Demo)",
      description: "Review Q1 project milestones - Demo event",
      start: { dateTime: new Date(tomorrow.setHours(14, 0, 0, 0)).toISOString() },
      end: { dateTime: new Date(tomorrow.setHours(15, 0, 0, 0)).toISOString() },
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
      start: { dateTime: new Date(dayAfter.setHours(12, 0, 0, 0)).toISOString() },
      end: { dateTime: new Date(dayAfter.setHours(13, 30, 0, 0)).toISOString() },
      location: "Downtown Bistro",
      htmlLink: "#",
      status: "tentative",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  ];
}
