// Companion Care API — the personal-JARVIS endpoints.
//
//   GET  /api/companion           → greeting + care context snapshot
//   POST /api/companion           → record care signals from a message
//   PATCH /api/companion          → resolve a follow-up thread
//
// All handlers are fail-soft: a DB problem degrades to a simple greeting,
// never a 500 on the main screen.

import { NextResponse } from "next/server";
import {
  buildCompanionGreeting,
  recordCareSignals,
  recordPresence,
  resolveThread,
  getCareContext,
  runChores,
} from "@/lib/companion/care";

export async function GET() {
  const now = new Date();
  try {
    // One presence write, one context fetch; the greeting reuses it.
    // Chores run here too — the quiet "his own life" housekeeping JARVIS
    // does between sessions. If something was tidied, he mentions it.
    const [presence, chores] = await Promise.all([recordPresence(now), runChores(now)]);
    const ctx = await getCareContext(now);
    const greeting = await buildCompanionGreeting("Dhruv", now, ctx);
    if (chores.expiredThreads > 0 || chores.archivedPeople > 0) {
      const bits: string[] = [];
      if (chores.expiredThreads > 0)
        bits.push(`closed out ${chores.expiredThreads} stale follow-up${chores.expiredThreads === 1 ? "" : "s"}`);
      if (chores.archivedPeople > 0)
        bits.push(`set aside ${chores.archivedPeople} long-quiet ${chores.archivedPeople === 1 ? "thread" : "threads"}`);
      greeting.text += ` While you were away, I ${bits.join(" and ")}.`;
      greeting.careNotes.push("housekeeping");
    }
    return NextResponse.json({
      ok: true,
      greeting: greeting.text,
      careNotes: greeting.careNotes,
      presence,
      threads: ctx.openThreads,
      moods: ctx.recentMoods.map((m) => ({
        mood: m.mood,
        score: m.score,
        note: m.note,
        at: m.at,
      })),
    });
  } catch (e) {
    console.warn("[Companion] GET failed:", (e as Error).message);
    return NextResponse.json({
      ok: false,
      greeting: `Good ${now.getHours() < 12 ? "morning" : now.getHours() < 17 ? "afternoon" : "evening"}, Boss.`,
      careNotes: [],
      threads: [],
      moods: [],
    });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const text: string = typeof body?.text === "string" ? body.text : "";
    const source: string = typeof body?.source === "string" ? body.source : "chat";
    if (!text.trim()) {
      return NextResponse.json({ ok: false, error: "text required" }, { status: 400 });
    }
    const result = await recordCareSignals(text, source);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.warn("[Companion] POST failed:", (e as Error).message);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const id: string = typeof body?.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });
    }
    const done = await resolveThread(id);
    return NextResponse.json({ ok: done });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
