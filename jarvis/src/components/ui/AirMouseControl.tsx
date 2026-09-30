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
import { Hand, MousePointerClick, Gamepad2 } from "lucide-react";
import { useHandControl, HandFrame } from "@/hooks/useHandControl";
import { OneEuroFilter } from "@/lib/oneEuro";
import {
  classifyPose,
  advanceFreezeRelease,
  FREEZE_RELEASE_FRAMES,
  type Pose,
} from "@/lib/handPose";
import { pipSupported, openPiPWith, pipWindow } from "@/lib/documentPiP";
import { backgroundTicker } from "@/lib/backgroundTicker";
import {
  claimVision,
  releaseVision,
  visionHolder,
  onVisionLockChange,
} from "@/lib/visionLock";
import { sendOsInput } from "@/lib/osInputClient";

// Pinch thresholds sit LOW on the metric curve on purpose: missing a
// deliberate pinch is far worse than a rare false click (the arm guards
// already veto fists/scroll/thumb). ON 0.5 fires at ~80% closure; OFF 0.25
// releases as soon as the fingers part. Sustain 1 frame: the camera runs
// 20-30fps and the pose guards handle transients.
const PINCH_ON = 0.5;
const PINCH_OFF = 0.25;
const PINCH_SUSTAIN_FRAMES = 1;
const DEADMAN_MS = 700; // no hand → stop driving the cursor
const DEBOUNCE_FRAMES = 2; // consecutive frames before a pose becomes a mode
const DRAG_AFTER_MS = 550; // pinch held this long becomes a drag (0.32s fired drags on slow clicks)
const PALM_FREEZE_MS = 1000; // open-palm hold to trigger panic freeze
const SWIPE_THRESHOLD = 0.18; // fist horizontal travel to fire alt-tab (in cursor-space units)
// ─── Cursor feel — the "Apple pointer" pass ───────────────────────────────
// Hand coords used to map 1:1 onto the screen, so the whole screen lived in
// the camera's FULL frame: reaching a corner meant shoving your hand to the
// edge of the webcam's field of view, and every millimetre of hand tremor
// became several millimetres of cursor travel. The pointer now maps a
// comfortable central region of the frame onto the full screen, with a soft
// shoulder past the edge so the pointer eases into the screen border rather
// than pinning at it. Same reach, about two thirds of the hand travel.
const ACTIVE_MIN_X = 0.18;
const ACTIVE_MAX_X = 0.82;
const ACTIVE_MIN_Y = 0.14;
const ACTIVE_MAX_Y = 0.86;
// Park threshold: below this the pointer counts as holding still and the
// move is NOT sent, so the OS cursor freezes instead of creeping a pixel or
// two with the filter's tail.
const PARK_EPS = 0.0016;
// ─── Cursor drive loop ────────────────────────────────────────────────────
// The hand arrives at camera rate (25-30Hz after inference); the OS cursor
// can take 60 updates/sec. Emitting one position per camera frame makes the
// pointer STEP, which reads as roughness no matter how good the signal is.
// The drive loop interpolates between samples at ~60Hz instead.
const DRIVE_POLL_MS = 16; // ~60Hz
const DRIVE_RATE = 30; // exponential approach rate (1/s) — lands in ~60ms
const MAX_SLEW_PER_SEC = 5; // hard speed cap: nothing teleports across the screen
const SWIPE_COOLDOWN_MS = 600;
const RIGHTCLICK_COOLDOWN_MS = 900;
const BUBBLE_WAVE_SIZE = 7; // bubbles per wave; next wave spawns ONLY when the field is cleared
// Apple-minimal sizing: bubbles stay small (3–4.5% of the stage) so the
// field reads calm and precision actually matters when pinching.
const BUBBLE_R_MIN = 0.03;
const BUBBLE_R_MAX = 0.045;

/** Map a hand coordinate into cursor space 0..1.
 *
 * Linear across the active region (the comfortable central part of the
 * camera frame), then a tanh shoulder outside it: a hand resting just past
 * the region edge still moves the pointer a little instead of slamming it
 * into the corner, and a deliberate reach still hits the screen edge. */
function mapActive(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0.5;
  const t = (v - lo) / (hi - lo);
  if (t >= 0 && t <= 1) return t;
  const shoulder = 0.3;
  const over = t < 0 ? t : t - 1;
  const eased = shoulder * Math.tanh(over / shoulder);
  return Math.max(0, Math.min(1, (t < 0 ? 0 : 1) + eased));
}

type Mode =
  | "idle" // no recognizable pose — hand present
  | "point" // index out → cursor follows
  | "drag" // pinch held long → button down
  | "scroll" // index+middle → wheel
  | "fist" // fist → alt-tab on swipe
  | "palm" // open palm → arming freeze
  | "frozen"; // panic freeze active

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

  // ─── Bubble practice mode (gamified pinch trainer) ──────────────────
  // A fullscreen sandbox: bubbles float on a dark stage, the hand drives a
  // VIRTUAL cursor (the real OS pointer is untouched), and a pinch pops the
  // bubble under it. Practicing here can never alt-tab, drag-select or
  // click something dangerous on the desktop.
  const [practiceMode, setPracticeMode] = useState<"live" | "bubbles">("live");
  const practiceRef = useRef<"live" | "bubbles">("live");
  practiceRef.current = practiceMode;
  const [bubbles, setBubbles] = useState<
    { id: number; x: number; y: number; r: number }[]
  >([]);
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number; hit: boolean }[]>([]);
  const [score, setScore] = useState({ popped: 0, missed: 0, streak: 0, best: 0, waves: 0 });
  const bubbleId = useRef(1);
  const burstId = useRef(1);
  const cursorDotRef = useRef<HTMLDivElement | null>(null); // direct-DOM cursor (no re-render)

  // ─── Gesture engine state (refs — mutated at camera framerate) ───────────
  // minCutoff dropped 2.6 → 1.2Hz: the old setting let rest micro-jitter
  // through, which is the visible "cursor shivers while I hold still". beta
  // stays high enough (0.12) that a flick raises the cutoff hard and lands
  // WITH the hand instead of trailing it.
  const fx = useRef(new OneEuroFilter(1.2, 0.12));
  const fy = useRef(new OneEuroFilter(1.2, 0.12));
  const lastSeen = useRef(0);
  const lastSent = useRef({ x: -1, y: -1 }); // last position actually sent
  // Cursor drive state: the camera-rate target, the interpolated position the
  // drive loop is currently emitting, and the follow-suppression flag.
  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const followBlockedRef = useRef(false);
  const driveRef = useRef<ReturnType<typeof setTimeout> | 0>(0);

  const poseCandidate = useRef<Pose>("none");
  const poseCount = useRef(0);
  const modeRef = useRef<Mode>("idle");

  // pinch → click vs drag
  const pinching = useRef(false);
  const pinchStart = useRef(0);
  const dragArmed = useRef(false); // true once long-hold converted to drag
  const pinchSustain = useRef(0); // consecutive gated frames above threshold

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

  // unrecognizable-pose run length (stranded-mode reset) + live fps
  const noneCount = useRef(0);
  const fpsRef = useRef(0);

  const setModeBoth = (m: Mode) => {
    if (modeRef.current === m) return;
    modeRef.current = m;
    setMode(m);
  };

  /** Release any held OS button (drag cleanup / panic). */
  const releaseButtons = useCallback(() => {
    sendOsInput({ action: "up" });
  }, []);

  const sendInput = useCallback((body: object) => {
    sendOsInput(body as { action: string });
  }, []);

  const handleFrame = useCallback(
    (f: HandFrame) => {
      const now = performance.now();

      if (!f.handFound) {
        // No fresh target: the drive loop holds the pointer exactly where it
        // is until the hand comes back (or the deadman expires).
        targetRef.current = null;
        // Hand vanished mid-drag → release the held button immediately,
        // otherwise the OS keeps dragging with no way to stop it.
        if (dragArmed.current) {
          dragArmed.current = false;
          pinching.current = false;
          sendInput({ action: "up" });
          setModeBoth("idle");
        }
        if (now - lastSeen.current > DEADMAN_MS) setStatus("show your hand ✋");
        return;
      }
      // Re-acquired after a gap (deadman expired / hand lost): reset the
      // filters so the pointer JUMPS to the hand's current position. Without
      // this the One-Euro state resumes from the stale pre-loss position and
      // the cursor visibly sweeps across the screen to catch up.
      if (now - lastSeen.current > 400) {
        fx.current.reset();
        fy.current.reset();
        lastSent.current = { x: -1, y: -1 };
        // Drop the interpolated position too, so the pointer JUMPS to the
        // hand's current spot instead of gliding across the whole screen.
        posRef.current = null;
      }
      lastSeen.current = now;
      fpsRef.current = f.fps;

      // Map the hand into cursor space ONCE per frame — the follow, the
      // scroll anchor and the swipe detector all work in these units.
      const px = mapActive(f.x, ACTIVE_MIN_X, ACTIVE_MAX_X);
      const py = mapActive(f.y, ACTIVE_MIN_Y, ACTIVE_MAX_Y);

      // ── Cursor target (camera rate) ─────────────────────────────────────
      // Mapped + filtered ONCE per frame here. The drive loop (below) then
      // interpolates toward it at ~60Hz, so the pointer GLIDES between
      // camera samples instead of stepping at 25-30Hz. That rate mismatch
      // between the camera and the OS cursor is the visible roughness that
      // no amount of signal filtering can remove.
      targetRef.current = {
        x: fx.current.filter(px, now),
        y: fy.current.filter(py, now),
      };

      // ─── Bubble practice mode: virtual cursor only ─────────────────────
      // The sandbox is fully isolated from the OS input path — nothing in
      // this branch sends click/down/up/key, and the real cursor never moves.
      if (practiceRef.current === "bubbles") {
        // Hit-test against the INTERPOLATED position: that is where the dot
        // the user is aiming with actually is drawn.
        const sx = posRef.current?.x ?? targetRef.current.x;
        const sy = posRef.current?.y ?? targetRef.current.y;

        // Pop = raw pinch metric crossing ON with a short sustain window;
        // pose-independent (see gate rewrite below — the pinched hand no
        // longer classifies as "point", which is what blocked clicks).
        if (!pinching.current && f.handFound && f.pinch > PINCH_ON) {
          // Fire on the FIRST frame over threshold — the 2-frame sustain
          // window swallowed the tick where the metric peaked (missed pops).
          pinching.current = true;
          const hit = bubblesRef.current.find(
            (b) => Math.hypot(b.x - sx, b.y - sy) < b.r + 0.06
          );
          if (hit) {
            const remaining = bubblesRef.current.filter((b) => b.id !== hit.id);
            bubblesRef.current = remaining; // keep the ref fresh for same-frame pops
            setBubbles(remaining);
            setScore((s) => {
              const streak = s.streak + 1;
              return { popped: s.popped + 1, missed: s.missed, streak, best: Math.max(s.best, streak), waves: s.waves };
            });
            const id = burstId.current++;
            setBursts((bs) => [...bs.slice(-4), { id, x: hit.x, y: hit.y, hit: true }]);
            setTimeout(() => setBursts((bs) => bs.filter((b) => b.id !== id)), 450);
          }
        } else if (pinching.current && f.pinch < PINCH_OFF) {
          pinching.current = false; // release — ready for the next pop
        } else if (pinchSustain.current > 0 && f.pinch <= PINCH_ON) {
          pinchSustain.current = 0;
        }
        return; // never fall through to OS control while practicing
      } else if (cursorDotRef.current) {
        cursorDotRef.current.style.opacity = "0";
      }

      // ─── Pose classification ────────────────────────────────────────────
      // Pure + geometric, in @/lib/handPose (so it is unit-testable). The
      // old inline classifier read a RELAXED POINTING hand as an open palm —
      // arms the panic freeze the user never asked for. See handPose.ts for
      // the dead-band guarantee that makes palm and point mutually exclusive.
      const { pinch, fist, curl } = f;
      const pose: Pose = classifyPose(f);

      // Stranded-mode reset: pose unrecognizable for ~1s while in a gesture
      // mode → fall back to pointing instead of staying stuck.
      if (pose === "none") {
        noneCount.current++;
        if (
          noneCount.current > 25 &&
          (modeRef.current === "drag" || modeRef.current === "scroll" || modeRef.current === "fist")
        ) {
          // Exiting drag via stranding must release the held button,
          // otherwise the OS keeps dragging with no way to stop it.
          if (modeRef.current === "drag") {
            dragArmed.current = false;
            pinching.current = false;
            sendInput({ action: "up" });
          }
          setModeBoth("idle");
          setStatus("gesture lost — pointing");
        }
      } else {
        noneCount.current = 0;
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
        // Per-frame pose, NO debounce — but tolerant of flicker: an open
        // palm holds the freeze, an unrecognized frame is neutral, and any
        // recognized non-palm pose makes progress. The old rule hard-reset
        // on anything it didn't recognize and demanded 4 CONSECUTIVE hits,
        // so a jittery classifier kept restarting the count and the user
        // stayed frozen no matter how they pointed ("it doesn't unfreeze").
        unfreezeCounter.current = advanceFreezeRelease(unfreezeCounter.current, pose);
        if (unfreezeCounter.current >= FREEZE_RELEASE_FRAMES) {
          unfreezeCounter.current = 0;
          // Re-anchor the cursor where it is: the parked position is stale
          // after a freeze, and resuming without a re-anchor would glide the
          // pointer across the screen to catch up with the hand.
          posRef.current = null;
          targetRef.current = null;
          setModeBoth("idle");
          setStatus("resumed");
        }
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
          scrollAnchor.current = py;
          scrollRemainder.current = 0;
          setModeBoth("scroll");
        } else if (stable === "fist" && cur !== "fist") {
          fistAnchorX.current = px;
          setModeBoth("fist");
        } else if (stable === "point" && cur !== "point" && cur !== "drag") {
          setModeBoth("point");
        // From a pointing pose the deliberate thumbs-UP geometry is required
        // (thumb tip above the knuckle) so a relaxed thumb-out never fires;
        // from idle/fist/scroll any stable thumb is intent enough.
        } else if (stable === "thumb" && cur !== "drag" && (cur !== "point" || f.thumbUp)) {
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

      // Cursor-follow is suppressed while a NON-pointer pose is stable:
      //  • palm — arming the panic freeze; the index tip wobbles on an open
      //    palm and the cursor must hold perfectly still while arming.
      //  • thumb — a thumbs-up is a discrete right-click; the folded index
      //    landmark is a poor pointer and jitters after the click.
      const followBlocked = stable === "palm" || (stable === "thumb" && m !== "drag");
      followBlockedRef.current = followBlocked;
      if ((m === "point" || m === "drag" || m === "idle") && !followBlocked) {
        // ─── Pinch gate, metric-driven (REWRITTEN — "pinch not detected") ──
        // The old gate required the DEBOUNCED pose to be "point" before a
        // pinch could arm. But pinching IS folding the index: the tip-to-PIP
        // extension check reads the pinched index as folded and the pose
        // classifier outputs "none" (or "fist" as the tips approach the
        // palm) exactly when the user pinches — the gate never opened, and
        // clicks "never registered".
        //
        // The fix: arm on the SCALE-NORMALIZED pinch METRIC itself, gated by
        // the other fingers staying folded and no stronger pose claiming the
        // hand. The metric is deliberately pinch-shaped: it only rises when
        // the index tip comes NEAR the THUMB tip (fist folds the index tip
        // DOWN toward the palm, far from the thumb — a fist can't fake it).
        // Sustain frames absorb single-frame transients; hysteresis (ON
        // 0.62 / OFF 0.34) prevents chatter; DRAG_AFTER_MS still converts a
        // hold into a drag.
        // curl.middle/ring guard: a pinch "counts" only when the OTHER
        // fingers are somewhat folded — but the bar relaxes while the pinch
        // is CLOSING (velocity-adaptive). During a natural pinch the whole
        // hand supinates and the ring/middle fingertips ride UP their curl
        // scale; a rigid 0.3 bar vetoed the arm on most real pinches (the
        // "detects once in 20" failure). Fist strength still vetoes above.
        const curlBar = pinch > 0.3 ? 0.12 : 0.3;
        const pinchArms =
          fist < 0.5 &&
          !(stable === "two") && // two-finger scroll owns the hand
          // (palm can't reach here — followBlocked already excluded it)
          !(stable === "thumb" && !pinching.current) && // right-click owns the hand
          curl.middle > curlBar &&
          curl.ring > curlBar;

        if (pinchArms && !pinching.current && pinch > PINCH_ON) {
          pinchSustain.current++;
          if (pinchSustain.current >= PINCH_SUSTAIN_FRAMES) {
            pinching.current = true;
            dragArmed.current = false;
            pinchStart.current = now;
            pinchSustain.current = 0;
          }
        } else if (pinching.current && pinch < PINCH_OFF) {
          // RELEASE ON THE METRIC ONLY. The old condition also required the
          // arming gate to still hold — but opening the fingers breaks the
          // curl guard BEFORE the tips part, so the release fell into the
          // dead branch and the click never fired ("only 40% working").
          pinching.current = false;
          pinchSustain.current = 0;
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
        } else if (!pinching.current && pinch <= PINCH_ON) {
          pinchSustain.current = 0;
        }

        if (
          pinching.current &&
          !dragArmed.current &&
          now - pinchStart.current >= DRAG_AFTER_MS
        ) {
          dragArmed.current = true;
          sendInput({ action: "down" }); // begin drag
          setModeBoth("drag");
        }
      }

      // (No cursor stepping here: the drive loop owns movement for point,
      // idle AND drag modes, so a dragged window follows just as smoothly.)

      if (m === "scroll") {
        // Filtered travel — raw hand jitter accumulates into phantom notches.
        const sy = fy.current.filter(py, now);
        const delta = sy - scrollAnchor.current; // hand down → scroll down
        // 8 (not 12): cursor-space travel is ~1.5× hand-space travel now.
        scrollRemainder.current += delta * 8; // normalized travel → notches
        const notches = Math.trunc(scrollRemainder.current);
        if (notches !== 0) {
          scrollRemainder.current -= notches;
          scrollAnchor.current = sy;
          sendInput({ action: "scroll", dy: Math.max(-3, Math.min(3, notches)) });
        }
      }

      if (m === "fist") {
        const dx = px - fistAnchorX.current;
        if (Math.abs(dx) > SWIPE_THRESHOLD && now - lastSwipe.current > SWIPE_COOLDOWN_MS) {
          lastSwipe.current = now;
          fistAnchorX.current = px;
          sendInput({ action: "key", keys: "alt+tab" });
          setStatus("alt-tab");
        }
      }
    },
    [releaseButtons, sendInput]
  );

  // ─── Wave system (practice mode) ─────────────────────────────────────
  // A full wave spawns at entry; the next wave appears ONLY when every
  // bubble is popped — the field never drains mid-wave and never times out.
  useEffect(() => {
    if (practiceMode !== "bubbles" || !enabled) return;
    const spawnWave = (countIt: boolean) => {
      const fresh = Array.from({ length: BUBBLE_WAVE_SIZE }, () => ({
        id: bubbleId.current++,
        x: 0.12 + Math.random() * 0.76,
        y: 0.12 + Math.random() * 0.76,
        r: BUBBLE_R_MIN + Math.random() * (BUBBLE_R_MAX - BUBBLE_R_MIN),
      }));
      bubblesRef.current = fresh;
      setBubbles(fresh);
      if (countIt) setScore((s) => ({ ...s, waves: s.waves + 1 }));
    };
    spawnWave(false); // first wave immediately on entry (not counted)
    const iv = setInterval(() => {
      if (bubblesRef.current.length === 0) spawnWave(true); // cleared → next wave
    }, 300);
    return () => clearInterval(iv);
  }, [practiceMode, enabled]);

  // Entering practice: clear session; leaving: restore OS control state.
  useEffect(() => {
    if (practiceMode === "bubbles") {
      setBubbles([]);
      setBursts([]);
      setScore({ popped: 0, missed: 0, streak: 0, best: 0, waves: 0 });
      pinching.current = false;
      pinchSustain.current = 0;
      lastSent.current = { x: -1, y: -1 };
      targetRef.current = null;
      posRef.current = null;
      fx.current.reset();
      fy.current.reset();
    }
  }, [practiceMode]);

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

  // ─── Cursor drive loop ────────────────────────────────────────────────
  // Decoupled from the camera on purpose. Camera frames arrive at 25-30Hz
  // (inference-bound); the OS cursor can take 60 updates/sec. Sending only
  // one position per frame makes the pointer visibly STEP, which reads as
  // "not smooth" no matter how well the signal is filtered. This loop runs
  // at ~60Hz, glides toward the latest filtered target with a speed-capped
  // exponential approach, and then PARKS (sends nothing at all) once it has
  // landed — so the pointer is statue-still whenever the hand is.
  //
  // This loop is the ONLY thing that ever moves the cursor.
  useEffect(() => {
    if (!enabled || !camGranted) return;
    let stopped = false;
    let last = performance.now();

    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.008, (now - last) / 1000));
      last = now;

      const target = targetRef.current;
      const fresh = !!target && now - lastSeen.current < DEADMAN_MS;

      if (target && fresh) {
        const cur = posRef.current ?? (posRef.current = { x: target.x, y: target.y });
        const dx = target.x - cur.x;
        const dy = target.y - cur.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= PARK_EPS) {
          // Landed — snap exactly onto the target so the pointer settles on
          // the thing you are pointing at instead of creeping the last pixel.
          cur.x = target.x;
          cur.y = target.y;
        } else {
          const alpha = 1 - Math.exp(-DRIVE_RATE * dt);
          const step = Math.min(dist * alpha, MAX_SLEW_PER_SEC * dt);
          cur.x += (dx / dist) * step;
          cur.y += (dy / dist) * step;
        }

        if (practiceRef.current === "bubbles") {
          // Practice sandbox: move the virtual dot, never touch the OS.
          const el = cursorDotRef.current;
          if (el) {
            el.style.opacity = "1";
            el.style.left = `${cur.x * 100}%`;
            el.style.top = `${cur.y * 100}%`;
          }
        } else {
          const m = modeRef.current;
          const movable =
            (m === "point" || m === "drag" || m === "idle") && !followBlockedRef.current;
          if (
            movable &&
            (Math.abs(cur.x - lastSent.current.x) >= PARK_EPS ||
              Math.abs(cur.y - lastSent.current.y) >= PARK_EPS)
          ) {
            lastSent.current = { x: cur.x, y: cur.y };
            sendInput({ action: "move", nx: cur.x, ny: cur.y });
          }
        }
      }

      driveRef.current = setTimeout(tick, DRIVE_POLL_MS);
    };

    const releaseKeepAlive = backgroundTicker.acquire("air-mouse-drive");
    const unsub = backgroundTicker.subscribe(() => {
      if (!stopped) tick();
    });

    driveRef.current = setTimeout(tick, DRIVE_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(driveRef.current);
      unsub();
      releaseKeepAlive();
    };
  }, [enabled, camGranted, sendInput]);

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
    const fps = fpsRef.current ? ` · ${fpsRef.current | 0}fps` : "";
    if (modeRef.current === "frozen") return "frozen — point to resume";
    if (modeRef.current === "drag") return `dragging…${fps}`;
    if (modeRef.current === "scroll") return `scrolling…${fps}`;
    if (modeRef.current === "fist") return `swipe ← → to switch apps${fps}`;
    return `point · pinch to click${fps}`;
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

  // On enable: wipe ALL state left over from the previous session. A frozen
  // mode or a half-armed palm timer must NEVER survive a toggle — with a
  // stale "frozen" mode the mouse ignored every gesture until the freeze
  // path happened to clear it ("loaded but stuck frozen").
  useEffect(() => {
    if (!enabled) return;
    modeRef.current = "idle";
    setMode("idle");
    setPalmProgress(0);
    setClickFlash(false);
    palmStart.current = 0;
    unfreezeCounter.current = 0;
    poseCandidate.current = "none";
    poseCount.current = 0;
    noneCount.current = 0;
    pinching.current = false;
    pinchSustain.current = 0;
    dragArmed.current = false;
    scrollAnchor.current = 0;
    scrollRemainder.current = 0;
    fistAnchorX.current = 0;
    lastSwipe.current = 0;
    lastRightClick.current = 0;
    lastSeen.current = 0;
    lastSent.current = { x: -1, y: -1 };
    targetRef.current = null;
    posRef.current = null;
    followBlockedRef.current = false;
    fx.current.reset();
    fy.current.reset();
    setStatus("");
  }, [enabled]);

  return (
    <>
      <motion.button
        onClick={() => setEnabled((v) => !v)}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title={enabled ? "Disable air-mouse (Ctrl+M)" : "Enable air-mouse (Ctrl+M)"}
        className={`fixed bottom-[13rem] right-6 z-50 p-3 rounded-full transition-colors ${
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
            className="fixed bottom-[13rem] right-[5.75rem] z-50 w-60 rounded-2xl border border-panel-border/60 bg-deep-space/80 backdrop-blur-md p-3.5 pointer-events-none shadow-[0_0_30px_rgba(0,212,255,0.08)]"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-2.5">
              <span className="font-orbitron text-[10px] tracking-[0.25em] text-text-secondary/70">
                AIR GESTURES
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPracticeMode((m) => (m === "bubbles" ? "live" : "bubbles"))}
                  title="Gamified pinch practice — pop floating bubbles in a fullscreen sandbox (real cursor untouched)"
                  className={`pointer-events-auto transition-colors ${
                    practiceMode === "bubbles" ? "text-reactor-core" : "text-text-secondary/60 hover:text-reactor-core"
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                </button>
                {pipSupported() && (
                  <button
                    onClick={() =>
                      window.dispatchEvent(new CustomEvent("jarvis:open-practice-monitor"))
                    }
                    title="Pop out the live monitor — keeps tracking alive while other apps are focused"
                    className="text-text-secondary/60 hover:text-reactor-core pointer-events-auto"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 3h6v6M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
                    </svg>
                  </button>
                )}
              </div>
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
                ? "Camera won't start — toggle again (the camera re-arms itself for a few seconds); if it keeps failing, check the shutter / F-key or close camera apps."
                  : error}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bubble practice stage — fullscreen sandbox ─────────────────── */}
      <AnimatePresence>
        {enabled && practiceMode === "bubbles" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black"
          >
            {bubbles.map((b) => (
              <motion.div
                key={b.id}
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  left: `${b.x * 100}%`,
                  top: `${b.y * 100}%`,
                  width: `${b.r * 140}%`,
                  aspectRatio: "1",
                  opacity: 0.85,
                  border: "1px solid rgba(255,255,255,0.35)",
                  background:
                    "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.09), rgba(255,255,255,0.015) 65%)",
                }}
              />
            ))}
            {bursts.map((b) => (
              <motion.div
                key={b.id}
                initial={{ scale: 0.4, opacity: 0.7 }}
                animate={{ scale: 1.8, opacity: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60"
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: "5vmin", height: "5vmin" }}
              />
            ))}
            {/* Virtual cursor — direct-DOM, zero re-renders */}
            <div
              ref={cursorDotRef}
              className="absolute w-2.5 h-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00FF9D]/90 pointer-events-none"
              style={{ left: "50%", top: "50%", opacity: 0 }}
            />
            {/* HUD — minimal counters */}
            <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-6 font-rajdhani text-xs text-white/40">
              <span>
                <b className="text-white/85 text-sm">{score.popped}</b> popped
              </span>
              <span>
                <b className="text-[#00FF9D]/80 text-sm">{score.streak}</b> streak · best {score.best}
              </span>
              <span>
                <b className="text-white/60 text-sm">{score.waves}</b> waves cleared
              </span>
            </div>
            <div className="absolute bottom-5 left-1/2 -translate-x-1/2 font-rajdhani text-[10px] text-white/25">
              move finger to steer · pinch to pop
            </div>
            <button
              onClick={() => setPracticeMode("live")}
              className="absolute top-4 right-5 font-rajdhani text-xs text-white/35 hover:text-white/70 transition-colors"
            >
              close ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
