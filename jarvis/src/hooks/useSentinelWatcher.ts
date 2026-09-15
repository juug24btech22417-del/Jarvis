"use client";

/**
 * Global Sentinel Eyes watcher — runs OUTSIDE the Security panel.
 *
 * While `sentinelArmed` is on, owns the webcam and runs the same
 * recognition pipeline as the panel (detect → match against registered
 * faces → Telegram alert + escalation on unknown face). The Security
 * panel can borrow the camera for registration via the camera-busy flag;
 * the watcher releases the stream and pauses while it's borrowed.
 *
 * Consumption:
 * - writes live status to the store (`sentinelLiveStatus`) so any UI
 *   (HUD chip, home toggle, panel) can react without prop-drilling
 * - fires the same /api/security alert + escalate actions as the panel
 */

import { useEffect, useRef, useCallback } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import {
  loadFaceApiModels,
  detectSingleFaceWithLandmarks,
} from "@/lib/security/face-recognition";

const STORAGE_KEY = "jarvis_faces";
const DETECT_INTERVAL_MS = 900;
const ALERT_DELAY_MS = 4000; // unknown face must persist this long before alert
const ESCALATE_L2_MS = 10_000;
const ESCALATE_L3_MS = 20_000;
const WELCOME_COOLDOWN_MS = 45_000;
const WARNING_COOLDOWN_MS = 45_000;

interface StoredFace {
  id: string;
  name: string;
  descriptor: number[];
  createdAt: string;
}

interface WatcherSettings {
  enabled: boolean;
  strictMode: boolean;
  autoLockTimeout: number;
  stealthMode: boolean;
  escalation: boolean;
}

export function useSentinelWatcher() {
  const armed = useJarvisStore((s) => s.sentinelArmed);
  const setLiveStatus = useJarvisStore((s) => s.setSentinelLiveStatus);

  // Camera + loop handles
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const loopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unknownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const escalateTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const alertSentRef = useRef(false);
  const speechCooldownRef = useRef({ welcome: 0, warning: 0 });
  const settingsRef = useRef<WatcherSettings>({
    enabled: false,
    strictMode: false,
    autoLockTimeout: 5,
    stealthMode: false,
    escalation: true,
  });
  const facesRef = useRef<StoredFace[]>([]);
  const runningRef = useRef(false);

  // ─── settings + faces sync (server is source of truth) ────────────────────
  const syncFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/security");
      const data = await res.json();
      if (data.success) {
        settingsRef.current = data.settings;
        if (!data.settings.enabled) {
          setLiveStatus("idle");
        }
      }
    } catch {
      /* offline — keep last known */
    }
  }, [setLiveStatus]);

  const loadFaces = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      facesRef.current = raw ? (JSON.parse(raw) as StoredFace[]) : [];
    } catch {
      facesRef.current = [];
    }
  }, []);

  // ─── alert + escalation (same contract as the panel flow) ────────────────
  const triggerAlert = useCallback(async (video: HTMLVideoElement) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const imageData = canvas.toDataURL("image/jpeg", 0.85);

      const timestamp = new Date().toLocaleTimeString();
      const message = `⚠️ [Sentinel Eyes Alert] Unauthorized presence detected at ${timestamp}!`;

      const res = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "alert", data: { imageData, message } }),
      });
      const data = await res.json();
      if (data.success) {
        console.log("[SentinelWatcher] Telegram alert sent");

        const s = settingsRef.current;
        if (s.escalation && !s.stealthMode) {
          escalateTimersRef.current.push(
            setTimeout(() => {
              fetch("/api/security", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "escalate", data: { level: 2 } }),
              }).catch(() => {});
            }, ESCALATE_L2_MS)
          );
          escalateTimersRef.current.push(
            setTimeout(() => {
              fetch("/api/security", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "escalate", data: { level: 3 } }),
              }).catch(() => {});
            }, ESCALATE_L3_MS)
          );
        }
      }
    } catch (e) {
      console.error("[SentinelWatcher] alert failed:", e);
    }
  }, []);

  // ─── camera management ────────────────────────────────────────────────────
  const releaseCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const acquireCamera = useCallback(async (): Promise<HTMLVideoElement | null> => {
    if (streamRef.current) return videoRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play().catch(() => {});
      streamRef.current = stream;
      videoRef.current = video;
      return video;
    } catch (err) {
      console.error("[SentinelWatcher] camera access failed:", err);
      return null;
    }
  }, []);

  // ─── the detection loop ───────────────────────────────────────────────────
  const tick = useCallback(async () => {
    if (!runningRef.current) return;

    const store = useJarvisStore.getState();
    const cameraBusy = store.sentinelCameraBusy;
    const s = settingsRef.current;

    // Panel borrowed the camera — stand down and wait.
    if (cameraBusy) {
      releaseCamera();
      setLiveStatus("scanning");
      loopTimerRef.current = setTimeout(tick, 1500);
      return;
    }

    const video = await acquireCamera();
    if (!video || video.readyState < 2) {
      loopTimerRef.current = setTimeout(tick, 1500);
      return;
    }

    try {
      const detection = await detectSingleFaceWithLandmarks(video);

      if (!detection) {
        setLiveStatus(s.enabled ? "scanning" : "idle");
        if (unknownTimerRef.current) {
          clearTimeout(unknownTimerRef.current);
          unknownTimerRef.current = null;
        }
      } else {
        const descArray = Array.from(detection.descriptor);
        const threshold = s.strictMode ? 0.5 : 0.55;
        let matched: { name: string } | null = null;
        let bestDist = Infinity;
        for (const f of facesRef.current) {
          let sum = 0;
          for (let i = 0; i < descArray.length; i++) {
            const d = descArray[i] - f.descriptor[i];
            sum += d * d;
          }
          const dist = Math.sqrt(sum);
          if (dist < threshold && dist < bestDist) {
            bestDist = dist;
            matched = { name: f.name };
          }
        }

        if (matched && s.enabled) {
          setLiveStatus("verified");
          if (unknownTimerRef.current) {
            clearTimeout(unknownTimerRef.current);
            unknownTimerRef.current = null;
          }
          alertSentRef.current = false;
          const now = Date.now();
          if (now - speechCooldownRef.current.welcome > WELCOME_COOLDOWN_MS) {
            speechCooldownRef.current.welcome = now;
            speechCooldownRef.current.warning = 0;
            try {
              if (typeof window !== "undefined" && window.speechSynthesis && !store.isMuted) {
                const u = new SpeechSynthesisUtterance(`Access granted. Welcome back, ${matched.name}.`);
                u.rate = 1;
                u.pitch = 1;
                window.speechSynthesis.speak(u);
              }
            } catch {}
          }
        } else if (matched && !s.enabled) {
          // Face known but system disarmed — just show presence.
          setLiveStatus("scanning");
          if (unknownTimerRef.current) {
            clearTimeout(unknownTimerRef.current);
            unknownTimerRef.current = null;
          }
        } else {
          // Unknown face
          setLiveStatus(s.enabled ? "intruder" : "scanning");
          if (s.enabled) {
            const now = Date.now();
            if (
              !s.stealthMode &&
              now - speechCooldownRef.current.warning > WARNING_COOLDOWN_MS
            ) {
              speechCooldownRef.current.warning = now;
              try {
                if (typeof window !== "undefined" && window.speechSynthesis && !store.isMuted) {
                  window.speechSynthesis.cancel();
                  const u = new SpeechSynthesisUtterance("Warning. Unidentified subject detected.");
                  u.rate = 1;
                  window.speechSynthesis.speak(u);
                }
              } catch {}
            }

            if (!unknownTimerRef.current && !alertSentRef.current) {
              unknownTimerRef.current = setTimeout(async () => {
                unknownTimerRef.current = null;
                if (!runningRef.current || alertSentRef.current) return;
                const v = videoRef.current;
                if (!v) return;
                alertSentRef.current = true;
                await triggerAlert(v);
              }, ALERT_DELAY_MS);
            }
          }
        }
      }
    } catch (err) {
      console.error("[SentinelWatcher] detection error:", err);
    }

    if (runningRef.current) {
      loopTimerRef.current = setTimeout(tick, DETECT_INTERVAL_MS);
    }
  }, [acquireCamera, releaseCamera, setLiveStatus, triggerAlert]);

  // ─── arm / disarm lifecycle ───────────────────────────────────────────────
  useEffect(() => {
    if (!armed) {
      runningRef.current = false;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (unknownTimerRef.current) clearTimeout(unknownTimerRef.current);
      escalateTimersRef.current.forEach(clearTimeout);
      escalateTimersRef.current = [];
      releaseCamera();
      setLiveStatus("idle");
      return;
    }

    let cancelled = false;
    void cancelled;
    runningRef.current = true;
    alertSentRef.current = false;

    const settingsInterval: ReturnType<typeof setInterval> = setInterval(() => {
      if (runningRef.current) syncFromServer();
    }, 15_000);

    void Promise.all([syncFromServer(), Promise.resolve(loadFaces())]);

    tick();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      if (unknownTimerRef.current) clearTimeout(unknownTimerRef.current);
      escalateTimersRef.current.forEach(clearTimeout);
      escalateTimersRef.current = [];
      clearInterval(settingsInterval);
      releaseCamera();
      setLiveStatus("idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed]);

  // Listen for face registration changes from the panel
  useEffect(() => {
    const onFocus = () => loadFaces();
    window.addEventListener("jarvis-faces-updated", onFocus as EventListener);
    return () => window.removeEventListener("jarvis-faces-updated", onFocus as EventListener);
  }, [loadFaces]);

  return null; // headless hook — UI reads the store
}
