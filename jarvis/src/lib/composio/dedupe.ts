// Dedupe helper for composio events.
//
// `composio.triggers.subscribe` can replay events after a reconnect, so we
// can't just naively process every payload. We keep a tiny seen-set backed
// by the ComposioEventLog table (unique on seenKey) — first time we see an
// id we insert, second time the insert fails and we drop the duplicate.
//
// The log also doubles as the delivery record, so callers get a single
// `recordAndCheck` that returns "first time, here is the row id" / "already
// seen, drop it".

import { prisma } from "@/lib/db/queries";
import type { JarvisEvent } from "./eventBus";

const DEFAULT_RETENTION_DAYS = 7;

function retentionExpiry(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + DEFAULT_RETENTION_DAYS);
  return d;
}

/**
 * Atomic dedupe. Returns:
 *   - { fresh: true, logId } on first sight — caller should process.
 *   - { fresh: false }       if seenKey already exists.
 *
 * Also increments today's ComposioUsage counter on a fresh insert so the
 * free-tier cap is observable in the panel.
 */
export async function recordAndCheck(event: JarvisEvent): Promise<
  | { fresh: true; logId: string }
  | { fresh: false }
> {
  const seenKey = `${event.source}:${event.id}`;

  try {
    const row = await prisma.composioEventLog.create({
      data: {
        seenKey,
        source: event.source,
        type: event.type,
        title: event.title,
        body: event.body,
        url: event.url ?? null,
        priority: event.priority,
        rawPayload: event.raw ? JSON.stringify(event.raw) : null,
        retentionUntil: retentionExpiry(),
      },
      select: { id: true },
    });

    // Best-effort daily counter bump. Don't fail delivery if this breaks.
    try {
      const day = new Date().toISOString().slice(0, 10);
      await prisma.composioUsage.upsert({
        where: { day },
        create: { day, count: 1 },
        update: { count: { increment: 1 } },
      });
    } catch {
      // Non-fatal.
    }

    return { fresh: true, logId: row.id };
  } catch (e: unknown) {
    // Prisma P2002 = unique constraint violation. That's our dedupe hit.
    if (
      typeof e === "object" &&
      e !== null &&
      "code" in e &&
      (e as { code?: string }).code === "P2002"
    ) {
      return { fresh: false };
    }
    // Any other error: log and let it through. Better to over-deliver than
    // to silently swallow events because of a DB blip.
    console.error("[composio/dedupe] unexpected error, treating as fresh:", e);
    return { fresh: true, logId: "unknown" };
  }
}

/**
 * Mark the delivery state on a log row. Either bool can be false to mean
 * "this channel failed"; both true is the happy path.
 */
export async function markDelivered(
  logId: string,
  channel: "telegram" | "desktop",
  ok: boolean,
  error?: string
): Promise<void> {
  if (logId === "unknown") return;
  try {
    await prisma.composioEventLog.update({
      where: { id: logId },
      data:
        channel === "telegram"
          ? { telegramSent: ok, error: error ?? null }
          : { desktopPushed: ok, error: error ?? null },
    });
  } catch (e) {
    console.error(`[composio/dedupe] markDelivered(${channel}) failed:`, e);
  }
}
