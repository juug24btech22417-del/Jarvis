// In-app notification endpoint.
//
// The Oracle research pipeline POSTs here when a run finishes (or fails)
// so the browser shows a desktop notification via the existing
// /api/events/stream SSE feed. Previously this endpoint didn't exist, so
// every Oracle completion notification 404'd silently.

import { NextRequest, NextResponse } from "next/server";
import { publishEvent } from "@/lib/composio/eventBus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const message = typeof body.message === "string" ? body.message : "";
    const status = body.status === "error" ? "error" : "success";

    if (!message.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    publishEvent({
      id: `notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "oracle",
      type: status === "error" ? "research_failed" : "research_complete",
      occurredAt: new Date().toISOString(),
      title: status === "error" ? "JARVIS: Research failed" : "JARVIS: Research complete",
      body: message.slice(0, 1500),
      priority: status === "error" ? "high" : "normal",
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
