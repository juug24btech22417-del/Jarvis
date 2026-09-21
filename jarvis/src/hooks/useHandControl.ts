"use client";

// Shared hand-tracking engine (MediaPipe Hands) for air-mouse and gesture DJ.
// One camera, one model instance; consumers get a per-frame callback with
// normalized index-finger position + pinch distance.

import { useEffect, useRef, useState, useCallback } from "react";
import type { Hands, Results } from "@mediapipe/hands";
import { loadHandsClass } from "@/lib/mediapipeLoader";

export interface HandFrame {
  /** Index fingertip, normalized 0..1 (mirrored horizontally for natural control). */
  x: number;
  y: number;
  /** Pinch strength 0..1 (1 = thumb+index touching). */
  pinch: number;
  /** Fist strength 0..1 (1 = all fingertips curled into the palm). */
  fist: number;
  /** Per-finger extension (true = finger straight/open). Size-invariant. */
  fingers: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
  handFound: boolean;
}

// Landmark indices for the four fingertips (thumb excluded — it wanders).
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

        // Legacy MediaPipe must load as a plain CDN script — webpack-bundling
        // it corrupts the WASM glue (`TypeError: n is not a function`).
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
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
        hands.onResults((results: Results) => {
          const lm = results.multiHandLandmarks?.[0];
          if (lm) {
            // Index tip 8, thumb tip 4.
            const tip = lm[8];
            const thumb = lm[4];
            const pinchDist = Math.hypot(tip.x - thumb.x, tip.y - thumb.y);

            // Fist strength — mean fingertip curl, normalized by hand size so
            // it works near or far from the camera. Fingertips pull toward the
            // palm centroid as the hand closes.
            const palmX = (lm[0].x + lm[5].x + lm[17].x) / 3;
            const palmY = (lm[0].y + lm[5].y + lm[17].y) / 3;
            // Hand scale: middle-MCP → wrist distance.
            const scale = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 1e-6;
            const curl =
              TIPS.reduce((acc, t, i) => {
                const knuckle = lm[PIPS[i]];
                const tipToPalm = Math.hypot(lm[t].x - palmX, lm[t].y - palmY);
                const knuckleToPalm = Math.hypot(knuckle.x - palmX, knuckle.y - palmY) || 1e-6;
                // Closed: tip sits closer to palm than its knuckle (ratio < 1).
                return acc + tipToPalm / knuckleToPalm;
              }, 0) / TIPS.length;
            // ratio ~0.75 open → ~0.35 closed. Map into 0..1.
            const fist = Math.max(0, Math.min(1, (0.72 - curl) / 0.32));

            // Per-finger extension: a finger is extended when its tip is
            // farther from the wrist than its PIP joint (curl folds the tip
            // back toward the palm). Orientation- and distance-invariant.
            const wrist = lm[0];
            const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
              Math.hypot(a.x - b.x, a.y - b.y);
            const ext = (tipIdx: number, pipIdx: number) =>
              d(lm[tipIdx], wrist) > d(lm[pipIdx], wrist);
            // Thumb: tucked-across-palm puts the tip close to the middle
            // knuckle; extended it swings out past it (normalized by scale).
            const thumbExt = d(lm[4], lm[9]) / scale > 1.0;
            const fingers = {
              thumb: thumbExt,
              index: ext(8, 6),
              middle: ext(12, 10),
              ring: ext(16, 14),
              pinky: ext(20, 18),
            };

            // Hands model is unmirrored; mirror x so moving hand right moves
            // cursor right.
            onFrameRef.current?.({
              x: 1 - tip.x,
              y: tip.y,
              pinch: Math.max(0, Math.min(1, 1 - pinchDist / 0.18)),
              fist,
              fingers,
              handFound: true,
            });
          } else {
            onFrameRef.current?.({
              x: 0.5,
              y: 0.5,
              pinch: 0,
              fist: 0,
              fingers: { thumb: false, index: false, middle: false, ring: false, pinky: false },
              handFound: false,
            });
          }
        });

        const loop = () => {
          if (cancelled || !videoRef.current) return;
          if (videoRef.current.readyState >= 2) {
            hands.send({ image: videoRef.current });
          }
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

  return { ready, error };
}
