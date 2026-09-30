"use client";

// Eyes engine — gaze tracking via MediaPipe FaceLandmarker on the IRIS signal.
//
// ─── Why iris landmarks ──────────────────────────────────────────────────
// The blendshape path (eyeLookIn/Out/Up/Down) is a weak, noisy proxy: the
// categories saturate, quantize, and mix head-pose artifacts in. The face
// mesh gives 478 landmarks INCLUDING iris centers (468-472 right iris,
// 473-477 left iris). Iris center offset relative to the eye corners is
// the signal real webcam eye trackers use — much higher SNR, and it's
// linear enough across the gaze range for a per-user regression.
//
// ─── Signal conditioning (this is what makes it usable) ──────────────────
// Raw iris landmarks are accurate but not SMOOTH: the mesh jitters ~1-2px
// per frame and occasionally emits a landmark that is metres off. Feeding
// that straight into a cursor produces the classic "the pointer dances
// around what I'm looking at" symptom, and no dead zone can fix it when
// the dead zone is smaller than the noise.
//
//  1. NORMALIZER: the iris offset is divided by the INTEROCULAR DISTANCE,
//     not by each eye's aperture. Eye height is moved by every squint,
//     blink and lid-track — dividing by it (a small, changing number)
//     inflated exactly the noise we were trying to remove. The interocular
//     distance is bone-anchored, stable frame to frame, and scales with
//     camera distance exactly like the iris travel does. Both axes share it.
//  2. MEDIAN-3 per axis — outright deletes single-frame landmark spikes.
//  3. ONE-EURO per axis — adaptive low-pass: heavy at rest (jitter dies),
//     light while saccading (the glance still lands immediately).
//
// Head pose (yaw/pitch) is extracted alongside, Filtered the same way and
// exposed raw: the 5-feature calibration regression uses it to SUBTRACT
// head-rotation contamination from the gaze signal (turning your head no
// longer moves the cursor).
//
// ─── One engine, many consumers ──────────────────────────────────────────
// The overlay and the gesture-practice panel BOTH want gaze. They used to
// each run their own detectForVideo loop against the same module-level
// FaceLandmarker — and the MediaPipe runtime is not reentrant: two
// interleaved loops corrupt each other's wasm state and BOTH stop producing
// sane landmarks (the "eye control doesn't work, in jarvis or in the
// practice panel" report). The engine is now refcounted: the first consumer
// starts ONE inference loop, everyone else attaches as a listener. Each
// consumer still gets its own <video> element bound to the shared stream for
// its own preview, so unmounting one panel can never detach another's feed.
//
// ─── The wasm abort, and why the landmarker is a singleton ───────────────
// FaceLandmarker wraps a wasm SIMD runtime (the "runtime error: aborted()
// ... native code" crash). The runtime is process-global: closing one
// instance tears down shared state under the feet of any other. One
// module-level landmarker, created at most once, never closed until page
// unload. Init serialized via a shared promise; GPU failure falls back to
// CPU; a mid-session wasm crash self-heals by reinitializing.

import { useEffect, useRef, useState } from "react";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";
import { getSharedCamera, releaseSharedCamera } from "@/lib/cameraCache";
import { pipActive } from "@/lib/documentPiP";
import { OneEuroFilter, Median3 } from "@/lib/oneEuro";
import { backgroundTicker } from "@/lib/backgroundTicker";

export interface GazeFrame {
  /** Conditioned iris gaze signals — inputs for the calibration fit. */
  rawH: number;
  rawV: number;
  /** Head pose signals — confound regressors for the calibration fit. */
  yaw: number;
  pitch: number;
  /** Blendshape-derived openness 0..1 (1 = wide open) — blink detection. */
  openness: number;
  faceFound: boolean;
}

// ─── Module-level singleton ───────────────────────────────────────────────
let landmarkerSingleton: FaceLandmarker | null = null;
let landmarkerInitPromise: Promise<FaceLandmarker> | null = null;

async function getLandmarker(): Promise<FaceLandmarker> {
  if (landmarkerSingleton) return landmarkerSingleton;
  if (landmarkerInitPromise) return landmarkerInitPromise;

  landmarkerInitPromise = (async () => {
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/vision");
    const make = (delegate: "GPU" | "CPU") =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "/mediapipe/models/face_landmarker.task",
          delegate,
        },
        outputFaceBlendshapes: true, // still used for blink/openness
        outputFacialTransformationMatrixes: false,
        runningMode: "VIDEO",
        numFaces: 1,
      });

    // CPU-first: GPU inference stalls whenever the page's compositor is
    // busy (streaming chat, animations, video) — the tracker then freezes
    // EXACTLY while the app is under load, and mysteriously "works" when
    // the window is occluded (occlusion skips composition → no stalls).
    // CPU inference here is a steady ~15-25ms and immune to that failure
    // mode; GPU remains the fallback if CPU init fails.
    let lm: FaceLandmarker;
    try {
      lm = await make("CPU");
    } catch (cpuErr) {
      console.warn("[EyeControl] CPU delegate failed, falling back to GPU:", cpuErr);
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

/** Boot the wasm + face-landmark model in the background (no camera). Call
 * once during app boot so the first eye-control enable is instant. */
export function warmEyeEngine(): void {
  if (typeof window === "undefined") return;
  void getLandmarker().catch(() => {
    /* warmup is best-effort; a real enable will surface errors */
  });
}

// ─── Landmark indices (MediaPipe FaceMesh topology) ───────────────────────
const R_IRIS = 468; // right iris center (user's right, camera's left)
const L_IRIS = 473; // left iris center
const R_EYE_OUT = 33; // right eye outer corner
const R_EYE_IN = 133; // right eye inner corner
const L_EYE_IN = 362; // left eye inner corner
const L_EYE_OUT = 263; // left eye outer corner
const NOSE_TIP = 1;
const CHIN = 152;
const FOREHEAD = 10;
const L_CHEEK = 234; // left face boundary (camera-right)
const R_CHEEK = 454; // right face boundary (camera-left)

// ─── Shared engine state ──────────────────────────────────────────────────
/** Latest engine state, readable by anyone (HUDs, diagnostics). */
export const gazeTelemetry: {
  frame: GazeFrame | null;
  ready: boolean;
  error: string | null;
} = { frame: null, ready: false, error: null };

type FrameListener = (g: GazeFrame) => void;
const frameListeners = new Set<FrameListener>();
const stateListeners = new Set<() => void>();

function publishFrame(g: GazeFrame): void {
  gazeTelemetry.frame = g;
  for (const l of frameListeners) {
    try {
      l(g);
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

// ─── Raw face-landmark consumers ──────────────────────────────────────────
// The AR suit-up needs the FULL 478-point mesh (to dock armour plates onto a
// real face), not the conditioned gaze scalar the overlay uses. Rather than
// spin up a second FaceLandmarker — which the header explains tears down the
// shared wasm runtime — the one engine republishes its raw mesh here. Empty
// set on the common path, so the cost when nobody listens is a set iteration.
export interface RawFaceFrame {
  /** 478 normalised face-mesh landmarks, or null when no face is in frame. */
  landmarks: Array<{ x: number; y: number; z: number }> | null;
}

type FaceListener = (f: RawFaceFrame) => void;
const faceListeners = new Set<FaceListener>();

function publishFaceLandmarks(f: RawFaceFrame): void {
  for (const l of faceListeners) {
    try {
      l(f);
    } catch {
      /* one bad listener must never break the loop */
    }
  }
}

/** Subscribe to the raw face mesh. Returns an unsubscribe function. */
export function subscribeFaceLandmarks(cb: FaceListener): () => void {
  faceListeners.add(cb);
  return () => {
    faceListeners.delete(cb);
  };
}

// Refcount: exactly one inference loop, however many consumers ask for gaze.
let engineConsumers = 0;
let engineDispose: (() => void) | null = null;

function acquireEngine(): void {
  engineConsumers++;
  if (!engineDispose) engineDispose = startGazeEngine();
}

function releaseEngine(): void {
  engineConsumers = Math.max(0, engineConsumers - 1);
  if (engineConsumers === 0 && engineDispose) {
    const d = engineDispose;
    engineDispose = null;
    d();
  }
}

/**
 * Start the one and only detection loop. Returns a disposer.
 *
 * The engine owns a tiny hidden <video> for inference and hands frames out
 * through publishFrame(); it deliberately does NOT own any panel's preview
 * element (each consumer makes its own off the shared stream), so a panel
 * unmounting can never pull the decode source out from under tracking.
 */
function startGazeEngine(): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let video: HTMLVideoElement | null = null;
  let lastVideoTs = -1;
  let crashed = false;
  let consecutiveErrors = 0;
  let useDelegate: "GPU" | "CPU" = "GPU";

  const setError = (msg: string | null) => {
    if (gazeTelemetry.error === msg) return;
    gazeTelemetry.error = msg;
    publishState();
  };

  const releaseKeepAlive = backgroundTicker.acquire("eye-engine");
  let unsubTicker: (() => void) | null = null;

  /** Drop the camera + hidden element (used by stop and by hard restarts). */
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
    releaseSharedCamera();
  };

  const start = async () => {
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
      // Hidden, but NOT offscreen-far and not display:none — Chrome keeps
      // decoding a tiny element that is technically on-screen and visible;
      // a fully offscreen one can be throttled to zero frames, which would
      // silently starve detectForVideo.
      v.style.cssText =
        "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1;";
      document.body.appendChild(v);
      // Assigned BEFORE the first await so a disposer running mid-init can
      // always find and remove the element (and release the stream).
      video = v;
      await v.play();
      if (cancelled) return;

      await getLandmarker();
      if (cancelled) return;
      gazeTelemetry.ready = true;
      setError(null);
      publishState();

      // ── Per-session signal conditioning ──────────────────────────────
      // Median first (spike deletion), One-Euro second (noise suppression).
      // minCutoff 0.55Hz: rock-solid sniper fixation stability at rest (lower
      // = more smoothing = less jitter = better word-level precision).
      // beta 2.0: fast saccade tracking with zero lag on deliberate glances.
      // Head pose uses separate faster filter since yaw/pitch contamination
      // needs to be removed with less lag than the gaze itself.
      const hMed = new Median3();
      const vMed = new Median3();
      const fH = new OneEuroFilter(0.55, 2.0);
      const fV = new OneEuroFilter(0.55, 2.0);
      const fYaw = new OneEuroFilter(1.2, 0.8);
      const fPitch = new OneEuroFilter(1.2, 0.8);

      const pick = (cats: { categoryName: string; score: number }[], name: string) =>
        cats.find((c) => c.categoryName === name)?.score ?? 0;

      const loop = () => {
        if (cancelled) return;
        // Engine rebuilding after a wasm crash — keep polling until it's
        // back instead of giving up (a dead loop used to freeze the cursor
        // until the feature was toggled off and on).
        if (!video || !landmarkerSingleton) {
          timer = setTimeout(loop, 120);
          return;
        }
        // Continuous background tracking: do NOT pause on document.hidden so
        // gaze control works seamlessly across all Windows applications.
        const v = video;
        if (v.readyState >= 2) {
          try {
            // Strictly-increasing timestamps: detectForVideo THROWS on a
            // duplicate/retreating stamp, and setTimeout(0) can coalesce two
            // loop ticks into the same millisecond on a fast machine — every
            // such tick then burns an inference slot on a thrown frame.
            const ts = Math.max(lastVideoTs + 1, performance.now());
            lastVideoTs = ts;
            const res = landmarkerSingleton.detectForVideo(v, ts);
            const lm = res.faceLandmarks?.[0];
            const face = res.faceBlendshapes?.[0]?.categories;
            if (lm && lm.length >= 478) {
              // ── Iris gaze signals with head roll alignment ──────────
              const rIris = lm[R_IRIS];
              const lIris = lm[L_IRIS];
              const rMidX = (lm[R_EYE_OUT].x + lm[R_EYE_IN].x) / 2;
              const rMidY = (lm[R_EYE_OUT].y + lm[R_EYE_IN].y) / 2;
              const lMidX = (lm[L_EYE_OUT].x + lm[L_EYE_IN].x) / 2;
              const lMidY = (lm[L_EYE_OUT].y + lm[L_EYE_IN].y) / 2;

              // Interocular vector & distance (stable bone-anchored scale)
              const dEyeX = lMidX - rMidX;
              const dEyeY = lMidY - rMidY;
              const iod = Math.hypot(dEyeX, dEyeY) || 1e-6;
              const cosR = dEyeX / iod;
              const sinR = dEyeY / iod;

              // Average raw displacements relative to eye socket midpoints
              const avgDx = (rIris.x - rMidX + (lIris.x - lMidX)) / 2;
              const avgDy = (rIris.y - rMidY + (lIris.y - lMidY)) / 2;

              // Rotate by -roll to align with head axis (head roll compensation)
              const alignedX = avgDx * cosR + avgDy * sinR;
              const alignedY = -avgDx * sinR + avgDy * cosR;

              // In mirrored selfie camera: looking right moves iris towards camera-left (-alignedX) -> negate so looking right is positive.
              const rawH0 = -(alignedX / iod);
              // Looking up moves iris towards camera-top (-alignedY) -> negate so looking UP is positive!
              const rawV0 = -(alignedY / iod);

              // ── Head pose signals ──────────────────────────────────
              // Yaw: nose tip x relative to the face's cheek midline,
              // normalized by face width. Turning the head moves the nose
              // off-center. Pitch: nose tip y against the forehead-chin
              // midpoint, normalized by face height.
              const faceW = Math.abs(lm[R_CHEEK].x - lm[L_CHEEK].x) || 1e-6;
              const faceMidX = (lm[R_CHEEK].x + lm[L_CHEEK].x) / 2;
              const yaw0 = (lm[NOSE_TIP].x - faceMidX) / faceW;
              const faceH = Math.abs(lm[CHIN].y - lm[FOREHEAD].y) || 1e-6;
              const faceMidY = (lm[CHIN].y + lm[FOREHEAD].y) / 2;
              const pitch0 = (lm[NOSE_TIP].y - faceMidY) / faceH;

              const openness = face
                ? 1 - (pick(face, "eyeBlinkLeft") + pick(face, "eyeBlinkRight")) / 2
                : 1;

              // NaN GUARD — the top-left-drift killer. GPU hiccups can
              // emit a frame of NaN landmarks; one NaN poisons the
              // downstream filter/anchor forever and every later send
              // becomes NaN → the OS clamps null coords to (0,0).
              // Never propagate a non-finite frame.
              if (
                !Number.isFinite(rawH0) || !Number.isFinite(rawV0) ||
                !Number.isFinite(yaw0) || !Number.isFinite(pitch0) ||
                !Number.isFinite(openness)
              ) {
                timer = setTimeout(loop, 0);
                return;
              }

              publishFaceLandmarks({ landmarks: lm });
              publishFrame({
                rawH: fH.filter(hMed.push(rawH0), ts),
                rawV: fV.filter(vMed.push(rawV0), ts),
                yaw: fYaw.filter(yaw0, ts),
                pitch: fPitch.filter(pitch0, ts),
                openness,
                faceFound: true,
              });
            } else {
              publishFaceLandmarks({ landmarks: null });
              publishFrame({
                rawH: 0,
                rawV: 0,
                yaw: 0,
                pitch: 0,
                openness: 1,
                faceFound: false,
              });
            }
            crashed = false;
            consecutiveErrors = 0;
          } catch (e) {
            const msg = String((e as Error)?.message ?? e);
            // Count every skipped frame. The old code only ever RESET this
            // counter, so the "persistent failure → full self-heal" branch
            // below was unreachable and a wedged engine looped on thrown
            // frames forever instead of re-acquiring the camera.
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
                  if (!cancelled) setError("eye tracker crashed and could not restart");
                });
            } else if (consecutiveErrors > 30 && !cancelled) {
              // Persistent failure (stalled video after device reset,
              // broken stream) → full self-heal: re-acquire camera +
              // engine instead of looping on errors forever.
              consecutiveErrors = 0;
              teardown();
              void start();
              return;
            }
            // frame skipped (video resize etc.)
          }
        }
        timer = setTimeout(loop, 0);
      };
      unsubTicker = backgroundTicker.subscribe(() => {
        if (!cancelled && video && landmarkerSingleton) loop();
      });
      timer = setTimeout(loop, 0);
    } catch (err) {
      console.error("[EyeControl] init failed:", err);
      // Release the stream + element on a failed boot (a rejected play()
      // used to leak both and leave a stray <video> in the DOM).
      teardown();
      const e = err as Error & { name?: string };
      if (!cancelled) setError(e.name ? `${e.name}: ${e.message}` : String(err));
    }
  };

  void start();

  return () => {
    cancelled = true;
    teardown();
    gazeTelemetry.frame = null;
    gazeTelemetry.ready = false;
    publishState();
    // Singleton intentionally NOT closed — see header comment.
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
  /** Called every processed frame with the latest gaze point. */
  onFrame?: (g: GazeFrame) => void;
}

export function useEyeControl({ enabled, onFrame }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let preview: HTMLVideoElement | null = null;

    const listener: FrameListener = (g) => onFrameRef.current?.(g);
    const syncState = () => {
      if (cancelled) return;
      // Publish the element BEFORE the state lands: consumers attach the
      // preview from an effect keyed on `ready`, so `videoRef` must already
      // be populated by the time they run.
      videoRef.current = preview;
      setReady(!!preview && gazeTelemetry.ready);
      setError(gazeTelemetry.error);
    };

    frameListeners.add(listener);
    stateListeners.add(syncState);
    acquireEngine();
    syncState(); // adopt an already-running engine (second panel, hot toggle)

    void (async () => {
      try {
        // Each consumer owns a preview element bound to the SHARED stream.
        // Two <video> elements on one MediaStream share the decoder, so this
        // costs nothing and keeps panels independent of each other.
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
      } catch (err) {
        if (cancelled) return;
        const e = err as Error & { name?: string };
        setError(e.name ? `${e.name}: ${e.message}` : String(err));
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
      releaseSharedCamera();
      releaseEngine();
    };
  }, [enabled]);

  return { videoRef, ready, error };
}
