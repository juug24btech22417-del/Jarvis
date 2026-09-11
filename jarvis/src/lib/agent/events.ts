// Mission event bus — in-memory ring buffer + subscribers per job.
// The SSE route drains this; AgentService emits into it. Bounded so a
// long mission can't leak memory.

export type MissionEventType =
  | "status" // job-level status change
  | "step_started"
  | "step_finished"
  | "log" // free-form progress line (engine details, page counts…)
  | "checkpoint" // awaiting user input
  | "error"
  | "done";

export interface MissionEvent {
  seq: number;
  jobId: string;
  type: MissionEventType;
  /** Short line for the feed. */
  message: string;
  /** Structured payload (stepId, results, options…). */
  data?: Record<string, unknown>;
  at: number;
}

type Listener = (e: MissionEvent) => void;

const RING_SIZE = 300;

// Stash the maps on globalThis: Next dev re-evaluates modules on code
// changes, which would otherwise reset a module-level Map mid-mission and
// silently drop every event (and job state, see AgentService).
const g = globalThis as unknown as {
  __jarvisMissionBuffers?: Map<string, MissionEvent[]>;
  __jarvisMissionListeners?: Map<string, Set<Listener>>;
  __jarvisMissionSeqs?: Map<string, number>;
};
if (!g.__jarvisMissionBuffers) g.__jarvisMissionBuffers = new Map();
if (!g.__jarvisMissionListeners) g.__jarvisMissionListeners = new Map();
if (!g.__jarvisMissionSeqs) g.__jarvisMissionSeqs = new Map();
const buffers = g.__jarvisMissionBuffers;
const listeners = g.__jarvisMissionListeners;
const seqs = g.__jarvisMissionSeqs;

export function emitMissionEvent(
  jobId: string,
  type: MissionEventType,
  message: string,
  data?: Record<string, unknown>
): void {
  const seq = (seqs.get(jobId) ?? 0) + 1;
  seqs.set(jobId, seq);
  const e: MissionEvent = { seq, jobId, type, message, data, at: Date.now() };

  const buf = buffers.get(jobId) ?? [];
  buf.push(e);
  if (buf.length > RING_SIZE) buf.shift();
  buffers.set(jobId, buf);

  for (const l of listeners.get(jobId) ?? []) {
    try {
      l(e);
    } catch {
      // a dead SSE client must never break the mission
    }
  }
}

/** All buffered events (for SSE catch-up on reconnect). */
export function getMissionEvents(jobId: string): MissionEvent[] {
  return buffers.get(jobId) ?? [];
}

export function subscribeMissionEvents(jobId: string, fn: Listener): () => void {
  const set = listeners.get(jobId) ?? new Set();
  set.add(fn);
  listeners.set(jobId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(jobId);
  };
}

/** Called when a job is dropped (cancel / gc) so buffers don't pile up. */
export function clearMissionEvents(jobId: string): void {
  buffers.delete(jobId);
  listeners.delete(jobId);
}
