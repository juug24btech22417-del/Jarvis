import { NextRequest, NextResponse } from "next/server";
import { runAutonomousTask, type AgentEvent, type UserLocation } from "@/lib/agent/toolRunner";

// The autonomous agent can drive a real browser, so give it room to work.
export const runtime = "nodejs";
export const maxDuration = 300;

const BASE =
  process.env.INTERNAL_BASE_URL ||
  process.env.INTERNAL_API_URL ||
  "http://localhost:3000";

/** Ask the Maps MCP to turn the client's coordinates into a human address. */
async function resolveAddress(lat: number, lng: number): Promise<string | undefined> {
  try {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcp: "googlemaps", action: "reverse_geocode", params: { lat, lng } }),
    });
    const json = await res.json();
    if (json.success) return json.data?.short || json.data?.address;
  } catch {
    // address is a nicety — coordinates alone still work
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  let goal = "";
  let userLocation: UserLocation | undefined;

  try {
    const body = await req.json();
    goal = String(body?.goal || "").trim();
    const locIn = body?.location;
    const lat = Number(locIn?.lat);
    const lng = Number(locIn?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      userLocation = { lat, lng, address: typeof locIn?.address === "string" ? locIn.address : undefined };
      if (!userLocation.address) {
        userLocation.address = await resolveAddress(lat, lng);
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!goal) {
    return NextResponse.json({ error: "Goal is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client disconnected — nothing to do
        }
      };

      try {
        // runAutonomousTask emits its own `final` event (success or honest
        // partial), so the route only needs to surface hard failures.
        await runAutonomousTask(goal, send, { userLocation });
      } catch (e: any) {
        send({ type: "error", message: e?.message || "Autonomous task failed" });
      } finally {
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch {}
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
