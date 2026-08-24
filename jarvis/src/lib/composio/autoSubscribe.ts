// Auto-subscribe to phase-1 triggers after a successful OAuth connect.
//
// Called by the callback route after a connection is persisted. For each
// known phase-1 trigger slug of the toolkit, calls
// `composio.triggers.create(userId, slug)` which upserts a trigger
// instance — composio will then start emitting events to our Pusher
// listener.
//
// Trigger slugs here MUST match what `normalize.ts` switches on. We
// validate by trying `composio.triggers.getType(slug)` first and skipping
// any slugs that don't exist for this toolkit version (composio adds/
// renames triggers over time and we don't want to crash the callback).

import { getComposio } from "./client";

// Slugs verified against composio's actual listTypes output on 2026-08-25.
// Composio uses GOOGLECALENDAR_* (no underscore) for calendar triggers.
//
// GitHub intentionally omitted: composio's github triggers require per-repo
// config (owner + repo) at subscribe time, not just at user level. Adding
// github needs a UX step where the user picks repos. We'll add it in phase 2.
const PHASE1_TRIGGERS_BY_TOOLKIT: Record<string, string[]> = {
  gmail: ["GMAIL_NEW_GMAIL_MESSAGE"],
  googlecalendar: [
    "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER",
    "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_UPDATED_TRIGGER",
    "GOOGLECALENDAR_EVENT_STARTING_SOON_TRIGGER",
  ],
  // github: phase 2 — see comment above
};

export async function autoSubscribeTriggers(
  toolkit: string,
  userId: string
): Promise<{ subscribed: string[]; skipped: string[]; errors: string[] }> {
  const composio = getComposio();
  const slugs = PHASE1_TRIGGERS_BY_TOOLKIT[toolkit.toLowerCase()] ?? [];

  const result = { subscribed: [] as string[], skipped: [] as string[], errors: [] as string[] };

  for (const slug of slugs) {
    try {
      // Validate the slug exists for this toolkit before subscribing.
      // Composio throws ComposioTriggerTypeNotFoundError on unknown slugs.
      await composio.triggers.getType(slug);
      const created = await composio.triggers.create(userId, slug);
      result.subscribed.push(slug);
      console.log(
        `[composio/autoSubscribe] subscribed ${slug} for user=${userId} (triggerId=${created.triggerId})`
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Treat "not found" as a soft skip — the slug simply isn't
      // available for this toolkit version. Any other error is a real
      // problem and we record it.
      if (/not found|ComposioTriggerTypeNotFound|400|404/i.test(msg)) {
        result.skipped.push(slug);
        console.log(`[composio/autoSubscribe] skipped ${slug} (not found)`);
      } else {
        result.errors.push(`${slug}: ${msg}`);
        console.error(
          `[composio/autoSubscribe] failed ${slug}: ${msg}`
        );
      }
    }
  }

  return result;
}
