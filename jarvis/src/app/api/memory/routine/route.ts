// Routine prediction API.
//
// GET  → ranked predictions for "what is the user about to do, and when"
//        ?limit=3        how many to return
//        ?at=<ISO date>  predict for a specific moment (defaults to now)
//        ?explain=1      also include the human sentence for each prediction
//
// Backed by the decayed interpolated-Markov model in lib/memory/routinePredict.
// One DB read serves every answer in the response.

import { NextRequest, NextResponse } from "next/server";
import {
  describePrediction,
  loadRecentRoutineActions,
  nextPrediction,
  predictRoutine,
} from "@/lib/memory/routinePredict";

// Reads the query string and the database, so it is never a static render:
// without this Next tries to prerender the handler at build time and logs a
// DYNAMIC_SERVER_USAGE error for using `request.url`.
export const dynamic = "force-dynamic";

// Predictions are built from weeks of history and shift slowly, so a short
// in-process cache keeps panel re-renders and briefings off the DB.
let cache: { at: number; limit: number; body: any } | null = null;
const CACHE_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const limitParam = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(10, Math.trunc(limitParam)) : 3;
    const explain = url.searchParams.get("explain") === "1";
    const atParam = url.searchParams.get("at");
    const at = atParam ? new Date(atParam) : new Date();
    if (!Number.isFinite(at.getTime())) {
      return NextResponse.json({ error: "invalid `at` timestamp" }, { status: 400 });
    }

    // The cache only describes "now"; an explicit `at` is a what-if query and is
    // always computed fresh.
    if (!atParam && !explain && cache && cache.limit === limit && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json({ ...cache.body, cached: true });
    }

    const actions = await loadRecentRoutineActions(at);
    const predictions = predictRoutine(actions, at, { limit });

    const body = {
      predictions,
      // The single item worth surfacing proactively — null unless the timing
      // actually lines up, so a scheduled habit three hours away stays quiet.
      next: nextPrediction(actions, at),
      sampleSize: actions.length,
      generatedAt: at.toISOString(),
      cached: false,
    };

    if (!atParam && !explain) cache = { at: Date.now(), limit, body };

    return NextResponse.json(
      explain
        ? { ...body, predictions: predictions.map((p) => ({ ...p, sentence: describePrediction(p) })) }
        : body
    );
  } catch (err) {
    console.error("[Routine] GET failed:", err);
    return NextResponse.json({ error: "Failed to predict routine" }, { status: 500 });
  }
}
