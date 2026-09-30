"use client";

// Gesture DJ — control Spotify Free (or any media app) from across the room.
//   Swipe right → next track     Swipe left → previous track
//   Hold a fist  → play/pause    Works with the FREE Spotify desktop app
//
// Runs on hardware media keys via /api/os/media (Windows SMTC chain), so no
// Spotify Premium / Web Playback SDK is needed — whatever owns media focus
// (Spotify desktop, YouTube tab, VLC) receives the transport.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Disc3, Music2, SkipForward, SkipBack, Pause, Play } from "lucide-react";
import { useHandControl, HandFrame } from "@/hooks/useHandControl";
import {
  claimVision,
  releaseVision,
  visionHolder,
  onVisionLockChange,
} from "@/lib/visionLock";

// Tuned for real-world tracking. THE CORE RULE: a STILL fist pauses, a
// MOVING fist swipes — motion blur during a swipe momentarily spikes the
// fist metric, and the old code let the pause timer accumulate through it
// ("every swipe paused the music"). The pause now only accrues while the
// hand is genuinely stationary (fist speed below SWIPE_VEL), and any
// qualifying swipe cancels a pending pause.
const SWIPE_VEL = 0.5; // normalized x units/sec — deliberate swipe speed
const SWIPE_MIN_TRAVEL = 0.11; // and at least this far in x
const SWIPE_COOLDOWN_MS = 500;
const SWIPE_TRAIL_MS = 300; // velocity window — must span several frames
const FIST_ON = 0.55; // loose fist counts (min-based metric)
const FIST_OFF = 0.38; // hysteresis
const FIST_HOLD_MS = 500; // hold STILL this long to toggle (350ms armed during swipe wind-up → pause+next double-fire = "track changes but stays paused")
const FIST_COOLDOWN_MS = 700;
const DEADMAN_MS = 800; // hand lost → abort any pending gesture

export default function GestureDJ() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const [flash, setFlash] = useState<{ icon: "next" | "prev" | "toggle"; ts: number } | null>(null);

  const lastFrame = useRef<HandFrame | null>(null);
  const lastSeen = useRef(0);

  // Swipe state
  const trail = useRef<Array<{ x: number; t: number }>>([]);
  const lastSwipe = useRef(0);

  // Fist state
  const fistDown = useRef(false);
  const fistSince = useRef<number | null>(null); // set only while STILL
  const lastFistFire = useRef(0);
  const lastPauseAt = useRef(0); // swipes are suppressed briefly after a pause
  const fistSeenOpen = useRef(true); // after a swipe, a closed fist must release once before it can pause

  const fire = useCallback(async (action: "next" | "prev" | "play-pause") => {
    try {
      const res = await fetch("/api/os/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json()) as { success?: boolean; error?: string };
      if (!j.success) setStatus(`media: ${j.error ?? "transport failed"}`);
    } catch {
      setStatus("media transport unreachable");
    }
    setFlash({ icon: action === "next" ? "next" : action === "prev" ? "prev" : "toggle", ts: Date.now() });
  }, []);

  const handleFrame = useCallback(
    (f: HandFrame) => {
      lastFrame.current = f;
      const now = performance.now();

      if (!f.handFound) {
        // Brief tracking dropouts (fast swipes blur or leave the crop) must
        // NOT wipe the swipe trail — only a real absence (DEADMAN) resets.
        if (now - lastSeen.current > DEADMAN_MS) {
          setStatus("show your hand ✋");
          trail.current = [];
          fistDown.current = false;
          fistSince.current = null;
        }
        return;
      }
      lastSeen.current = now;

      // ── Swipe → next/prev (velocity over a short trail) ──
      trail.current.push({ x: f.x, t: now });
      while (trail.current.length > 2 && now - trail.current[0].t > SWIPE_TRAIL_MS) {
        trail.current.shift();
      }
      let fistSpeed = 0;
      if (trail.current.length >= 2) {
        const first = trail.current[0];
        const last = trail.current[trail.current.length - 1];
        const dt = (last.t - first.t) / 1000;
        if (dt > 0.02) fistSpeed = Math.abs(last.x - first.x) / dt;
      }

      // ── Fist → play/pause — ONLY while the fist is still ──
      if (f.fist < FIST_OFF) fistSeenOpen.current = true;
      if (!fistDown.current && f.fist > FIST_ON && fistSeenOpen.current && fistSpeed < SWIPE_VEL && now - lastFistFire.current > FIST_COOLDOWN_MS) {
        fistDown.current = true;
        fistSince.current = now;
        fistSeenOpen.current = false;
      } else if (fistDown.current && (f.fist < FIST_OFF || fistSpeed >= SWIPE_VEL)) {
        // Opened the hand, or the fist started moving (that's a swipe —
        // cancel the pause instead of firing it).
        fistDown.current = false;
        fistSince.current = null;
      }
      if (fistDown.current && fistSince.current !== null && now - fistSince.current >= FIST_HOLD_MS) {
        fistDown.current = false;
        fistSince.current = null;
        lastFistFire.current = now;
        lastPauseAt.current = now; // a pause just fired — swallow the trailing swipe
        trail.current = []; // a fresh pause shouldn't leave stale trail velocity
        fire("play-pause");
        setStatus("fist → play/pause");
        return;
      }

      // ── Swipe fires even with a closed hand — the speed gate above is
      // what separates the two intents now. A qualifying swipe also cancels
      // any pause that was still counting.
      if (
        trail.current.length >= 2 &&
        now - lastSwipe.current > SWIPE_COOLDOWN_MS &&
        now - lastPauseAt.current > 800
      ) {
        const first = trail.current[0];
        const last = trail.current[trail.current.length - 1];
        const dt = (last.t - first.t) / 1000;
        if (dt > 0.02) {
          const vel = (last.x - first.x) / dt;
          const travel = Math.abs(last.x - first.x);
          if (Math.abs(vel) > SWIPE_VEL && travel > SWIPE_MIN_TRAVEL) {
            lastSwipe.current = now;
            trail.current = [];
            fistDown.current = false;
            fistSince.current = null;
            fistSeenOpen.current = false; // swiped with a closed hand → must open before pausing
            if (vel > 0) {
              fire("next");
              setStatus("swipe → next track");
            } else {
              fire("prev");
              setStatus("swipe → previous track");
            }
          }
        }
      }
    },
    [fire]
  );

  // Claim/release the shared webcam lock while enabled — air-mouse or eyes
  // may hold it. Retries automatically when the holder releases.
  const [camGranted, setCamGranted] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setCamGranted(false);
      return;
    }
    if (claimVision("dj")) {
      setCamGranted(true);
      return () => releaseVision("dj");
    }
    setStatus(`camera busy — ${visionHolder()} is using it`);
    const off = onVisionLockChange((h) => {
      if (!h && enabled) {
        if (claimVision("dj")) {
          setCamGranted(true);
          setStatus("");
        }
      }
      if (h !== "dj") setCamGranted(false);
    });
    return off;
  }, [enabled]);

  const { ready, error } = useHandControl({ enabled: enabled && camGranted, onFrame: handleFrame });

  // Status ticker.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      const f = lastFrame.current;
      if (!f) return setStatus("warming up…");
      if (!f.handFound) return setStatus("show your hand ✋");
      if (f.fist > FIST_OFF) return setStatus("fist detected — hold it");
      setStatus(`swipe ⏭ ⏮ · fist ⏯ · ${f.fps | 0}fps`);
    }, 400);
    return () => clearInterval(t);
  }, [enabled]);

  // Ctrl+Shift+J toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Persist preference.
  useEffect(() => {
    localStorage.setItem("jarvis:gesture-dj", enabled ? "1" : "0");
  }, [enabled]);

  // Clear the gesture flash after a beat.
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(t);
  }, [flash]);

  return (
    <>
      {/* Toggle button — bottom-right stack under the narrator */}
      <motion.button
        onClick={() => setEnabled((v) => !v)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title={enabled ? "Disable Gesture DJ (Ctrl+Shift+J)" : "Enable Gesture DJ (Ctrl+Shift+J)"}
        className={`fixed bottom-[18.5rem] right-6 z-50 p-3 rounded-full transition-colors ${
          enabled ? "bg-reactor-core text-deep-space" : "bg-panel-glass text-text-secondary hover:bg-panel-border"
        }`}
      >
        {enabled ? <Music2 className="w-5 h-5" /> : <Disc3 className="w-5 h-5" />}
      </motion.button>

      {/* Status chip */}
      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed bottom-[18.5rem] right-[5.75rem] z-50 font-rajdhani text-xs text-text-secondary/80 bg-deep-space/70 border border-panel-border/50 rounded-full px-3 py-1.5 pointer-events-none"
          >
            {error
              ? "DJ: camera error"
              : ready
              ? `DJ: ${status}`
              : "DJ: loading model…"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Big gesture feedback flash */}
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.ts}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.4 }}
            className="fixed bottom-[20.5rem] right-6 z-50 p-3 rounded-full bg-reactor-core/20 border border-reactor-core/60 text-reactor-core pointer-events-none"
          >
            {flash.icon === "next" ? (
              <SkipForward className="w-6 h-6" />
            ) : flash.icon === "prev" ? (
              <SkipBack className="w-6 h-6" />
            ) : (
              <Pause className="w-6 h-6" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
