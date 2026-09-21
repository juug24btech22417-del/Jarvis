"use client";

// Eyes engine — gaze tracking via MediaPipe FaceLandmarker blendshapes.
// Look at a HUD target and hold your gaze to trigger it (dwell-to-open).
//
// Uses outputFaceBlendshapes (eyeLookIn/Out/Up/Down categories) to derive a
// 2D gaze vector — no iris model needed, runs fine on CPU/GPU at ~20fps.

import { useEffect, useRef, useState, useCallback } from "react";
import { FilesetResolver, FaceLandmarker } from "@mediapipe/tasks-vision";

export interface GazeFrame {
  /** Normalized gaze point on screen, 0..1 (mirrored: your right = screen right). */
  x: number;
  y: number;
  /** Blendshape magnitude 0..1 — how wide open the eyes are. */
  openness: number;
  faceFound: boolean;
}

interface Options {
  enabled: boolean;
  /** Called every processed frame with the latest gaze point. */
  onFrame?: (g: GazeFrame) => void;
}

export function useEyeControl({ enabled, onFrame }: Options) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
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

        const fileset = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          outputFaceBlendshapes: true,
          runningMode: "VIDEO",
          numFaces: 1,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setReady(true);

        // Blendshape categories we care about.
        const pick = (cats: { categoryName: string; score: number }[], name: string) =>
          cats.find((c) => c.categoryName === name)?.score ?? 0;

        const loop = () => {
          if (cancelled || !videoRef.current || !landmarkerRef.current) return;
          const v = videoRef.current;
          if (v.readyState >= 2) {
            try {
              const res = landmarkerRef.current.detectForVideo(v, performance.now());
              const face = res.faceBlendshapes?.[0]?.categories;
              if (face) {
                // Gaze vector from eye-look blendshapes (0..1 each side).
                const lookInL = pick(face, "eyeLookInLeft");
                const lookOutL = pick(face, "eyeLookOutLeft");
                const lookInR = pick(face, "eyeLookInRight");
                const lookOutR = pick(face, "eyeLookOutRight");
                const lookUpL = pick(face, "eyeLookUpLeft");
                const lookDownL = pick(face, "eyeLookDownLeft");
                const lookUpR = pick(face, "eyeLookUpRight");
                const lookDownR = pick(face, "eyeLookDownRight");

                // Horizontal: looking right (user's right) → camera sees eyes
                // turning to their left... we mirror so it feels natural.
                const hRaw = (lookOutL + lookInR) / 2 - (lookInL + lookOutR) / 2;
                const vRaw = (lookUpL + lookUpR) / 2 - (lookDownL + lookDownR) / 2;

                // Map to screen. Blendshapes hover near 0.1-0.35 for normal
                // gaze angles; expand around a 0.15 deadzone into 0..1.
                const expand = (t: number) => Math.max(0, Math.min(1, (t + 0.25) / 0.5));

                const openness =
                  1 -
                  (pick(face, "eyeBlinkLeft") + pick(face, "eyeBlinkRight")) / 2;

                onFrameRef.current?.({
                  x: expand(hRaw),
                  y: expand(-vRaw),
                  openness,
                  faceFound: true,
                });
              } else {
                onFrameRef.current?.({ x: 0.5, y: 0.5, openness: 1, faceFound: false });
              }
            } catch {
              // frame skipped (video resize etc.)
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        console.error("[EyeControl] init failed:", err);
        setError(String(err));
      }
    };

    start();
    return () => {
      cancelled = true;
      stop();
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
    };
  }, [enabled, stop]);

  return { videoRef, ready, error };
}
