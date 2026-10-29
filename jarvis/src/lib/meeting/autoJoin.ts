// Auto-attend logic: turn Google Calendar events into "should the bot walk into
// this meeting by itself?" decisions.
//
// WHY THIS EXISTS
// Joining a meeting meant pasting a link into the panel every single time. The
// calendar already knows the lecture/standup exists and already carries the
// Meet/Zoom link — usually in `hangoutLink`, but just as often pasted into the
// description or the location field — so the bot should attend on its own.
//
// The decision is kept pure (event + settings + now → verdict) because the
// failure modes are all timing/parsing edge cases: joining an all-day event,
// rejoining one already attended, walking into something that ended an hour ago,
// or hammering a link whose platform the user switched off. Those are testable
// without a browser or a network, so they are tested here.

export type MeetingPlatform = "google-meet" | "zoom";

/** The subset of a Google Calendar event auto-attend cares about. */
export interface CalendarEventLike {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export interface AutoJoinSettings {
  enabled: boolean;
  platforms: { googleMeet: boolean; zoom: boolean };
  /** Start flicking to the meeting this many seconds before it begins. */
  joinLeadSeconds: number;
  /** Still fine to join if the meeting started less than this long ago. */
  joinGraceSeconds: number;
  /** How often the heartbeat re-checks the calendar. */
  pollSeconds: number;
}

export const DEFAULT_AUTO_JOIN_SETTINGS: AutoJoinSettings = {
  // Opt-in: auto-attending opens a real browser window, so it must never
  // switch itself on.
  enabled: false,
  platforms: { googleMeet: true, zoom: true },
  joinLeadSeconds: 20,
  joinGraceSeconds: 300,
  pollSeconds: 60,
};

export type AutoJoinReason =
  | "ready"
  | "auto-join-disabled"
  | "already-joined"
  | "cancelled"
  | "all-day"
  | "no-start-time"
  | "no-meeting-link"
  | "platform-disabled"
  | "too-early"
  | "too-late";

export interface MeetingLink {
  url: string;
  platform: MeetingPlatform;
  source: "hangoutLink" | "location" | "description" | "summary";
}

export interface AutoJoinDecision {
  join: boolean;
  reason: AutoJoinReason;
  /** Human-readable one-liner for the panel. */
  message: string;
  link?: MeetingLink;
  /** Milliseconds until the join window opens (negative while inside it). */
  opensInMs?: number | null;
  startsInMs?: number | null;
}

const MAX_LEAD_SECONDS = 900;
const MAX_GRACE_SECONDS = 3600;
const MIN_POLL_SECONDS = 15;
const MAX_POLL_SECONDS = 1800;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

interface RawAutoJoinSettings {
  enabled?: unknown;
  platforms?: { googleMeet?: unknown; meet?: unknown; zoom?: unknown };
  joinLeadSeconds?: unknown;
  joinGraceSeconds?: unknown;
  pollSeconds?: unknown;
}

/** Merge a stored/partial settings blob with defaults, clamping every number. */
export function normalizeAutoJoinSettings(raw: unknown): AutoJoinSettings {
  const input = (raw && typeof raw === "object" ? raw : {}) as RawAutoJoinSettings;
  const platforms = input.platforms || {};
  return {
    enabled: asBool(input.enabled, DEFAULT_AUTO_JOIN_SETTINGS.enabled),
    platforms: {
      googleMeet: asBool(
        platforms.googleMeet ?? platforms.meet,
        DEFAULT_AUTO_JOIN_SETTINGS.platforms.googleMeet
      ),
      zoom: asBool(platforms.zoom, DEFAULT_AUTO_JOIN_SETTINGS.platforms.zoom),
    },
    joinLeadSeconds: clampNumber(
      input.joinLeadSeconds,
      DEFAULT_AUTO_JOIN_SETTINGS.joinLeadSeconds,
      0,
      MAX_LEAD_SECONDS
    ),
    joinGraceSeconds: clampNumber(
      input.joinGraceSeconds,
      DEFAULT_AUTO_JOIN_SETTINGS.joinGraceSeconds,
      0,
      MAX_GRACE_SECONDS
    ),
    pollSeconds: clampNumber(
      input.pollSeconds,
      DEFAULT_AUTO_JOIN_SETTINGS.pollSeconds,
      MIN_POLL_SECONDS,
      MAX_POLL_SECONDS
    ),
  };
}

export function platformEnabled(settings: AutoJoinSettings, platform: MeetingPlatform): boolean {
  return platform === "google-meet" ? settings.platforms.googleMeet : settings.platforms.zoom;
}

export function platformLabel(platform: MeetingPlatform): string {
  return platform === "google-meet" ? "Google Meet" : "Zoom";
}

function platformForUrl(url: string): MeetingPlatform | null {
  if (/meet\.google\.com/i.test(url)) return "google-meet";
  if (/zoom\.us/i.test(url)) return "zoom";
  return null;
}

// Meet codes, Zoom /j//w//s//wc//my/ links and webinar registrations. Match on
// the text without a scheme too — lecturers routinely write bare
// "meet.google.com/abc-defg-hij".
const MEETING_HOST = "(?:meet\\.google\\.com|zoom\\.us)";

/** An absolute meeting URL sitting inside a bigger token (usually `?q=`). */
const EMBEDDED_MEETING_URL = new RegExp(
  `(?:^|[=:,;\\s])(https?:\\/\\/(?:[\\w-]+\\.)*${MEETING_HOST}\\/[^\\s"'<>()\\[\\]{}]*)`,
  "gi"
);

/** True when the token itself is the meeting link, e.g. `https://meet.google.com/abc`. */
function startsWithMeetingHost(value: string): boolean {
  return new RegExp(`^(?:https?:\\/\\/)?(?:[\\w-]+\\.)*${MEETING_HOST}\\/`, "i").test(value);
}

/** Trim punctuation and HTML entities that trail a link in pasted text. */
function cleanUrlToken(token: string): string {
  let url = token.replace(/&amp;/g, "&").replace(/[.,;:!?]+$/g, "");
  // A trailing ")" that belongs to "(see https://…)" is not part of the URL.
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1);
  }
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export function detectPlatform(url: string): MeetingPlatform | null {
  return platformForUrl(url);
}

function linksFromText(text: string | undefined, source: MeetingLink["source"]): MeetingLink[] {
  if (!text) return [];
  const out: MeetingLink[] = [];

  // Split into tokens first. Scanning the raw text instead has two failure
  // modes that matter in practice: a link written mid-sentence swallows the
  // punctuation around it, and (worse) the host of a URL that merely *contains*
  // a meeting path gets cut off — `https://proxy.example/meet.google.com/abc`
  // became `https://meet.google.com/abc`, sending the bot to a meeting that
  // isn't the one on the invite.
  for (const raw of text.split(/[\s<>"'()[\]{}]+/)) {
    if (!raw) continue;
    const token = raw.replace(/&amp;/g, "&");

    // A redirect/wrapper link carries the real room in a query parameter
    // (calendar invites and `google.com/url?q=` links do this constantly), so
    // when the token is not itself a meeting link, take the absolute meeting URL
    // out of it.
    let candidate = token;
    if (!startsWithMeetingHost(token)) {
      const embedded = [...token.matchAll(EMBEDDED_MEETING_URL)];
      if (embedded.length > 0) candidate = embedded[embedded.length - 1][1];
    }

    const url = cleanUrlToken(candidate);
    const platform = platformForUrl(url);
    if (platform) out.push({ url, platform, source });
  }

  return out;
}

/**
 * Every usable conference link on an event, best first: the real conference
 * field, then the location line, then the description, then the title.
 */
export function extractMeetingLinks(event: CalendarEventLike): MeetingLink[] {
  const found: MeetingLink[] = [
    ...linksFromText(event.hangoutLink, "hangoutLink"),
    ...linksFromText(event.location, "location"),
    ...linksFromText(event.description, "description"),
    ...linksFromText(event.summary, "summary"),
  ];
  const seen = new Set<string>();
  return found.filter((l) => {
    const key = l.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function eventStartMs(event: CalendarEventLike): number | null {
  const raw = event.start?.dateTime;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

export function eventEndMs(event: CalendarEventLike): number | null {
  const raw = event.end?.dateTime;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : null;
}

/** When the bot may join: a lead-in before the start, then a grace period after. */
export function joinWindowMs(
  event: CalendarEventLike,
  settings: AutoJoinSettings
): { opensAt: number; closesAt: number } | null {
  const start = eventStartMs(event);
  if (start === null) return null;
  const opensAt = start - settings.joinLeadSeconds * 1000;
  let closesAt = start + settings.joinGraceSeconds * 1000;
  const end = eventEndMs(event);
  // Never walk into something that has already finished.
  if (end !== null && end > start) closesAt = Math.min(closesAt, end);
  return { opensAt, closesAt };
}

export interface AutoJoinContext {
  now: number;
  settings: AutoJoinSettings;
  /** Events already attended (id → anything), so they are never rejoined. */
  handledEventIds?: Iterable<string> | Record<string, unknown>;
}

function toIdSet(handled?: AutoJoinContext["handledEventIds"]): Set<string> {
  if (!handled) return new Set();
  if (Symbol.iterator in Object(handled)) return new Set(handled as Iterable<string>);
  return new Set(Object.keys(handled as Record<string, unknown>));
}

/**
 * The whole auto-attend verdict for one event. `join: true` means the caller
 * should hand `link.url` to MeetingBotService right now.
 */
export function shouldAutoJoin(event: CalendarEventLike, ctx: AutoJoinContext): AutoJoinDecision {
  const settings = ctx.settings;
  const title = (event.summary || "Untitled event").trim();

  if (!settings.enabled) {
    return { join: false, reason: "auto-join-disabled", message: "Auto-attend is off." };
  }
  const id = event.id || "";
  if (id && toIdSet(ctx.handledEventIds).has(id)) {
    return { join: false, reason: "already-joined", message: `${title}: already attended in this session.` };
  }
  if ((event.status || "").toLowerCase() === "cancelled") {
    return { join: false, reason: "cancelled", message: `${title}: cancelled.` };
  }
  if (!event.start?.dateTime) {
    if (event.start?.date) {
      return { join: false, reason: "all-day", message: `${title}: all-day event, nothing to join.` };
    }
    return { join: false, reason: "no-start-time", message: `${title}: no start time.` };
  }

  const links = extractMeetingLinks(event);
  if (links.length === 0) {
    return { join: false, reason: "no-meeting-link", message: `${title}: no Meet/Zoom link.` };
  }
  const link = links.find((l) => platformEnabled(settings, l.platform));
  if (!link) {
    const platforms = links.map((l) => platformLabel(l.platform)).join(", ");
    return {
      join: false,
      reason: "platform-disabled",
      message: `${title}: only ${platforms} link found, which is switched off.`,
    };
  }

  const window = joinWindowMs(event, settings)!;
  const startsInMs = window.opensAt + settings.joinLeadSeconds * 1000 - ctx.now;
  if (ctx.now < window.opensAt) {
    return {
      join: false,
      reason: "too-early",
      message: `${title}: starts in ${formatDuration(window.opensAt - ctx.now)}.`,
      link,
      opensInMs: window.opensAt - ctx.now,
      startsInMs,
    };
  }
  if (ctx.now > window.closesAt) {
    return {
      join: false,
      reason: "too-late",
      message: `${title}: already over (window closed ${formatDuration(ctx.now - window.closesAt)} ago).`,
      link,
      startsInMs,
    };
  }

  const behind = ctx.now - (window.opensAt + settings.joinLeadSeconds * 1000);
  return {
    join: true,
    reason: "ready",
    message:
      behind > 15_000
        ? `${title}: in progress — joining ${link.platform === "zoom" ? "Zoom" : "Google Meet"} now.`
        : `${title}: starting — joining now.`,
    link,
    opensInMs: window.opensAt - ctx.now,
    startsInMs,
  };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(Math.abs(ms) / 1000));
  const mins = Math.floor(total / 60);
  if (mins < 60) return mins <= 0 ? `${total}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Panel badge for a decision that is not a join. */
export function decisionBadge(decision: AutoJoinDecision): string {
  switch (decision.reason) {
    case "ready":
      return "Joining";
    case "too-early":
      return "Scheduled";
    case "too-late":
      return "Finished";
    case "already-joined":
      return "Attended";
    case "no-meeting-link":
      return "No link";
    case "platform-disabled":
      return "Platform off";
    case "all-day":
      return "All-day";
    case "cancelled":
      return "Cancelled";
    case "auto-join-disabled":
      return "Auto-attend off";
    default:
      return "Skipped";
  }
}
