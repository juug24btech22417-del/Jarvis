// SSE endpoint for desktop notifications.
//
// Subscribes to the in-process eventBus and forwards every JarvisEvent
// to the connected browser client. The browser hook (useNotifFromBus)
// turns each event into a system Notification via the existing
// useNotifications hook in src/lib/notifications/index.ts.
//
// Keep-alive ping every 25s so intermediate proxies / dev-server hot
// reloads don't kill the stream silently.

import type { NextRequest } from "next/server";
import { subscribeEvents, type JarvisEvent } from "@/lib/composio/eventBus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(_req: NextRequest) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAlive: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller closed; cleanup below
        }
      };

      send("hello", { ts: Date.now() });

      unsubscribe = subscribeEvents((event: JarvisEvent) => {
        send("jarvis:event", event);
      });

      keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // closed; interval will be cleared in cancel()
        }
      }, 25_000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
