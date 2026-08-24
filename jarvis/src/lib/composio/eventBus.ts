// Typed pub-sub for jarvis-internal events.
//
// Used by the composio listener to fan events out to:
//   1. The SSE endpoint at /api/events/stream (so the desktop browser can
//      show a system notification via the existing useNotifications hook).
//   2. Any other in-process consumer (debug log, future "events" page, etc).
//
// Singleton pinned to globalThis for the same HMR reason as client.ts:
// Next.js dev re-evaluates route modules on every request, and a per-module
// EventTarget would lose active SSE subscribers on the first hot reload.

export type JarvisEventSource =
  | "gmail"
  | "gcal"
  | "github"
  | "notion"
  | "linear"
  | "jira"
  | "test";

export type JarvisEventPriority = "low" | "normal" | "high";

export interface JarvisEvent {
  /** Unique id for dedupe (composio's trigger instance id, or a synthetic uuid). */
  id: string;
  source: JarvisEventSource;
  /** Source-specific event type, e.g. "new_email", "invite.created". */
  type: string;
  /** ISO timestamp of when the source says it happened. */
  occurredAt: string;
  /** Short title for the desktop notification (≤ 80 chars). */
  title: string;
  /** Markdown body. Hard-capped at 1500 chars before sending. */
  body: string;
  /** Deep link back to the source. Telegram button + desktop click target. */
  url?: string;
  priority: JarvisEventPriority;
  /** Original payload, kept for future "view details" UI. */
  raw?: unknown;
}

const STATE_KEY = Symbol.for("jarvis.composio.eventBus");
type GlobalState = { bus: EventTarget | null };
const g = globalThis as typeof globalThis & { [STATE_KEY]?: GlobalState };
const state: GlobalState = g[STATE_KEY] ?? (g[STATE_KEY] = { bus: null });

function bus(): EventTarget {
  if (state.bus) return state.bus;
  state.bus = new EventTarget();
  return state.bus;
}

export function publishEvent(event: JarvisEvent): void {
  bus().dispatchEvent(new CustomEvent("jarvis:event", { detail: event }));
}

export function subscribeEvents(
  handler: (event: JarvisEvent) => void
): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<JarvisEvent>).detail);
  bus().addEventListener("jarvis:event", listener);
  return () => bus().removeEventListener("jarvis:event", listener);
}
