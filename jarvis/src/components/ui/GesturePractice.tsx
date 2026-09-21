"use client";

// Gesture Practice — live pose-detection overlay to calibrate the gestures.
// Shows the camera feed with the 21-point MediaPipe skeleton drawn on top,
// live pinch/fist meters, the currently-classified pose, and the fps.
//
// Two modes:
//  - own:   practice itself owns the camera (via the vision lock).
//  - share: another feature (air-mouse / DJ) holds the camera — practice
//           becomes a read-only MONITOR tapping into the module-level
//           handTelemetry stream (their video element + landmarks), so you
//           can watch what DJ/air-mouse sees, including popped-out into the
//           always-on-top PiP window, WITHOUT stealing the camera.
//
// The pop-out button (Document Picture-in-Picture) moves the stage into an
// always-on-top mini window — which also keeps tracking alive while other
// apps are focused.

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hand, X, ExternalLink, Camera, Eye } from "lucide-react";
import {
  useHandControl,
  handTelemetry,
  HandFrame,
} from "@/hooks/useHandControl";
import type { NormalizedLandmark } from "@mediapipe/hands";
import { claimVision, releaseVision, visionHolder, onVisionLockChange } from "@/lib/visionLock";
import { pipSupported, openPiPWith, pipWindow } from "@/lib/documentPiP";

// Hand skeleton connections (MediaPipe Hands topology).
const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

type Pose = "none" | "point" | "two" | "thumb" | "fist" | "palm";

function classify(f: HandFrame): Pose {
  const { fingers } = f;
  if (fingers.index && fingers.middle && fingers.ring && fingers.pinky) return "palm";
  if (!fingers.index && !fingers.middle && !fingers.ring && f.fist > 0.65) return "fist";
  if (fingers.index && fingers.middle && !fingers.ring) return "two";
  if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring) return "thumb";
  if (fingers.index && !fingers.middle && !fingers.ring) return "point";
  return "none";
}

const POSE_HINT: Record<Pose, string> = {
  point: "POINT → cursor moves",
  two: "TWO FINGERS → scroll mode",
  thumb: "THUMB → right-click",
  fist: "FIST → DJ play/pause / alt-tab swipe",
  palm: "OPEN PALM (hold 1s) → panic freeze",
  none: "unrecognized — spread your fingers",
};

/** Derive a display frame from raw landmarks (share mode — no hysteresis). */
function frameFromLandmarks(lm: NormalizedLandmark[], fps: number): HandFrame {
  const tip = lm[8];
  const thumb = lm[4];
  const pinchDist = Math.hypot(tip.x - thumb.x, tip.y - thumb.y);
  const palmX = (lm[0].x + lm[5].x + lm[17].x) / 3;
  const palmY = (lm[0].y + lm[5].y + lm[17].y) / 3;
  const scale = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y) || 1e-6;
  const TIPS = [8, 12, 16, 20];
  const PIPS = [5, 9, 13, 17];
  let curl = 0;
  for (let i = 0; i < 4; i++) {
    curl +=
      Math.hypot(lm[TIPS[i]].x - palmX, lm[TIPS[i]].y - palmY) /
      (Math.hypot(lm[PIPS[i]].x - palmX, lm[PIPS[i]].y - palmY) || 1e-6);
  }
  curl /= 4;
  const fist = Math.max(0, Math.min(1, (0.72 - curl) / 0.32));
  const wrist = lm[0];
  const d = (a: NormalizedLandmark, b: NormalizedLandmark) => Math.hypot(a.x - b.x, a.y - b.y);
  const ext = (t: number, p: number) => d(lm[t], wrist) > d(lm[p], wrist) * 1.08;
  return {
    x: 1 - tip.x,
    y: tip.y,
    pinch: Math.max(0, Math.min(1, 1 - pinchDist / 0.18)),
    fist,
    fingers: {
      thumb: d(lm[4], lm[9]) / scale > 0.95,
      index: ext(8, 6),
      middle: ext(12, 10),
      ring: ext(16, 14),
      pinky: ext(20, 18),
    },
    handFound: true,
    fps,
  };
}

export default function GesturePractice() {
  const [mode, setMode] = useState<"off" | "own" | "share">("off");
  const [frame, setFrame] = useState<HandFrame | null>(null);
  const [pip, setPip] = useState(false);
  const [pipErr, setPipErr] = useState("");
  const [holder, setHolder] = useState<string>("");

  const stageRef = useRef<HTMLDivElement | null>(null); // video+canvas wrapper (movable to PiP)
  const videoSlotRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleFrame = useCallback((f: HandFrame) => setFrame(f), []);
  const { ready, error, landmarksRef, videoElRef } = useHandControl({
    enabled: mode === "own",
    onFrame: handleFrame,
  });

  // ─── Vision lock: own the camera if free, otherwise share the stream ────
  useEffect(() => {
    if (mode === "off") return;
    // Already sharing or owning — just keep an eye on the lock.
    const off = onVisionLockChange((h) => {
      setHolder(h ?? "");
      if (!h && mode === "share") {
        // Owner released — upgrade to owning the camera.
        if (claimVision("practice")) setMode("own");
      }
    });
    return off;
  }, [mode]);

  useEffect(() => {
    if (mode !== "off") return;
    setFrame(null);
    setPipErr("");
  }, [mode]);

  const enable = useCallback(() => {
    setPipErr("");
    if (claimVision("practice")) {
      setHolder("practice");
      setMode("own");
    } else {
      const h = visionHolder() ?? "another feature";
      setHolder(h);
      setMode("share"); // read-only monitor of the active feature's stream
    }
  }, []);

  const disable = useCallback(() => {
    releaseVision("practice");
    setMode("off");
  }, []);

  // ─── Video element routing (own element or the owner's, via telemetry) ──
  useEffect(() => {
    if (mode === "off") return;
    const slot = videoSlotRef.current;
    if (!slot) return;
    let attached: HTMLVideoElement | null = null;

    const tryAttach = () => {
      const v = mode === "own" ? videoElRef.current : handTelemetry.videoEl;
      if (!v) return false;
      if (v.parentNode !== slot) {
        v.style.width = "100%";
        v.style.height = "100%";
        v.style.objectFit = "cover";
        v.style.transform = "scaleX(-1)"; // mirrored like a mirror
        slot.appendChild(v);
        attached = v;
      }
      return true;
    };
    tryAttach();
    // Share mode: the owner's stream may start after we open — keep trying.
    const iv = setInterval(tryAttach, 500);
    return () => {
      clearInterval(iv);
      if (attached && attached.parentNode === slot) slot.removeChild(attached);
    };
  }, [mode, ready, videoElRef]);

  // ─── Skeleton painting (own landmarks or telemetry landmarks) ───────────
  useEffect(() => {
    if (mode === "off") return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      const lm = mode === "own" ? landmarksRef.current : handTelemetry.landmarks;
      if (!lm) return;
      // Mirrored mapping to match the flipped video.
      const px = (p: { x: number; y: number }) => [(1 - p.x) * W, p.y * H] as const;
      ctx.strokeStyle = "rgba(0,212,255,0.9)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const [a, b] of CONNECTIONS) {
        const [ax, ay] = px(lm[a]);
        const [bx, by] = px(lm[b]);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      for (let i = 0; i < lm.length; i++) {
        const [x, y] = px(lm[i]);
        ctx.beginPath();
        ctx.arc(x, y, i === 8 ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Index fingertip halo — the cursor point.
      const [tx, ty] = px(lm[8]);
      ctx.strokeStyle = "rgba(0,212,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(tx, ty, 12, 0, Math.PI * 2);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode, landmarksRef]);

  // ─── Share mode: derive meters/pose from telemetry at ~10Hz ─────────────
  useEffect(() => {
    if (mode !== "share") return;
    const iv = setInterval(() => {
      const lm = handTelemetry.landmarks;
      if (!lm) return setFrame(null);
      setFrame(frameFromLandmarks(lm, handTelemetry.fps));
    }, 100);
    return () => clearInterval(iv);
  }, [mode]);

  // ─── PiP pop-out — move the whole stage into the always-on-top window ───
  const popOut = useCallback(async () => {
    try {
      setPipErr("");
      if (pipWindow()) return;
      if (!stageRef.current) return;
      await openPiPWith([stageRef.current], { width: 340, height: 300 });
      setPip(true);
    } catch (e) {
      setPipErr(String((e as Error).message || e));
    }
  }, []);

  // Track PiP closure.
  useEffect(() => {
    const id = setInterval(() => {
      if (!pipWindow() && pip) setPip(false);
    }, 600);
    return () => clearInterval(id);
  }, [pip]);

  const pose: Pose = frame ? classify(frame) : "none";
  const waiting = mode === "share" && !handTelemetry.videoEl;

  return (
    <>
      {/* Toggle — top of the bottom-right stack */}
      <motion.button
        onClick={() => (mode === "off" ? enable() : disable())}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Gesture practice — see what the camera sees (Ctrl+Shift+P)"
        className={`fixed bottom-[22.5rem] right-6 z-50 p-3 rounded-full transition-colors ${
          mode !== "off"
            ? "bg-reactor-core text-deep-space"
            : "bg-panel-glass text-text-secondary hover:bg-panel-border"
        }`}
      >
        {mode === "share" ? <Eye className="w-5 h-5" /> : <Hand className="w-5 h-5" />}
      </motion.button>

      <AnimatePresence>
        {mode !== "off" && (
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            className="fixed bottom-[25rem] right-6 z-50 w-64 rounded-2xl border border-panel-border/60 bg-deep-space/90 backdrop-blur-md p-3 shadow-[0_0_30px_rgba(0,212,255,0.08)]"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-orbitron text-[10px] tracking-[0.25em] text-text-secondary/70">
                {mode === "share" ? `MONITOR · ${holder}` : "GESTURE PRACTICE"}
              </span>
              <div className="flex items-center gap-1.5">
                {pipSupported() && (
                  <button
                    onClick={popOut}
                    title="Pop out — always-on-top monitor (keep tracking while other apps are focused)"
                    className="text-text-secondary/60 hover:text-reactor-core"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={disable} className="text-text-secondary/60 hover:text-text-secondary">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Camera + skeleton stage (this whole node moves to PiP) */}
            <div
              ref={stageRef}
              className="relative rounded-xl overflow-hidden border border-panel-border/50 bg-black aspect-[4/3]"
            >
              <div ref={videoSlotRef} className="absolute inset-0" />
              <canvas ref={canvasRef} width={320} height={240} className="absolute inset-0 w-full h-full" />
              {(mode === "own" && (!ready || error)) || waiting ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 font-rajdhani text-[11px] text-text-secondary/70">
                  <Camera className="w-5 h-5 mb-1 opacity-60" />
                  {mode === "own"
                    ? error
                      ? error.slice(0, 60)
                      : "starting camera…"
                    : `waiting for ${holder}'s camera…`}
                </div>
              ) : null}
            </div>

            {/* Meters */}
            <div className="mt-2.5 space-y-1.5">
              <Meter label="pinch" value={frame?.pinch ?? 0} color="#00d4ff" />
              <Meter label="fist" value={frame?.fist ?? 0} color="#ff6b81" />
            </div>

            {/* Pose readout */}
            <div className="mt-2.5 pt-2 border-t border-panel-border/40">
              <div
                className={`font-rajdhani text-[11px] font-semibold ${
                  frame?.handFound ? "text-reactor-core" : "text-text-secondary/50"
                }`}
              >
                {frame?.handFound ? POSE_HINT[pose] : "show your hand ✋"}
              </div>
              <div className="font-rajdhani text-[10px] text-text-secondary/45 mt-0.5">
                {frame ? `${frame.fps | 0} fps` : "—"} {pip ? "· popped out ↗" : ""}
                {mode === "share" ? " · watch-only" : ""}
              </div>
              {pipErr && <div className="font-rajdhani text-[10px] text-accent-red mt-1">{pipErr}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-rajdhani text-[10px] text-text-secondary/55 w-9">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-panel-border/40 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-75"
          style={{ width: `${Math.round(value * 100)}%`, background: color, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
      <span className="font-rajdhani text-[10px] text-text-secondary/45 w-7 text-right">
        {Math.round(value * 100)}
      </span>
    </div>
  );
}
