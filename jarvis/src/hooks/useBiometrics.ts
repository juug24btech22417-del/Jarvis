import { useEffect, useRef, useState } from "react";
import { detectFacePresence } from "@/lib/security/face-recognition";
import { useJarvisStore } from "@/store/jarvis.store";
import { useTextToSpeech } from "./useVoice";

// Uses the SAME engine as Sentinel Eyes (@vladmandic/face-api, lazy-loaded,
// models vendored at /models) — the legacy face-api.js import here used to
// drag the ancient TFJS into the bundle and crash the app at eval time
// ("t is not a function" in tf-core.esm.js).
const GREETING_COOLDOWN = 10 * 60 * 1000; // 10 minutes between greetings

export function useJarvisBiometrics() {
  const { biometricActive, state } = useJarvisStore();
  const { speak } = useTextToSpeech();
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastGreetingRef = useRef<number>(0);
  const isGreetingRef = useRef(false);

  // Kick off model loading once when biometrics activates (shared loader —
  // no-op if Sentinel Eyes already loaded them).
  useEffect(() => {
    if (!biometricActive) return;

    let cancelled = false;
    const loadModels = async () => {
      try {
        console.log("[Biometrics] Loading face detection models...");
        const { loadFaceApiModels } = await import("@/lib/security/face-recognition");
        const ok = await loadFaceApiModels();
        if (!cancelled) setModelsLoaded(ok);
        if (ok) console.log("[Biometrics] Models loaded successfully.");
        else console.error("[Biometrics] Failed to load models");
      } catch (error) {
        console.error("[Biometrics] Failed to load models:", error);
      }
    };

    loadModels();
    return () => {
      cancelled = true;
    };
  }, [biometricActive]);

  // Start video stream and presence-detection loop
  useEffect(() => {
    if (!biometricActive || !modelsLoaded) return;

    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let busy = false;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.play();
        videoRef.current = video;

        interval = setInterval(async () => {
          if (state !== "idle" || isGreetingRef.current || busy) return;
          const video = videoRef.current;
          if (!video || video.readyState < 2) return;

          busy = true;
          try {
            const face = await detectFacePresence(video);

            if (face) {
              const now = Date.now();
              if (now - lastGreetingRef.current > GREETING_COOLDOWN) {
                console.log("[Biometrics] Face detected! Triggering greeting.");
                isGreetingRef.current = true;
                lastGreetingRef.current = now;

                speak("Welcome back, Boss. All systems are nominal and ready for your command.");

                // Reset greeting flag after speech starts
                setTimeout(() => {
                  isGreetingRef.current = false;
                }, 5000);
              }
            }
          } finally {
            busy = false;
          }
        }, 3000); // Check every 3 seconds
      } catch (error) {
        console.error("[Biometrics] Camera access failed:", error);
      }
    };

    startCamera();

    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
      if (interval) clearInterval(interval);
    };
  }, [biometricActive, modelsLoaded, state, speak]);
}
