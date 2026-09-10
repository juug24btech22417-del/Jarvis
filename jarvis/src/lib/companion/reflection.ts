// JARVIS Weekly Reflection — the friend who actually paid attention.
//
// Once a week JARVIS reviews: how many days you showed up, your mood
// trend, what got done, what's still open, who's gone quiet. Not a
// dashboard — a short, honest reflection in his voice.

import { prisma } from "@/lib/db/queries";
import { getQuietPeople } from "./care";

export interface WeekReflection {
  hasData: boolean;
  daysActive: number;
  lateNights: number;
  chatsCount: number;
  moodAvg: number | null;
  moodTrend: "up" | "down" | "steady" | "none";
  openThreads: string[];
  quietPeople: string[];
  rendered: string;
}

function moodWord(avg: number): string {
  if (avg >= 4) return "good week overall";
  if (avg >= 3) return "steady week";
  if (avg >= 2) return "heavy week";
  return "rough week";
}

export async function buildWeeklyReflection(now = new Date()): Promise<WeekReflection> {
  const weekAgo = new Date(now.getTime() - 7 * 864e5);
  const base: WeekReflection = {
    hasData: false,
    daysActive: 0,
    lateNights: 0,
    chatsCount: 0,
    moodAvg: null,
    moodTrend: "none",
    openThreads: [],
    quietPeople: [],
    rendered: "",
  };

  try {
    const [presence, moods, events, threads, people] = await Promise.all([
      prisma.presenceLog.findMany({
        where: { lastSeenAt: { gte: weekAgo } },
        orderBy: { lastSeenAt: "asc" },
      }),
      prisma.moodSample.findMany({
        where: { createdAt: { gte: weekAgo } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.memoryEvent.findMany({
        where: { kind: "chat", createdAt: { gte: weekAgo } },
        select: { createdAt: true },
      }),
      prisma.followUpThread.findMany({
        where: { status: { in: ["open", "asked"] } },
        take: 5,
      }),
      getQuietPeople(now),
    ]);

    const daysActive = presence.length;
    const lateNights = presence.filter((p) => {
      const h = new Date(p.lastSeenAt).getHours();
      return h >= 23 || h < 5;
    }).length;
    const chatsCount = events.length;

    const firstHalf = moods.slice(0, Math.ceil(moods.length / 2));
    const secondHalf = moods.slice(Math.ceil(moods.length / 2));
    const avg = (arr: typeof moods) =>
      arr.length ? arr.reduce((s, m) => s + m.score, 0) / arr.length : null;
    const moodAvg = moods.length ? Number((avg(moods) as number).toFixed(1)) : null;
    let moodTrend: WeekReflection["moodTrend"] = "none";
    if (firstHalf.length && secondHalf.length) {
      const a = avg(firstHalf) as number;
      const b = avg(secondHalf) as number;
      moodTrend = b - a > 0.5 ? "up" : a - b > 0.5 ? "down" : "steady";
    }

    const hasData = daysActive > 0 || chatsCount > 0 || moods.length > 0;

    // ── Render in JARVIS's voice ──
    const lines: string[] = [];
    lines.push(`**Weekly reflection, Boss.**`);
    if (!hasData) {
      lines.push(
        `Quiet week — we barely spoke. No judgment. I'll be here when you're back.`
      );
      return { ...base, rendered: lines.join("\n\n") };
    }

    if (daysActive > 0) {
      lines.push(
        `You showed up ${daysActive} day${daysActive === 1 ? "" : "s"} this week${
          chatsCount > 0 ? `, and we talked ${chatsCount} time${chatsCount === 1 ? "" : "s"}` : ""
        }.`
      );
    }
    if (moodAvg !== null) {
      const trendBit =
        moodTrend === "up"
          ? " — and you ended stronger than you started"
          : moodTrend === "down"
            ? " — it got heavier as the week went on"
            : "";
      lines.push(`Mood read: a ${moodWord(moodAvg)}${trendBit}.`);
    }
    if (lateNights >= 3) {
      lines.push(
        `${lateNights} late nights. I kept watch, but even Tony Stark sleeps — go easy this week.`
      );
    }
    if (threads.length > 0) {
      lines.push(
        `Still on my list: ${threads.map((t) => t.topic).join(", ")}. Want to take one on today?`
      );
    }
    if (people.length > 0) {
      lines.push(
        `It's been a while since you mentioned ${people
          .map((p) => p.name)
          .join(" or ")}. Maybe check in?`
      );
    }

    return {
      hasData,
      daysActive,
      lateNights,
      chatsCount,
      moodAvg,
      moodTrend,
      openThreads: threads.map((t) => t.topic),
      quietPeople: people.map((p) => p.name),
      rendered: lines.join("\n\n"),
    };
  } catch (e) {
    console.warn("[Reflection] buildWeeklyReflection failed (non-fatal):", (e as Error).message);
    return base;
  }
}
