// Auto-attend scheduler — the calendar decides, the bot walks in.
//
// WHY THIS EXISTS
// The bot only ever joined a meeting when a link was pasted into the panel by
// hand. A lecture that is already on the calendar, with its Meet link already on
// the event, should not need a human at all: check the calendar, and when an
// event with a conference link reaches its start time, send the bot in.
//
// HOW IT STAYS HONEST
//   • Opt-in: `enabled` defaults to false because auto-attend opens a real
//     browser window on the user's desktop.
//   • One meeting at a time: the tick bails while a bot session is live, so it
//     can never stack a second Chrome.
//   • Attended events are remembered in the settings file, so a restart (or a
//     dev hot-reload) doesn't walk back into the same lecture.
//   • Demo/mock calendar data never triggers a join — if the calendar isn't
//     authenticated the tick reports that instead of opening fake Zoom links.
//
// The decision logic itself lives in @/lib/meeting/autoJoin and is pure/tested;
// this file owns persistence, timing and the actual join call.
//
// Pinned to globalThis so dev hot reloads don't stack up duplicate timers.

import * as fs from "fs";
import path from "path";
import { fetchEvents } from "@/lib/googleCalendar";
import { meetingBot } from "@/services/MeetingBotService";
import {
  DEFAULT_AUTO_JOIN_SETTINGS,
  decisionBadge,
  eventStartMs,
  extractMeetingLinks,
  formatDuration,
  normalizeAutoJoinSettings,
  platformLabel,
  shouldAutoJoin,
  type AutoJoinDecision,
  type AutoJoinSettings,
  type CalendarEventLike,
} from "@/lib/meeting/autoJoin";

const SETTINGS_FILE = path.join(process.cwd(), ".jarvis-data", "meeting-autojoin.json");
const CALENDAR_LOOKAHEAD = 25;
const HANDLED_TTL_MS = 12 * 60 * 60 * 1000;
/** Scheduler granularity — the poll interval itself is a live setting. */
const SCHEDULE_RESOLUTION_MS = 15_000;

export interface AutoJoinEventView {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  platform: string | null;
  url: string | null;
  linkSource: string | null;
  badge: string;
  reason: string;
  message: string;
  willJoin: boolean;
  startsInMs: number | null;
}

export interface AutoJoinTickResult {
  ran: boolean;
  skipped?: "disabled" | "already-in-meeting" | "already-running" | "calendar-unauthenticated" | "no-events";
  joined: boolean;
  joinedEventId?: string;
  joinedTitle?: string;
  joinedUrl?: string;
  error?: string;
  events: AutoJoinEventView[];
  calendarAuthenticated: boolean;
}

interface HandledEntry {
  joinedAt: string;
  title: string;
  url: string;
  platform: string;
}

interface Runtime {
  settings: AutoJoinSettings;
  handled: Record<string, HandledEntry>;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
  tickCount: number;
  lastTickAt: number | null;
  lastError: string | null;
  lastJoined: (HandledEntry & { eventId: string }) | null;
  upcoming: AutoJoinEventView[];
  calendarAuthenticated: boolean;
  lastCalendarAt: number | null;
  lastSkip: AutoJoinTickResult["skipped"] | null;
}

const g = globalThis as unknown as { __jarvisMeetingAutoJoin?: Runtime };
if (!g.__jarvisMeetingAutoJoin) {
  g.__jarvisMeetingAutoJoin = {
    settings: { ...DEFAULT_AUTO_JOIN_SETTINGS },
    handled: {},
    timer: null,
    inFlight: false,
    tickCount: 0,
    lastTickAt: null,
    lastError: null,
    lastJoined: null,
    upcoming: [],
    calendarAuthenticated: false,
    lastCalendarAt: null,
    lastSkip: null,
  };
}
const rt = g.__jarvisMeetingAutoJoin;

/* ------------------------------- persistence ------------------------------- */

function loadFromDisk() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as {
      settings?: unknown;
      handled?: Record<string, HandledEntry>;
    };
    rt.settings = normalizeAutoJoinSettings(raw.settings);
    rt.handled = raw.handled && typeof raw.handled === "object" ? raw.handled : {};
    pruneHandled();
  } catch (e) {
    console.warn("[MeetingAutoJoin] settings load failed:", (e as Error)?.message);
  }
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(
      SETTINGS_FILE,
      JSON.stringify({ settings: rt.settings, handled: rt.handled }, null, 2),
      "utf8"
    );
  } catch (e) {
    console.warn("[MeetingAutoJoin] settings save failed:", (e as Error)?.message);
  }
}

function pruneHandled() {
  const cutoff = Date.now() - HANDLED_TTL_MS;
  for (const [id, entry] of Object.entries(rt.handled)) {
    const at = new Date(entry.joinedAt).getTime();
    if (!Number.isFinite(at) || at < cutoff) delete rt.handled[id];
  }
}

loadFromDisk();

/* --------------------------------- helpers -------------------------------- */

function participantDetails() {
  return {
    name: process.env.MEETING_BOT_NAME || "Dhruv",
    email: process.env.JARVIS_PROFILE_EMAIL || process.env.MEETING_BOT_EMAIL || "dhruvbijapur@gmail.com",
    phone: process.env.JARVIS_PROFILE_PHONE || "",
  };
}

function toEventView(
  event: CalendarEventLike,
  decision: AutoJoinDecision,
  now: number
): AutoJoinEventView {
  const start = eventStartMs(event);
  return {
    id: event.id || "",
    title: event.summary || "(untitled)",
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    platform: decision.link ? platformLabel(decision.link.platform) : null,
    url: decision.link?.url ?? null,
    linkSource: decision.link?.source ?? null,
    badge: decisionBadge(decision),
    reason: decision.reason,
    message: decision.message,
    willJoin: decision.join,
    startsInMs: start === null ? null : start - now,
  };
}

function decisionsFor(events: CalendarEventLike[], now: number) {
  return events
    .slice()
    .sort((a, b) => (eventStartMs(a) ?? Number.MAX_SAFE_INTEGER) - (eventStartMs(b) ?? Number.MAX_SAFE_INTEGER))
    .map((event) => ({
      event,
      decision: shouldAutoJoin(event, {
        now,
        settings: rt.settings,
        handledEventIds: rt.handled,
      }),
    }));
}

/* ---------------------------------- tick ---------------------------------- */

/**
 * One pass over the calendar. `events` is a dev/e2e seam (see the route) that
 * lets a test drive the scheduler without touching the real calendar; production
 * ticks always read the calendar.
 */
export async function runAutoJoinTick(
  options: { events?: CalendarEventLike[]; now?: number } = {}
): Promise<AutoJoinTickResult> {
  const now = options.now ?? Date.now();

  if (rt.inFlight) {
    return { ran: false, skipped: "already-running", joined: false, events: rt.upcoming, calendarAuthenticated: rt.calendarAuthenticated };
  }
  rt.inFlight = true;
  rt.tickCount += 1;
  rt.lastTickAt = now;

  try {
    if (!rt.settings.enabled) {
      rt.lastSkip = "disabled";
      return { ran: true, skipped: "disabled", joined: false, events: [], calendarAuthenticated: rt.calendarAuthenticated };
    }

    const botStatus = meetingBot.getStatus();
    if (botStatus.isActive) {
      rt.lastSkip = "already-in-meeting";
      return {
        ran: true,
        skipped: "already-in-meeting",
        joined: false,
        events: rt.upcoming,
        calendarAuthenticated: rt.calendarAuthenticated,
      };
    }

    let events: CalendarEventLike[];
    if (options.events) {
      events = options.events;
    } else {
      const res = await fetchEvents("primary", CALENDAR_LOOKAHEAD);
      if (!res.authenticated) {
        // Mock/demo events must never send the bot into a fake meeting.
        rt.calendarAuthenticated = false;
        rt.lastSkip = "calendar-unauthenticated";
        rt.lastError = "Google Calendar is not connected.";
        return { ran: true, skipped: "calendar-unauthenticated", joined: false, events: [], calendarAuthenticated: false };
      }
      rt.calendarAuthenticated = true;
      events = res.events as CalendarEventLike[];
    }

    rt.lastCalendarAt = Date.now();
    const evaluated = decisionsFor(events, now);
    rt.upcoming = evaluated.slice(0, 8).map(({ event, decision }) => toEventView(event, decision, now));

    const candidate = evaluated.find((e) => e.decision.join && Boolean(e.decision.link));
    const chosenLink = candidate?.decision.link;
    if (!candidate || !chosenLink) {
      rt.lastSkip = "no-events";
      rt.lastError = null;
      return {
        ran: true,
        skipped: "no-events",
        joined: false,
        events: rt.upcoming,
        calendarAuthenticated: rt.calendarAuthenticated,
      };
    }

    const { event, decision } = candidate;
    const url = chosenLink.url;
    const title = event.summary || "(untitled)";
    console.log(`[MeetingAutoJoin] 🚪 ${decision.message} → ${url}`);

    // The event title travels with the session so the notes are named after the
    // lecture/standup instead of "Meeting Notes — <date>".
    const result = await meetingBot.joinMeeting(url, { ...participantDetails(), title });

    if (!result?.success) {
      const error = (result as { error?: string })?.error || "join failed";
      rt.lastError = error;
      console.warn(`[MeetingAutoJoin] join failed: ${error}`);
      return {
        ran: true,
        joined: false,
        error,
        events: rt.upcoming,
        calendarAuthenticated: rt.calendarAuthenticated,
      };
    }

    const entry: HandledEntry = {
      joinedAt: new Date(now).toISOString(),
      title,
      url,
      platform: platformLabel(chosenLink.platform),
    };
    if (event.id) rt.handled[event.id] = entry;
    rt.lastJoined = { eventId: event.id || "", ...entry };
    rt.lastError = null;
    pruneHandled();
    persist();
    rt.upcoming = rt.upcoming.map((v) =>
      v.id === event.id ? { ...v, willJoin: false, badge: "Attended", reason: "already-joined" } : v
    );

    return {
      ran: true,
      joined: true,
      joinedEventId: event.id || "",
      joinedTitle: title,
      joinedUrl: url,
      events: rt.upcoming,
      calendarAuthenticated: true,
    };
  } catch (e) {
    rt.lastError = (e as Error)?.message || "auto-join tick failed";
    console.warn("[MeetingAutoJoin] tick error:", rt.lastError);
    return {
      ran: true,
      joined: false,
      error: rt.lastError,
      events: rt.upcoming,
      calendarAuthenticated: rt.calendarAuthenticated,
    };
  } finally {
    rt.inFlight = false;
  }
}

/** Dry run — same decisions, never joins. Used by the panel and by tests. */
export async function previewAutoJoin(
  options: { events?: CalendarEventLike[]; now?: number } = {}
): Promise<AutoJoinTickResult> {
  const now = options.now ?? Date.now();
  try {
    let events: CalendarEventLike[];
    let authenticated = rt.calendarAuthenticated;
    if (options.events) {
      events = options.events;
    } else {
      const res = await fetchEvents("primary", CALENDAR_LOOKAHEAD);
      authenticated = res.authenticated;
      
      events = res.events as CalendarEventLike[];
    }
    rt.calendarAuthenticated = authenticated;
    const evaluated = decisionsFor(events, now);
    rt.upcoming = evaluated.slice(0, 8).map(({ event, decision }) => toEventView(event, decision, now));
    rt.lastCalendarAt = Date.now();
    rt.lastError = authenticated ? null : "Google Calendar is not connected.";
    return {
      ran: true,
      joined: false,
      events: rt.upcoming,
      calendarAuthenticated: authenticated,
    };
  } catch (e) {
    rt.lastError = (e as Error)?.message || "calendar preview failed";
    return { ran: false, joined: false, error: rt.lastError, events: rt.upcoming, calendarAuthenticated: rt.calendarAuthenticated };
  }
}

/** Force-join one known event (the panel's "Join now"). */
export async function joinEventNow(eventId: string): Promise<AutoJoinTickResult> {
  const view = rt.upcoming.find((v) => v.id === eventId);
  let url = view?.url || null;
  let title = view?.title || "Calendar meeting";

  if (!url) {
    const res = await fetchEvents("primary", CALENDAR_LOOKAHEAD);
    const event = (res.events as CalendarEventLike[]).find((e) => e.id === eventId);
    if (!event) {
      return { ran: false, joined: false, error: "Event not found on the calendar.", events: rt.upcoming, calendarAuthenticated: rt.calendarAuthenticated };
    }
    const links = extractMeetingLinks(event);
    url = links[0]?.url ?? null;
    title = event.summary || title;
  }

  if (!url) {
    return { ran: false, joined: false, error: `${title}: no Meet/Zoom link on the event.`, events: rt.upcoming, calendarAuthenticated: rt.calendarAuthenticated };
  }

  const result = await meetingBot.joinMeeting(url, { ...participantDetails(), title });
  if (!result?.success) {
    const error = (result as { error?: string })?.error || "join failed";
    rt.lastError = error;
    return { ran: true, joined: false, error, events: rt.upcoming, calendarAuthenticated: rt.calendarAuthenticated };
  }

  const entry: HandledEntry = {
    joinedAt: new Date().toISOString(),
    title,
    url,
    platform: url.includes("zoom.us") ? "Zoom" : "Google Meet",
  };
  if (eventId) rt.handled[eventId] = entry;
  rt.lastJoined = { eventId, ...entry };
  pruneHandled();
  persist();

  return {
    ran: true,
    joined: true,
    joinedEventId: eventId,
    joinedTitle: title,
    joinedUrl: url,
    events: rt.upcoming,
    calendarAuthenticated: rt.calendarAuthenticated,
  };
}

/* -------------------------------- settings -------------------------------- */

export function updateAutoJoinSettings(partial: unknown): AutoJoinSettings {
  rt.settings = normalizeAutoJoinSettings({ ...rt.settings, ...(partial as object) });
  persist();
  console.log(
    `[MeetingAutoJoin] settings → enabled=${rt.settings.enabled}, meet=${rt.settings.platforms.googleMeet}, zoom=${rt.settings.platforms.zoom}, lead=${rt.settings.joinLeadSeconds}s, grace=${rt.settings.joinGraceSeconds}s`
  );
  if (rt.settings.enabled) ensureAutoJoinStarted();
  return rt.settings;
}

/** Let the bot attend an event again (e.g. it was joined but the link changed). */
export function forgetAutoJoinedEvent(eventId: string): boolean {
  if (!eventId || !rt.handled[eventId]) return false;
  delete rt.handled[eventId];
  persist();
  return true;
}

/** Clear the attended ledger entirely. */
export function resetAutoJoinHistory(): number {
  const count = Object.keys(rt.handled).length;
  rt.handled = {};
  rt.lastJoined = null;
  persist();
  return count;
}

/* ------------------------------- scheduler -------------------------------- */

/** Arm the self-checking loop. Idempotent — one timer per process. */
export function ensureAutoJoinStarted(): void {
  if (rt.timer) return;
  rt.timer = setInterval(() => {
    if (!rt.settings.enabled) return;
    const sinceLast = rt.lastTickAt === null ? Infinity : Date.now() - rt.lastTickAt;
    if (sinceLast < rt.settings.pollSeconds * 1000) return;
    void runAutoJoinTick();
  }, SCHEDULE_RESOLUTION_MS);
  // Never hold the dev server / process open just for the scheduler.
  (rt.timer as { unref?: () => void }).unref?.();
  console.log(
    `[MeetingAutoJoin] scheduler armed — checks the calendar every ${rt.settings.pollSeconds}s while enabled (enabled=${rt.settings.enabled})`
  );
}

ensureAutoJoinStarted();

/* --------------------------------- status --------------------------------- */

export function getAutoJoinStatus() {
  const next = rt.upcoming.find((v) => v.willJoin) || rt.upcoming[0] || null;
  return {
    settings: rt.settings,
    enabled: rt.settings.enabled,
    calendarAuthenticated: rt.calendarAuthenticated,
    settingsFile: SETTINGS_FILE,
    upcoming: rt.upcoming,
    nextEvent: next,
    handledCount: Object.keys(rt.handled).length,
    handled: rt.handled,
    lastJoined: rt.lastJoined,
    lastTickAt: rt.lastTickAt ? new Date(rt.lastTickAt).toISOString() : null,
    lastError: rt.lastError,
    lastSkip: rt.lastSkip,
    tickCount: rt.tickCount,
    inFlight: rt.inFlight,
    pollSeconds: rt.settings.pollSeconds,
    schedulerArmed: Boolean(rt.timer),
    /** How long until the next event's join window opens — for the panel countdown. */
    nextWindowInMs: (() => {
      const candidate = rt.upcoming.find((v) => v.reason === "too-early" && v.url);
      return candidate?.startsInMs ?? null;
    })(),
    nextWindowLabel: (() => {
      const candidate = rt.upcoming.find((v) => v.reason === "too-early" && v.url);
      return candidate?.startsInMs != null ? `in ${formatDuration(candidate.startsInMs)}` : null;
    })(),
  };
}
