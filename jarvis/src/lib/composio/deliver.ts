// Delivery: fan a JarvisEvent out to telegram + desktop, in parallel.
//
// Telegram path:  delegates to the existing notifyUser() — same code path
//                 the scheduler, briefing, sentinel, and panel already use.
//                 This means outgoing composio messages automatically show
//                 up in the Telegram panel as "system" rows and the user's
//                 voice/text preferences are honored.
//
// Desktop path:   publishes on eventBus. The SSE endpoint at
//                 /api/events/stream forwards it to the browser, where a
//                 hook calls the existing notify() to trigger a system
//                 Notification.
//
// Rate limiting:  per-chat 1 message / 3s to stay well under Telegram's
//                 per-chat 1 msg/sec global limit even during a burst of
//                 composio events.
//
// Dedup of delivery state:  the row id from recordAndCheck is updated
//                           per-channel so the panel can show a delivery
//                           ledger.

import { notifyUser } from "@/lib/telegram/notify";
import { publishEvent, type JarvisEvent } from "./eventBus";
import { markDelivered } from "./dedupe";

const RATE_LIMIT_MS = 3000;
const lastSentByChat = new Map<number, number>();

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildTelegramMessage(event: JarvisEvent): string {
  const icon = iconFor(event.source);
  // Plain text. The downstream "Open in source" button carries the link.
  // Avoid MarkdownV2 because user-controlled bodies (email subjects, github
  // titles) commonly contain unescaped reserved chars (`-`, `.`, `!`, ...)
  // which cause Telegram 400s. We can revisit HTML mode later.
  return `${icon} ${event.title}\n\n${event.body}`.slice(0, 4000);
}

function iconFor(source: JarvisEvent["source"]): string {
  switch (source) {
    case "gmail":
      return "📧";
    case "gcal":
      return "📅";
    case "github":
      return "🔔";
    case "notion":
      return "📝";
    case "linear":
      return "🟣";
    case "jira":
      return "🟦";
    default:
      return "⚡";
  }
}

function buildButtons(event: JarvisEvent): Array<Array<{ text: string; url?: string; callback_data: string }>> {
  if (!event.url) return [];
  return [[{ text: "Open in source", url: event.url, callback_data: "noop" }]];
}

/**
 * Deliver an event. Idempotent at the dedupe layer (caller already passed
 * recordAndCheck before calling us), so calling this twice with the same
 * event id is safe — the second call short-circuits at dedupe.
 *
 * `opts.followUp` skips the per-chat rate limit (used by the LLM summary
 * enrichment message which would otherwise be delayed 3s after the raw
 * body message).
 */
export async function deliver(
  event: JarvisEvent,
  logId: string,
  opts: { followUp?: boolean } = {}
): Promise<void> {
  // ── Telegram ──
  const tgPromise = (async () => {
    const chatId = undefined; // notifyUser resolves to first allowed chat
    if (!opts.followUp) {
      const last = lastSentByChat.get(0);
      if (last) {
        const wait = Math.max(0, RATE_LIMIT_MS - (Date.now() - last));
        if (wait > 0) await sleep(wait);
      }
    }
    const result = await notifyUser(chatId, buildTelegramMessage(event), {
      buttons: buildButtons(event),
      fromSource: `composio:${event.source}`,
    });
    // Mark timestamp only AFTER the actual send completes — so the next
    // event's wait is measured against the previous send, not against the
    // start of the wait.
    lastSentByChat.set(0, Date.now());
    if (result.sent) {
      await markDelivered(logId, "telegram", true);
    } else {
      await markDelivered(logId, "telegram", false, result.error);
    }
  })();

  // ── Desktop (SSE → browser notification) ──
  const dtPromise = (async () => {
    try {
      publishEvent(event);
      await markDelivered(logId, "desktop", true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await markDelivered(logId, "desktop", false, msg);
    }
  })();

  await Promise.allSettled([tgPromise, dtPromise]);
}
