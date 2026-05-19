import { useEffect, useRef } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import { useTextToSpeech } from "./useVoice";

const SENTINEL_INTERVAL = 45000; // 45 seconds between passive checks
const MIN_STABLE_TIME = 5000; // Wait 5 seconds after speaking/active to check

export function useJarvisSentinel() {
  const { sentinelActive, isMuted, state } = useJarvisStore();
  const { speak } = useTextToSpeech();
  const lastCheckRef = useRef<number>(0);
  const isCheckingRef = useRef(false);

  useEffect(() => {
    if (!sentinelActive || state === "thinking") return;

    const runSentinelCheck = async () => {
      // Don't check if we're already checking or if JARVIS is busy
      if (isCheckingRef.current || state === "speaking") return;

      const now = Date.now();
      if (now - lastCheckRef.current < SENTINEL_INTERVAL) return;

      console.log("[Sentinel] Initiating passive observation...");
      isCheckingRef.current = true;
      lastCheckRef.current = now;

      try {
        // 1. Capture screen
        const captureRes = await fetch("/api/screenshot/capture");
        const captureData = await captureRes.json();

        if (!captureData.success) {
          console.error("[Sentinel] Capture failed:", captureData.error);
          isCheckingRef.current = false;
          return;
        }

        // 2. Analyze screen
        const analyzeRes = await fetch("/api/sentinel/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: captureData.image }),
        });
        const analyzeData = await analyzeRes.json();

        // 3. Proactively comment if noteworthy
        if (analyzeData.success && analyzeData.proactive && analyzeData.comment) {
          console.log("[Sentinel] Proactive comment:", analyzeData.comment);
          
          // Only speak if not muted
          if (!isMuted) {
            speak(analyzeData.comment);
          }
        } else {
          console.log("[Sentinel] Nothing noteworthy observed.");
        }
      } catch (error) {
        console.error("[Sentinel] Error during check:", error);
      } finally {
        isCheckingRef.current = false;
      }
    };

    const interval = setInterval(runSentinelCheck, 10000); // Check every 10s if it's time
    return () => clearInterval(interval);
  }, [sentinelActive, isMuted, state, speak]);
}
