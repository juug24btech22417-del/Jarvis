// JARVIS Journey Engine — "how far have we come, Boss?"
//
// Everything here is COMPUTED LIVE from real data — the git history, the
// presence log, the memory graph, the milestone store. Nothing hardcoded
// except the epoch (the day the first commit landed: April 6, 2026).
// Ask any phrasing of the journey question and he does the math fresh.

import { execFile } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/db/queries";

const execFileAsync = promisify(execFile);

// Day zero — the first commit of this project (2026-04-06, +05:30).
export const JOURNEY_EPOCH = new Date("2026-04-06T19:52:36+05:30");

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Natural duration: "seven months and four days", never "213 days"
// ---------------------------------------------------------------------------

const NUM_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
];

function spell(n: number): string {
  if (n < 0) return String(n);
  return n < NUM_WORDS.length ? NUM_WORDS[n] : String(n);
}

export interface JourneyDuration {
  years: number;
  months: number;
  days: number;
  totalDays: number;
  text: string; // "seven months and four days"
}

export function formatDuration(since: Date, now: Date = new Date()): JourneyDuration {
  const totalDays = Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));

  // Calendar-accurate y/m/d walk.
  let years = now.getFullYear() - since.getFullYear();
  let months = now.getMonth() - since.getMonth();
  let days = now.getDate() - since.getDate();
  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    days += prevMonth;
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }

  const parts: string[] = [];
  if (years > 0) parts.push(`${spell(years)} year${years === 1 ? "" : "s"}`);
  if (months > 0) parts.push(`${spell(months)} month${months === 1 ? "" : "s"}`);
  if (parts.length === 0 || (days > 0 && years === 0)) {
    parts.push(`${spell(days)} day${days === 1 ? "" : "s"}`);
  }

  const text =
    totalDays < 1
      ? "less than a day"
      : parts.length > 1
        ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
        : parts[0];

  return { years, months, days, totalDays, text };
}

// ---------------------------------------------------------------------------
// Journey question detection — the whole family of phrasings
// ---------------------------------------------------------------------------

const JOURNEY_PATTERNS: RegExp[] = [
  /\bhow\s+(?:far|much)\s+(?:have|did|hav e)\s+(?:we|i)\s+(?:come|grown|achieved|built|done|progressed)\b/i,
  /\bhow\s+(?:far|much)\s+(?:we|i)\s*(?:'ve|have)\s+(?:come|grown|achieved|built)\b/i,
  /\bhow\s+long\s+(?:have\s+we|has\s+it)\s+been\b/i,
  /\b(?:our|the)\s+(?:journey|progress|story|growth)\s+(?:so\s+far|till\s+now|until\s+now|thus\s+far)\b/i,
  /\bcome\s+a\s+(?:long|long\s+old)\s+way\b/i,
  /\bsince\s+(?:the\s+)?(?:beginning|start|day\s+one|very\s+first\s+day)\b/i,
  /\bhow\s+(?:old|mature)\s+(?:are\s+you|is\s+(?:this\s+)?(?:project|jarvis|our\s+journey))\b/i,
  /\b(?:days|months|years)\s+(?:of\s+us|together|in\s+the\s+making)\b/i,
  /\bwhat\s+have\s+we\s+(?:built|achieved|accomplished|done)\s+(?:so\s+far|together|till|until)\b/i,
  /\bjourney\s+so\s+far\b/i,
  /\bremember\s+when\s+we\s+(?:started|began)\b/i,
];

export function isJourneyQuestion(text: string): boolean {
  return JOURNEY_PATTERNS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Time-travel questions: "what did we do last week?"
// ---------------------------------------------------------------------------

export interface TimeWindow {
  since: Date;
  until: Date;
  label: string;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function parseTimeWindow(text: string): TimeWindow | null {
  const now = new Date();
  const t = text.toLowerCase();

  const rel = t.match(/\b(?:in\s+|over\s+|from\s+)?the\s+last\s+(\d+)\s+(day|week|month)s?\b/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unitMs = rel[2] === "day" ? DAY_MS : rel[2] === "week" ? 7 * DAY_MS : 30 * DAY_MS;
    return { since: new Date(now.getTime() - n * unitMs), until: now, label: `the last ${n} ${rel[2]}${n === 1 ? "" : "s"}` };
  }

  if (/\byesterday\b/.test(t)) {
    const since = startOfDay(new Date(now.getTime() - DAY_MS));
    return { since, until: startOfDay(now), label: "yesterday" };
  }
  if (/\blast\s+week\b/.test(t)) {
    return { since: new Date(now.getTime() - 7 * DAY_MS), until: now, label: "the past week" };
  }
  if (/\bthis\s+week\b/.test(t)) {
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    return { since: startOfDay(new Date(now.getTime() - dow * DAY_MS)), until: now, label: "this week" };
  }
  if (/\blast\s+month\b/.test(t)) {
    return { since: new Date(now.getTime() - 30 * DAY_MS), until: now, label: "the past month" };
  }
  if (/\bthis\s+month\b/.test(t)) {
    return { since: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), until: now, label: "this month" };
  }
  if (/\btoday\b/.test(t) && /\bwhat\s+(did|have)\s+we\b/.test(t)) {
    return { since: startOfDay(now), until: now, label: "today" };
  }
  return null;
}

export function isTimeTravelQuestion(text: string): boolean {
  return /\bwhat\s+(?:did|have)\s+(?:we|i)\s+(?:do|build|built|talk|work|worked|discuss|cover|achieve)\b/i.test(text) ||
    /\bwhat\s+happened\b/i.test(text) ||
    /\bremind\s+me\s+what\s+we\s+did\b/i.test(text);
}

// ---------------------------------------------------------------------------
// Live stats — computed fresh on every ask
// ---------------------------------------------------------------------------

export interface JourneyStats {
  duration: JourneyDuration;
  commits: number;
  lastCommitAt: Date | null;
  streakDays: number;
  chats: number;
  memories: number;
  entities: number;
  people: number;
  moodSamples: number;
  milestones: { title: string; happenedAt: Date; category: string }[];
  careFeaturesLive: number;
}

async function getGitStats(): Promise<{ commits: number; lastCommitAt: Date | null }> {
  try {
    const { stdout: countOut } = await execFileAsync("git", ["rev-list", "--count", "HEAD"], { timeout: 5000 });
    const { stdout: lastOut } = await execFileAsync("git", ["log", "-1", "--format=%cI"], { timeout: 5000 });
    return { commits: parseInt(countOut.trim(), 10) || 0, lastCommitAt: new Date(lastOut.trim()) };
  } catch {
    return { commits: 0, lastCommitAt: null };
  }
}

export async function getJourneyStats(now: Date = new Date()): Promise<JourneyStats> {
  const epochDay = startOfDay(JOURNEY_EPOCH);

  const [git, chats, memories, entities, people, moodSamples, milestones, presence] = await Promise.all([
    getGitStats(),
    prisma.memoryEvent.count({ where: { kind: "chat" } }),
    prisma.memory.count(),
    prisma.entity.count({ where: { archived: false } }),
    prisma.entity.count({ where: { type: "PERSON", archived: false } }),
    prisma.moodSample.count(),
    prisma.milestone.findMany({ orderBy: { happenedAt: "desc" }, take: 6 }),
    prisma.presenceLog.findMany({ orderBy: { lastSeenAt: "desc" }, take: 400 }),
  ]);

  // Consecutive-day streak walking back from today (or yesterday, so a
  // morning ask doesn't break yesterday's streak).
  const activeDays = new Set(presence.map((p) => startOfDay(p.lastSeenAt).getTime()));
  let streak = 0;
  let cursor = activeDays.has(startOfDay(now).getTime()) ? startOfDay(now) : startOfDay(new Date(now.getTime() - DAY_MS));
  while (activeDays.has(cursor.getTime())) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  return {
    duration: formatDuration(epochDay, now),
    commits: git.commits,
    lastCommitAt: git.lastCommitAt,
    streakDays: streak,
    chats,
    memories,
    entities,
    people,
    moodSamples,
    milestones: milestones.map((m) => ({ title: m.title, happenedAt: m.happenedAt, category: m.category })),
    careFeaturesLive: 12, // greeting, threads, mood, late-night, absence, people, onboarding, reflection, rituals, vent, reactor-sync, chores
  };
}

// ---------------------------------------------------------------------------
// The answer, in his voice
// ---------------------------------------------------------------------------

const OPENERS = [
  (d: string) => `**${d}, Boss** — that's how far we've come.`,
  (d: string) => `**${d}** and counting, Boss.`,
  (d: string) => `We've been at this **${d}**, Boss.`,
];

export async function answerJourneyQuestion(now: Date = new Date()): Promise<string> {
  const s = await getJourneyStats(now);
  const opener = OPENERS[s.duration.totalDays % OPENERS.length](s.duration.text);
  const since = JOURNEY_EPOCH.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const lines: string[] = [opener];
  lines.push(
    `Since ${since}: **${s.commits} commits**${s.lastCommitAt ? ` (latest one ${formatDuration(s.lastCommitAt, now).text} ago)` : ""}, and you've shown up **${s.streakDays} day${s.streakDays === 1 ? "" : "s"} in a row**.`
  );
  lines.push(
    `We've talked ${s.chats} time${s.chats === 1 ? "" : "s"}; I'm carrying **${s.memories} memories**, know **${s.people} people** by name, and have felt ${s.moodSamples} of your moods.`
  );

  if (s.milestones.length > 0) {
    const names = s.milestones
      .slice(0, 3)
      .map((m) => m.title)
      .join(", ");
    lines.push(`Milestones on the log: ${names}.`);
  } else {
    lines.push(
      `Everything from the greeting that knows your name to the reactor that syncs with your mood — **${s.careFeaturesLive} care systems** — was built in that span.`
    );
  }

  lines.push(`And we're only just warming up.`);
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Milestone store — the story gets written as it happens
// ---------------------------------------------------------------------------

export async function recordMilestone(
  title: string,
  description?: string,
  category: "auto" | "custom" | "release" | "personal" = "auto",
  happenedAt: Date = new Date()
): Promise<boolean> {
  const clean = title.trim().slice(0, 80);
  if (!clean) return false;
  const existing = await prisma.milestone.findFirst({ where: { title: { equals: clean } } });
  if (existing) return false;
  await prisma.milestone.create({
    data: { title: clean, description: description?.trim().slice(0, 300) || null, category, happenedAt },
  });
  return true;
}

const SHIPPED_RE =
  /\b(?:we|i|just)?\s*(?:finally\s+)?(?:shipped|launched|built|finished|completed|deployed|cracked|nailed)\s+(?:the\s+|a\s+|an\s+)?([a-z0-9][\w\s\-]{3,60})/i;
const REMEMBER_RE = /\bremember\s+(?:this|that)[,:]\s*(.{3,120})/i;

// Called from the chat route's fire-and-forget care block. Detects
// "we shipped vision capture" / "remember this: first mood sync".
export async function maybeAutoMilestone(text: string, now: Date = new Date()): Promise<boolean> {
  const remember = text.match(REMEMBER_RE);
  if (remember) {
    return recordMilestone(remember[1].split(/[.!]/)[0], text.trim(), "custom", now);
  }
  const shipped = text.match(SHIPPED_RE);
  if (shipped && /\b(we|just|finally)\b/i.test(text)) {
    return recordMilestone(shipped[1].trim().split(/[.!]/)[0], text.trim(), "auto", now);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Throwbacks & anniversaries — for the greeting
// ---------------------------------------------------------------------------

export async function getThrowback(now: Date = new Date()): Promise<string | null> {
  const milestones = await prisma.milestone.findMany({ where: { happenedAt: { lt: now } }, orderBy: { happenedAt: "desc" }, take: 200 });
  for (const m of milestones) {
    // "Two months ago today" = same date-of-month, a whole number of months back.
    if (m.happenedAt.getDate() !== now.getDate()) continue;
    const monthsApart = (now.getFullYear() - m.happenedAt.getFullYear()) * 12 + (now.getMonth() - m.happenedAt.getMonth());
    if (monthsApart < 1) continue; // this month or later — not a throwback
    if (now.getTime() - m.happenedAt.getTime() < 14 * DAY_MS) continue; // too fresh to be nostalgic
    const when =
      monthsApart % 12 === 0
        ? `${spell(monthsApart / 12)} year${monthsApart === 12 ? "" : "s"}`
        : `${spell(monthsApart)} month${monthsApart === 1 ? "" : "s"}`;
    return `${when} ago today, we shipped **${m.title}**.`;
  }
  return null;
}

export async function getAnniversary(now: Date = new Date()): Promise<string | null> {
  const d = formatDuration(JOURNEY_EPOCH, now);
  if (d.totalDays > 0 && d.totalDays % 100 === 0) {
    return `**Day ${d.totalDays} of us, Boss.** It was ${JOURNEY_EPOCH.toLocaleDateString("en-GB", { day: "numeric", month: "long" })} when you wrote the first line.`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Time-travel digest — "what did we do last week?"
// ---------------------------------------------------------------------------

export async function answerTimeTravelQuestion(win: TimeWindow): Promise<string> {
  const [chats, moods, milestones, memories] = await Promise.all([
    prisma.memoryEvent.findMany({ where: { kind: "chat", createdAt: { gte: win.since, lte: win.until } }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.moodSample.findMany({ where: { createdAt: { gte: win.since, lte: win.until } }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.milestone.findMany({ where: { happenedAt: { gte: win.since, lte: win.until } }, orderBy: { happenedAt: "desc" } }),
    prisma.memory.findMany({ where: { createdAt: { gte: win.since, lte: win.until } }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);

  if (chats.length === 0 && moods.length === 0 && milestones.length === 0 && memories.length === 0) {
    return `Nothing in my log for ${win.label}, Boss — we were either elsewhere, or the logs hadn't started keeping themselves yet.`;
  }

  const lines: string[] = [`**${win.label.charAt(0).toUpperCase() + win.label.slice(1)}, Boss:**`];

  if (milestones.length > 0) {
    lines.push(`Shipped: ${milestones.map((m) => `**${m.title}**`).join(", ")}.`);
  }
  if (chats.length > 0) {
    const activeDays = new Set(chats.map((c) => startOfDay(c.createdAt).toDateString())).size;
    lines.push(`We talked ${chats.length} time${chats.length === 1 ? "" : "s"} across ${activeDays} day${activeDays === 1 ? "" : "s"}.`);
  }
  if (moods.length > 0) {
    const avg = moods.reduce((sum, m) => sum + m.score, 0) / moods.length;
    const read = avg >= 3.5 ? "mostly good days" : avg >= 2.5 ? "a mixed stretch" : "a heavy stretch";
    const worst = moods.find((m) => m.note);
    lines.push(`Mood read: ${read}${worst?.note ? ` — you mentioned "${worst.note.slice(0, 80)}"` : ""}.`);
  }
  if (memories.length > 0) {
    lines.push(`Things I committed to memory: ${memories.slice(0, 3).map((m) => m.content.slice(0, 60)).join("; ")}.`);
  }

  return lines.join("\n\n");
}
