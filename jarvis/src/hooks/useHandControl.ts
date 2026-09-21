"use client";

// Shared hand-tracking engine (MediaPipe Hands) for air-mouse, gesture DJ and
// the legacy useGesture hook. One camera, one model instance; consumers get a
// per-frame callback with normalized index-finger position + pinch/fist +
// per-finger extension.
//
// Performance notes:
//  - The inference loop is SELF-PACING: we await hands.send() before
//    scheduling the next frame. Naively firing send() every rAF queues a
//    backlog on slower machines and every callback then receives STALE
//    frames — the #1 cause of "gestures feel laggy / don't respond".
//  - Finger extension uses hysteresis (separate enter/exit thresholds) so a
//    fingertip hovering at the detection boundary doesn't flicker the pose
//    classifier and debounce resets.

import { useEffect, useRef, useState, useCallback } from "react";
import type { Hands, Results, NormalizedLandmark } from "@mediapipe/hands";
import { loadHandsClass } from "@/lib/mediapipeLoader";

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
  handFound: boolean;
  /** Rolling estimate of processed frames per second (for HUDs). */
  fps: number;
}

// Landmark indices for the four fingertips.
const TIPS = [8, 12, 16, 20];
// Corresponding MCP knuckle joints where fingers meet the palm.
const PIPS = [5, 9, 13, 17];

interface Options {
  enabled: boolean;
  onFrame?: (f: HandFrame) => void;
}

export function useHandControl({ enabled, onFrame }: Options) {
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handsRef = useRef<Hands | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Latest 21-point skeleton + the video element, exposed for overlays
  // (gesture practice) and mini PiP monitors.
  const landmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const videoElRef = useRef<HTMLVideoElement | null>(null);

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }
    let cancelled = false;

    const start = async () => {
      try {
        // getUserMedia only exists in secure contexts. Opening the app over a
        // LAN IP (http://172.x.x.x:3000) silently hides the camera API.
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "InsecureContext: camera API unavailable — open the app via http://localhost:3000"
          );
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();
        videoRef.current = video;
        videoElRef.current = video;

        // Legacy MediaPipe must load as a plain same-origin script —
        // webpack-bundling it corrupts the WASM glue.
        const HandsCtor = (await loadHandsClass()) as unknown as new (config: {
          locateFile: (file: string) => string;
        }) => Hands;
        const hands = new HandsCtor({
          // Self-hosted runtime (public/mediapipe) — CSP-compliant, offline-safe,
          // and version-matched to hands.js.
          locateFile: (f) => `/mediapipe/hands/${f}`,
        });
        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0, // lite — lower latency for cursor control
          // Relaxed from 0.6/0.5: with the strict values the detector often
          // drops the hand mid-gesture (especially side-on fists/swipes),
          // which reads as "gesture not recognized".
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.4,
        });

        let haveResult = false;
        hands.onResults((results: Results) => {
          haveResult = true;
          const lm = results.multiHandLandmarks?.[0];
          landmarksRef.current = lm ?? null;
          if (lm) {
            // Index tip 8, thumb tip 4.
            const tip = lm[8];
            const thumb = lm[4];
            const pinchDist = Math.hypot(tip.x - thumb.x, tip.y - thumb.y);

            // Fist strength — mean fingertip curl, normalized by hand size so
            // it works near or far from the camera.
            const palmX = (lm[0].x + lm[5].x + lm[17].x) / 3;
            const palmY = (lm[0].y + lm[5].y + lm[17].y) / 3;
            // Hand scale: middle-MCP → wrist distance.
            const scale = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 1e-6;
            const curl =
              TIPS.reduce((acc, t, i) => {
                const knuckle = lm[PIPS[i]];
                const tipToPalm = Math.hypot(lm[t].x - palmX, lm[t].y - palmY);
                const knuckleToPalm = Math.hypot(knuckle.x - palmX, knuckle.y - palmY) || 1e-6;
                return acc + tipToPalm / knuckleToPalm;
              }, 0) / TIPS.length;
            const fist = Math.max(0, Math.min(1, (0.72 - curl) / 0.32));

            // Per-finger extension with hysteresis. A finger is extended when
            // its tip is farther from the wrist than its PIP joint; the two
            // thresholds (enter 1.12×, exit 0.95×) stop flicker at the
            // boundary, which previously forced the consumer's debounce to
            // restart over and over → gestures "never detected".
            const wrist = lm[0];
            const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
              Math.hypot(a.x - b.x, a.y - b.y);
            const prev = prevFingers.current;
            const hysteresis = (tipIdx: number, pipIdx: number, was: boolean) => {
              const r = d(lm[tipIdx], wrist) / (d(lm[pipIdx], wrist) || 1e-6);
              return was ? r > 0.95 : r > 1.12;
            };
            const fingers = {
              thumb: prev.thumb
                ? d(lm[4], lm[9]) / scale > 0.85
                : d(lm[4], lm[9]) / scale > 1.0,
              index: hysteresis(8, 6, prev.index),
              middle: hysteresis(12, 10, prev.middle),
              ring: hysteresis(16, 14, prev.ring),
              pinky: hysteresis(20, 18, prev.pinky),
            };
            prevFingers.current = fingers;

            // Hands model is unmirrored; mirror x so moving hand right moves
            // cursor right.
            onFrameRef.current?.({
              x: 1 - tip.x,
              y: tip.y,
              pinch: Math.max(0, Math.min(1, 1 - pinchDist / 0.18)),
              fist,
              fingers,
              handFound: true,
              fps: fpsRef.current,
            });
          } else {
            onFrameRef.current?.({
              x: 0.5,
              y: 0.5,
              pinch: 0,
              fist: 0,
              fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
              handFound: false,
              fps: fpsRef.current,
            });
          }
        });

        // ─── Self-pacing inference loop ────────────────────────────────────
        // rAF only schedules the NEXT send after the current one finishes, so
        // the pipeline never queues a backlog of stale frames.
        let lastStamp = performance.now();
        let smoothFps = 0;
        const loop = async () => {
          if (cancelled || !videoRef.current || !handsRef.current) return;
          // Hidden tabs throttle rAF; skip inference until visible again so
          // nothing stale queues up. (A Document-PiP window keeps us visible.)
          if (document.hidden) {
            rafRef.current = requestAnimationFrame(loop);
            return;
          }
          if (videoRef.current.readyState >= 2) {
            try {
              await handsRef.current.send({ image: videoRef.current });
            } catch {
              // send() can throw during teardown; ignore.
            }
          }
          const now = performance.now();
          const dt = now - lastStamp;
          lastStamp = now;
          if (dt > 0) smoothFps = smoothFps ? smoothFps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
          fpsRef.current = smoothFps;
          rafRef.current = requestAnimationFrame(loop);
        };

        await hands.initialize();
        if (cancelled) return;
        handsRef.current = hands;
        setReady(true);
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error("[HandControl] init failed:", err);
        // Surface the DOMException name — NotFoundError (no/hidden camera),
        // NotAllowedError (permission denied), NotReadableError (held by
        // another app) each need a different fix.
        const e = err as Error & { name?: string };
        setError(e.name ? `${e.name}: ${e.message}` : String(err));
      }
    };

    start();
    return () => {
      cancelled = true;
      stop();
      handsRef.current?.close();
      handsRef.current = null;
    };
  }, [enabled, stop]);

  return { ready, error, landmarksRef, videoElRef };
}

// Hysteresis memory lives outside the effect so onResults closes over it.
const prevFingers = { current: { thumb: false, index: false, middle: false, ring: false, pinky: false } };
const fpsRef = { current: 0 };
