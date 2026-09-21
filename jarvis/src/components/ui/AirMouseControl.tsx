"use client";

// Air-mouse + full air-gesture suite — one hand, one camera, whole laptop.
//
//   ☝️  index point ....... move cursor (One-Euro smoothed)
//   🤏 pinch .............. left click · hold = drag, release = drop
//   ✌️  index+middle ....... scroll (vertical hand travel → wheel)
//   👍 thumb out .......... right-click
//   ✊  fist + swipe ....... alt-tab between apps
//   🖐  open palm 1s ...... panic freeze (releases buttons, halts control)
//
// MediaPipe tracks the hand (useHandControl), a debounce state machine maps
// poses to modes, and /api/os/input drives the real Windows cursor/keys.

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hand, MousePointerClick } from "lucide-react";
import { useHandControl, HandFrame } from "@/hooks/useHandControl";
import { OneEuroFilter } from "@/lib/oneEuro";
import {
  claimVision,
  releaseVision,
  visionHolder,
  onVisionLockChange,
} from "@/lib/visionLock";

const MOVE_INTERVAL_MS = 40; // ~25 cursor updates/sec
const PINCH_ON = 0.75; // pinch strength to trigger click/drag
const PINCH_OFF = 0.5; // hysteresis — release must drop below this
const DEADMAN_MS = 700; // no hand → stop driving the cursor
const DEBOUNCE_FRAMES = 3; // consecutive frames before a pose becomes a mode
const DRAG_AFTER_MS = 320; // pinch held this long becomes a drag
const PALM_FREEZE_MS = 1000; // open-palm hold to trigger panic freeze
const SWIPE_THRESHOLD = 0.14; // fist horizontal travel to fire alt-tab
const SWIPE_COOLDOWN_MS = 600;
const RIGHTCLICK_COOLDOWN_MS = 900;

type Mode =
  | "idle" // no recognizable pose — hand present
  | "point" // index out → cursor follows
  | "drag" // pinch held long → button down
  | "scroll" // index+middle → wheel
  | "fist" // fist → alt-tab on swipe
  | "palm" // open palm → arming freeze
  | "frozen"; // panic freeze active

type Pose = "none" | "point" | "two" | "thumb" | "fist" | "palm";

interface LegendRow {
  key: string;
  icons: string;
  label: string;
  modes: Mode[];
}

const LEGEND: LegendRow[] = [
  { key: "point", icons: "☝️", label: "point · move", modes: ["point"] },
  { key: "pinch", icons: "🤏", label: "pinch · click / drag", modes: ["drag"] },
  { key: "two", icons: "✌️", label: "two fingers · scroll", modes: ["scroll"] },
  { key: "thumb", icons: "👍", label: "thumb · right-click", modes: [] },
  { key: "fist", icons: "✊", label: "fist + swipe · alt-tab", modes: ["fist"] },
  { key: "palm", icons: "🖐", label: "palm 1s · freeze", modes: ["palm", "frozen"] },
];

const MODE_LABEL: Record<Mode, string> = {
  idle: "ready",
  point: "move",
  drag: "drag",
  scroll: "scroll",
  fist: "alt-tab",
  palm: "arm freeze…",
  frozen: "frozen",
};

export default function AirMouseControl() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const [clickFlash, setClickFlash] = useState(false);
  const [mode, setMode] = useState<Mode>("idle");
  const [palmProgress, setPalmProgress] = useState(0); // 0..1 freeze arming

  // ─── Gesture engine state (refs — mutated at camera framerate) ───────────
  const fx = useRef(new OneEuroFilter(1.2, 0.007));
  const fy = useRef(new OneEuroFilter(1.2, 0.007));
  const lastMove = useRef(0);
  const lastSeen = useRef(0);

  const poseCandidate = useRef<Pose>("none");
  const poseCount = useRef(0);
  const modeRef = useRef<Mode>("idle");

  // pinch → click vs drag
  const pinching = useRef(false);
  const pinchStart = useRef(0);
  const dragArmed = useRef(false); // true once long-hold converted to drag

  // scroll accumulator
  const scrollAnchor = useRef(0);
  const scrollRemainder = useRef(0);

  // fist swipe
  const fistAnchorX = useRef(0);
  const lastSwipe = useRef(0);

  // palm freeze
  const palmStart = useRef(0);
  const unfreezeCounter = useRef(0);

  // thumb right-click
  const lastRightClick = useRef(0);

  const setModeBoth = (m: Mode) => {
    if (modeRef.current === m) return;
    modeRef.current = m;
    setMode(m);
  };

  /** Release any held OS button (drag cleanup / panic). */
  const releaseButtons = useCallback(() => {
    fetch("/api/os/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "up" }),
    }).catch(() => {});
  }, []);

  const sendInput = useCallback((body: object) => {
    fetch("/api/os/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }, []);

  const handleFrame = useCallback(
    (f: HandFrame) => {
      const now = performance.now();

      if (!f.handFound) {
        if (now - lastSeen.current > DEADMAN_MS) setStatus("show your hand ✋");
        return;
      }
      lastSeen.current = now;

      // ─── Pose classification ────────────────────────────────────────────
      const { fingers, pinch, fist } = f;
      let pose: Pose;
      if (fingers.index && fingers.middle && fingers.ring && fingers.pinky && fingers.thumb) {
        pose = "palm";
      } else if (!fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky && fist > 0.75) {
        pose = "fist";
      } else if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) {
        pose = "two";
      } else if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
        pose = "thumb";
      } else if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) {
        pose = "point";
      } else {
        pose = "none";
      }

      // Debounce: pose must hold DEBOUNCE_FRAMES consecutive frames.
      if (pose === poseCandidate.current) poseCount.current++;
      else {
        poseCandidate.current = pose;
        poseCount.current = 1;
      }
      const stable = poseCount.current >= DEBOUNCE_FRAMES ? pose : null;

      // ─── Panic freeze ───────────────────────────────────────────────────
      if (modeRef.current === "frozen") {
        // Any stable non-palm pose for a while resumes control.
        if (stable && stable !== "palm") {
          unfreezeCounter.current++;
          if (unfreezeCounter.current > 10) {
            unfreezeCounter.current = 0;
            setModeBoth("idle");
            setStatus("resumed");
          }
        } else unfreezeCounter.current = 0;
        return; // while frozen, never move the cursor or click
      }

      // ─── Palm arming (freeze progress) ──────────────────────────────────
      if (stable === "palm") {
        if (!palmStart.current) palmStart.current = now;
        const held = now - palmStart.current;
        setPalmProgress(Math.min(1, held / PALM_FREEZE_MS));
        if (held >= PALM_FREEZE_MS) {
          releaseButtons(); // safety: drop anything we're holding
          fx.current.reset();
          fy.current.reset();
          setPalmProgress(0);
          palmStart.current = 0;
          setModeBoth("frozen");
          setStatus("frozen — point to resume");
          return;
        }
      } else {
        palmStart.current = 0;
        setPalmProgress(0);
      }

      // ─── Mode transitions ───────────────────────────────────────────────
      if (stable && stable !== "none") {
        const cur = modeRef.current;
        if (stable === "two" && cur !== "scroll") {
          scrollAnchor.current = f.y;
          scrollRemainder.current = 0;
          setModeBoth("scroll");
        } else if (stable === "fist" && cur !== "fist") {
          fistAnchorX.current = f.x;
          setModeBoth("fist");
        } else if (stable === "point" && cur !== "point" && cur !== "drag") {
          setModeBoth("point");
        } else if (stable === "thumb" && cur !== "point" && cur !== "drag") {
          setModeBoth("idle");
          if (now - lastRightClick.current > RIGHTCLICK_COOLDOWN_MS) {
            lastRightClick.current = now;
            sendInput({ action: "click", button: "right" });
            setClickFlash(true);
            setTimeout(() => setClickFlash(false), 300);
          }
        }
      }

      // ─── Mode actions ───────────────────────────────────────────────────
      const m = modeRef.current;

      if (m === "point" || m === "drag" || m === "idle") {
        // Cursor follows the (filtered) fingertip whenever not scrolling.
        if (now - lastMove.current >= MOVE_INTERVAL_MS) {
          lastMove.current = now;
          const sx = fx.current.filter(f.x, now);
          const sy = fy.current.filter(f.y, now);
          sendInput({ action: "move", nx: sx, ny: sy });
        }

        // Pinch: quick = click, long-hold = drag.
        if (!pinching.current && pinch > PINCH_ON) {
          pinching.current = true;
          dragArmed.current = false;
          pinchStart.current = now;
        } else if (pinching.current && pinch < PINCH_OFF) {
          pinching.current = false;
          if (dragArmed.current) {
            sendInput({ action: "up" }); // end drag
            dragArmed.current = false;
            setModeBoth("point");
            setStatus("dropped");
          } else {
            sendInput({ action: "click" });
            setClickFlash(true);
            setTimeout(() => setClickFlash(false), 300);
          }
        } else if (
          pinching.current &&
          !dragArmed.current &&
          now - pinchStart.current >= DRAG_AFTER_MS
        ) {
          dragArmed.current = true;
          sendInput({ action: "down" }); // begin drag
          setModeBoth("drag");
        }
      }

      if (m === "drag") {
        // Keep the dragged cursor following the finger.
        if (now - lastMove.current >= MOVE_INTERVAL_MS) {
          lastMove.current = now;
          const sx = fx.current.filter(f.x, now);
          const sy = fy.current.filter(f.y, now);
          sendInput({ action: "move", nx: sx, ny: sy });
        }
      }

      if (m === "scroll") {
        const delta = f.y - scrollAnchor.current; // hand down → scroll down
        scrollRemainder.current += delta * 12; // normalized travel → notches
        const notches = Math.trunc(scrollRemainder.current);
        if (notches !== 0) {
          scrollRemainder.current -= notches;
          scrollAnchor.current = f.y;
          sendInput({ action: "scroll", dy: Math.max(-3, Math.min(3, notches)) });
        }
      }

      if (m === "fist") {
        const dx = f.x - fistAnchorX.current;
        if (Math.abs(dx) > SWIPE_THRESHOLD && now - lastSwipe.current > SWIPE_COOLDOWN_MS) {
          lastSwipe.current = now;
          fistAnchorX.current = f.x;
          sendInput({ action: "key", keys: "alt+tab" });
          setStatus("alt-tab");
        }
      }
    },
    [releaseButtons, sendInput]
  );

  // Claim the shared webcam lock while enabled — DJ / eyes may hold it.
  const [camGranted, setCamGranted] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setCamGranted(false);
      return;
    }
    if (claimVision("air-mouse")) {
      setCamGranted(true);
      return () => releaseVision("air-mouse");
    }
    setStatus(`camera busy — ${visionHolder()} is using it`);
    const off = onVisionLockChange((h) => {
      if (!h && enabled) {
        if (claimVision("air-mouse")) setCamGranted(true);
      }
      if (h !== "air-mouse") setCamGranted(false);
    });
    return off;
  }, [enabled]);

  const { ready, error } = useHandControl({
    enabled: enabled && camGranted,
    onFrame: handleFrame,
  });

  // Status ticker.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      const f = lastFrameStatus();
      if (f) setStatus(f);
    }, 600);
    return () => clearInterval(t);
  }, [enabled]);
  const lastFrameStatus = () => {
    if (modeRef.current === "frozen") return "frozen — point to resume";
    if (modeRef.current === "drag") return "dragging…";
    if (modeRef.current === "scroll") return "scrolling…";
    if (modeRef.current === "fist") return "swipe ← → to switch apps";
    return "point · pinch to click";
  };

  // Ctrl+M toggles.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        setEnabled((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    localStorage.setItem("jarvis:air-mouse", enabled ? "1" : "0");
  }, [enabled]);

  // On disable: drop any held button.
  useEffect(() => {
    if (!enabled) releaseButtons();
  }, [enabled, releaseButtons]);

  return (
    <>
      <motion.button
        onClick={() => setEnabled((v) => !v)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title={enabled ? "Disable air-mouse (Ctrl+M)" : "Enable air-mouse (Ctrl+M)"}
        className={`fixed bottom-[9.5rem] right-6 z-50 p-3 rounded-full transition-colors ${
          enabled
            ? "bg-reactor-core text-deep-space"
            : "bg-panel-glass text-text-secondary hover:bg-panel-border"
        }`}
      >
        {enabled ? <MousePointerClick className="w-5 h-5" /> : <Hand className="w-5 h-5" />}
      </motion.button>

      <AnimatePresence>
        {enabled && (
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", stiffness: 260, damping: 26 }}
            className="fixed bottom-[12.5rem] right-6 z-50 w-60 rounded-2xl border border-panel-border/60 bg-deep-space/80 backdrop-blur-md p-3.5 pointer-events-none shadow-[0_0_30px_rgba(0,212,255,0.08)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-orbitron text-[10px] tracking-[0.25em] text-text-secondary/70">
                AIR GESTURES
              </span>
              <motion.span
                key={mode}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className={`font-rajdhani text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  mode === "frozen"
                    ? "border-accent-red/60 text-accent-red bg-accent-red/10"
                    : mode === "drag" || mode === "scroll" || mode === "fist"
                    ? "border-reactor-core/60 text-reactor-core bg-reactor-core/10"
                    : "border-panel-border text-text-secondary/80"
                }`}
              >
                {error ? "error" : ready ? MODE_LABEL[mode] : "loading"}
              </motion.span>
            </div>

            {/* Freeze arming bar */}
            <AnimatePresence>
              {palmProgress > 0 && palmProgress < 1 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mb-2"
                >
                  <div className="h-1 rounded-full bg-panel-border/40 overflow-hidden">
                    <div
                      className="h-full bg-accent-red rounded-full transition-[width] duration-100"
                      style={{ width: `${palmProgress * 100}%` }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Legend */}
            <div className="space-y-1">
              {LEGEND.map((row) => {
                const active =
                  row.modes.includes(mode) ||
                  (row.key === "point" && mode === "idle") ||
                  (row.key === "pinch" && clickFlash);
                return (
                  <div
                    key={row.key}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1 transition-colors duration-150 ${
                      active ? "bg-reactor-core/10" : ""
                    }`}
                  >
                    <span className="text-sm leading-none w-5 text-center">{row.icons}</span>
                    <span
                      className={`font-rajdhani text-[11px] ${
                        active ? "text-reactor-core" : "text-text-secondary/55"
                      }`}
                    >
                      {row.label}
                    </span>
                    {active && (
                      <motion.span
                        layoutId="gesture-active-dot"
                        className="ml-auto w-1.5 h-1.5 rounded-full bg-reactor-core shadow-[0_0_6px_rgba(0,212,255,0.9)]"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Status */}
            <div className="mt-2.5 pt-2 border-t border-panel-border/40 font-rajdhani text-[10px] text-text-secondary/50 leading-snug">
              {error
                ? `CAMERA: ${error}`
                : ready
                ? status || "AIR-MOUSE: active"
                : "AIR-MOUSE: loading model…"}
            </div>
            {error && (
              <div className="mt-1.5 font-rajdhani text-[10px] text-accent-red/80 leading-snug">
                {error.startsWith("NotAllowedError")
                  ? "Click the 🔒 icon in the address bar → Camera → Allow, then reload."
                  : error.startsWith("NotFoundError")
                  ? "Windows Settings → Privacy → Camera → allow desktop apps."
                  : error.startsWith("NotReadableError")
                  ? "Another app (Zoom/Teams?) is holding the camera — close it."
                  : ""}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
