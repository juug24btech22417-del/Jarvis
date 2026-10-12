// Same-origin request gate — WHY THIS EXISTS
//
// Chrome allows ~6 concurrent connections per host over HTTP/1.1, which is what
// `next dev` speaks. Jarvis runs many independent pollers (telemetry, weather,
// companion, tasks/timers, widgets, security). Whenever one endpoint gets slower
// than a poller's interval, that poller queues another request before the last
// one answered, the queue grows without bound, and all 6 slots stay occupied by
// polls — so every OTHER request on the origin waits in the browser's queue.
// Not slowly. Indefinitely.
//
// That was the "eye control / air-mouse / Gesture DJ say 'loading model…'
// forever" bug. Measured in the running app: 54 → 85 requests in flight and
// still climbing, and a plain `fetch()` of the 12MB MediaPipe wasm from inside
// the page TIMED OUT after 20s while the identical fetch from a bare page
// finished in 0.4s. The trackers were never slow — the wasm and the .task models
// simply never got a socket.
//
// The gate:
//   • ASSET requests (/mediapipe, /_next, fonts, media, images, wasm/task files)
//     bypass it completely, so tracking startup never queues behind telemetry.
//   • Concurrent identical GETs share ONE in-flight request — pollers that want
//     the same thing get the same response for one round trip.
//   • Everything else is capped at MAX_CONCURRENT, which permanently reserves
//     half the connection pool for assets and interactive calls like /api/chat.
//
// It never changes fetch's contract: the returned promise resolves/rejects
// exactly like the native call, and bodies are cloned per caller so each one
// gets its own readable stream.

const ASSET_PATH_RE = /^\/(mediapipe|_next)\//;
const ASSET_EXT_RE = /\.(wasm|task|js|mjs|css|map|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|wav|ogg)$/i;

/** API requests allowed to hold a connection at once (pool is ~6). */
const MAX_CONCURRENT = 3;

let installed = false;
let active = 0;
const waiters: Array<() => void> = [];
const inflightGets = new Map<string, Promise<Response>>();

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiters.push(() => {
      active++;
      resolve();
    });
  });
}

function isAssetUrl(url: URL): boolean {
  return ASSET_PATH_RE.test(url.pathname) || ASSET_EXT_RE.test(url.pathname);
}

/** Decisions are computed before any promise is created so that a rejection
 * from the real fetch can never be mistaken for a gate error. */
type Decision =
  | { kind: "passthrough" }
  | { kind: "dedupe"; key: string }
  | { kind: "limited" };

function decide(input: RequestInfo | URL, init: RequestInit | undefined): Decision {
  try {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = (
      init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
    ).toUpperCase();
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin || isAssetUrl(url)) return { kind: "passthrough" };
    if (method === "GET" || method === "HEAD") return { kind: "dedupe", key: `${method} ${url.href}` };
    return { kind: "limited" };
  } catch {
    // Unparseable input → let the native fetch produce its own error.
    return { kind: "passthrough" };
  }
}

export function installFetchGate(): void {
  if (installed || typeof window === "undefined" || typeof window.fetch !== "function") return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  const gatedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const decision = decide(input, init);

    if (decision.kind === "passthrough") return nativeFetch(input, init);

    if (decision.kind === "dedupe") {
      const existing = inflightGets.get(decision.key);
      if (existing) return existing.then((r) => r.clone());

      const pending = (async () => {
        await acquire();
        try {
          return await nativeFetch(input, init);
        } finally {
          release();
          inflightGets.delete(decision.key);
        }
      })();
      inflightGets.set(decision.key, pending);
      return pending.then((r) => r.clone());
    }

    return (async () => {
      await acquire();
      try {
        return await nativeFetch(input, init);
      } finally {
        release();
      }
    })();
  };

  window.fetch = gatedFetch as typeof window.fetch;
}
