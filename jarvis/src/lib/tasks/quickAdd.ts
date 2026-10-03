// Natural-language quick-add for tasks.
//
// "pay bill tomorrow 6pm high"  →  { title: "pay bill", priority: "high",
//                                    dueAt: <tomorrow 18:00> }
//
// Pure and dependency-free (no Prisma, no Next) so it can run in the client
// bundle and be unit-tested offline. The date vocabulary mirrors the companion
// engine's extractDueAt, but is re-implemented here to keep this module free of
// server imports.

export type QuickPriority = "critical" | "high" | "normal" | "someday";

export interface QuickAddResult {
  title: string;
  priority: QuickPriority;
  dueAt: Date | null;
  /** What was recognised — handy for a live "detected" preview. */
  matched: { priority?: string; when?: string; time?: string };
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Priority cues, most specific first. The matched word is stripped from the title.
const PRIORITY_RULES: Array<{ re: RegExp; priority: QuickPriority }> = [
  { re: /\b(critical|urgent|asap|emergency|blocker|immediately)\b/i, priority: "critical" },
  { re: /\b(high|important|priority|prioritize|soon)\b/i, priority: "high" },
  { re: /\b(someday|sometime|eventually|low|maybe|whenever|backlog)\b/i, priority: "someday" },
];

/** Time-of-day phrases: "6pm", "6:30 pm", "at 6 pm", "18:00", "noon". */
function parseTimeOfDay(text: string): { hours: number; minutes: number; raw: string } | null {
  const ampm = text.match(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i);
  if (ampm) {
    let h = parseInt(ampm[1], 10);
    const min = ampm[2] ? parseInt(ampm[2], 10) : 0;
    const isPm = /p/i.test(ampm[3]);
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    if (h >= 0 && h < 24 && min < 60) return { hours: h, minutes: min, raw: ampm[0] };
  }
  const clock = text.match(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/);
  if (clock) {
    const h = parseInt(clock[1], 10);
    const min = parseInt(clock[2], 10);
    if (h >= 0 && h < 24 && min < 60) return { hours: h, minutes: min, raw: clock[0] };
  }
  if (/\bnoon\b/i.test(text)) return { hours: 12, minutes: 0, raw: "noon" };
  if (/\bmidnight\b/i.test(text)) return { hours: 0, minutes: 0, raw: "midnight" };
  return null;
}

interface DateHit {
  date: Date;
  raw: string;
  /** Preferred hour when no explicit time is given (e.g. "tonight" → 21). */
  defaultHour?: number;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Date phrases: today/tomorrow/tonight, weekdays, next week/month, calendar dates. */
function parseDatePhrase(text: string, now: Date): DateHit | null {
  const lower = text.toLowerCase();
  if (/\bday after tomorrow\b/i.test(lower)) {
    return { date: startOfDay(new Date(now.getTime() + 2 * 864e5)), raw: "day after tomorrow" };
  }
  if (/\btomorrow\b/i.test(lower)) {
    return { date: startOfDay(new Date(now.getTime() + 864e5)), raw: "tomorrow" };
  }
  if (/\btonight\b/i.test(lower)) {
    return { date: startOfDay(now), raw: "tonight", defaultHour: 21 };
  }
  if (/\btoday\b/i.test(lower)) {
    return { date: startOfDay(now), raw: "today" };
  }
  if (/\bnext week\b/i.test(lower)) {
    return { date: startOfDay(new Date(now.getTime() + 7 * 864e5)), raw: "next week" };
  }
  if (/\bnext month\b/i.test(lower)) {
    return { date: startOfDay(new Date(now.getTime() + 30 * 864e5)), raw: "next month" };
  }

  // "on/next/by <weekday>" or a bare weekday name.
  const weekdayPrefixed = text.match(
    /\b(?:on|by|this|next|before|after)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i
  );
  const weekdayBare = text.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  const weekdayMatch = weekdayPrefixed || weekdayBare;
  if (weekdayMatch) {
    const target = WEEKDAYS.indexOf(weekdayMatch[1].toLowerCase());
    const d = startOfDay(now);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // a bare weekday means the NEXT one
    return { date: new Date(d.getTime() + delta * 864e5), raw: weekdayMatch[0] };
  }

  // "12 september" / "sep 12" / "on the 15th"
  const dayMonth = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i
  );
  const monthDay = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
  );
  const md = dayMonth || monthDay;
  if (md) {
    const day = parseInt(md[dayMonth ? 1 : 2], 10);
    const month = MONTHS.indexOf(md[dayMonth ? 2 : 1].slice(0, 3).toLowerCase());
    const d = new Date(now.getFullYear(), month, day);
    if (d < startOfDay(now)) d.setFullYear(d.getFullYear() + 1);
    return { date: startOfDay(d), raw: md[0] };
  }

  const dayOnly = text.match(/\b(?:on the|by the)\s+(\d{1,2})(?:st|nd|rd|th)\b/i);
  if (dayOnly) {
    const day = parseInt(dayOnly[1], 10);
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d < startOfDay(now)) d.setMonth(d.getMonth() + 1);
    return { date: startOfDay(d), raw: dayOnly[0] };
  }

  return null;
}

/**
 * Parse a natural-language task line into a title + priority + due date.
 *
 * Never throws; when nothing is recognised the whole input becomes the title.
 */
export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  const original = (input || "").replace(/\s+/g, " ").trim();
  if (!original) return { title: "", priority: "normal", dueAt: null, matched: {} };

  let working = original;
  const matched: QuickAddResult["matched"] = {};

  // Priority.
  let priority: QuickPriority = "normal";
  for (const rule of PRIORITY_RULES) {
    const m = working.match(rule.re);
    if (m) {
      priority = rule.priority;
      matched.priority = m[1];
      working = working.replace(m[0], " ");
      break;
    }
  }

  // Time of day.
  const time = parseTimeOfDay(working);
  if (time) {
    matched.time = time.raw;
    working = working.replace(time.raw, " ");
  }

  // Calendar date.
  const dateHit = parseDatePhrase(working, now);
  if (dateHit) {
    matched.when = dateHit.raw;
    working = working.replace(dateHit.raw, " ");
  }

  // Combine into a concrete due timestamp.
  let dueAt: Date | null = null;
  if (dateHit || time) {
    const base = dateHit ? new Date(dateHit.date) : startOfDay(now);
    if (time) {
      base.setHours(time.hours, time.minutes, 0, 0);
    } else {
      base.setHours(dateHit?.defaultHour ?? 9, 0, 0, 0);
    }
    // A bare time already in the past means "tomorrow".
    if (!dateHit && time && base.getTime() <= now.getTime()) {
      base.setDate(base.getDate() + 1);
    }
    dueAt = base;
  }

  const title =
    working
      .replace(/\s+/g, " ")
      .replace(/^[\s,.\-–—:]+|[\s,.\-–—:]+$/g, "")
      .trim() || original;

  return { title, priority, dueAt, matched };
}

/** Compact human label for a parsed due date ("Today 6:00 PM", "Fri, Oct 9, 9:00 AM"). */
export function formatDueAt(due: Date, now: Date = new Date()): string {
  const h24 = due.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(due.getMinutes()).padStart(2, "0");
  const ampm = h24 < 12 ? "AM" : "PM";
  const time = `${h12}:${mm} ${ampm}`;
  const sameDay = due.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 864e5).toDateString() === due.toDateString();
  if (sameDay) return `Today ${time}`;
  if (tomorrow) return `Tomorrow ${time}`;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][due.getDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][due.getMonth()];
  return `${wd}, ${mo} ${due.getDate()} ${time}`;
}
