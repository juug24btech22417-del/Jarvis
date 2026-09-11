// Tier 2A — Mission event stream (SSE).
// GET ?jobId=X → live Server-Sent-Events feed of that job's mission events.
// Replays the ring buffer first (catch-up), then subscribes live. The
// client filters duplicates by `seq` so replay + live overlap is safe.

import { NextRequest } from "next/server";
import {
  getMissionEvents,
  subscribeMissionEvents,
  type MissionEvent,
} from "@/lib/agent/events";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return new Response("Missing jobId", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (e: MissionEvent) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: mission\ndata: ${JSON.stringify(e)}\n\n`)
          );
        } catch {
          closed = true; // client went away — stop writing
        }
      };

      // 1. Replay buffered events so reconnects catch up instantly.
      for (const e of getMissionEvents(jobId)) send(e);

      // 2. Subscribe for live events. The ring buffer replays may overlap
      //    with live events if some arrive mid-subscribe — the client
      //    dedupes on seq.
      const unsubscribe = subscribeMissionEvents(jobId, send);

      // 3. Keepalive so proxies don't kill the connection.
      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
