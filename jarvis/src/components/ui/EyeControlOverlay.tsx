"use client";

// Eye control overlay — two ways to drive with your eyes:
//
//  1. TARGETS (original): dwell targets float on the right edge. Look and
//     hold ~1.2s → ring fills → panel opens.
//  2. CURSOR (new): your calibrated gaze drives the REAL OS cursor
//     everywhere (via /api/os/input). Blink (<450ms) = left click; keep
//     eyes closed longer = nothing (cursor also holds still while closed —
//     closed-eye gaze signals are garbage, so we simply stop updating).
//
// The cursor mode requires a one-time 9-point calibration ritual: look at
// each dot until it fills; an affine map (least-squares fit) is computed and
// persisted. Recalibrate any time — lighting/position changes drift the map.

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Crosshair, Ruler, X } from "lucide-react";
import { useEyeControl, GazeFrame } from "@/hooks/useEyeControl";
import {
  CALIB_POINTS,
  fitAffine,
  mapGaze,
  saveCalibration,
  loadCalibration,
  clearCalibration,
  GazePoint,
  AffineCoeffs,
} from "@/lib/eyeCalibration";
import { OneEuroFilter } from "@/lib/oneEuro";
import { claimVision, releaseVision, visionHolder, onVisionLockChange } from "@/lib/visionLock";

const DWELL_MS = 1200; // target dwell
const CALIB_DWELL_MS = 950; // per calibration point
const CURSOR_SEND_MS = 40; // ~25 cursor updates/sec
const BLINK_MAX_MS = 450; // shorter than this = a click
const BLINK_OPEN = 0.62; // openness above = eyes open
const BLINK_CLOSED = 0.32; // openness below = eyes closed
const BLINK_COOLDOWN_MS = 650;

type UiMode = "targets" | "cursor" | "calib";

interface Target {
  id: string;
  label: string;
  x: number;
  y: number;
  action?: () => void;
}

export default function EyeControlOverlay(props: {
  onOpenSpotify?: () => void;
  onOpenWeather?: () => void;
  onOpenNews?: () => void;
  onOpenCalendar?: () => void;
  onOpenVoiceNotes?: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [uiMode, setUiMode] = useState<UiMode>("targets");
  const [gaze, setGaze] = useState<GazeFrame | null>(null);
  const [hasCalib, setHasCalib] = useState(false);
  const [calibQuality, setCalibQuality] = useState<number | null>(null);
  const [clickFlash, setClickFlash] = useState(false);

  // Dwell-target state
  const dwellProgress = useRef<Record<string, number>>({});
  const [activeRing, setActiveRing] = useState<{ id: string; pct: number } | null>(null);
  const lastFrame = useRef<number>(0);

  // Cursor mode engine state
  const fx = useRef(new OneEuroFilter(0.9, 0.012));
  const fy = useRef(new OneEuroFilter(0.9, 0.012));
  const coeffs = useRef<AffineCoeffs | null>(loadCalibration());
  const lastSend = useRef(0);

  // Blink-click state
  const eyesOpen = useRef(true);
  const closedAt = useRef<number | null>(null);
  const lastClick = useRef(0);

  // Calibration state
  const [calibStep, setCalibStep] = useState(0);
  const [calibPct, setCalibPct] = useState(0);
  const calibAccum = useRef<{ h: number; v: number; n: number }>({ h: 0, v: 0, n: 0 });
  const calibSamples = useRef<GazePoint[]>([]);

  const targetsRef = useRef<Target[]>([]);
  targetsRef.current = [
    { id: "spotify", label: "Spotify", x: 0.88, y: 0.3, action: props.onOpenSpotify },
    { id: "weather", label: "Weather", x: 0.88, y: 0.45, action: props.onOpenWeather },
    { id: "news", label: "News", x: 0.88, y: 0.6, action: props.onOpenNews },
    { id: "calendar", label: "Calendar", x: 0.88, y: 0.75, action: props.onOpenCalendar },
    { id: "notes", label: "Voice Notes", x: 0.88, y: 0.9, action: props.onOpenVoiceNotes },
  ];

  const sendInput = useCallback((body: object) => {
    fetch("/api/os/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, []);

  const handleFrame = useCallback(
    (g: GazeFrame) => {
      setGaze(g);
      const now = performance.now();
      const dt = lastFrame.current ? now - lastFrame.current : 16;
      lastFrame.current = now;

      if (!g.faceFound) {
        setActiveRing(null);
        dwellProgress.current = {};
        return;
      }

      // ─── Calibration ritual ──────────────────────────────────────────────
      if (uiMode === "calib") {
        const [sx, sy] = CALIB_POINTS[calibStep];
        const near = Math.hypot(g.x - sx, g.y - sy) < 0.14;
        if (near) {
          calibAccum.current.h += g.rawH;
          calibAccum.current.v += g.rawV;
          calibAccum.current.n += 1;
          const prev = calibPct;
          const pct = Math.min(1, prev + dt / CALIB_DWELL_MS);
          setCalibPct(pct);
          if (pct >= 1) {
            if (calibAccum.current.n > 3) {
              calibSamples.current.push({
                h: calibAccum.current.h / calibAccum.current.n,
                v: calibAccum.current.v / calibAccum.current.n,
                sx,
                sy,
              });
            }
            calibAccum.current = { h: 0, v: 0, n: 0 };
            setCalibPct(0);
            if (calibStep + 1 >= CALIB_POINTS.length) {
              const fit = fitAffine(calibSamples.current);
              if (fit && fit.residual < 0.18) {
                coeffs.current = fit.coeffs;
                saveCalibration(fit.coeffs);
                setHasCalib(true);
                setCalibQuality(fit.residual);
                setUiMode("cursor");
              } else {
                // Too noisy — restart the ritual.
                calibSamples.current = [];
                setCalibStep(0);
                setCalibPct(0);
              }
            } else {
              setCalibStep((s) => s + 1);
            }
          }
        } else {
          // Gaze wandered off the dot — decay gently but keep accumulation
          // reset so a stray glance doesn't pollute the average.
          calibAccum.current = { h: 0, v: 0, n: 0 };
          setCalibPct((p) => Math.max(0, p - dt / (CALIB_DWELL_MS * 2)));
        }
        return;
      }

      // ─── Cursor mode: calibrated gaze → OS cursor + blink click ─────────
      if (uiMode === "cursor" && coeffs.current) {
        const open = g.openness > BLINK_OPEN;
        const closed = g.openness < BLINK_CLOSED;

        if (closed) {
          if (eyesOpen.current) {
            eyesOpen.current = false;
            closedAt.current = now;
          }
          // Eyes closed → gaze signal unreliable; hold cursor still.
          return;
        }

        if (!eyesOpen.current && open) {
          // Just reopened — was it a blink-click?
          const dur = closedAt.current ? now - closedAt.current : Infinity;
          eyesOpen.current = true;
          closedAt.current = null;
          if (dur < BLINK_MAX_MS && now - lastClick.current > BLINK_COOLDOWN_MS) {
            lastClick.current = now;
            sendInput({ action: "click" });
            setClickFlash(true);
            setTimeout(() => setClickFlash(false), 220);
            return; // don't jump the cursor on the same frame
          }
        }

        // Throttled, filtered cursor drive.
        if (now - lastSend.current >= CURSOR_SEND_MS) {
          lastSend.current = now;
          const { x, y } = mapGaze(coeffs.current, g.rawH, g.rawV);
          const sx = fx.current.filter(x, now);
          const sy = fy.current.filter(y, now);
          sendInput({ action: "move", nx: sx, ny: sy });
        }
        return;
      }

      // ─── Targets mode (original dwell behavior) ──────────────────────────
      const hit = targetsRef.current.find((t) => Math.hypot(t.x - g.x, t.y - g.y) < 0.08);
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
        for (const k of Object.keys(dwellProgress.current)) {
          dwellProgress.current[k] = Math.max(0, (dwellProgress.current[k] || 0) - dt * 2);
        }
      }
    },
    [uiMode, calibStep, calibPct, sendInput]
  );

  // Claim the shared webcam lock while enabled — air-mouse/DJ/practice may hold it.
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

  // Ctrl+E toggles the feature; Ctrl+Shift+E toggles cursor mode.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (e.shiftKey) {
          setUiMode((m) => (m === "cursor" ? "targets" : "cursor"));
        } else {
          setEnabled((v) => !v);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setHasCalib(!!loadCalibration());
    localStorage.setItem("jarvis:eye-control", enabled ? "1" : "0");
  }, [enabled]);

  const startCalib = useCallback(() => {
    calibSamples.current = [];
    calibAccum.current = { h: 0, v: 0, n: 0 };
    setCalibStep(0);
    setCalibPct(0);
    fx.current.reset();
    fy.current.reset();
    setUiMode("calib");
  }, []);

  return (
    <>
      {/* Toggle button — bottom-right stack */}
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
            {/* ── Dwell targets (targets mode) ── */}
            {uiMode === "targets" &&
              targetsRef.current.map((t) => {
                const ring = activeRing?.id === t.id ? activeRing.pct : 0;
                const cooling = (dwellProgress.current[t.id] || 0) < 0;
                return (
                  <div
                    key={t.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2"
                    style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                  >
                    <div className="relative w-16 h-16 flex items-center justify-center">
                      <svg className="absolute inset-0 w-full h-full -rotate-90">
                        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(0,212,255,0.15)" strokeWidth="2" />
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

            {/* ── Gaze cursor dot (targets + cursor modes) ── */}
            {uiMode !== "calib" && gaze?.faceFound && (
              <div
                className={`absolute w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-75 ${
                  uiMode === "cursor"
                    ? "bg-[#00FF9D]/90 shadow-[0_0_12px_rgba(0,255,157,0.8)]"
                    : "bg-reactor-core/80 shadow-[0_0_12px_rgba(0,212,255,0.8)]"
                }`}
                style={{ left: `${gaze.x * 100}%`, top: `${gaze.y * 100}%` }}
              />
            )}
            {uiMode === "cursor" && clickFlash && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-10 h-10 rounded-full border-2 border-[#00FF9D] animate-ping" />
              </div>
            )}

            {/* ── Calibration ritual ── */}
            {uiMode === "calib" && (
              <div className="absolute inset-0 bg-deep-space/95">
                {CALIB_POINTS.map(([x, y], i) => {
                  const active = i === calibStep;
                  const done = i < calibStep;
                  return (
                    <div
                      key={i}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                    >
                      <div className="relative w-14 h-14 flex items-center justify-center">
                        {active && (
                          <svg className="absolute inset-0 w-full h-full -rotate-90">
                            <circle cx="28" cy="28" r="24" fill="none" stroke="rgba(0,212,255,0.2)" strokeWidth="3" />
                            <circle
                              cx="28"
                              cy="28"
                              r="24"
                              fill="none"
                              stroke="#00D4FF"
                              strokeWidth="4"
                              strokeDasharray={`${2 * Math.PI * 24}`}
                              strokeDashoffset={`${2 * Math.PI * 24 * (1 - calibPct)}`}
                              strokeLinecap="round"
                            />
                          </svg>
                        )}
                        <div
                          className={`w-4 h-4 rounded-full ${
                            done ? "bg-[#00FF9D]" : active ? "bg-reactor-core animate-pulse" : "bg-panel-border/60"
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
                <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center">
                  <div className="font-orbitron text-xs tracking-[0.3em] text-reactor-core">
                    EYE CALIBRATION
                  </div>
                  <div className="font-rajdhani text-sm text-text-secondary mt-1">
                    Look at the glowing dot until the ring fills — keep your head still
                  </div>
                  <div className="font-rajdhani text-[11px] text-text-secondary/50 mt-0.5">
                    point {calibStep + 1} / {CALIB_POINTS.length}
                  </div>
                </div>
                <button
                  onClick={() => setUiMode(coeffs.current ? "cursor" : "targets")}
                  className="absolute top-5 left-5 pointer-events-auto flex items-center gap-1.5 font-rajdhani text-xs text-text-secondary/60 hover:text-text-secondary border border-panel-border/50 rounded-full px-3 py-1.5 bg-deep-space/70"
                >
                  <X className="w-4 h-4" /> EXIT CALIBRATION
                </button>
              </div>
            )}

            {/* ── Control strip ── */}
            <div className="absolute top-16 right-5 flex flex-col items-end gap-1.5">
              <div className="font-rajdhani text-xs text-text-secondary/70 bg-deep-space/70 border border-panel-border/50 rounded-full px-3 py-1">
                {lockStatus
                  ? `EYES: ${lockStatus}`
                  : error
                  ? `EYES: ${error}`
                  : ready
                  ? gaze?.faceFound
                    ? uiMode === "cursor"
                      ? hasCalib
                        ? "CURSOR: gaze drives mouse · blink = click"
                        : "CURSOR: calibrate first"
                      : "EYES: tracking — hold gaze to open"
                    : "EYES: searching for face…"
                  : "EYES: loading models…"}
              </div>

              {uiMode !== "calib" && (
                <div className="flex items-center gap-1.5 pointer-events-auto">
                  <button
                    onClick={() => setUiMode((m) => (m === "cursor" ? "targets" : "cursor"))}
                    className={`flex items-center gap-1.5 font-rajdhani text-[11px] px-3 py-1.5 rounded-full border transition-colors ${
                      uiMode === "cursor"
                        ? "bg-[#00FF9D]/15 border-[#00FF9D]/50 text-[#00FF9D]"
                        : "bg-deep-space/70 border-panel-border/50 text-text-secondary/80 hover:text-text-secondary"
                    }`}
                    title="Gaze drives the real OS cursor everywhere · Ctrl+Shift+E"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                    CURSOR {uiMode === "cursor" ? "ON" : "OFF"}
                  </button>
                  <button
                    onClick={startCalib}
                    className="flex items-center gap-1.5 font-rajdhani text-[11px] px-3 py-1.5 rounded-full border bg-deep-space/70 border-panel-border/50 text-text-secondary/80 hover:text-text-secondary"
                    title="9-point eye calibration ritual"
                  >
                    <Ruler className="w-3.5 h-3.5" />
                    {hasCalib ? "RECALIBRATE" : "CALIBRATE"}
                  </button>
                  {hasCalib && calibQuality !== null && (
                    <span className="font-rajdhani text-[10px] text-text-secondary/40 px-1">
                      fit ±{(calibQuality * 100).toFixed(0)}
                    </span>
                  )}
                  {hasCalib && (
                    <button
                      onClick={() => {
                        clearCalibration();
                        coeffs.current = null;
                        setHasCalib(false);
                        setUiMode("targets");
                      }}
                      className="font-rajdhani text-[10px] text-text-secondary/40 hover:text-accent-red px-1"
                      title="Delete saved calibration"
                    >
                      reset
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
