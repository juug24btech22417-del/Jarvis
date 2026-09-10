// JARVIS Companion Care Engine
// ─────────────────────────────
// The part of JARVIS that makes him feel like a person who knows you —
// not a chatbot that forgets you exist between sessions.
//
// Inspired by two questions:
//   "What would the real JARVIS notice?"  → absence, mood, late nights.
//   "What made Atom special in Real Steel?" → he remembered Max. Always.
//
// Everything here is fail-soft: if the DB is down or not yet migrated,
// the care engine degrades to "no context" and never breaks chat or the
// greeting. A companion that crashes the app is not a caring companion.

import { prisma } from "@/lib/db/queries";
import { getAnniversary, getThrowback } from "./journey";

// ─── Types ──────────────────────────────────────────────────────────

export interface PresenceSnapshot {
  gapHours: number;
  isNewUser: boolean; // first-ever session
  lastSeenAt: Date | null;
}

export interface DetectedThread {
  topic: string;
  detail: string;
  kind: "event" | "stressor" | "goal" | "person" | "health" | "celebration";
  dueAt: Date | null;
}

export interface DetectedMood {
  mood: "great" | "good" | "neutral" | "low" | "stressed" | "tired";
  score: number; // 1–5
  energy: "high" | "normal" | "low";
}

export interface QuietPerson {
  name: string;
  relation: string | null;
  daysSinceMention: number;
  context: string | null;
}

export interface CareContextBlock {
  presence: PresenceSnapshot | null;
  openThreads: Array<{
    id: string;
    topic: string;
    detail: string | null;
    kind: string;
    dueAt: Date | null;
    dueLabel: string; // "overdue" | "today" | "tomorrow" | "in N days" | "upcoming"
    askedCount: number;
  }>;
  recentMoods: Array<{ mood: string; score: number; note: string | null; at: Date }>;
  quietPeople: QuietPerson[];
  rituals: RitualInsight;
  promptBlock: string; // ready to append to a system prompt ("" when nothing)
}

// ─── Small helpers ──────────────────────────────────────────────────

function hoursBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / 36e5);
}

function humanizeGap(hours: number): string {
  if (hours < 1) return "less than an hour";
  if (hours < 24) {
    const h = Math.round(hours);
    return h === 1 ? "an hour" : `${h} hours`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) return "a day";
  if (days === 2) return "two days";
  if (days < 7) return `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks === 1 ? "a week" : `${weeks} weeks`;
}

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];
const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/**
 * Best-effort due-date extraction from phrases like:
 *   "on friday", "by tomorrow", "next week", "on 12 september",
 *   "on the 15th", "day after tomorrow"
 * Returns null when nothing date-ish is found.
 */
export function extractDueAt(text: string, now = new Date()): Date | null {
  const lower = text.toLowerCase();

  if (/\bday after tomorrow\b/.test(lower)) {
    return new Date(now.getTime() + 2 * 864e5);
  }
  if (/\btomorrow\b/.test(lower)) return new Date(now.getTime() + 864e5);
  if (/\btonight\b/.test(lower)) {
    const d = new Date(now);
    d.setHours(21, 0, 0, 0);
    if (d < now) d.setDate(d.getDate() + 1);
    return d;
  }
  if (/\bnext week\b/.test(lower)) return new Date(now.getTime() + 7 * 864e5);
  if (/\bnext month\b/.test(lower)) return new Date(now.getTime() + 30 * 864e5);

  // "on friday" / "by monday" — next occurrence of that weekday.
  const weekdayMatch = lower.match(
    /\b(?:on|by|this|before|after)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/
  );
  if (weekdayMatch) {
    const target = WEEKDAYS.indexOf(weekdayMatch[1]);
    const d = new Date(now);
    let delta = (target - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // "on friday" said on a friday → next friday
    return new Date(now.getTime() + delta * 864e5);
  }

  // "12 september" / "sep 12" / "on the 15th"
  const dayMonth = lower.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/
  );
  const monthDay = lower.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/
  );
  const m = dayMonth || monthDay;
  if (m) {
    const day = parseInt(m[dayMonth ? 1 : 2], 10);
    const month = MONTHS.indexOf(m[dayMonth ? 2 : 1].slice(0, 3));
    const d = new Date(now.getFullYear(), month, day);
    if (d < now) d.setFullYear(d.getFullYear() + 1); // past date → next year
    return d;
  }
  const dayOnly = lower.match(/\b(?:on the|by the)\s+(\d{1,2})(?:st|nd|rd|th)\b/);
  if (dayOnly) {
    const day = parseInt(dayOnly[1], 10);
    const d = new Date(now.getFullYear(), now.getMonth(), day);
    if (d < now) d.setMonth(d.getMonth() + 1);
    return d;
  }

  return null;
}

// ─── Signal detection (regex-first, zero-cost, offline-friendly) ────

interface SignalPattern {
  re: RegExp;
  topic: (m: RegExpMatchArray) => string;
  detail: (m: RegExpMatchArray, raw: string) => string;
  kind: DetectedThread["kind"];
  withDue?: boolean;
}

const THREAD_PATTERNS: SignalPattern[] = [
  {
    re: /\b(?:i (?:have|had|got)|my)\s+(?:a\s+|an\s+|my\s+)?((?:\w+\s+){0,2}(?:exam|test|quiz|viva|interview|presentation|demo|review))\b(?:\s+(?:on|at|tomorrow|next\s+\w+|this\s+\w+|day after tomorrow))?(?:[^.!?]{0,80})?/i,
    topic: (m) => m[1].trim(),
    detail: (_m, raw) => raw.trim(),
    kind: "event",
    withDue: true,
  },
  {
    re: /\b(deadline|due date|submission|last date)\b[^.!?]{0,80}/i,
    topic: (m) => m[1],
    detail: (_m, raw) => raw.trim(),
    kind: "event",
    withDue: true,
  },
  {
    re: /\bi(?:'m| am)\s+(?:so\s+|really\s+|very\s+|kinda\s+|a bit\s+)?(stressed|exhausted|burnt out|burned out|overwhelmed|anxious)\b/i,
    topic: (m) => `feeling ${m[1].toLowerCase()}`,
    detail: (_m, raw) => raw.trim(),
    kind: "stressor",
  },
  {
    re: /\bi(?:'m| am)\s+(?:feeling\s+)?(sad|down|low|lonely|unhappy|upset)\b/i,
    topic: (m) => `feeling ${m[1].toLowerCase()}`,
    detail: (_m, raw) => raw.trim(),
    kind: "stressor",
  },
  {
    re: /\b(?:not feeling well|i'?m sick|fever|headache|cold and fever|feeling ill)\b[^.!?]{0,60}/i,
    topic: () => "health issue",
    detail: (_m, raw) => raw.trim(),
    kind: "health",
  },
  {
    re: /\b(?:got|cracked|cleared|passed|won|selected(?: for)?|offered)\s+([^,.!?]{3,60})/i,
    topic: (m) => m[1].trim(),
    detail: (_m, raw) => raw.trim(),
    kind: "celebration",
  },
];

const MOOD_PATTERNS: Array<{
  re: RegExp;
  mood: DetectedMood["mood"];
  score: number;
  energy: DetectedMood["energy"];
}> = [
  { re: /\b(feeling (?:great|amazing|fantastic|on top of the world)|i(?:'m| am) (?:great|amazing|fantastic)|so happy|thrilled)\b/i, mood: "great", score: 5, energy: "high" },
  { re: /\b(feeling (?:good|nice|better)|i(?:'m| am) (?:good|fine|okay)|had a (?:good|great) day)\b/i, mood: "good", score: 4, energy: "normal" },
  { re: /\b(i(?:'m| am) (?:so |really |very |extremely )?(?:tired|exhausted|drained|sleepy)|burnt out|burned out)\b/i, mood: "tired", score: 2, energy: "low" },
  { re: /\b(i(?:'m| am) (?:so |really |very )?(?:stressed|overwhelmed|anxious)|stressed out)\b/i, mood: "stressed", score: 2, energy: "low" },
  { re: /\b(i(?:'m| am) (?:feeling )?(?:sad|down|low|lonely|unhappy|upset)|bad day|rough day)\b/i, mood: "low", score: 1, energy: "low" },
];

// ─── People detection (who matters to you) ─────────────────────────

const GENERIC_PEOPLE = new Set([
  "you", "jarvis", "someone", "everyone", "nobody", "anyone", "no one",
  "god", "sir", "boss", "man", "guys", "people", "they", "them",
]);

const RELATION_PATTERNS: Array<{ re: RegExp; relation: string }> = [
  { re: /\b(dad|father|papa|pop)\b/i, relation: "dad" },
  { re: /\b(mom|mum|mother|mama)\b/i, relation: "mom" },
  { re: /\b(brother|bro|sister|sis)\b/i, relation: "sibling" },
  { re: /\b(grandma|grandmother|grandpa|grandfather|grandparent)\b/i, relation: "grandparent" },
  { re: /\b(girlfriend|boyfriend|partner|wife|husband)\b/i, relation: "partner" },
  { re: /\b(roommate|flatmate)\b/i, relation: "roommate" },
  { re: /\b(boss|manager|lead)\b/i, relation: "work" },
  { re: /\b(friend|buddy|mate)\b/i, relation: "friend" },
  { re: /\b(cousin|uncle|aunt|nephew|niece)\b/i, relation: "family" },
  { re: /\b(teammate|colleague|coworker)\b/i, relation: "colleague" },
];

interface PersonMention {
  name: string;      // canonical-ish: "dad", "rahul"
  relation: string | null;
  context: string;
}

/**
 * Detect mentions of personal people in a message. Regex-first, zero-cost.
 * Catches two shapes:
 *   - relation words: "my dad", "my roommate"
 *   - named people after a possessive/relationship cue: "my friend Rahul",
 *     "my brother Arjun"
 * Deliberately conservative: only capitalized names right after a
 * relationship cue, so random nouns don't become people.
 */
export function extractPersonMentions(text: string): PersonMention[] {
  const mentions = new Map<string, PersonMention>();
  const trimmed = text.trim();

  const add = (rawName: string, relation: string | null) => {
    const name = rawName.toLowerCase().trim();
    if (!name || name.length < 2 || name.length > 24) return;
    if (GENERIC_PEOPLE.has(name)) return;
    const existing = mentions.get(name);
    if (existing) {
      if (!existing.relation && relation) existing.relation = relation;
    } else {
      mentions.set(name, { name, relation, context: trimmed.slice(0, 240) });
    }
  };

  // "my dad" / "my mom" / "my roommate" etc.
  // If the relation word is immediately followed by a capitalized name
  // ("my friend Rahul"), skip the bare word — the real person is the name.
  const relRe = /\bmy\s+(dad|father|papa|pop|mom|mum|mother|mama|brother|bro|sister|sis|grandma|grandmother|grandpa|grandfather|girlfriend|boyfriend|partner|wife|husband|roommate|flatmate|boss|manager|friend|buddy|cousin|uncle|aunt)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(text)) !== null) {
    const rest = text.slice((m.index ?? 0) + m[0].length);
    if (/^\s+[A-Z][a-z]{1,15}\b/.test(rest)) continue;
    const relation = (RELATION_PATTERNS.find((p) => p.re.test(m![1])) ?? {}).relation ?? m![1].toLowerCase();
    add(m[1], relation);
  }

  // "my friend Rahul" / "my brother Arjun" — a Name following the cue.
  // The name becomes the person; the cue becomes their relation.
  const namedRe = /\bmy\s+(dad|father|mom|mum|mother|brother|sister|friend|buddy|mate|roommate|flatmate|cousin|uncle|aunt|colleague|teammate|manager|boss)\s+([A-Z][a-z]{1,15})\b/g;
  while ((m = namedRe.exec(text)) !== null) {
    const relation = (RELATION_PATTERNS.find((p) => p.re.test(m![1])) ?? {}).relation ?? null;
    add(m[2], relation);
  }

  return Array.from(mentions.values());
}

/**
 * Persist people mentions — upsert per name, bumping mention count and
 * refreshing context. Fire-and-forget safe; never throws.
 */
export async function recordPersonMentions(text: string, now = new Date()): Promise<number> {
  try {
    const mentions = extractPersonMentions(text);
    let saved = 0;
    for (const p of mentions) {
      const existing = await prisma.personThread.findUnique({ where: { name: p.name } });
      if (existing) {
        await prisma.personThread.update({
          where: { name: p.name },
          data: {
            mentionCount: { increment: 1 },
            lastMention: now,
            context: p.context,
            status: "active",
            relation: existing.relation ?? p.relation,
          },
        });
      } else {
        await prisma.personThread.create({
          data: {
            name: p.name,
            relation: p.relation,
            context: p.context,
            lastMention: now,
          },
        });
      }
      saved++;
    }
    return saved;
  } catch (e) {
    console.warn("[Care] recordPersonMentions failed (non-fatal):", (e as Error).message);
    return 0;
  }
}

/**
 * People JARVIS hasn't heard you mention in a while — candidates for a
 * gentle "how's your dad doing?" check-in. Threshold: 10+ days quiet.
 */
export async function getQuietPeople(now = new Date(), minQuietDays = 10): Promise<QuietPerson[]> {
  try {
    const cutoff = new Date(now.getTime() - minQuietDays * 864e5);
    const rows = await prisma.personThread.findMany({
      where: { status: "active", lastMention: { lt: cutoff } },
      orderBy: { lastMention: "asc" },
      take: 3,
    });
    return rows.map((r) => ({
      name: r.name,
      relation: r.relation,
      daysSinceMention: Math.floor(hoursBetween(now, r.lastMention) / 24),
      context: r.context,
    }));
  } catch {
    return [];
  }
}

// ─── Rituals & patterns (his sense of your rhythms) ────────────────

export interface RitualInsight {
  dominantTimeBand: string | null; // "mornings" | "afternoons" | "evenings" | "late nights"
  favoritePanel: string | null;
  sampleSize: number;
}

function bandForHour(h: number): string {
  if (h >= 6 && h < 12) return "mornings";
  if (h >= 12 && h < 17) return "afternoons";
  if (h >= 17 && h < 23) return "evenings";
  return "late nights";
}

/**
 * Infer usage rhythms from the MemoryEvent stream (last 14 days).
 * Cheap aggregation, no LLM.
 */
export async function getRituals(now = new Date()): Promise<RitualInsight> {
  const empty: RitualInsight = { dominantTimeBand: null, favoritePanel: null, sampleSize: 0 };
  try {
    const since = new Date(now.getTime() - 14 * 864e5);
    const [events, panelEvents] = await Promise.all([
      prisma.memoryEvent.findMany({
        where: { kind: { in: ["chat", "search"] }, createdAt: { gte: since } },
        select: { createdAt: true },
        take: 500,
      }),
      prisma.memoryEvent.findMany({
        where: { kind: "panel", createdAt: { gte: since } },
        select: { payload: true },
        take: 300,
      }),
    ]);

    const bandCounts = new Map<string, number>();
    for (const e of events) {
      const band = bandForHour(new Date(e.createdAt).getHours());
      bandCounts.set(band, (bandCounts.get(band) ?? 0) + 1);
    }
    let topBand: string | null = null;
    let topCount = 0;
    for (const [band, count] of bandCounts) {
      if (count > topCount) {
        topBand = band;
        topCount = count;
      }
    }

    const panelCounts = new Map<string, number>();
    for (const e of panelEvents) {
      try {
        const payload = JSON.parse(e.payload) as { panel?: string; name?: string };
        const panel = payload.panel ?? payload.name;
        if (panel) panelCounts.set(panel, (panelCounts.get(panel) ?? 0) + 1);
      } catch {
        // ignore malformed payloads
      }
    }
    let topPanel: string | null = null;
    let topPanelCount = 0;
    for (const [panel, count] of panelCounts) {
      if (count > topPanelCount) {
        topPanel = panel;
        topPanelCount = count;
      }
    }

    return {
      dominantTimeBand: topCount >= 5 ? topBand : null,
      favoritePanel: topPanelCount >= 3 ? topPanel : null,
      sampleSize: events.length + panelEvents.length,
    };
  } catch {
    return empty;
  }
}

// ─── Past wins (for low moments) ────────────────────────────────────

/**
 * One recent win to recall when he's low — from resolved celebration
 * threads or positive mood notes. Used by vent mode.
 */
export async function getPastWin(): Promise<string | null> {
  try {
    const wins = await prisma.followUpThread.findMany({
      where: { kind: "celebration" },
      orderBy: { createdAt: "desc" },
      take: 3,
    });
    if (wins.length > 0) {
      return wins[0].detail ?? wins[0].topic;
    }
    const goodMood = await prisma.moodSample.findFirst({
      where: { score: { gte: 4 }, note: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    return goodMood?.note ?? null;
  } catch {
    return null;
  }
}

// ─── His own life (small autonomous chores between sessions) ───────

export interface ChoreReport {
  expiredThreads: number; // stale threads quietly closed
  archivedPeople: number; // very quiet person threads set aside
}

/**
 * While you were away, JARVIS tidied up:
 *  - follow-up threads whose due date passed by >7 days without an ask → expired
 *  - person threads quiet for >60 days → status "quiet" (out of check-in rotation)
 * Idempotent and cheap; runs as part of the companion GET.
 */
export async function runChores(now = new Date()): Promise<ChoreReport> {
  const report: ChoreReport = { expiredThreads: 0, archivedPeople: 0 };
  try {
    const staleCutoff = new Date(now.getTime() - 7 * 864e5);
    const stale = await prisma.followUpThread.updateMany({
      where: {
        status: { in: ["open", "asked"] },
        dueAt: { lt: staleCutoff, not: null },
      },
      data: { status: "expired" },
    });
    report.expiredThreads = stale.count;

    const quietCutoff = new Date(now.getTime() - 60 * 864e5);
    const quiet = await prisma.personThread.updateMany({
      where: { status: "active", lastMention: { lt: quietCutoff } },
      data: { status: "quiet" },
    });
    report.archivedPeople = quiet.count;
  } catch (e) {
    console.warn("[Care] runChores failed (non-fatal):", (e as Error).message);
  }
  return report;
}

/**
 * Scan a user message for care-worthy signals. Pure function — no I/O.
 */
export function extractCareSignals(text: string, now = new Date()): {
  threads: DetectedThread[];
  mood: DetectedMood | null;
} {
  const threads: DetectedThread[] = [];
  for (const p of THREAD_PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      threads.push({
        topic: p.topic(m).slice(0, 80),
        detail: p.detail(m, text).slice(0, 240),
        kind: p.kind,
        dueAt: p.withDue ? extractDueAt(text, now) : null,
      });
    }
  }

  let mood: DetectedMood | null = null;
  for (const p of MOOD_PATTERNS) {
    if (p.re.test(text)) {
      mood = { mood: p.mood, score: p.score, energy: p.energy };
      break; // first (most specific) match wins
    }
  }

  return { threads, mood };
}

// ─── Persistence (all fail-soft) ────────────────────────────────────

/**
 * Record presence for this session. One row per calendar day; the gap
 * is measured from the previous day's visit so "two days, Boss" works.
 */
export async function recordPresence(now = new Date()): Promise<PresenceSnapshot | null> {
  try {
    const dayKey = now.toISOString().slice(0, 10);
    // Previous visit = most recent row that is NOT today, so repeated
    // calls within the same session stay idempotent and the gap really
    // measures "time since you were last here".
    const previous = await prisma.presenceLog.findFirst({
      where: { sessionKey: { not: dayKey } },
      orderBy: { lastSeenAt: "desc" },
    });
    const isNewUser = !previous;
    let gapHours = 0;
    if (previous) {
      gapHours = hoursBetween(now, previous.lastSeenAt);
    }
    await prisma.presenceLog.upsert({
      where: { sessionKey: dayKey },
      create: { sessionKey: dayKey, gapHours, lastSeenAt: now },
      update: { lastSeenAt: now, gapHours },
    });
    return { gapHours, isNewUser, lastSeenAt: previous?.lastSeenAt ?? null };
  } catch (e) {
    console.warn("[Care] recordPresence failed (non-fatal):", (e as Error).message);
    return null;
  }
}

/** Persist threads + mood detected in a user message. Fire-and-forget safe. */
export async function recordCareSignals(
  text: string,
  source = "chat",
  now = new Date()
): Promise<{ threads: number; mood: boolean; people: number }> {
  const { threads, mood } = extractCareSignals(text, now);
  const people = await recordPersonMentions(text, now);
  let savedThreads = 0;
  try {
    for (const t of threads) {
      // Dedupe: refresh an existing open thread on the same topic.
      const existing = await prisma.followUpThread.findFirst({
        where: { topic: { equals: t.topic }, status: { in: ["open", "asked"] } },
      });
      if (existing) {
        await prisma.followUpThread.update({
          where: { id: existing.id },
          data: { detail: t.detail, dueAt: t.dueAt ?? existing.dueAt, kind: t.kind },
        });
      } else {
        await prisma.followUpThread.create({
          data: {
            topic: t.topic,
            detail: t.detail,
            kind: t.kind,
            dueAt: t.dueAt,
          },
        });
      }
      savedThreads++;
    }

    let savedMood = false;
    if (mood) {
      // Don't spam samples — skip if same mood logged within 2 hours.
      const recent = await prisma.moodSample.findFirst({
        where: { createdAt: { gte: new Date(now.getTime() - 2 * 36e5) } },
        orderBy: { createdAt: "desc" },
      });
      if (!recent || recent.mood !== mood.mood) {
        await prisma.moodSample.create({
          data: {
            mood: mood.mood,
            score: mood.score,
            energy: mood.energy,
            source,
            note: text.slice(0, 200),
          },
        });
        savedMood = true;
      }
    }
    return { threads: savedThreads, mood: savedMood, people };
  } catch (e) {
    console.warn("[Care] recordCareSignals failed (non-fatal):", (e as Error).message);
    return { threads: 0, mood: false, people: 0 };
  }
}

// ─── Context assembly ───────────────────────────────────────────────

function dueLabelFor(dueAt: Date | null, now = new Date()): string {
  if (!dueAt) return "upcoming";
  const diffH = hoursBetween(dueAt, now); // positive → due is in the future
  if (diffH <= 0) {
    const overdueH = -diffH;
    return overdueH <= 36 ? "just passed" : "overdue";
  }
  if (diffH <= 12) return "today";
  if (diffH <= 36) return "tomorrow";
  return `in ${Math.ceil(diffH / 24)} days`;
}

/**
 * Everything JARVIS needs to *care*, formatted as a system-prompt block.
 * Empty string when there's nothing worth saying or the DB is unhappy.
 */
export async function getCareContext(now = new Date()): Promise<CareContextBlock> {
  const empty: CareContextBlock = {
    presence: null,
    openThreads: [],
    recentMoods: [],
    quietPeople: [],
    rituals: { dominantTimeBand: null, favoritePanel: null, sampleSize: 0 },
    promptBlock: "",
  };
  try {
    const [presence, threads, moods, people, rituals] = await Promise.all([
      recordPresence(now),
      prisma.followUpThread.findMany({
        where: { status: { in: ["open", "asked"] } },
        orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
        take: 5,
      }),
      prisma.moodSample.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
      getQuietPeople(now),
      getRituals(now),
    ]);

    const openThreads = threads.map((t) => ({
      id: t.id,
      topic: t.topic,
      detail: t.detail,
      kind: t.kind,
      dueAt: t.dueAt,
      dueLabel: dueLabelFor(t.dueAt, now),
      askedCount: t.askedCount,
    }));

    const recentMoods = moods.map((m) => ({
      mood: m.mood,
      score: m.score,
      note: m.note,
      at: m.createdAt,
    }));

    const quietPeople = people;

    // ── Prompt block ──
    const lines: string[] = [];
    const hour = now.getHours();

    lines.push(`── COMPANION CARE CONTEXT ────────────────────────`);
    if (presence && presence.gapHours >= 20) {
      lines.push(
        `- Dhruv was away for ${humanizeGap(presence.gapHours)}. Acknowledge it warmly but briefly — like a friend who noticed.`
      );
    }
    if (hour >= 23 || hour < 5) {
      lines.push(
        `- It is late at night (${hour}:00). Show genuine concern about his sleep without lecturing. One gentle nudge, maximum.`
      );
    }
    if (openThreads.length > 0) {
      lines.push(`- Personal follow-up threads you are tracking:`);
      for (const t of openThreads) {
        lines.push(
          `    • ${t.topic} (${t.kind}, due: ${t.dueLabel})${t.detail ? ` — context: "${t.detail}"` : ""}`
        );
      }
      lines.push(
        `  If a thread's due date has passed or is today, ask about it — ONCE, naturally, woven into your reply (never as an interrogation). Do not re-ask about a thread you already asked about recently unless he brings it up.`
      );
    }
    if (quietPeople.length > 0) {
      lines.push(`- People he hasn't mentioned in a while:`);
      for (const p of quietPeople) {
        lines.push(
          `    • ${p.name}${p.relation ? ` (${p.relation})` : ""} — quiet for ${p.daysSinceMention} days`
        );
      }
      lines.push(
        `  At most ONE per conversation, and only when it fits naturally: a brief "how's your ${quietPeople[0].relation ?? quietPeople[0].name}?" style check-in. Never guilt-trip.`
      );
    }
    if (recentMoods.length > 0) {
      const latest = recentMoods[0];
      const avg = recentMoods.reduce((s, m) => s + m.score, 0) / recentMoods.length;
      lines.push(
        `- Mood signal: latest "${latest.mood}" (${latest.at.toLocaleString()}), recent average ${avg.toFixed(1)}/5.`
      );
      if (latest.score <= 2) {
        lines.push(
          `  He has been ${latest.mood} recently. Lead with a small, genuine check-in — "How are you holding up?" energy — before anything task-related. No toxic positivity.`
        );
      }
    }
    if (rituals.dominantTimeBand && rituals.sampleSize >= 10) {
      const panelBit = rituals.favoritePanel
        ? ` He also tends to spend time in the ${rituals.favoritePanel} panel.`
        : "";
      lines.push(
        `- Habit pattern: he is most often active during ${rituals.dominantTimeBand}.${panelBit} You may reference this rhythm naturally ("right on schedule") but never more than once per conversation.`
      );
    }
    lines.push(
      `- Address him as "Boss" by default; occasionally use his name "Dhruv" in warm or serious moments. Never both in the same sentence.`
    );
    lines.push(`──────────────────────────────────────────────────`);

    const promptBlock =
      openThreads.length > 0 ||
      recentMoods.length > 0 ||
      quietPeople.length > 0 ||
      rituals.dominantTimeBand !== null ||
      (presence && presence.gapHours >= 20)
        ? `\n${lines.join("\n")}`
        : "";

    return { presence, openThreads, recentMoods, quietPeople, rituals, promptBlock };
  } catch (e) {
    console.warn("[Care] getCareContext failed (non-fatal):", (e as Error).message);
    return empty;
  }
}

// ─── Greeting builder ───────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function firstName(name: string): string {
  const cleaned = (name || "").trim();
  if (!cleaned || cleaned.toLowerCase() === "boss") return "Dhruv";
  return cleaned.split(/\s+/)[0];
}

/**
 * A greeting that only JARVIS could give *this* user.
 * Deterministic structure, varied phrasing, real memory behind it.
 */
export async function buildCompanionGreeting(
  userName: string,
  now = new Date(),
  preloadedCtx?: CareContextBlock
): Promise<{ text: string; careNotes: string[] }> {
  const careNotes: string[] = [];
  const name = firstName(userName);
  const hour = now.getHours();
  const timeBand =
    hour < 5 ? "late night" : hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

  let ctx: CareContextBlock | null = preloadedCtx ?? null;
  if (!ctx) {
    try {
      ctx = await getCareContext(now);
    } catch {
      ctx = null;
    }
  }

  const parts: string[] = [];

  // 1) The hello — varies, uses Boss.
  const hello =
    timeBand === "late night"
      ? pick([
          `It's ${timeBand}, Boss. You should be asleep.`,
          `Up past midnight again, Boss?`,
        ])
      : pick([
          `Good ${timeBand}, Boss.`,
          `${timeBand.charAt(0).toUpperCase() + timeBand.slice(1)}, Boss.`,
          `Back online, Boss. Good ${timeBand}.`,
        ]);
  parts.push(hello);

  // 2) Absence — the "I noticed you were gone" moment.
  if (ctx?.presence && ctx.presence.gapHours >= 20 && !ctx.presence.isNewUser) {
    const gap = humanizeGap(ctx.presence.gapHours);
    parts.push(
      pick([
        `It's been ${gap}. I was starting to wonder.`,
        `${gap} — I kept the reactor warm for you.`,
        `You were away ${gap}. Everything held together, mostly.`,
      ])
    );
    careNotes.push(`away ${gap}`);
  }

  // 3) Mood check-in — only when he's been low recently.
  const latest = ctx?.recentMoods?.[0];
  if (latest && latest.score <= 2) {
    parts.push(
      pick([
        `How are you holding up, ${name}?`,
        `You seemed ${latest.mood} last time we talked, ${name}. Better now?`,
        `No pressure today, ${name}. Take what you need.`,
      ])
    );
    careNotes.push(`mood check-in`);
  }

  // 4) Follow-up threads — the "he actually listens" moment.
  const askable = (ctx?.openThreads ?? []).filter(
    (t) =>
      t.askedCount === 0 &&
      (t.dueLabel === "just passed" || t.dueLabel === "today" || t.dueLabel === "tomorrow")
  );
  if (askable.length > 0) {
    const t = askable[0];
    const q =
      t.dueLabel === "just passed"
        ? pick([
            `How did the ${t.topic} go?`,
            `So — the ${t.topic}. Tell me everything.`,
          ])
        : t.dueLabel === "today"
          ? `The ${t.topic} is today, if I remember correctly. You've got this.`
          : `The ${t.topic} is tomorrow, yes? Anything I can prep?`;
    parts.push(q);
    careNotes.push(`follow-up: ${t.topic}`);
    // Mark asked (best-effort).
    try {
      await prisma.followUpThread.update({
        where: { id: t.id },
        data: { askedCount: { increment: 1 }, status: "asked" },
      });
    } catch {
      // non-fatal
    }
  }

  // 5) People check-in — one, only if it's been a long while.
  const quiet = ctx?.quietPeople?.[0];
  if (quiet && quiet.daysSinceMention >= 14) {
    parts.push(
      pick([
        `By the way — how's your ${quiet.relation ?? quiet.name} doing these days?`,
        `It's been a while since you mentioned ${quiet.name}. Everything alright there?`,
      ])
    );
    careNotes.push(`people check-in: ${quiet.name}`);
  }

  // 6) Late-night care — one gentle nudge.
  if (timeBand === "late night") {
    parts.push(
      pick([
        `Even Tony Stark sleeps. Eventually.`,
        `The systems will keep watch. You should rest.`,
        `Nothing you're about to do can't wait until sunrise. Most things can't.`,
      ])
    );
    careNotes.push(`late-night nudge`);
  }

  // 7) Throwbacks & anniversaries — the long-memory moment. "100 days of
  // us" or "two months ago today we shipped X" — computed, not canned.
  try {
    const memoryMoment = (await getAnniversary(now)) ?? (await getThrowback(now));
    if (memoryMoment) {
      parts.push(memoryMoment);
      careNotes.push(memoryMoment.includes("ago today") ? "throwback" : "journey anniversary");
    }
  } catch {
    // non-fatal
  }

  return {
    text: parts.join(" "),
    careNotes,
  };
}

// ─── Thread utilities (for API + UI) ────────────────────────────────

export async function resolveThread(id: string): Promise<boolean> {
  try {
    await prisma.followUpThread.update({
      where: { id },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    return true;
  } catch {
    return false;
  }
}

export async function listOpenThreads() {
  try {
    return await prisma.followUpThread.findMany({
      where: { status: { in: ["open", "asked"] } },
      orderBy: [{ dueAt: "asc" }, { updatedAt: "desc" }],
      take: 20,
    });
  } catch {
    return [];
  }
}
