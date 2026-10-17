// API Route: /api/companion/proactive
// Handles evaluation of proactive unprompted speech, snooze, and interaction tracking.

import { NextResponse } from "next/server";
import {
  evaluateProactiveSpeech,
  recordUserInteraction,
  snoozeProactive,
  getProactiveStatus,
} from "@/lib/companion/proactive";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    const user = searchParams.get("user") || "Dhruv";
    const mockHour = searchParams.has("mockHour") ? Number(searchParams.get("mockHour")) : undefined;

    const result = await evaluateProactiveSpeech({
      force,
      userName: user,
      mockHour,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[Proactive API] GET failed:", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body?.action;

    if (action === "user_spoke") {
      await recordUserInteraction();
      return NextResponse.json({ ok: true, message: "Interaction recorded" });
    }

    if (action === "snooze") {
      const minutes = Number(body?.minutes) || 60;
      await snoozeProactive(minutes);
      return NextResponse.json({ ok: true, message: `Proactive speech snoozed for ${minutes}m` });
    }

    if (action === "status") {
      const status = await getProactiveStatus();
      return NextResponse.json({ ok: true, ...status });
    }

    // Default: evaluate
    const result = await evaluateProactiveSpeech({
      force: !!body?.force,
      userName: body?.user || "Dhruv",
      mockHour: body?.mockHour !== undefined ? Number(body.mockHour) : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[Proactive API] POST failed:", err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
