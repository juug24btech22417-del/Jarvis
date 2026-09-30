"use client";

// Shared hand-tracking engine — MediaPipe HandLandmarker on the tasks-vision
// runtime, i.e. the SAME wasm the face/eye engine already uses.
//
// ─── Why this replaced the legacy @mediapipe/hands solution ──────────────
// The legacy solution runtime produced an endless tail of failures, and most
// recently a hard crash that surfaced as:
//
//   RuntimeError: Aborted(Module.noExitRuntime has been replaced with plain
//   noExitRuntime ...)
//
// That string is emscripten's guard against an embedder touching `Module`
// AFTER startup, and it only exists in hands_solution_*_wasm_bin.js. The
// legacy package wires its runtime through a GLOBAL Module object, so any
// second MediaPipe solution on the page — GestureDetector used to build its
// own Hands instance — or a re-init after a wedge manipulates that same
// global and trips the guard. Aborting a wasm runtime kills the whole
// feature and, because the throw happens inside the runtime, it looked like
// it came from whichever panel was on screen.
//
// tasks-vision has no such global. Each task gets its own module instance,
// the runtime is already self-hosted for the face engine (so both features
// now share ONE wasm download instead of two runtimes fighting for CPU),
// and — the big one — inference is SYNCHRONOUS. There is no send() promise,
// so there is no queue of stale frames, no 5s watchdog and no dead-air timer
// to babysit: the loop calls detectForVideo and gets landmarks back.
//
// ─── One engine, many consumers ──────────────────────────────────────────
// Refcounted, exactly like the eye engine. The first consumer starts ONE
// inference loop; everyone else attaches as a listener. Each consumer makes
// its own <video> off the shared stream for its own preview, so unmounting
// one panel can never pull the decode source out from under another.

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { getSharedCamera, releaseSharedCamera } from "@/lib/cameraCache";
import { pipActive } from "@/lib/documentPiP";
import { backgroundTicker } from "@/lib/backgroundTicker";

export type HandLandmark = NormalizedLandmark;

// ─── Module-level singleton ───────────────────────────────────────────────
// Created at most once, never closed until page unload — closing a
// tasks-vision task while other tasks share the wasm runtime is a known way
// to tear state out from under them (the same rule the eye engine follows).
let landmarkerSingleton: HandLandmarker | null = null;
let landmarkerInitPromise: Promise<HandLandmarker> | null = null;

async function getLandmarker(): Promise<HandLandmarker> {
  if (landmarkerSingleton) return landmarkerSingleton;
  if (landmarkerInitPromise) return landmarkerInitPromise;

  landmarkerInitPromise = (async () => {
    // Same self-hosted fileset as the face engine — one wasm, two models.
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/vision");
    const make = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "/mediapipe/models/hand_landmarker.task",
          delegate,
        },
        runningMode: "VIDEO",
        numHands: 1,
        // Relaxed twice over: strict values drop the hand mid-gesture, and
        // DURING A PINCH the hand presents edge-on — a dropped hand resets
        // every gate and reads as "gesture not detected". These keep the
        // hand locked through the whole pinch motion.
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      });

    // CPU-first, for the same reason as the face engine: GPU inference
    // stalls whenever the page's compositor is busy (streaming chat,
    // animations, video), so the tracker freezes EXACTLY while the app is
    // under load. CPU is a steady ~25-40ms and immune to that. GPU is the
    // fallback if CPU init fails, and the crash self-heal below alternates
    // delegates — so if CPU ever proves too slow on this machine, flipping
    // the order here is a one-line change.
    let lm: HandLandmarker;
    try {
      lm = await make("CPU");
    } catch (cpuErr) {
      console.warn("[HandControl] CPU delegate failed, falling back to GPU:", cpuErr);
      lm = await make("GPU");
    }
    landmarkerSingleton = lm;
    return lm;
  })();

  try {
    return await landmarkerInitPromise;
  } catch (e) {
    landmarkerInitPromise = null; // allow a later retry
    throw e;
  }
}

/** Kill the landmarker so the next getLandmarker() builds a fresh runtime. */
function killLandmarker(): void {
  try {
    landmarkerSingleton?.close();
  } catch {
    /* already dead */
  }
  landmarkerSingleton = null;
  landmarkerInitPromise = null;
}

/** Boot the wasm + hand model in the background (no camera). Call once
 * during app boot so the first air-mouse/DJ enable attaches to a hot
 * engine instead of freezing mid-bootload. */
export function warmHandEngine(): void {
  if (typeof window === "undefined") return;
  void getLandmarker().catch(() => {
    /* warmup is best-effort; a real enable will surface errors */
  });
}

export interface HandFrame {
  /** Index fingertip, normalized 0..1 (mirrored horizontally for natural control). */
  x: number;
  y: number;
  /** Pinch strength 0..1 (1 = thumb+index touching). */
  pinch: number;
  /** Fist strength 0..1 (1 = all fingertips curled into the palm). */
  fist: number;
  /** Per-finger extension (true = finger straight/open). Hysteresis-stabilized. */
  fingers: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
  /** Thumb tip raised above the index knuckle (thumb-up geometry). Splits a
   * fully-curled THUMB-UP from a same-strength FIST with the thumb alongside. */
  thumbUp: boolean;
  /** Per-finger curl score 0..1 (1 = fully folded). Scale-invariant — this is
   * what tolerant pose classification reads; booleans above are the strict view. */
  curl: { index: number; middle: number; ring: number; pinky: number };
  /**
   * Per-finger tip→PIP extension RATIO: distance(tip, wrist) ÷
   * distance(pip, wrist). ~1.2+ = straight, ~0.75 = folded, ~1.0 = level.
   *
   * This is the raw measurement the hysteresis booleans threshold, exposed
   * because pose classification needs a value that is not already collapsed
   * into a boolean: "is the middle finger extended" is what separates an open
   * palm from a pointing hand, and a threshold ON the ratio can guarantee the
   * two poses can never overlap, which thresholds on derived scores cannot.
   */
  ext: { index: number; middle: number; ring: number; pinky: number };
  handFound: boolean;
  /** Rolling estimate of processed frames per second (for HUDs). */
  fps: number;
}

// Module-level telemetry shared by every hook instance — the current frame,
// the live 21-point skeleton, the fps and the engine's own video element.
// Read-only consumers (the gesture-practice monitor) display the live stream
// from here without claiming the camera themselves.
export const handTelemetry: {
  videoEl: HTMLVideoElement | null;
  landmarks: HandLandmark[] | null;
  fps: number;
  frame: HandFrame | null;
  /** Engine status — shared, since there is one engine for the whole app. */
  ready: boolean;
  error: string | null;
} = { videoEl: null, landmarks: null, fps: 0, frame: null, ready: false, error: null };

// ─── Shared engine plumbing ───────────────────────────────────────────────
type FrameListener = (f: HandFrame) => void;
const frameListeners = new Set<FrameListener>();
const stateListeners = new Set<() => void>();

function publishFrame(f: HandFrame): void {
  handTelemetry.frame = f;
  handTelemetry.fps = f.fps;
  for (const l of frameListeners) {
    try {
      l(f);
    } catch {
      /* one bad listener must never break the loop */
    }
  }
}

function publishState(): void {
  for (const l of stateListeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

let engineConsumers = 0;
let engineDispose: (() => void) | null = null;

function acquireEngine(): void {
  engineConsumers++;
  if (!engineDispose) engineDispose = startHandEngine();
}

function releaseEngine(): void {
  engineConsumers = Math.max(0, engineConsumers - 1);
  if (engineConsumers === 0 && engineDispose) {
    const d = engineDispose;
    engineDispose = null;
    d();
  }
}

/** Start the one and only detection loop. Returns a disposer. */
function startHandEngine(): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let video: HTMLVideoElement | null = null;
  let lastVideoTs = -1;
  let crashed = false;
  let consecutiveErrors = 0;
  let useDelegate: "GPU" | "CPU" = "GPU";
  let smoothFps = 0;
  let lastStamp = performance.now();

  const setError = (msg: string | null) => {
    if (handTelemetry.error === msg) return;
    handTelemetry.error = msg;
    publishState();
  };

  const releaseKeepAlive = backgroundTicker.acquire("hand-engine");
  let unsubTicker: (() => void) | null = null;

  const teardown = () => {
    clearTimeout(timer);
    timer = 0;
    unsubTicker?.();
    unsubTicker = null;
    releaseKeepAlive();
    if (video) {
      try {
        video.remove();
      } catch {
        /* already detached */
      }
    }
    video = null;
    handTelemetry.videoEl = null;
    handTelemetry.landmarks = null;
    handTelemetry.frame = null;
    handTelemetry.fps = 0;
    releaseSharedCamera();
  };

  const start = async () => {
    try {
      // getUserMedia only exists in secure contexts. Opening the app over a
      // LAN IP (http://172.x.x.x:3000) silently hides the camera API.
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "InsecureContext: camera API unavailable — open the app via http://localhost:3000"
        );
      }
      const stream = await getSharedCamera();
      if (cancelled) {
        releaseSharedCamera();
        return;
      }
      const v = document.createElement("video");
      v.srcObject = stream;
      v.muted = true;
      v.playsInline = true;
      // Hidden, but on-screen and technically visible — Chrome keeps
      // decoding a tiny element like this, while a fully offscreen one can
      // be throttled to zero frames and silently starve detectForVideo.
      v.style.cssText =
        "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;";
      document.body.appendChild(v);
      // Assigned before the first await so a disposer running mid-init can
      // always find and remove the element (and release the stream).
      video = v;
      await v.play();
      if (cancelled) return;

      await getLandmarker();
      if (cancelled) return;
      handTelemetry.videoEl = v;
      handTelemetry.ready = true;
      setError(null);
      publishState();

      // Per-finger hysteresis state lives in the ENGINE now (one landmark
      // stream, one pose state) instead of per hook instance — two panels
      // used to overwrite each other's finger states.
      const prevFingers = { thumb: false, index: false, middle: false, ring: false, pinky: false };

      const loop = () => {
        if (cancelled) return;
        // Engine rebuilding after a wasm crash — keep polling until it's
        // back instead of giving up and freezing the feature.
        if (!video || !landmarkerSingleton) {
          timer = setTimeout(loop, 120);
          return;
        }
        // Continuous background tracking: do NOT pause on document.hidden so
        // air-mouse works seamlessly across all Windows applications.
        const v = video;
        if (v.readyState >= 2) {
          try {
            // Strictly-increasing timestamps: detectForVideo THROWS on a
            // duplicate/retreating stamp, and setTimeout(0) can coalesce two
            // ticks into the same millisecond on a fast machine.
            const ts = Math.max(lastVideoTs + 1, performance.now());
            lastVideoTs = ts;
            const res = landmarkerSingleton.detectForVideo(v, ts);
            const lm = res.landmarks?.[0] ?? null;
            handTelemetry.landmarks = lm;

            if (lm) {
              // Index tip 8, thumb tip 4.
              const palmX = (lm[0].x + lm[5].x + lm[17].x) / 3;
              const palmY = (lm[0].y + lm[5].y + lm[17].y) / 3;
              // Hand scale — middle-MCP → wrist. ALL distance metrics below
              // normalize by this, so detection is identical near or far.
              const scale = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 1e-6;

              // ROTATION-ROBUST pinch — 3D geometry with DAMPED depth. The
              // lite model's per-landmark z carries ~±0.02 noise and hypot()
              // adds that into EVERY reading, so the metric wobbled around
              // the threshold instead of decisively crossing it. Damped
              // euclidean (z scaled 0.2) keeps rotation invariance but cuts
              // the noise floor ~5×.
              const dx42 = lm[8].x - lm[4].x;
              const dy42 = lm[8].y - lm[4].y;
              const dz42 = lm[8].z - lm[4].z;
              const pinchDist = Math.sqrt(dx42 * dx42 + dy42 * dy42 + 0.04 * dz42 * dz42);
              const palmDx = lm[9].x - lm[0].x;
              const palmDy = lm[9].y - lm[0].y;
              const palmDz = lm[9].z - lm[0].z;
              const palmDepth =
                Math.sqrt(palmDx * palmDx + palmDy * palmDy + 0.04 * palmDz * palmDz) || 1e-6;
              const pinchNorm = pinchDist / palmDepth;
              const lin = (0.55 - pinchNorm) / 0.27;
              const pinch = lin <= 0 ? 0 : Math.min(1, Math.pow(Math.min(1, lin), 0.7));

              // Per-finger curl scores 0..1 (1 = fully folded), scale-invariant
              // via palm-relative distances.
              const curlOf = (tipIdx: number, pipIdx: number) => {
                const tipToPalm = Math.hypot(lm[tipIdx].x - palmX, lm[tipIdx].y - palmY);
                const knuckleToPalm =
                  Math.hypot(lm[pipIdx].x - palmX, lm[pipIdx].y - palmY) || 1e-6;
                return Math.max(0, Math.min(1, (1.15 - tipToPalm / knuckleToPalm) / 0.7));
              };
              const curl = {
                index: curlOf(8, 6),
                middle: curlOf(12, 10),
                ring: curlOf(16, 14),
                pinky: curlOf(20, 18),
              };
              // Fist strength — MIN-based: the index MUST be folded and the
              // other three on average. A mean over all four reads a pointing
              // hand (3 fingers curled) as a fist!
              const fistRaw = Math.min(curl.index, (curl.middle + curl.ring + curl.pinky) / 3);
              const fist = Math.max(0, Math.min(1, (fistRaw - 0.55) / 0.35));

              const wrist = lm[0];
              const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
                Math.hypot(a.x - b.x, a.y - b.y);
              // Raw tip→PIP extension ratios (see HandFrame.ext). Computed
              // once here and reused for both the booleans and classification.
              const ext = {
                index: d(lm[8], wrist) / (d(lm[6], wrist) || 1e-6),
                middle: d(lm[12], wrist) / (d(lm[10], wrist) || 1e-6),
                ring: d(lm[16], wrist) / (d(lm[14], wrist) || 1e-6),
                pinky: d(lm[20], wrist) / (d(lm[18], wrist) || 1e-6),
              };
              const thumbUp = lm[4].y < lm[5].y - 0.18 * scale;

              // Hysteresis (separate enter/exit thresholds): a fingertip
              // hovering at the detection boundary must not flicker the pose
              // classifier, which previously forced consumer debounces to
              // restart over and over → gestures "never detected".
              const hysteresis = (r: number, was: boolean) => (was ? r > 0.95 : r > 1.08);
              const fingers = {
                thumb: prevFingers.thumb
                  ? d(lm[4], lm[9]) / scale > 0.85
                  : d(lm[4], lm[9]) / scale > 1.0,
                index: hysteresis(ext.index, prevFingers.index),
                middle: hysteresis(ext.middle, prevFingers.middle),
                ring: hysteresis(ext.ring, prevFingers.ring),
                pinky: hysteresis(ext.pinky, prevFingers.pinky),
              };
              prevFingers.index = fingers.index;
              prevFingers.middle = fingers.middle;
              prevFingers.ring = fingers.ring;
              prevFingers.pinky = fingers.pinky;
              prevFingers.thumb = fingers.thumb;

              // Hands model is unmirrored; mirror x so moving hand right
              // moves cursor right.
              publishFrame({
                x: 1 - lm[8].x,
                y: lm[8].y,
                pinch,
                fist,
                fingers,
                thumbUp,
                curl,
                ext,
                handFound: true,
                fps: smoothFps,
              });
            } else {
              publishFrame({
                x: 0.5,
                y: 0.5,
                pinch: 0,
                fist: 0,
                fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
                thumbUp: false,
                curl: { index: 0, middle: 0, ring: 0, pinky: 0 },
                ext: { index: 0, middle: 0, ring: 0, pinky: 0 },
                handFound: false,
                fps: smoothFps,
              });
            }
            crashed = false;
            consecutiveErrors = 0;
          } catch (e) {
            const msg = String((e as Error)?.message ?? e);
            consecutiveErrors++;
            if (/abort|runtime|wasm|memory/i.test(msg) && !crashed) {
              crashed = true;
              killLandmarker();
              const next = useDelegate === "GPU" ? "CPU" : "GPU";
              useDelegate = next;
              getLandmarker()
                .then(() => {
                  crashed = false;
                })
                .catch(() => {
                  if (!cancelled) setError("hand tracker crashed and could not restart");
                });
            } else if (consecutiveErrors > 30 && !cancelled) {
              // Persistent failure (stalled video after device reset, broken
              // stream) → full self-heal: re-acquire camera + engine.
              consecutiveErrors = 0;
              teardown();
              void start();
              return;
            }
          }
        }
        // FPS: measured between loop ticks, so it reflects the real end-to-end
        // cadence (inference + video decode), which is what a HUD should show.
        const now = performance.now();
        const dt = now - lastStamp;
        lastStamp = now;
        if (dt > 0) smoothFps = smoothFps ? smoothFps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
        timer = setTimeout(loop, 0);
      };
      unsubTicker = backgroundTicker.subscribe(() => {
        if (!cancelled && video && landmarkerSingleton) loop();
      });
      timer = setTimeout(loop, 0);
    } catch (err) {
      console.error("[HandControl] init failed:", err);
      teardown();
      // Surface the DOMException name — NotFoundError (no/hidden camera),
      // NotAllowedError (permission denied), NotReadableError (held by
      // another app) each need a different fix.
      const e = err as Error & { name?: string };
      if (!cancelled) setError(e.name ? `${e.name}: ${e.message}` : String(err));
    }
  };

  void start();

  return () => {
    cancelled = true;
    teardown();
    handTelemetry.ready = false;
    publishState();
    // The engine singleton intentionally stays warm — see the header.
  };
}

// Page teardown — the only place the singleton is ever closed.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    engineDispose?.();
    engineDispose = null;
    engineConsumers = 0;
    killLandmarker();
  });
}

interface Options {
  enabled: boolean;
  onFrame?: (f: HandFrame) => void;
}

export function useHandControl({ enabled, onFrame }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const landmarksRef = useRef<HandLandmark[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let preview: HTMLVideoElement | null = null;

    const listener: FrameListener = (f) => {
      landmarksRef.current = handTelemetry.landmarks;
      onFrameRef.current?.(f);
    };
    const syncState = () => {
      if (cancelled) return;
      videoRef.current = preview;
      videoElRef.current = preview;
      setReady(!!preview && handTelemetry.ready);
      setError(handTelemetry.error);
    };

    frameListeners.add(listener);
    stateListeners.add(syncState);
    acquireEngine();
    syncState(); // adopt an already-running engine (second panel, hot toggle)

    void (async () => {
      try {
        const stream = await getSharedCamera();
        if (cancelled) {
          releaseSharedCamera();
          return;
        }
        const v = document.createElement("video");
        v.srcObject = stream;
        v.muted = true;
        v.playsInline = true;
        await v.play();
        if (cancelled) {
          v.remove();
          return;
        }
        preview = v;
        syncState();
      } catch (e) {
        if (cancelled) return;
        const err = e as Error & { name?: string };
        setError(err.name ? `${err.name}: ${err.message}` : String(e));
      }
    })();

    return () => {
      cancelled = true;
      frameListeners.delete(listener);
      stateListeners.delete(syncState);
      try {
        preview?.remove();
      } catch {
        /* already detached */
      }
      videoRef.current = null;
      videoElRef.current = null;
      releaseSharedCamera();
      releaseEngine();
    };
  }, [enabled]);

  return { ready, error, landmarksRef, videoElRef };
}
