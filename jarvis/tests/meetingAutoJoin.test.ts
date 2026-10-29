// Meeting bot — auto-attend from Google Calendar (pure helpers).
//
// Covers the two things that decide whether the bot walks into the right meeting
// at the right time: finding the conference link on an event (it is very often
// pasted into the description/location, not just `hangoutLink`), and the timing
// verdict (too early / join now / already over / already attended).
//
// All pure: no calendar API, no browser, no Prisma.
//
// Run with:  npx tsx tests/meetingAutoJoin.test.ts

import {
  DEFAULT_AUTO_JOIN_SETTINGS,
  decisionBadge,
  eventStartMs,
  extractMeetingLinks,
  formatDuration,
  joinWindowMs,
  normalizeAutoJoinSettings,
  platformEnabled,
  shouldAutoJoin,
  type AutoJoinSettings,
  type CalendarEventLike,
} from "../src/lib/meeting/autoJoin";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

// Friday 2 October 2026, 10:00 local — frozen so every window is deterministic.
const NOW = new Date(2026, 9, 2, 10, 0, 0).getTime();
const iso = (offsetMinutes: number) => new Date(NOW + offsetMinutes * 60_000).toISOString();

const SETTINGS: AutoJoinSettings = {
  enabled: true,
  platforms: { googleMeet: true, zoom: true },
  joinLeadSeconds: 20,
  joinGraceSeconds: 300,
  pollSeconds: 60,
};

function event(overrides: Partial<CalendarEventLike> = {}): CalendarEventLike {
  return {
    id: "evt-1",
    summary: "Signals & Systems lecture",
    status: "confirmed",
    start: { dateTime: iso(30) },
    end: { dateTime: iso(90) },
    ...overrides,
  };
}

/* --------------------------- finding the meeting link --------------------------- */

section("extractMeetingLinks — where the link really lives");

{
  const fromHangout = extractMeetingLinks(event({ hangoutLink: "https://meet.google.com/abc-defg-hij" }));
  check("hangoutLink is used", fromHangout.length === 1 && fromHangout[0].platform === "google-meet");
  check("the source is recorded", fromHangout[0]?.source === "hangoutLink");
}

{
  // The common real case: the lecturer pasted the link into the description.
  const desc = extractMeetingLinks(
    event({ description: "Join here: https://meet.google.com/xyz-abcd-efg. Be on time!" })
  );
  check("a Meet link in the description is found", desc.length === 1, JSON.stringify(desc));
  check("trailing punctuation is stripped", desc[0]?.url === "https://meet.google.com/xyz-abcd-efg", desc[0]?.url);
  check("the source is the description", desc[0]?.source === "description");
}

{
  const bare = extractMeetingLinks(event({ description: "class link meet.google.com/abc-defg-hij" }));
  check("a scheme-less meet link is normalised", bare[0]?.url === "https://meet.google.com/abc-defg-hij", bare[0]?.url);
}

{
  const zoom = extractMeetingLinks(
    event({ location: "https://us06web.zoom.us/j/89470861004?pwd=aBcD123", hangoutLink: undefined })
  );
  check("a Zoom link in the location is found", zoom[0]?.platform === "zoom", JSON.stringify(zoom));
  check("the Zoom passcode query survives", zoom[0]?.url.includes("pwd=aBcD123"), zoom[0]?.url);
}

{
  const both = extractMeetingLinks(
    event({
      hangoutLink: "https://meet.google.com/abc-defg-hij",
      description: "backup: https://zoom.us/j/111222333 and https://meet.google.com/abc-defg-hij",
    })
  );
  check("the conference field wins over the text", both[0]?.url === "https://meet.google.com/abc-defg-hij");
  check("the same link twice is deduped", both.filter((l) => l.url.endsWith("abc-defg-hij")).length === 1);
  check("the backup Zoom link is still available", both.some((l) => l.platform === "zoom"));
}

{
  // A link whose HOST is not the meeting host must keep its host — cutting the
  // URL down to the meeting path sends the bot somewhere else entirely.
  const proxied = extractMeetingLinks(
    event({ location: "http://192.168.1.20:4321/meet.google.com/e2e-lecture-abc" })
  );
  check(
    "a link that merely contains a meeting path keeps its real host",
    proxied[0]?.url === "http://192.168.1.20:4321/meet.google.com/e2e-lecture-abc",
    proxied[0]?.url
  );
  check("its platform is still detected", proxied[0]?.platform === "google-meet");

  const wrapped = extractMeetingLinks(
    event({ description: "https://www.google.com/url?q=https://meet.google.com/abc-defg-hij" })
  );
  check(
    "a redirect wrapper yields the inner meeting link",
    wrapped[0]?.url === "https://meet.google.com/abc-defg-hij",
    wrapped[0]?.url
  );
}

{
  const webinar = extractMeetingLinks(event({ description: "https://company.zoom.us/webinar/register/WN_abc123" }));
  check("webinar registration links are recognised", webinar[0]?.platform === "zoom");

  const none = extractMeetingLinks(event({ description: "Room 204, no link", location: "Block C" }));
  check("an event without a link returns none", none.length === 0);

  const calendarPage = extractMeetingLinks(event({ description: "https://calendar.google.com/event?eid=123" }));
  check("a plain calendar page is not a meeting link", calendarPage.length === 0);
}

/* ------------------------------- settings merge -------------------------------- */

section("normalizeAutoJoinSettings — defaults and clamps");

{
  const defaults = normalizeAutoJoinSettings(undefined);
  check("auto-attend is opt-in by default", defaults.enabled === false);
  check("both platforms default on", defaults.platforms.googleMeet && defaults.platforms.zoom);
  check("default lead is 20s", defaults.joinLeadSeconds === 20);
  check("default poll is 60s", defaults.pollSeconds === 60);

  const clamped = normalizeAutoJoinSettings({
    enabled: "true",
    joinLeadSeconds: 99_999,
    joinGraceSeconds: -30,
    pollSeconds: 1,
  });
  check("string booleans are understood", clamped.enabled === true);
  check("a silly lead is clamped", clamped.joinLeadSeconds === 900, String(clamped.joinLeadSeconds));
  check("a negative grace becomes 0", clamped.joinGraceSeconds === 0);
  check("a 1s poll is clamped up", clamped.pollSeconds === 15, String(clamped.pollSeconds));

  const alias = normalizeAutoJoinSettings({ platforms: { meet: false } });
  check("the 'meet' alias is accepted", alias.platforms.googleMeet === false);
  check("the untouched platform keeps its default", alias.platforms.zoom === true);

  check(
    "platformEnabled maps Meet correctly",
    platformEnabled(SETTINGS, "google-meet") === true && platformEnabled({ ...SETTINGS, platforms: { googleMeet: false, zoom: true } }, "google-meet") === false
  );
}

/* ------------------------------ the join verdict ------------------------------- */

section("shouldAutoJoin — the verdict");

{
  const off = shouldAutoJoin(event(), { now: NOW, settings: { ...SETTINGS, enabled: false } });
  check("disabled settings never join", off.join === false && off.reason === "auto-join-disabled");

  const handled = shouldAutoJoin(event(), { now: NOW, settings: SETTINGS, handledEventIds: { "evt-1": {} } });
  check("an already-attended event is skipped", handled.join === false && handled.reason === "already-joined");

  const handledArray = shouldAutoJoin(event(), { now: NOW, settings: SETTINGS, handledEventIds: ["evt-1"] });
  check("the ledger works as an array too", handledArray.reason === "already-joined");

  const cancelled = shouldAutoJoin(event({ status: "cancelled" }), { now: NOW, settings: SETTINGS });
  check("cancelled events are skipped", cancelled.reason === "cancelled");

  const allDay = shouldAutoJoin(event({ start: { date: "2026-10-02" }, end: { date: "2026-10-03" } }), {
    now: NOW,
    settings: SETTINGS,
  });
  check("all-day events are skipped", allDay.reason === "all-day");

  const noTime = shouldAutoJoin(event({ start: {}, end: {} }), { now: NOW, settings: SETTINGS });
  check("an event without a start time is skipped", noTime.reason === "no-start-time");

  const noLink = shouldAutoJoin(event({ description: "no link here" }), { now: NOW, settings: SETTINGS });
  check("an event without a link is skipped", noLink.reason === "no-meeting-link");

  const meetOnly = event({ hangoutLink: "https://meet.google.com/abc-defg-hij" });
  const zoomOff = shouldAutoJoin(meetOnly, {
    now: NOW,
    settings: { ...SETTINGS, platforms: { googleMeet: false, zoom: true } },
  });
  check("a platform the user switched off is skipped", zoomOff.reason === "platform-disabled");
}

section("shouldAutoJoin — timing windows");

{
  // Event starts in 30 minutes: far too early.
  const early = shouldAutoJoin(event({ hangoutLink: "https://meet.google.com/abc-defg-hij" }), {
    now: NOW,
    settings: SETTINGS,
  });
  check("a meeting 30 minutes out is not joined yet", early.join === false && early.reason === "too-early");
  check("the panel gets a countdown", early.opensInMs !== null && (early.opensInMs ?? 0) > 0);

  // Starts in 10 seconds — inside the 20s lead-in.
  const startingSoon = shouldAutoJoin(
    event({ start: { dateTime: iso(10 / 60) }, end: { dateTime: iso(60) }, hangoutLink: "https://meet.google.com/abc-defg-hij" }),
    { now: NOW, settings: SETTINGS }
  );
  check("a meeting inside the lead-in is joined", startingSoon.join === true && startingSoon.reason === "ready");

  // Starts exactly now.
  const nowEvent = shouldAutoJoin(
    event({ start: { dateTime: iso(0) }, end: { dateTime: iso(60) }, hangoutLink: "https://meet.google.com/abc-defg-hij" }),
    { now: NOW, settings: SETTINGS }
  );
  check("a meeting starting now is joined", nowEvent.join === true);

  // Started 2 minutes ago and still running — the bot was busy/restarted.
  const inProgress = shouldAutoJoin(
    event({ start: { dateTime: iso(-2) }, end: { dateTime: iso(40) }, hangoutLink: "https://meet.google.com/abc-defg-hij" }),
    { now: NOW, settings: SETTINGS }
  );
  check("a meeting that started 2 minutes ago is still joinable", inProgress.join === true);

  // Started 10 minutes ago — outside the 5 minute grace.
  const stale = shouldAutoJoin(
    event({ start: { dateTime: iso(-10) }, end: { dateTime: iso(50) }, hangoutLink: "https://meet.google.com/abc-defg-hij" }),
    { now: NOW, settings: SETTINGS }
  );
  check("a meeting 10 minutes in is left alone", stale.join === false && stale.reason === "too-late");

  // Ended an hour ago.
  const ended = shouldAutoJoin(
    event({ start: { dateTime: iso(-120) }, end: { dateTime: iso(-60) }, hangoutLink: "https://meet.google.com/abc-defg-hij" }),
    { now: NOW, settings: SETTINGS }
  );
  check("an ended meeting is never joined", ended.join === false && ended.reason === "too-late");
}

section("shouldAutoJoin — picking between two links");

{
  const dual = event({
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    description: "Zoom backup https://zoom.us/j/999888777",
  });
  const meetOff = shouldAutoJoin(dual, {
    now: NOW,
    settings: { ...SETTINGS, platforms: { googleMeet: false, zoom: true } },
  });
  check("a disabled Meet link is skipped for the Zoom backup", meetOff.link?.platform === "zoom", JSON.stringify(meetOff.link));
  check("the chosen link is the joinable one", meetOff.join === false ? true : meetOff.link?.url.includes("zoom.us") === true);

  const bothOn = shouldAutoJoin(dual, { now: NOW, settings: SETTINGS });
  check("with both enabled the primary link wins", bothOn.link?.platform === "google-meet");
}

section("joinWindowMs — lead-in and grace, capped by the event's end");

{
  const window = joinWindowMs(event({ start: { dateTime: iso(0) }, end: { dateTime: iso(60) } }), SETTINGS);
  check("the window opens before the start", window !== null && window.opensAt === NOW - 20_000);
  check("the window closes after the grace period", window !== null && window.closesAt === NOW + 300_000);

  // A 45-second meeting can't keep the window open for 5 minutes.
  const shortMeeting = joinWindowMs(
    event({ start: { dateTime: iso(0) }, end: { dateTime: iso(0.75) } }),
    SETTINGS
  );
  check("a short meeting closes its own window at the end", shortMeeting !== null && shortMeeting.closesAt === NOW + 45_000);

  check("all-day events have no window", joinWindowMs(event({ start: { date: "2026-10-02" }, end: {} }), SETTINGS) === null);
  check("eventStartMs parses ISO starts", eventStartMs(event({ start: { dateTime: iso(5) } })) === NOW + 300_000);
}

section("panel labels");

{
  check("a due verdict reads as Joining", decisionBadge({ join: true, reason: "ready", message: "" }) === "Joining");
  check(
    "a future verdict reads as Scheduled",
    decisionBadge({ join: false, reason: "too-early", message: "" }) === "Scheduled"
  );
  check("formatDuration shows minutes", formatDuration(90_000) === "1m");
  check("formatDuration shows hours", formatDuration(3_700_000) === "1h 1m");
  check("the default settings object is not mutated by normalization", DEFAULT_AUTO_JOIN_SETTINGS.platforms.zoom === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
