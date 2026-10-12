// A tiny bounded-concurrency queue.
//
// WHY THIS IS NOT JUST `void fetch(...)`
// -------------------------------------
// Transcription uploads take 0.5s when the network is good and 20s when it is
// not. Free-firing one upload per audio round means a slow minute queues
// minutes of audio, memory grows, and the overlay keeps transcribing a
// conversation that ended — the exact "slow response freezes/derails the HUD"
// failure. This queue:
//
//   • runs at most `concurrency` uploads at once (2: one per audio source),
//   • keeps at most `maxPending` waiting, dropping the OLDEST when it is full
//     (fresh speech matters, stale speech does not),
//   • reports drops so the UI can say "behind — dropped 3 stale chunks" instead
//     of pretending everything was heard.

export interface BoundedQueueOptions {
  concurrency?: number;
  maxPending?: number;
  onDrop?: (item: unknown, reason: "overflow" | "cleared") => void;
}

export interface BoundedQueue<T> {
  push(item: T): void;
  /** Resolves when nothing is queued or running (used by tests + shutdown). */
  drain(): Promise<void>;
  /** Drop everything waiting; running tasks are left to finish. */
  clear(): void;
  readonly inflight: number;
  readonly pending: number;
  readonly drops: number;
}

export function createBoundedQueue<T>(
  task: (item: T) => Promise<unknown>,
  opts: BoundedQueueOptions = {}
): BoundedQueue<T> {
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const maxPending = Math.max(1, opts.maxPending ?? 3);
  const waiting: T[] = [];
  let inflight = 0;
  let drops = 0;
  let idleResolvers: Array<() => void> = [];

  const settle = () => {
    if (inflight === 0 && waiting.length === 0) {
      const rs = idleResolvers;
      idleResolvers = [];
      rs.forEach((r) => r());
    }
  };

  const pump = () => {
    while (inflight < concurrency && waiting.length) {
      const item = waiting.shift() as T;
      inflight++;
      Promise.resolve()
        .then(() => task(item))
        .catch(() => {
          /* a dropped chunk must never kill the session */
        })
        .finally(() => {
          inflight--;
          pump();
          settle();
        });
    }
    settle();
  };

  return {
    push(item: T) {
      if (inflight >= concurrency && waiting.length >= maxPending) {
        const dropped = waiting.shift();
        drops++;
        opts.onDrop?.(dropped, "overflow");
      }
      waiting.push(item);
      pump();
    },
    drain() {
      if (inflight === 0 && waiting.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleResolvers.push(resolve));
    },
    clear() {
      while (waiting.length) {
        const dropped = waiting.shift();
        drops++;
        opts.onDrop?.(dropped, "cleared");
      }
      settle();
    },
    get inflight() {
      return inflight;
    },
    get pending() {
      return waiting.length;
    },
    get drops() {
      return drops;
    },
  };
}
