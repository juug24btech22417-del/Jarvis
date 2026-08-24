// The composio trigger listener.
//
// One long-lived loop per process. On boot:
//   1. Read COMPOSIO_USER_ID + COMPOSIO_APPS (csv of toolkit slugs).
//   2. Open a Pusher-backed WebSocket via composio.triggers.subscribe(),
//      filtered to those toolkits.
//   3. For every IncomingTriggerPayload:
//      - normalize → JarvisEvent
//      - dedupe via sqlite
//      - summarize via existing LLM chain (gmail/notion only)
//      - deliver to telegram + desktop in parallel
//   4. Reconnect with backoff on any error. Log every connection event
//      to stdout so the user can see in the launcher window what's
//      happening.
//
// IMPORTANT: this is a singleton per Node process. Don't import it from
// a Next.js route — that would open multiple Pusher connections per HMR
// recompile. Run it from scripts/composio-listener.ts only.

import { readComposioEnv, getComposio, isComposioConfigured } from "./client";
import { normalize } from "./normalize";
import { recordAndCheck } from "./dedupe";
import { maybeSummarize } from "./summarize";
import { deliver } from "./deliver";
import type { JarvisEvent } from "./eventBus";

const PHASE1_TOOLKITS = ["gmail", "googlecalendar", "github"] as const;

function configuredToolkits(): string[] {
  const csv = process.env.COMPOSIO_APPS?.trim();
  if (!csv) return [...PHASE1_TOOLKITS];
  return csv
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const RECONNECT_INITIAL_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

let stopRequested = false;
let attempt = 0;

export async function runListener(): Promise<void> {
  if (!isComposioConfigured()) {
    console.error(
      "[composio/listener] COMPOSIO_API_KEY not set. Set it in jarvis/.env.local and restart this process."
    );
    return;
  }

  const { userId } = readComposioEnv();
  const toolkits = configuredToolkits();
  console.log(
    `[composio/listener] starting — user=${userId}, toolkits=${toolkits.join(",")}`
  );

  while (!stopRequested) {
    try {
      const composio = getComposio();
      attempt = 0;

      // The subscribe callback runs for every event the project receives.
      // We filter by toolkit here. We also filter by connected-account
      // userId when metadata provides it.
      await composio.triggers.subscribe((raw) => {
        const toolkit = (raw.toolkitSlug || "").toLowerCase();
        if (!toolkits.includes(toolkit)) return;

        // Pusher gives us a callback; we never throw out of it. Errors
        // are caught per-event and logged.
        handleEvent(raw, userId).catch((e) => {
          console.error(
            `[composio/listener] event handler failed (${raw.triggerSlug}):`,
            e instanceof Error ? e.message : e
          );
        });
      });

      // subscribe() resolves once the Pusher connection is established.
      // If it returns without throwing, we wait until the process exits
      // or until we receive a signal to reconnect.
      console.log("[composio/listener] subscribed — waiting for events");
      await waitForStop();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      attempt += 1;
      const backoff = Math.min(RECONNECT_INITIAL_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
      console.error(
        `[composio/listener] connection error: ${msg}. Reconnecting in ${backoff}ms (attempt ${attempt})`
      );
      await sleep(backoff);
    }
  }
  console.log("[composio/listener] stopped");
}

export function requestStop(): void {
  stopRequested = true;
}

async function handleEvent(
  raw: import("@composio/core").IncomingTriggerPayload,
  expectedUserId: string
): Promise<void> {
  const receivedAt = Date.now();
  // If the event has a connected-account userId and it doesn't match ours,
  // skip. (Multiple users in one composio project would otherwise
  // interleave; we are single-user.)
  const eventUserId =
    raw.metadata?.connectedAccount?.userId || raw.userId || "";
  if (eventUserId && expectedUserId && eventUserId !== expectedUserId) {
    console.log(
      `[composio/listener] skipping event for user=${eventUserId} (want ${expectedUserId})`
    );
    return;
  }

  const normalized: JarvisEvent = normalize({
    triggerSlug: raw.triggerSlug,
    toolkitSlug: raw.toolkitSlug,
    payload: raw.payload,
    id: raw.id,
    occurredAt: new Date().toISOString(),
  });

  const dedupe = await recordAndCheck(normalized);
  if (!dedupe.fresh) {
    console.log(`[composio/listener] duplicate ${normalized.source}:${normalized.id} — dropping`);
    return;
  }

  // Fire-and-forget: deliver immediately, summarize in parallel. The first
  // telegram message to land should not wait for the (optional) LLM
  // summary. If a summary arrives in time we still send it as a follow-up
  // message on the same channel so the user sees the body + the summary.
  deliver(normalized, dedupe.logId).catch((e) =>
    console.error(`[composio/listener] deliver failed (${normalized.source}):`, e)
  );

  maybeSummarize(normalized).then((enriched) => {
    if (enriched === normalized) return; // summarizer skipped
    const bodyGrew = enriched.body.length > normalized.body.length;
    if (bodyGrew) {
      console.log(
        `[composio/listener] summary arrived ${Date.now() - receivedAt}ms after delivery — sending follow-up`
      );
      deliver(enriched, dedupe.logId, { followUp: true }).catch(() => {});
    }
  });

  console.log(
    `[composio/listener] delivered ${normalized.source}:${normalized.id} (${normalized.type}) in ${Date.now() - receivedAt}ms`
  );
}

function waitForStop(): Promise<void> {
  return new Promise((resolve) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve();
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
