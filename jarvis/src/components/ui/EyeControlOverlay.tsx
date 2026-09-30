"use client";

// Eye control overlay — your gaze drives the REAL OS cursor.
//
// ─── The signal path (v2) ─────────────────────────────────────────────────
//   iris landmarks → rawH/rawV (+ head yaw/pitch) → 5-feature calibrated
//   regression (head contamination subtracted) → span-normalized →
//   engage→glide→settle motion model → OS cursor.
//
// ─── The motion model ("Apple feel", not name-sake) ───────────────────────
//   • STATUE RULE: gaze jitter inside the dead zone never moves the cursor
//     — not "moves it a little", NEVER. No sends at all while parked. The
//     dead zone is MEASURED from the conditioned signal (a multiple of its
//     own per-frame wander) instead of being a fixed constant that one set
//     of lighting/user tuned and every other set broke.
//   • ENGAGE: a deliberate glance pushes the target beyond the dead zone;
//     the cursor then GLIDES there on an exponential ramp (fast start,
//     asymptotic arrival — no linear robotic crawl, no teleport).
//   • SETTLE: arrival inside the (tighter) land radius parks it again.
//   Blink (<450ms) = click; a "closed" misread auto-recovers in 2.5s;
//   reopen frames are frozen out (lids mid-transition produce garbage).
//
// Without a stored calibration the overlay falls back to AutoGain, which
// learns the user's own gaze span — so targets mode works out of the box.
//
// Calibration: 13 dots, center first. Raw-signal steadiness fills each ring
// (the uncalibrated estimate is too inaccurate to gate on — that was the
// original chicken-and-egg trap). One deliberate saccade between dots.

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Crosshair, Ruler, X, Gamepad2 } from "lucide-react";
import { useEyeControl, GazeFrame } from "@/hooks/useEyeControl";
import {
  CALIB_POINTS,
  fitGaze,
  fitIsSane,
  normalizeFit,
  mapGaze,
  saveCalibration,
  loadCalibration,
  clearCalibration,
  AutoGain,
  GazePoint,
  DEFAULT_COEFFS,
} from "@/lib/eyeCalibration";
import { OneEuroFilter } from "@/lib/oneEuro";
import { GazeCursor } from "@/lib/gazeCursor";
import { sendOsInput } from "@/lib/osInputClient";
import { claimVision, releaseVision, visionHolder, onVisionLockChange } from "@/lib/visionLock";
import { pipSupported, openPiPWith, pipWindow } from "@/lib/documentPiP";
import { backgroundTicker } from "@/lib/backgroundTicker";

const DWELL_MS = 1200; // target dwell (targets mode)
const CALIB_DWELL_MS = 1000; // per calibration point — slightly faster, 17 pts
const CURSOR_SEND_MS = 33; // ~30 drive ticks/sec
// ─── Adaptive statue rule ─────────────────────────────────────────────────
// The park radius used to be a FIXED 1.1% of screen. That is below the real
// iris-landmark noise floor, so the gate kept opening on sensor jitter and
// the cursor danced around the fixation point — the exact complaint. It is
// now measured from the user's own signal (see the engage block): the park
// radius is NOISE_K × the per-frame wander of the conditioned gaze, bounded.
const DEAD_ZONE = 0.005;      // floor — ~0.5% screen ≈ 9px on 1920px display
const DEAD_ZONE_MAX = 0.035;  // ceiling — wild signal can't freeze the cursor
const NOISE_K = 3.0;          // park radius = 3.0× measured wander
const DEAD_ZONE_EXIT_K = 1.8; // hysteresis: re-engage past 1.8× park radius
const GLIDE_RATE = 20;        // exponential approach rate (1/s) — crisp, no crawl
const FINE_RATE = 14;         // near-target rate — precise landing, no overshoot
const FINE_RADIUS = 0.055;    // inside this, switch to fine landing rate
const CURSOR_SLEW_PER_SEC = 3.2; // hard speed cap — fast saccades, no teleports
const BLINK_MAX_MS = 450; // shorter than this = a click
// Adaptive gate baselines: "closed" is judged RELATIVE to the user's own
// recent open-eye openness. Fixed thresholds froze the cursor whenever
// lighting/squint/glasses-glare shifted openness (bright focused page vs
// dim background page — the user's exact symptom).
const OPEN_BASE_INIT = 0.32;
const OPEN_BASE_MIN = 0.15;
const BLINK_COOLDOWN_MS = 650;
const BLINK_FALLBACK_MS = 2500; // stuck-"closed" = misread → resume
const REOPEN_FREEZE_MS = 200;   // ignore gaze just after eyes reopen
const CALIB_SETTLE_MS = 600;    // grace window when cursor mode starts
const GAZE_GAIN = 1.0;          // span normalization guarantees full reach
const DRILL_DWELL_MS = 900;     // practice drill: steady gaze this long pops target
const DRILL_RADIUS = 0.07;      // practice drill: tighter for word-level training
const CALIB_ON_DOT_R = 0.15;   // calib: generous proximity so ritual never deadlocks

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
  const [driveStalled, setDriveStalled] = useState(false);
  const [calibAttempt, setCalibAttempt] = useState(0);
  const [calibHint, setCalibHint] = useState<string | null>(null);

  // ─── Practice mode (black fullscreen trainer) ─────────────────────────
  // Pure black stage, zero Jarvis chrome — only the gaze cursor (plus drill
  // targets). Blink-intent coaching: every blink in practice is classified
  // as a registered CLICK or an IGNORED attempt (held too long / fired
  // during cooldown) so the user learns exactly which blink clicks.
  const [practice, setPractice] = useState(false);
  const practiceRef = useRef(false);
  practiceRef.current = practice;
  const [blinkStats, setBlinkStats] = useState({ clicks: 0, ignored: 0, streak: 0, best: 0 });
  const [blinkCoach, setBlinkCoach] = useState<{
    kind: "click" | "held" | "cooldown" | "drill";
    id: number;
  } | null>(null);
  const coachId = useRef(1);
  // Target drill: one dot at a time from the calibration grid; a steady
  // gaze fills the ring and advances. Refs drive it (10Hz UI mirror).
  const drillRef = useRef<{ idx: number; hold: number } | null>(null);
  const [drillUi, setDrillUi] = useState<{ idx: number; pct: number } | null>(null);
  const [drillHits, setDrillHits] = useState(0);

  // Dwell-target state
  const dwellProgress = useRef<Record<string, number>>({});
  const [activeRing, setActiveRing] = useState<{ id: string; pct: number } | null>(null);
  const lastFrame = useRef<number>(0);

  // Cursor engine state
  // Light second-stage smoothing: the heavy jitter removal happens in the engine
  // (median + One-Euro on raw iris), so this stage removes the residual ripple
  // from the quadratic map without adding visible lag.
  // minCutoff 1.8Hz: tight enough to damp mapping noise, loose enough not to
  // blur saccade edges. beta 1.8: fast pursuit across the screen.
  const fx = useRef(new OneEuroFilter(1.8, 1.8));
  const fy = useRef(new OneEuroFilter(1.8, 1.8));
  // The engage → glide → settle model lives in @/lib/gazeCursor so its
  // stability guarantees are unit-testable (see tests/gazeCursor.test.ts).
  const cursor = useRef(new GazeCursor({
    minRadius: DEAD_ZONE,
    maxRadius: DEAD_ZONE_MAX,
    noiseK: NOISE_K,
    exitK: DEAD_ZONE_EXIT_K,
    glideRate: GLIDE_RATE,
    fineRate: FINE_RATE,
    fineRadius: FINE_RADIUS,
    maxSpeed: CURSOR_SLEW_PER_SEC,
  }));
  const settleUntil = useRef(0);
  const lastSend = useRef(0);
  const lastDriveAt = useRef(0);
  const driveTimer = useRef<ReturnType<typeof setTimeout> | 0>(0);

  // Calibration-free mapping. AutoGain measures the user's own gaze span, so
  // targets mode and the practice drill work before any ritual — the old
  // fixed 1.8× expand was blendshape-era and mapped a full eye sweep into
  // ~15% of the screen, leaving the targets at x=0.88 unreachable.
  const autoGainX = useRef(new AutoGain());
  const autoGainY = useRef(new AutoGain());

  // Blink state
  const eyesOpen = useRef(true);
  const closedAt = useRef<number | null>(null);
  const lastClick = useRef(0);
  const blinkFallbackSince = useRef<number | null>(null);
  const openBase = useRef(OPEN_BASE_INIT); // rolling open-eye openness baseline
  const faceLostAt = useRef<number | null>(null); // face-loss debounce timestamp
  const lastGazeUi = useRef(0); // React update throttle for gaze state

  // Calibration state
  const [calibStep, setCalibStep] = useState(0);
  const [calibPct, setCalibPct] = useState(0);
  // Rolling fixation window (most recent steady frames) + progress kept in a
  // ref: the UI copy syncs at ~12Hz instead of re-rendering the 13-dot overlay
  // at camera framerate (that render storm competed with inference and made
  // the ritual itself laggy).
  const calibWin = useRef<Array<{ h: number; v: number; yaw: number; pitch: number }>>([]);
  const calibPctRef = useRef(0);
  const lastCalibUi = useRef(0);
  const calibSamples = useRef<GazePoint[]>([]);
  const saccadeRef = useRef({ h: 0, v: 0 });
  const saccadeCount = useRef(0);

  // Sane-load: accept stored fit, or fall back to DEFAULT_COEFFS for immediate tracking.
  const coeffs = useRef<number[] | null>(null);
  // Whether the loaded coeffs are from a USER calibration (true) or just DEFAULT_COEFFS (false).
  const hasRealCalib = useRef(false);
  if (coeffs.current === null && typeof window !== "undefined") {
    const saved = loadCalibration();
    if (saved && fitIsSane(saved)) {
      coeffs.current = saved;
      hasRealCalib.current = true;
    } else {
      if (saved) clearCalibration();
      coeffs.current = DEFAULT_COEFFS;
      hasRealCalib.current = false;
    }
  }

  // rawV zero-offset correction for the DEFAULT_COEFFS path in cursor mode.
  // The DEFAULT_COEFFS assume rawV=0 at center gaze, but actual rawV at rest
  // varies with webcam height, user posture, and face geometry. We measure it
  // from the first ~90 stable frames and subtract it so y=0.5 maps to wherever
  // the user naturally looks — not to a hardware-specific magic number.
  const rawVBaseline = useRef<{ sum: number; count: number; value: number | null }>({
    sum: 0,
    count: 0,
    value: null,
  });
  const rawHBaseline = useRef<{ sum: number; count: number; value: number | null }>({
    sum: 0,
    count: 0,
    value: null,
  });

  const targetRef = useRef<{ x: number; y: number } | null>(null);
  const lastSentRef = useRef<{ x: number; y: number }>({ x: -1, y: -1 });
  const eyesClosedRef = useRef(false);

  const gazeRef = useRef<GazeFrame>({
    rawH: 0, rawV: 0, yaw: 0, pitch: 0, openness: 1, faceFound: false,
  });

  const targetsRef = useRef<Target[]>([]);
  targetsRef.current = [
    { id: "spotify", label: "Spotify", x: 0.88, y: 0.3, action: props.onOpenSpotify },
    { id: "weather", label: "Weather", x: 0.88, y: 0.45, action: props.onOpenWeather },
    { id: "news", label: "News", x: 0.88, y: 0.6, action: props.onOpenNews },
    { id: "calendar", label: "Calendar", x: 0.88, y: 0.75, action: props.onOpenCalendar },
    { id: "notes", label: "Voice Notes", x: 0.88, y: 0.9, action: props.onOpenVoiceNotes },
  ];

  const pushCoach = useCallback((kind: "click" | "held" | "cooldown" | "drill") => {
    const id = coachId.current++;
    setBlinkCoach({ kind, id });
    setTimeout(() => setBlinkCoach((c) => (c && c.id === id ? null : c)), 1400);
  }, []);

  const startDrill = useCallback(() => {
    drillRef.current = { idx: 0, hold: 0 };
    setDrillUi({ idx: 0, pct: 0 });
    setDrillHits(0);
  }, []);

  const stopPractice = useCallback(() => {
    setPractice(false);
    drillRef.current = null;
    setDrillUi(null);
  }, []);

  const sendInput = useCallback((body: object) => {
    sendOsInput(body as { action: string });
  }, []);

  /** Wipe all drive state so the next frames start fresh — used on mode
   * entry AND on every tracking dropout. A stale anchor/filter after a
   * camera hiccup is what makes a cursor freeze or fly to a corner. */
  const resetDrive = useCallback(() => {
    fx.current.reset();
    fy.current.reset();
    // Parks at the next target and drops the wander reference: across a
    // tracking gap the "movement" is the gap itself, and feeding that into
    // the noise estimate would inflate the park radius for no reason.
    cursor.current.reset();
    settleUntil.current = performance.now() + CALIB_SETTLE_MS;
    lastDriveAt.current = performance.now();
    blinkFallbackSince.current = null;
    openBase.current = OPEN_BASE_INIT; // fresh baseline on (re)start
    // Re-learn the resting gaze baseline when tracking resumes.
    rawVBaseline.current = { sum: 0, count: 0, value: null };
    rawHBaseline.current = { sum: 0, count: 0, value: null };

  }, []);

  /** Screen point for display/targets: calibrated if possible, else AutoGain. */
  const displayPoint = useCallback(
    (g: GazeFrame): { x: number; y: number } => {
      // Only use the regression map when the user has run the ritual and saved
      // a real calibration. DEFAULT_COEFFS are too setup-specific for display.
      if (hasRealCalib.current && coeffs.current)
        return mapGaze(coeffs.current, g.rawH, g.rawV, g.yaw, g.pitch);
      // Uncalibrated path: self-scaling auto-gain (see AutoGain). rawV is
      // positive when looking UP, so the screen y axis is inverted.
      return { x: autoGainX.current.map(g.rawH), y: 1 - autoGainY.current.map(g.rawV) };
    },
    []
  );

  const handleFrame = useCallback(
    (g: GazeFrame) => {
      gazeRef.current = g;
      // Throttle React updates: the camera loop runs 20-30×/s and this state
      // re-renders the whole overlay each time — that rendering competed
      // with inference and visibly slowed the page ("takes hell of time").
      const tNow = performance.now();
      if (tNow - lastGazeUi.current > 100) {
        lastGazeUi.current = tNow;
        setGaze(g);
      }
      const now = tNow;
      const dt = lastFrame.current ? now - lastFrame.current : 16;
      lastFrame.current = now;

      if (!g.faceFound) {
        setActiveRing(null);
        dwellProgress.current = {};
        // Tracking lost (looked away, occlusion blip, camera hiccup). Two
        // guard rails: (1) the reset is DEBOUNCED — a single dropped frame
        // no longer parks the cursor (dropped frames used to read as
        // face-lost and silently freeze control); (2) when it does fire,
        // drive state is wiped so re-acquisition PARKS at the new gaze
        // instead of gliding from a stale anchor (top-left-flyaway class).
        faceLostAt.current = faceLostAt.current ?? now;
        if (now - faceLostAt.current > 100) resetDrive();
        return;
      }
      faceLostAt.current = null;

      // Keep the calibration-free mapper learning (targets mode / practice
      // drill). The calibrated path uses the regression instead.
      if (!coeffs.current) {
        autoGainX.current.push(g.rawH);
        autoGainY.current.push(g.rawV);
      }

      // ─── Calibration ritual: steadiness fills the ring ───────────────────
      if (uiMode === "calib") {
        // FIXATION = steadiness of the RAW signals, NOT proximity of the
        // on-screen estimate to the dot (the uncalibrated estimate can't
        // know which dot you're on — that gate made the ritual impossible).
        // Motion detector reference: a few frames stale, refreshed at ~6Hz.
        saccadeCount.current = (saccadeCount.current + 1) % 5;
        if (saccadeCount.current === 0) saccadeRef.current = { h: g.rawH, v: g.rawV };
        const dH = Math.abs(g.rawH - saccadeRef.current.h);
        const dV = Math.abs(g.rawV - saccadeRef.current.v);
        // Iris-range scale: eye darts produce ~0.04-0.15 raw shifts. The
        // engine now conditions the signal (median + One-Euro), so the
        // observed delta at dart onset is smaller — the threshold tracks
        // that so a genuine glance still reads as motion.
        const moving = dH > 0.011 || dV > 0.011;

        // DIRECTION CONFIDENCE — modulates accrual SPEED, never a hard gate.
        // The previous hard gate deadlocked for users whose raw gaze signal
        // spans little (head-pointers, small face in frame): center filled,
        // then NO dot ever did — a ritual that could never finish. Speeds:
        //   1.0  on-target per the partial map, or a genuinely new look
        //   0.6  uncertain (map still immature)
        //   0.25 confidently elsewhere / same look as an earlier dot
        // Even 0.25 keeps accruing — the ritual always completes, and the
        // raw-spread guard at fit time still refuses to SAVE a degenerate
        // stare-through calibration.
        let speed = 1;
        if (calibStep > 0) {
          const S = calibSamples.current;
          // Distinctness (loose 0.008): the current look must differ from
          // EVERY collected sample — a fixed stare never reads as "new".
          const distinct = !S.some(
            (s) => Math.abs(g.rawH - s.h) < 0.008 && Math.abs(g.rawV - s.v) < 0.008
          );
          let predClose: boolean | null = null;
          if (S.length >= 3) {
            // Partial 1D least-squares map (h→sx, v→sy) over the samples
            // collected so far — enough to know which dot the gaze is on.
            const n = S.length;
            let mh = 0, mv = 0, mx = 0, my = 0;
            for (const s of S) { mh += s.h; mv += s.v; mx += s.sx; my += s.sy; }
            mh /= n; mv /= n; mx /= n; my /= n;
            let varH = 0, varV = 0, covHx = 0, covVy = 0;
            for (const s of S) {
              const dh = s.h - mh, dv = s.v - mv;
              varH += dh * dh; covHx += dh * (s.sx - mx);
              varV += dv * dv; covVy += dv * (s.sy - my);
            }
            const kx = varH > 1e-10 ? covHx / varH : 0;
            const ky = varV > 1e-10 ? covVy / varV : 0;
            const px = mx + kx * (g.rawH - mh);
            const py = my + ky * (g.rawV - mv);
            predClose = Math.hypot(CALIB_POINTS[calibStep][0] - px, CALIB_POINTS[calibStep][1] - py) < CALIB_ON_DOT_R;
          }
          speed = predClose === true || distinct ? 1 : predClose === false ? 0.25 : 0.6;
        }

        // MOTION-PENALTY GATE (replaces the rigid "dart-then-hold" gate).
        // That gate deadlocked between adjacent dots: a short hop (center →
        // top-left) that never crossed the rigid threshold filled the ring
        // on micro-drift, and the then-required "dart" could never fire
        // (calibStep is captured state) — the ritual froze FOREVER on dot 2.
        // Now steadiness accrues time and motion decays it: the ritual can
        // never lock, and a deliberate dart costs only ~0.4s of re-settle.
        const w = calibWin.current;
        if (!moving) {
          // Rolling window, NOT a cumulative mean: motion onset is detected
          // against a stale reference, so the first frames of a steady run
          // can carry movement. Capped + shifted → by ring-full only the
          // most recent truly-steady frames are averaged — tighter fit.
          w.push({ h: g.rawH, v: g.rawV, yaw: g.yaw, pitch: g.pitch });
          if (w.length > 14) w.shift();
          calibPctRef.current = Math.min(1, calibPctRef.current + (dt * speed) / CALIB_DWELL_MS);
        } else {
          w.length = 0; // clear in place — `w` must remain the live window
          calibPctRef.current = Math.max(0, calibPctRef.current - dt / (CALIB_DWELL_MS * 2.5));
        }
        const pct = calibPctRef.current;
        if (tNow - lastCalibUi.current > 80) {
          lastCalibUi.current = tNow;
          setCalibPct(pct);
        }
        if (pct >= 1) {
            if (w.length > 5) {
              const n = w.length;
              const avg = w.reduce(
                (acc, s) => ({
                  h: acc.h + s.h / n,
                  v: acc.v + s.v / n,
                  yaw: acc.yaw + s.yaw / n,
                  pitch: acc.pitch + s.pitch / n,
                }),
                { h: 0, v: 0, yaw: 0, pitch: 0 }
              );
              calibSamples.current.push({
                ...avg,
                sx: CALIB_POINTS[calibStep][0],
                sy: CALIB_POINTS[calibStep][1],
              });
              // EARLY DEGENERACY CHECK — 6 dots in, the samples must differ.
              // A stare-through run is caught HERE instead of after all 17 dots.
              if (calibSamples.current.length === 6) {
                const hs5 = calibSamples.current.map((s) => s.h);
                const vs5 = calibSamples.current.map((s) => s.v);
                const spanH5 = Math.max(...hs5) - Math.min(...hs5);
                const spanV5 = Math.max(...vs5) - Math.min(...vs5);
                if (spanH5 < 0.006 && spanV5 < 0.004) {
                  calibSamples.current = [];
                  calibWin.current = [];
                  calibPctRef.current = 0;
                  setCalibPct(0);
                  setCalibStep(0);
                  setCalibAttempt((n) => n + 1);
                  setCalibHint("gaze signal isn't moving — glance at each dot with your EYES");
                  return;
                }
              }
            }
            calibWin.current = [];
            calibPctRef.current = 0;
            setCalibPct(0);
            if (calibStep + 1 >= CALIB_POINTS.length) {
              const fit = fitGaze(calibSamples.current);
              // RAW-SPREAD GUARD — the degenerate-fit killer. Require the raw
              // span to cover a real gaze range across all 17 samples.
              let spreadOk = false;
              if (fit && calibSamples.current.length >= 9) {
                const hs = calibSamples.current.map((s) => s.h);
                const vs = calibSamples.current.map((s) => s.v);
                const spanH = Math.max(...hs) - Math.min(...hs);
                const spanV = Math.max(...vs) - Math.min(...vs);
                // Thresholds sit just above a stare-through run (~0.004 noise span).
                // Low-span users legitimately reach 0.01-0.03.
                spreadOk = spanH > 0.008 && spanV > 0.005;
              }
              // Quadratic model: residual threshold slightly relaxed (0.5 vs 0.45)
              // since 8-feature fit has more parameters and may oscillate slightly.
              if (fit && fit.residual < 0.5 && fitIsSane(fit.coeffs) && spreadOk) {
                const normed = normalizeFit(fit.coeffs, calibSamples.current);
                coeffs.current = normed;
                hasRealCalib.current = true;
                saveCalibration(normed);
                setHasCalib(true);
                setCalibQuality(fit.residual);
                setCalibAttempt(0);
                setUiMode("cursor");
              } else {
                // RESTART WITH FEEDBACK — silent restarts made the ritual look
                // broken ("calibrated 3 times, still calibrating"). Count the
                // attempt and tell the user which fix to try next.
                calibSamples.current = [];
                setCalibStep(0);
                setCalibPct(0);
                setCalibAttempt((n) => n + 1);
                const why = !fit
                  ? "tracker saw no eye movement — glance clearly between dots"
                  : !fitIsSane(fit.coeffs)
                  ? "signal didn't travel — make BIGGER eye darts, keep head still"
                  : !spreadOk
                  ? "gaze barely moved — actually LOOK at each dot, don't stare at one spot"
                  : "jittery signal — keep gaze steady on each dot";
                setCalibHint(why);
                console.warn("[EyeControl] calibration restart:", why, fit?.coeffs);
              }
            } else {
              setCalibStep((s) => s + 1); // next dot — no arming gate to deadlock
            }
          }
        return;
      }

        // ─── Cursor mode: engage → glide → settle ────────────────────────────
      if (uiMode === "cursor") {
        // ─── Adaptive blink gate (lighting-proof) ─────────────────────
        // Fixed openness thresholds froze the drive whenever ambient
        // conditions shifted: a bright focused page → squint/glare →
        // openness reads "closed" forever → cursor parked while JARVIS is
        // on screen, and "magically" worked when looking at something else.
        // The gate now tracks the user's rolling open-eye baseline: a real
        // blink collapses openness ~2× below baseline, while lighting
        // changes move the baseline WITH them.
        const o = g.openness;
        if (eyesOpen.current && o > 0.25) {
          openBase.current = openBase.current * 0.985 + o * 0.015;
        }
        const closed = eyesOpen.current
          ? o < Math.max(OPEN_BASE_MIN, openBase.current * 0.55)
          : o < 0.3;
        const open = o > Math.max(0.3, openBase.current * 0.7);

        if (closed) {
          eyesClosedRef.current = true;
          if (eyesOpen.current) {
            eyesOpen.current = false;
            closedAt.current = now;
          }
          // Eyes closed → gaze unreliable; hold still. FAILSAFE: a stuck
          // "closed" (misread — lighting/squint) resumes after 2.5s instead
          // of freezing the cursor forever.
          if (closedAt.current !== null && now - closedAt.current > BLINK_FALLBACK_MS) {
            eyesOpen.current = true;
            closedAt.current = null;
            blinkFallbackSince.current = now;
            settleUntil.current = now + 300;
            eyesClosedRef.current = false;
          } else {
            lastDriveAt.current = now;
            return;
          }
        }

        if (!eyesOpen.current && open) {
          eyesClosedRef.current = false;
          const dur = closedAt.current ? now - closedAt.current : Infinity;
          eyesOpen.current = true;
          closedAt.current = null;
          const inCooldown = now - lastClick.current <= BLINK_COOLDOWN_MS;
          if (dur < BLINK_MAX_MS && !inCooldown) {
            lastClick.current = now;
            sendInput({ action: "click" });
            setClickFlash(true);
            setTimeout(() => setClickFlash(false), 220);
            if (practiceRef.current) {
              setBlinkStats((s) => {
                const streak = s.streak + 1;
                return { clicks: s.clicks + 1, ignored: s.ignored, streak, best: Math.max(s.best, streak) };
              });
              pushCoach("click");
            }
          } else if (practiceRef.current && Number.isFinite(dur)) {
            setBlinkStats((s) => ({ ...s, ignored: s.ignored + 1, streak: 0 }));
            pushCoach(inCooldown ? "cooldown" : "held");
          }
          // Reopen frames carry garbage gaze — freeze briefly.
          settleUntil.current = now + REOPEN_FREEZE_MS;
          return;
        }

        if (now < settleUntil.current) return;

        const c = coeffs.current ?? DEFAULT_COEFFS;
        // Apply rawV/rawH baseline correction when using DEFAULT_COEFFS.
        // This measures the user's resting gaze for the first 90 frames and
        // offsets it so center-screen gaze maps to (0.5, 0.5).
        let correctedH = g.rawH;
        let correctedV = g.rawV;
        if (!hasRealCalib.current) {
          const bH = rawHBaseline.current;
          const bV = rawVBaseline.current;
          if (bH.value === null) {
            bH.sum += g.rawH;
            bH.count++;
            if (bH.count >= 90) bH.value = bH.sum / bH.count;
          } else {
            correctedH = g.rawH - bH.value;
          }
          if (bV.value === null) {
            bV.sum += g.rawV;
            bV.count++;
            if (bV.count >= 90) bV.value = bV.sum / bV.count;
          } else {
            correctedV = g.rawV - bV.value;
          }
        }
        const p = mapGaze(c, correctedH, correctedV, g.yaw, g.pitch);
        // Defensive: never let a non-finite prediction reach the OS.
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          resetDrive();
          return;
        }
        const tx = Math.max(0, Math.min(1, 0.5 + (p.x - 0.5) * GAZE_GAIN));
        const ty = Math.max(0, Math.min(1, 0.5 + (p.y - 0.5) * GAZE_GAIN));
        const sx = fx.current.filter(tx, now);
        const sy = fy.current.filter(ty, now);
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
          resetDrive();
          return;
        }

        targetRef.current = { x: sx, y: sy };
        return;
      }

      // ─── Targets mode (dwell to open) ─────────────────────────────────────
      const dp = displayPoint(g);
      const hit = targetsRef.current.find((t) => Math.hypot(t.x - dp.x, t.y - dp.y) < 0.08);
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
    [uiMode, calibStep, sendInput, displayPoint, pushCoach, resetDrive]
  );

  // Entering cursor mode or toggling practice: park at current gaze +
  // settle window (a fresh park both ways — no stale anchor across the
  // black stage boundary).
  useEffect(() => {
    if (uiMode === "cursor") {
      resetDrive();
    }
  }, [uiMode, practice, resetDrive]);

  // ─── Target drill driver (practice stage) ─────────────────────────────
  // Polls the live gaze 10×/s; a steady gaze inside the target fills the
  // ring; a filled ring advances to the next dot. Drifting away DECAYS the
  // ring instead of hard-resetting — forgiving, like the calibration ritual.
  useEffect(() => {
    if (!practice || uiMode === "calib") return;
    const iv = setInterval(() => {
      const d = drillRef.current;
      if (!d) return;
      const g = gazeRef.current;
      const p = displayPoint(g);
      const [tx, ty] = CALIB_POINTS[d.idx];
      if (g.faceFound && Math.hypot(tx - p.x, ty - p.y) < DRILL_RADIUS) {
        d.hold += 100;
        if (d.hold >= DRILL_DWELL_MS) {
          d.hold = 0;
          d.idx = (d.idx + 1) % CALIB_POINTS.length;
          setDrillHits((h) => h + 1);
          if (d.idx === 0) {
            drillRef.current = null;
            setDrillUi(null);
            pushCoach("drill");
            return;
          }
        }
      } else {
        d.hold = Math.max(0, d.hold - 150);
      }
      setDrillUi({ idx: d.idx, pct: Math.min(1, d.hold / DRILL_DWELL_MS) });
    }, 100);
    return () => clearInterval(iv);
  }, [practice, uiMode, displayPoint, pushCoach]);

  // Esc exits practice.
  useEffect(() => {
    if (!practice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopPractice();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [practice, stopPractice]);

  // Live diagnostic: cursor mode active but the drive is idle → say why.
  useEffect(() => {
    if (uiMode !== "cursor" || !coeffs.current) {
      setDriveStalled(false);
      return;
    }
    const iv = setInterval(() => {
      const idle = performance.now() - lastDriveAt.current;
      const stalled = idle > 2500 && blinkFallbackSince.current === null;
      setDriveStalled(stalled);
      if (stalled) {
        const g = gazeRef.current;
        console.info("[EyeControl] drive idle", {
          ms: Math.round(idle),
          rawH: +g.rawH.toFixed(3),
          rawV: +g.rawV.toFixed(3),
          yaw: +g.yaw.toFixed(3),
          pitch: +g.pitch.toFixed(3),
          openness: +g.openness.toFixed(2),
          faceFound: g.faceFound,
        });
      }
    }, 500);
    return () => clearInterval(iv);
  }, [uiMode]);

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

  const { videoRef, ready, error } = useEyeControl({ enabled: enabled && camGranted, onFrame: handleFrame });

  // ─── 60Hz Decoupled Gaze Drive Loop ───────────────────────────────────────
  // Decoupled from camera frame rate: interpolates smoothly at 60Hz,
  // immune to background tab throttling via backgroundTicker.
  useEffect(() => {
    if (!enabled || !camGranted || uiMode !== "cursor") return;
    let stopped = false;
    let last = performance.now();
    const releaseKeepAlive = backgroundTicker.acquire("eye-cursor-drive");

    const tick = () => {
      if (stopped) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.008, (now - last) / 1000));
      last = now;

      const target = targetRef.current;
      if (target && !eyesClosedRef.current && now >= settleUntil.current) {
        const out = cursor.current.step(target, dt);
        lastDriveAt.current = now;
        if (
          out &&
          (Math.abs(out.x - lastSentRef.current.x) >= 0.001 ||
            Math.abs(out.y - lastSentRef.current.y) >= 0.001)
        ) {
          lastSentRef.current = { x: out.x, y: out.y };
          sendInput({ action: "move", nx: out.x, ny: out.y });
        }
      }
      driveTimer.current = setTimeout(tick, 16);
    };

    const unsub = backgroundTicker.subscribe(() => {
      if (!stopped) tick();
    });
    driveTimer.current = setTimeout(tick, 16);

    return () => {
      stopped = true;
      clearTimeout(driveTimer.current);
      unsub();
      releaseKeepAlive();
    };
  }, [enabled, camGranted, uiMode, sendInput]);

  // ─── Background control (PIN) ─────────────────────────────────────────
  // A hidden tab throttles requestAnimationFrame to zero — tracking dies
  // the moment you switch windows. Moving the camera preview into a
  // Document-PiP (always-on-top) window keeps the page "visible" to
  // Chrome, so gaze control keeps working in OTHER apps.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    if (!enabled || !camGranted) return;
    // Practice stage is chrome-free: never mount the preview into the hidden
    // stage (it would reappear once Jarvis UI unmounts it on next toggle).
    if (practice) {
      videoRef.current?.remove();
      return;
    }
    const slot = stageRef.current;
    const v = videoRef.current;
    if (!slot || !v) return;
    if (v.parentNode !== slot) {
      v.style.width = "100%";
      v.style.height = "100%";
      v.style.objectFit = "cover";
      v.style.transform = "scaleX(-1)";
      slot.appendChild(v);
      v.play?.().catch(() => {});
    }
  }, [enabled, camGranted, ready, videoRef, practice]);
  const pin = useCallback(async () => {
    try {
      if (pipWindow()) return setPinned(true);
      if (!stageRef.current) return;
      await openPiPWith([stageRef.current], { width: 224, height: 176 });
      setPinned(true);
    } catch {
      // PiP unsupported/refused — in-tab control still works.
    }
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      if (!pipWindow() && pinned) setPinned(false);
    }, 600);
    return () => clearInterval(id);
  }, [pinned]);

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
    calibWin.current = [];
    calibPctRef.current = 0;
    lastCalibUi.current = 0;
    saccadeRef.current = { h: 0, v: 0 };
    saccadeCount.current = 0;
    setCalibStep(0);
    setCalibPct(0);
    setCalibHint(null);
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
            {/* Practice mode hides ALL Jarvis chrome — black stage, cursor only.
             * Calibration renders as its own top-level layer (see below). */}
            {!practice && (
              <>
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
                style={{
                  left: `${displayPoint(gaze).x * 100}%`,
                  top: `${displayPoint(gaze).y * 100}%`,
                }}
              />
            )}
            {uiMode === "cursor" && clickFlash && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-24 h-24 rounded-full border-2 border-[#00FF9D] animate-ping" />
              </div>
            )}

            {/* ── Camera preview / PiP stage (bottom-left) ── */}
            {enabled && camGranted && ready && !practice && (
              <div
                ref={stageRef}
                className="absolute bottom-5 left-5 w-40 aspect-[4/3] rounded-xl overflow-hidden border border-panel-border/50 bg-black pointer-events-auto"
                title="camera preview — PIN moves this into an always-on-top window so tracking keeps running in other apps"
              />
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
                        ? driveStalled
                          ? "CURSOR: signal stuck — glance wider or recalibrate"
                          : "CURSOR: gaze drives mouse · blink = click"
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
                        coeffs.current = DEFAULT_COEFFS;
                        hasRealCalib.current = false;
                        rawVBaseline.current = { sum: 0, count: 0, value: null };
                        rawHBaseline.current = { sum: 0, count: 0, value: null };
                        setHasCalib(false);
                        setUiMode("targets");
                      }}
                      className="font-rajdhani text-[10px] text-text-secondary/40 hover:text-accent-red px-1"
                      title="Delete saved calibration"
                    >
                      reset
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setPractice(true);
                      if (hasCalib) setUiMode("cursor");
                    }}
                    className="flex items-center gap-1.5 font-rajdhani text-[11px] px-3 py-1.5 rounded-full border bg-deep-space/70 border-panel-border/50 text-text-secondary/80 hover:text-text-secondary"
                    title="Fullscreen black practice stage — free cursor, target drill and blink coaching (Esc exits)"
                  >
                    <Gamepad2 className="w-3.5 h-3.5" />
                    PRACTICE
                  </button>
                  {uiMode === "cursor" && pipSupported() && (
                    <button
                      onClick={pin}
                      className={`flex items-center gap-1.5 font-rajdhani text-[11px] px-3 py-1.5 rounded-full border transition-colors ${
                        pinned
                          ? "bg-reactor-core/15 border-reactor-core/50 text-reactor-core"
                          : "bg-deep-space/70 border-panel-border/50 text-text-secondary/80 hover:text-text-secondary"
                      }`}
                      title="Keep eye control alive when you switch to other apps (always-on-top mini window)"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      {pinned ? "PINNED · works in background" : "PIN · background control"}
                    </button>
                  )}
                </div>
              )}
            </div>
              </>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ── CALIBRATION RITUAL — own top-level layer at z-[90] ───────────
       * Same stacking-context reasoning as the practice stage: the ritual
       * must own the whole screen (pure black, zero chrome) wherever it's
       * launched from. */}
      <AnimatePresence>
        {enabled && uiMode === "calib" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black pointer-events-auto"
          >
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
                    <svg className="absolute inset-0 w-full h-full -rotate-90">
                      <circle
                        cx="28" cy="28" r="24"
                        fill="none"
                        stroke={done ? "#00FF9D" : active ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.14)"}
                        strokeWidth={active ? "2" : "1.5"}
                      />
                      {active && (
                        <circle
                          cx="28" cy="28" r="24"
                          fill="none"
                          stroke="#00FF9D"
                          strokeWidth="2"
                          strokeDasharray={`${2 * Math.PI * 24}`}
                          strokeDashoffset={`${2 * Math.PI * 24 * (1 - calibPct)}`}
                          strokeLinecap="round"
                        />
                      )}
                    </svg>
                    <div
                      className={`w-2 h-2 rounded-full ${
                        done ? "bg-[#00FF9D]/80" : active ? "bg-white/80" : "bg-white/20"
                      }`}
                    />
                  </div>
                </div>
              );
            })}
            <div className="absolute top-6 left-1/2 -translate-x-1/2 text-center">
              <div className="font-rajdhani text-sm tracking-[0.25em] text-white/70">
                STARK GAZE CALIBRATION — QUADRATIC MODEL
              </div>
              <div className="font-rajdhani text-xs text-white/40 mt-1">
                Look at the glowing dot — hold still until the ring fills · {calibStep + 1} / {CALIB_POINTS.length}
              </div>
              <div className="font-rajdhani text-[11px] text-cyan-400/50 mt-1">
                Keep head still · move only your EYES · each dot takes ~1s
              </div>
              {calibAttempt > 0 && calibHint && (
                <div className="font-rajdhani text-xs text-amber-300/80 mt-2 border border-amber-300/25 rounded-lg px-3 py-1.5 inline-block">
                  attempt {calibAttempt}: {calibHint}
                </div>
              )}
            </div>
            <button
              onClick={() => setUiMode(coeffs.current ? "cursor" : "targets")}
              className="absolute top-5 left-5 font-rajdhani text-xs text-white/40 hover:text-white/80 transition-colors"
            >
              ✕ exit calibration
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── PRACTICE STAGE — own top-level layer at z-[90] ────────────────
       * The overlay above is a z-40 stacking context; page chrome (command
       * bars at z-[75]/z-50) painted OVER it. As a sibling fixed layer at
       * z-[90], the black stage covers every piece of Jarvis chrome. */}
      <AnimatePresence>
        {enabled && practice && uiMode !== "calib" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black pointer-events-none"
          >
            {error && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 font-rajdhani text-xs text-amber-400/80">
                {error}
              </div>
            )}
                {/* Drill target */}
                {drillUi &&
                  CALIB_POINTS.map(([x, y], i) => {
                    if (i !== drillUi.idx) return null;
                    return (
                      <div
                        key={i}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                      >
                        <div className="relative w-10 h-10 flex items-center justify-center">
                          <svg className="absolute inset-0 w-full h-full -rotate-90">
                            <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
                            <circle
                              cx="20" cy="20" r="17"
                              fill="none"
                              stroke="#00FF9D"
                              strokeWidth="2"
                              strokeDasharray={`${2 * Math.PI * 17}`}
                              strokeDashoffset={`${2 * Math.PI * 17 * (1 - drillUi.pct)}`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="w-1.5 h-1.5 rounded-full bg-[#00FF9D]/80" />
                        </div>
                      </div>
                    );
                  })}

                {/* The ONLY cursor on stage */}
                {gaze?.faceFound && (
                  <div
                    className="absolute w-3.5 h-3.5 rounded-full -translate-x-1/2 -translate-y-1/2 bg-[#00FF9D] shadow-[0_0_16px_rgba(0,255,157,0.9)]"
                    style={{
                      left: `${displayPoint(gaze).x * 100}%`,
                      top: `${displayPoint(gaze).y * 100}%`,
                    }}
                  />
                )}
                {clickFlash && (
                  <div
                    className="absolute w-20 h-20 rounded-full border-2 border-[#00FF9D] animate-ping -translate-x-1/2 -translate-y-1/2"
                    style={{
                      left: gaze ? `${displayPoint(gaze).x * 100}%` : "50%",
                      top: gaze ? `${displayPoint(gaze).y * 100}%` : "50%",
                    }}
                  />
                )}

                {/* Blink-intent coach feedback — quiet, one line */}
                <AnimatePresence>
                  {blinkCoach && (
                    <motion.div
                      key={blinkCoach.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className={`absolute top-20 left-1/2 -translate-x-1/2 font-rajdhani text-[13px] tracking-wide px-4 py-1.5 rounded-full border ${
                        blinkCoach.kind === "click" || blinkCoach.kind === "drill"
                          ? "text-[#00FF9D]/90 border-[#00FF9D]/25"
                          : "text-amber-300/80 border-amber-300/20"
                      }`}
                    >
                      {blinkCoach.kind === "click" && "click ✓"}
                      {blinkCoach.kind === "held" && "held too long — blink quicker"}
                      {blinkCoach.kind === "cooldown" && "too soon — wait a beat"}
                      {blinkCoach.kind === "drill" && `drill complete · ${drillHits} targets`}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Stats — minimal counters */}
                <div className="absolute top-5 left-1/2 -translate-x-1/2 flex items-center gap-6 font-rajdhani text-xs text-text-secondary/50">
                  <span>
                    <b className="text-[#00FF9D]/90 text-sm">{blinkStats.clicks}</b> clicks
                  </span>
                  <span>
                    <b className="text-amber-300/80 text-sm">{blinkStats.ignored}</b> ignored
                  </span>
                  <span>
                    <b className="text-white/70 text-sm">{blinkStats.streak}</b> streak · best {blinkStats.best}
                  </span>
                </div>

                {/* Practice controls — text-quiet buttons */}
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-5 pointer-events-auto">
                  {!drillUi ? (
                    <button
                      onClick={startDrill}
                      className="font-rajdhani text-xs tracking-wide text-[#00FF9D]/80 hover:text-[#00FF9D] transition-colors"
                    >
                      start target drill
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        drillRef.current = null;
                        setDrillUi(null);
                      }}
                      className="font-rajdhani text-xs tracking-wide text-white/50 hover:text-white/80 transition-colors"
                    >
                      stop drill
                    </button>
                  )}
                  <span className="text-white/15">·</span>
                  <button
                    onClick={startCalib}
                    className="font-rajdhani text-xs tracking-wide text-white/50 hover:text-white/80 transition-colors"
                    title="Run the 13-dot ritual on this black stage"
                  >
                    calibrate
                  </button>
                </div>
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 font-rajdhani text-[10px] text-white/20">
                  blink = click · esc exits
                </div>
                <button
                  onClick={stopPractice}
                  className="absolute top-4 right-5 font-rajdhani text-xs text-white/35 hover:text-white/70 transition-colors pointer-events-auto"
                >
                  close ✕
                </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
