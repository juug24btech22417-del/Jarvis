"use client";

// Eye control overlay — the "look at a panel to open it" flex.
// Three dwell targets float on the right edge of the HUD. Look at one and
// hold your gaze ~1.2s → ring fills → panel opens. Toggle via StatusHUD eye
// button or Ctrl+E.

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff } from "lucide-react";
import { useEyeControl, GazeFrame } from "@/hooks/useEyeControl";
import { claimVision, releaseVision, visionHolder, onVisionLockChange } from "@/lib/visionLock";

interface Target {
  id: string;
  label: string;
  /** Screen position (normalized). */
  x: number;
  y: number;
  action?: () => void;
}

const DWELL_MS = 1200;

export default function EyeControlOverlay(props: {
  onOpenSpotify?: () => void;
  onOpenWeather?: () => void;
  onOpenNews?: () => void;
  onOpenCalendar?: () => void;
  onOpenVoiceNotes?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [gaze, setGaze] = useState<GazeFrame | null>(null);
  const dwellProgress = useRef<Record<string, number>>({});
  const [activeRing, setActiveRing] = useState<{ id: string; pct: number } | null>(null);
  const lastFrame = useRef<number>(0);

  const targetsRef = useRef<Target[]>([]);
  targetsRef.current = [
    { id: "spotify", label: "Spotify", x: 0.88, y: 0.3, action: props.onOpenSpotify },
    { id: "weather", label: "Weather", x: 0.88, y: 0.45, action: props.onOpenWeather },
    { id: "news", label: "News", x: 0.88, y: 0.6, action: props.onOpenNews },
    { id: "calendar", label: "Calendar", x: 0.88, y: 0.75, action: props.onOpenCalendar },
    { id: "notes", label: "Voice Notes", x: 0.88, y: 0.9, action: props.onOpenVoiceNotes },
  ];

  const handleFrame = useCallback((g: GazeFrame) => {
    setGaze(g);
    const now = performance.now();
    const dt = lastFrame.current ? now - lastFrame.current : 16;
    lastFrame.current = now;

    if (!g.faceFound) {
      setActiveRing(null);
      dwellProgress.current = {};
      return;
    }

    // Which target is under the gaze? (8% radius)
    const hit = targetsRef.current.find(
      (t) => Math.hypot(t.x - g.x, t.y - g.y) < 0.08
    );

    if (hit) {
      dwellProgress.current[hit.id] = (dwellProgress.current[hit.id] || 0) + dt;
      const pct = Math.min(1, dwellProgress.current[hit.id] / DWELL_MS);
      setActiveRing({ id: hit.id, pct });
      if (pct >= 1) {
        dwellProgress.current[hit.id] = -10000; // cooldown: don't retrigger
        hit.action?.();
      }
    } else {
      setActiveRing(null);
      // decay all progress slowly
      for (const k of Object.keys(dwellProgress.current)) {
        dwellProgress.current[k] = Math.max(0, (dwellProgress.current[k] || 0) - dt * 2);
      }
    }
  }, []);

  // Claim the shared webcam lock while enabled — air-mouse or gesture DJ may hold it.
  const [camGranted, setCamGranted] = useState(false);
  const [lockStatus, setLockStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setCamGranted(false);
      return;
    }
    if (claimVision("eyes")) {
      setCamGranted(true);
      return () => releaseVision("eyes");
    }
    setLockStatus(`camera busy — ${visionHolder()} is using it`);
    const off = onVisionLockChange((h) => {
      if (!h && enabled) {
        if (claimVision("eyes")) {
          setCamGranted(true);
          setLockStatus(null);
        }
      }
      if (h !== "eyes") setCamGranted(false);
    });
    return off;
  }, [enabled]);

  const { ready, error } = useEyeControl({ enabled: enabled && camGranted, onFrame: handleFrame });

  // Ctrl+E toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Persist preference.
  useEffect(() => {
    localStorage.setItem("jarvis:eye-control", enabled ? "1" : "0");
  }, [enabled]);

  return (
    <>
      {/* Toggle button — under the gesture camera button, bottom-right */}
      <motion.button
        onClick={() => setEnabled((v) => !v)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title={enabled ? "Disable eye control (Ctrl+E)" : "Enable eye control (Ctrl+E)"}
        className={`fixed bottom-[9.5rem] right-6 z-50 p-3 rounded-full transition-colors ${
          enabled
            ? "bg-reactor-core text-deep-space"
            : "bg-panel-glass text-text-secondary hover:bg-panel-border"
        }`}
      >
        {enabled ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
      </motion.button>

      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 pointer-events-none"
          >
            {/* Dwell targets */}
            {targetsRef.current.map((t) => {
              const ring = activeRing?.id === t.id ? activeRing.pct : 0;
              const cooling = (dwellProgress.current[t.id] || 0) < 0;
              return (
                <div
                  key={t.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                >
                  <div className="relative w-16 h-16 flex items-center justify-center">
                    {/* Dwell ring */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90">
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        fill="none"
                        stroke="rgba(0,212,255,0.15)"
                        strokeWidth="2"
                      />
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        fill="none"
                        stroke={cooling ? "#00FF9D" : "#00D4FF"}
                        strokeWidth="3"
                        strokeDasharray={`${2 * Math.PI * 28}`}
                        strokeDashoffset={`${2 * Math.PI * 28 * (1 - Math.max(0, ring))}`}
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="font-rajdhani text-[10px] tracking-wider text-text-secondary/80 bg-deep-space/60 px-2 py-0.5 rounded-full border border-panel-border/50">
                      {t.label}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Gaze cursor */}
            {gaze?.faceFound && (
              <div
                className="absolute w-3 h-3 rounded-full bg-reactor-core/80 shadow-[0_0_12px_rgba(0,212,255,0.8)] -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75"
                style={{ left: `${gaze.x * 100}%`, top: `${gaze.y * 100}%` }}
              />
            )}

            {/* Status chip */}
            <div className="absolute top-16 right-5 font-rajdhani text-xs text-text-secondary/70 bg-deep-space/70 border border-panel-border/50 rounded-full px-3 py-1">
              {lockStatus
                ? `EYES: ${lockStatus}`
                : error
                ? "EYES: camera error"
                : ready
                ? gaze?.faceFound
                  ? "EYES: tracking — hold gaze to open"
                  : "EYES: searching for face…"
                : "EYES: loading models…"}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
