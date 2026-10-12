// Warm the vision assets into the HTTP cache BEFORE anyone asks for them.
//
// WHY THIS EXISTS
// ---------------
// Measured on this machine, with everything self-hosted on localhost:
//
//   /mediapipe/vision/vision_wasm_internal.wasm (11.7 MB)   17.9s … 53.3s
//   /mediapipe/models/hand_landmarker.task       ( 7.8 MB)    1.3s … 39.0s
//   /mediapipe/models/face_landmarker.task       ( 3.8 MB)   16.5s
//
// Nothing is wrong with the files or the server — a cold fetch from a bare page
// is under a second. Those numbers are the page itself: the landmarks engine
// starts loading an 11.7 MB wasm at the exact moment the app is booting
// (three.js, the reactor, panels, tickers), and the main thread is too busy to
// drain the response. The feature then sits on "loading model…" for half a
// minute, which reads as "never loads".
//
// Pulling the bytes in early — sequentially, so the prefetch never competes
// with itself — means the engines later hit the HTTP cache (the routes already
// send `Cache-Control: public, max-age=31536000, immutable`) and the remaining
// work is just wasm instantiation.

const BIG_FIRST = [
  "/mediapipe/vision/vision_wasm_internal.js",
  "/mediapipe/vision/vision_wasm_internal.wasm",
  "/mediapipe/models/hand_landmarker.task",
  "/mediapipe/models/face_landmarker.task",
];

let started = false;

/** Idempotent: safe to call from every boot path. Best-effort, never throws. */
export function prefetchVisionAssets(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  void (async () => {
    for (const url of BIG_FIRST) {
      try {
        const res = await fetch(url, { cache: "force-cache" });
        // Read the body: a response that is never consumed does not populate
        // the cache, and the whole point here is the cache.
        await res.arrayBuffer();
      } catch {
        // Offline or blocked: the engines will fetch normally and report.
      }
    }
  })();
}
