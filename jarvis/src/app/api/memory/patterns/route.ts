// Tier 1C — Pattern-of-life API.
// GET  → top patterns (cached 5 min in-process)
// POST → record a single event (fire-and-forget callers don't need to wait)

import { NextResponse } from "next/server";
import { detectPatterns, recordEvent } from "@/lib/memory/patterns";

// Tiny in-process cache. Patterns are derived, so 5 minutes is fine.
let cache: { at: number; data: any } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function GET() {
  try {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return NextResponse.json({ patterns: cache.data, cached: true });
    }
    const patterns = await detectPatterns();
    cache = { at: Date.now(), data: patterns };
    return NextResponse.json({ patterns, cached: false });
  } catch (err) {
    console.error("[Patterns] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to detect patterns" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { kind, payload } = body;
    if (!kind || typeof kind !== "string") {
      return NextResponse.json(
        { error: "kind required" },
        { status: 400 }
      );
    }
    // Don't await — fire-and-forget so callers can stay snappy.
    recordEvent(kind, payload || {}).catch((err) =>
      console.warn("[Patterns] recordEvent error:", err)
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Patterns] POST failed:", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}