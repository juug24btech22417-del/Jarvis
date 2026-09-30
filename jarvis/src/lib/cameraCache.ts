// Shared webcam keep-alive — WHY THIS EXISTS
//
// Every time eye-control or air-mouse was toggled on, the hook ran a fresh
// getUserMedia: camera renegotiation on Windows is slow (1–4s), and doing it
// repeatedly is exactly why features took "hell of time to load". The camera
// itself is a hardware device — keeping ONE warm stream and handing it to
// every consumer makes re-enable ~instant. Model runtimes are cached in the
// hooks (singleton landmarker / Hands); the last slow piece was this.
//
// Rules:
//  • The last consumer's release starts a short GRACE timer (5s) — toggling
//    a feature off/on or handing the camera between features stays instant —
//    after which the tracks STOP. The camera light must go off when every
//    panel is closed; the old never-stop policy left it burning forever.
//  • releaseSharedCameraFull() stops tracks immediately (hard teardown).
//  • If the OS/browser kills the tracks (device unplug, kill switch), the
//    next request transparently re-acquires a fresh stream.

type SharedStream = {
  stream: MediaStream;
  refCount: number;
};

let cached: SharedStream | null = null;
let pending: Promise<MediaStream> | null = null;
let idleStopTimer: ReturnType<typeof setTimeout> | 0 = 0;
const IDLE_STOP_MS = 5000; // grace window: instant re-enable, then light off

function stopCachedTracks() {
  cached?.stream.getTracks().forEach((t) => t.stop());
  cached = null;
}

/** Permanent failures — retrying cannot help, surface guidance immediately.
 * (Permission denied and no-device must not burn 5s of retries.) */
function isPermanentCamError(e: unknown): boolean {
  const name = (e as Error)?.name ?? "";
  return name === "NotAllowedError" || name === "NotFoundError" || name === "SecurityError";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function acquireOnce(deviceId?: string, loose = false): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "InsecureContext: camera API unavailable — open the app via http://localhost:3000"
    );
  }
  // Loose mode → bare `true` (browser picks anything); otherwise ideal size
  // plus an explicit device when falling back across cameras.
  const video: MediaTrackConstraints = loose
    ? {}
    : { width: 640, height: 480 };
  if (deviceId) video.deviceId = { exact: deviceId };
  return navigator.mediaDevices.getUserMedia({
    video: loose && !deviceId ? true : video,
    audio: false,
  });
}

/** NOT_READABLE with the camera light OFF and no other app open is almost
 * never "Zoom is holding it". The real causes: a Windows-Hello IR default,
 * a wedged driver, or — since the grace-window release — a device that was
 * JUST stopped: Windows needs 1–3s after track.stop() before it reopens.
 *
 * So the acquire is an ESCALATION LADDER: several rounds, each trying the
 * default device → every explicit device (bypasses a wedged/IR default) →
 * fully-loose constraints, with growing backoff between rounds (a camera
 * that refuses at 0ms usually opens at 1.5–3s). Only then do we surface an
 * error — with honest guidance. */
async function acquireWithRetry(): Promise<MediaStream> {
  let lastErr: unknown;
  const tryOnce = async (fn: () => Promise<MediaStream>): Promise<MediaStream | null> => {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      return null;
    }
  };

  for (const waitMs of [0, 500, 1500, 3000]) {
    if (waitMs) await sleep(waitMs);

    // 1) Default device, ideal constraints.
    const direct = await tryOnce(() => acquireOnce());
    if (direct) return direct;

    // Permanent failures never improve — bail to guidance immediately.
    if (lastErr && isPermanentCamError(lastErr)) break;

    // 2) Explicit per-device fallback — bypasses the selector that keeps
    // choosing a wedged/IR default. IR sensors are deprioritized when
    // labels are visible (they only start during Hello enrollment).
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === "videoinput");
      const irish = (l: string) => /\bir\b|infrared|hello/i.test(l);
      cams.sort((a, b) => Number(irish(a.label)) - Number(irish(b.label)));
      for (const cam of cams) {
        const r = await tryOnce(() => acquireOnce(cam.deviceId));
        if (r) return r;
      }
    } catch {
      /* enumerateDevices can throw before permission; pass 3 still runs */
    }

    // 3) Maximum looseness — picky wedged drivers reject ideal sizes.
    const loose = await tryOnce(() => acquireOnce(undefined, true));
    if (loose) return loose;
  }

  const cause = lastErr instanceof Error ? `${lastErr.name}: ${lastErr.message}` : String(lastErr);
  const err = new Error(
    `NotReadableError: camera won't restart (${cause}) — check the shutter / F-key camera toggle, close camera apps, or wait 5s and toggle again.`
  );
  err.name = "NotReadableError";
  try {
    (err as Error & { cause?: unknown }).cause = lastErr;
  } catch {
    /* older targets */
  }
  throw err;
}

/** Get the shared camera stream. Concurrent callers share one negotiation. */
export function getSharedCamera(): Promise<MediaStream> {
  // An acquire inside the grace window cancels the scheduled stop.
  if (idleStopTimer) {
    clearTimeout(idleStopTimer);
    idleStopTimer = 0;
  }
  // Cached stream — but only while its video tracks are actually LIVE. A
  // stream whose tracks went "ended" (device reset, OS camera kill) used to
  // be handed out forever: every consumer attached to a dead source and the
  // tracker sat on "loading" / fired NotReadable on first use.
  if (cached && cached.stream.getVideoTracks().some((t) => t.readyState === "live")) {
    cached.refCount++;
    return Promise.resolve(cached.stream);
  }
  // Dead cache (tracks ended) — drop and re-acquire.
  cached = null;
  if (!pending) {
    pending = acquireWithRetry().finally(() => {
      pending = null;
    });
  }
  return pending.then((s) => {
    // Whichever pass succeeded, register the stream in the cache here.
    if (!cached) cached = { stream: s, refCount: 0 };
    cached.refCount++;
    return s;
  });
}

/** Drop a reference. The stream stays warm through a short grace window
 * (instant re-enable / feature handover); when it expires with no consumer,
 * the tracks STOP — the camera light goes off once every panel is closed. */
export function releaseSharedCamera() {
  if (!cached) return;
  if (cached.refCount > 0) cached.refCount--;
  if (cached.refCount <= 0 && !idleStopTimer) {
    idleStopTimer = setTimeout(() => {
      idleStopTimer = 0;
      if (cached && cached.refCount <= 0) stopCachedTracks();
    }, IDLE_STOP_MS);
  }
}

/** Hard teardown — stop the tracks NOW (pagehide; explicit full release). */
export function releaseSharedCameraFull() {
  if (idleStopTimer) {
    clearTimeout(idleStopTimer);
    idleStopTimer = 0;
  }
  stopCachedTracks();
  pending = null;
}

/** Page teardown is the only place the camera is actually released. */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    releaseSharedCameraFull();
  });
}
