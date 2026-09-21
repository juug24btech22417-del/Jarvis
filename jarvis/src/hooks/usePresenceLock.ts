"use client";

// Presence auto-lock — the "walks away → screen locks itself" flex.
// Uses the same face-api presence engine as useBiometrics. When the face
// disappears for GRACE_MS while armed, calls /api/os/lock (Win32
// LockWorkStation). When you come back, jarvis greets you.
//
// Armed via localStorage flag "jarvis:presence-lock" (toggle in StatusHUD
// is a future nicety; for now Ctrl+L toggles and the biometrics toggle
// keeps working as before).

import { useEffect, useRef, useState, useCallback } from "react";
import { detectFacePresence } from "@/lib/security/face-recognition";
import { loadFaceApiModels } from "@/lib/security/face-recognition";
import { useJarvisVoice } from "@/hooks/useVoice";

const GRACE_MS = 20_000; // face gone for 20s → lock
const CHECK_MS = 2_000;
const GREET_COOLDOWN_MS = 5 * 60_000;

export function usePresenceLock() {
  const [armed, setArmed] = useState(false);
  const [present, setPresent] = useState<boolean | null>(null); // null = unknown
  const awaySince = useRef<number | null>(null);
  const lastGreet = useRef(0);
  const locking = useRef(false);
  const { speak } = useJarvisVoice();

  // Ctrl+Shift+L toggles arming.
  useEffect(() => {
    const stored = localStorage.getItem("jarvis:presence-lock") === "1";
    setArmed(stored);
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setArmed((v) => {
          const next = !v;
          localStorage.setItem("jarvis:presence-lock", next ? "1" : "0");
          speak(next ? "Presence lock armed, Boss." : "Presence lock disarmed.");
          return next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speak]);

  const lockNow = useCallback(async () => {
    if (locking.current) return;
    locking.current = true;
    try {
      await fetch("/api/os/lock", { method: "POST" });
    } catch {
      // non-fatal
    } finally {
      setTimeout(() => (locking.current = false), 5000);
    }
  }, []);

  useEffect(() => {
    if (!armed) {
      setPresent(null);
      return;
    }
    let stream: MediaStream | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let busy = false;
    let cancelled = false;

    const start = async () => {
      try {
        const ok = await loadFaceApiModels();
        if (!ok || cancelled) return;
        stream = await navigator.mediaDevices.getUserMedia({ video: {} });
        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        await video.play();

        interval = setInterval(async () => {
          if (busy || video.readyState < 2) return;
          busy = true;
          try {
            const face = await detectFacePresence(video);
            setPresent(!!face);

            if (face) {
              awaySince.current = null;
              const now = Date.now();
              if (now - lastGreet.current > GREET_COOLDOWN_MS) {
                lastGreet.current = now;
                speak("Welcome back, Boss. Systems held your place.");
              }
            } else {
              if (awaySince.current === null) awaySince.current = Date.now();
              else if (Date.now() - awaySince.current > GRACE_MS) {
                awaySince.current = null;
                speak("No presence detected. Locking the station.");
                await lockNow();
              }
            }
          } finally {
            busy = false;
          }
        }, CHECK_MS);
      } catch (err) {
        console.error("[PresenceLock] camera failed:", err);
      }
    };

    start();
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [armed, lockNow, speak]);

  return { armed, present };
}
