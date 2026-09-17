"use client";

/**
 * ArcReactor — J.A.R.V.I.S. MARK II core.
 *
 * Flat SVG HUD (no three.js): layered structural rings, segmented energy
 * collar, voice-reactive particle clusters, and a glowing state-label core —
 * modeled after the MARK II film HUD. One requestAnimationFrame loop drives
 * every rotation; React re-renders only on state/hue changes.
 *
 * Boot: the reactor ASSEMBLES — layers snap in core-first with spring
 * physics and a synthesized power-up soundtrack (WebAudio, no assets).
 *
 * Replaces the old WebGL orb: no scene fog (which tinted the whole page
 * cyan), no canvas glare — sits cleanly on a pure black background.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useJarvisStore } from "@/store/jarvis.store";
import { useAudioReactivity } from "@/hooks/useAudioReactivity";
import { playRepulsor, primeRepulsor } from "@/lib/sounds";

/* ─── Hue palettes (driven by reactorHue from useReactorDrive) ───────── */

const HUES = {
  cyan: { accent: "#00D4FF", soft: "#7DF9FF", deep: "#0E5F7A", white: "#CFEFFC", ring: "#0A6EE0", ringBright: "#2E9BFF" },
  gold: { accent: "#FFD700", soft: "#FFE664", deep: "#7A5E0E", white: "#FFF4D6", ring: "#C79000", ringBright: "#FFC933" },
  red:  { accent: "#FF3B47", soft: "#FF8A93", deep: "#7A1420", white: "#FFD9DC", ring: "#C21F2C", ringBright: "#FF5A66" },
  dim:  { accent: "#4A8CB8", soft: "#9CC4DC", deep: "#1E3A4E", white: "#D8E8F0", ring: "#2E6396", ringBright: "#5EA8DC" },
} as const;

type HueKey = keyof typeof HUES;

/* ─── Geometry constants (viewBox units, canvas is -500..500) ─────────── */

const TICKS_MAIN = 72;
const TICKS_BRIGHT = 24;
const SEGS_RING = 48;

/** Precompute dash arrays so ticks/segments are perfectly even. */
const DASH = (() => {
  const circ = (r: number) => 2 * Math.PI * r;
  const tickMain = circ(370) / TICKS_MAIN;
  const tickBright = circ(370) / TICKS_BRIGHT;
  const seg = circ(200) / SEGS_RING;
  return {
    ticksMain: `2 ${tickMain - 2}`,
    ticksBright: `2.5 ${tickBright - 2.5}`,
    segBright: `${seg * 0.55} ${seg * 0.45}`,
    segDim: `${seg * 0.3} ${seg * 0.7}`,
    dots: "0.5 7",
  };
})();

/* ─── Particle belt layout (deterministic — no hydration drift) ───────── */

interface BeltDot {
  angle: number; // degrees
  radius: number;
  size: number;
  phase: number;
  colorIdx: number;
}

function buildBelt(): BeltDot[] {
  const dots: BeltDot[] = [];
  const palette = [0, 1, 2, 1, 0, 3]; // accent, soft, white, deep…
  let seed = 7;
  const rand = () => {
    // Deterministic LCG — same belt on server & client.
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let c = 0; c < 14; c++) {
    const baseAngle = c * (360 / 14) + rand() * 14;
    const baseRadius = 238 + rand() * 42;
    const clusterSize = 3 + Math.floor(rand() * 3);
    for (let d = 0; d < clusterSize; d++) {
      dots.push({
        angle: baseAngle + d * (5 + rand() * 6),
        radius: baseRadius + (rand() - 0.5) * 26,
        size: 3 + rand() * 5.5,
        phase: rand() * Math.PI * 2,
        colorIdx: palette[Math.floor(rand() * palette.length)],
      });
    }
  }
  return dots;
}

const BELT = buildBelt();

/* ─── State label mapping ─────────────────────────────────────────────── */

const STATE_LABEL: Record<string, string> = {
  booting: "INITIALIZING",
  idle: "STANDBY",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
  sleep: "DORMANT",
};

/* ─── The MARK II visual ──────────────────────────────────────────────── */

function MarkIIReactor({ hue }: { hue: HueKey }) {
  const state = useJarvisStore((s) => s.state);
  const label = STATE_LABEL[state] ?? "STANDBY";
  const c = HUES[hue];
  const audioRef = useAudioReactivity();

  // Mutable refs the rAF loop drives — zero re-renders per frame.
  const gStruct = useRef<SVGGElement>(null);   // outer structural ring
  const gTicks = useRef<SVGGElement>(null);    // tick ring
  const gBelt = useRef<SVGGElement>(null);     // particle belt
  const gSeg = useRef<SVGGElement>(null);      // segmented energy ring
  const gSegB = useRef<SVGGElement>(null);     // counter-phase dim segments
  const gCollar = useRef<SVGGElement>(null);   // inner collar
  const gCore = useRef<SVGGElement>(null);     // breathing core
  const coreDot = useRef<SVGCircleElement>(null);
  const segRing = useRef<SVGCircleElement>(null);
  const pwrText = useRef<SVGTextElement>(null);
  const flecks = useRef<SVGGElement>(null);    // alert flecks
  const segGlow = useRef<SVGCircleElement>(null); // collar glow underlay
  const gSegWrap = useRef<SVGGElement>(null);  // hero ring assembly wrapper
  const gTele = useRef<SVGGElement>(null);     // quiet telemetry block
  const beltDots = useRef<(SVGCircleElement | null)[]>([]);

  // Single animation loop — every ring, every dot, every breath, and the
  // whole boot assembly. One clock, so motion and beats stay in perfect sync.
  // All store values read via getState() (no subscriptions, no re-renders).
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let t = 0;                            // seconds of accumulated animation time
    let bootStart: number | null = null;  // timestamp of the power-gate press

    // Apple-style ease-out — fast attack, long silky settle.
    const easeOut = (x: number) => (x <= 0 ? 0 : 1 - Math.pow(1 - x, 4));
    /** Assembly progress of one layer: delay/duration in seconds since press. */
    const stage = (boot: number, delay: number, dur: number) =>
      easeOut(Math.min(1, Math.max(0, (boot - delay) / dur)));

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const st = useJarvisStore.getState();
      if (st.assemblyStarted && bootStart === null) bootStart = now;
      const boot = bootStart === null ? -1 : (now - bootStart) / 1000;

      // Sleep = barely alive; booting = cautious spin-up.
      const speed =
        st.state === "sleep" ? 0.12 : st.state === "booting" ? 0.55 : 1;
      t += dt * speed;

      const voice = st.voiceLevel;
      const load = st.reactorLoad;
      // Music reactivity — the collar dances when system audio plays.
      const audio = audioRef.current;
      const music = audio.musicPlaying ? audio.reactivity : 0;

      // Alert pulse (3s decay from reactorPulse).
      const since = st.reactorPulse > 0 ? (Date.now() - st.reactorPulse) / 1000 : 999;
      const alertBoost = since < 3 ? 1 - since / 3 : 0;

      // Boot assembly choreography:
      // core ignites > collar snaps > belt blooms > hero ring lands >
      // tick ring collapses in > outer orbit settles > telemetry fades.
      const pCore   = reduced ? 1 : stage(boot, 0.0, 0.9);
      const pCollar = reduced ? 1 : stage(boot, 0.35, 0.9);
      const pBelt   = reduced ? 1 : stage(boot, 0.6, 0.9);
      const pRing   = reduced ? 1 : stage(boot, 0.9, 1.0);
      const pTicks  = reduced ? 1 : stage(boot, 1.25, 0.9);
      const pOrbit  = reduced ? 1 : stage(boot, 1.6, 1.1);
      const pTele   = reduced ? 1 : stage(boot, 2.3, 0.9);

      if (gCore.current) {
        const breath =
          (1 + Math.sin(t * 1.35) * 0.022 + voice * 0.07 + music * 0.09 + alertBoost * 0.06) *
          Math.max(0.0001, pCore);
        gCore.current.setAttribute("transform", "scale(" + breath.toFixed(4) + ")");
        gCore.current.setAttribute("opacity", pCore.toFixed(3));
      }
      if (gCollar.current) {
        const s = 0.5 + 0.5 * pCollar;
        gCollar.current.setAttribute("transform", "rotate(" + (t * 9).toFixed(2) + ") scale(" + s.toFixed(4) + ")");
        gCollar.current.setAttribute("opacity", pCollar.toFixed(3));
      }
      if (gBelt.current) {
        const s = 1.3 - 0.3 * pBelt;
        gBelt.current.setAttribute("transform", "rotate(" + (t * 7).toFixed(2) + ") scale(" + s.toFixed(4) + ")");
        gBelt.current.setAttribute("opacity", pBelt.toFixed(3));
      }
      if (gSegWrap.current) {
        const s = 0.6 + 0.4 * pRing;
        gSegWrap.current.setAttribute("transform", "scale(" + s.toFixed(4) + ")");
        gSegWrap.current.setAttribute("opacity", pRing.toFixed(3));
      }
      if (gTicks.current) {
        const s = 0.3 + 0.7 * pTicks;
        gTicks.current.setAttribute("transform", "rotate(" + (-t * 4.5).toFixed(2) + ") scale(" + s.toFixed(4) + ")");
        gTicks.current.setAttribute("opacity", pTicks.toFixed(3));
      }
      if (gStruct.current) {
        const s = 1.5 - 0.5 * pOrbit;
        const rot = -30 * (1 - pOrbit) + t * 2.2;
        gStruct.current.setAttribute("transform", "rotate(" + rot.toFixed(2) + ") scale(" + s.toFixed(4) + ")");
        gStruct.current.setAttribute("opacity", pOrbit.toFixed(3));
      }
      if (gTele.current) {
        gTele.current.setAttribute("opacity", (0.4 * pTele).toFixed(3));
      }
      // Inner counter-rotating segments live inside the hero wrapper.
      if (!reduced) {
        if (gSeg.current) gSeg.current.setAttribute("transform", "rotate(" + (t * 20).toFixed(2) + ")");
        if (gSegB.current) gSegB.current.setAttribute("transform", "rotate(" + (-t * 13).toFixed(2) + ")");
      }

      if (coreDot.current) {
        coreDot.current.setAttribute(
          "opacity",
          String((0.75 + Math.sin(t * 1.35) * 0.1 + voice * 0.15) * pCore)
        );
      }

      // Segmented ring thickness tracks reactor load + music beats (hero ring).
      if (segRing.current) {
        segRing.current.setAttribute(
          "stroke-width",
          String(14 + load * 10 + music * 14 + alertBoost * 5)
        );
      }
      if (segGlow.current) {
        segGlow.current.setAttribute(
          "stroke-width",
          String(15 + load * 8 + music * 12 + alertBoost * 4)
        );
        segGlow.current.setAttribute(
          "stroke-opacity",
          String(0.14 + load * 0.16 + music * 0.3 + alertBoost * 0.12)
        );
      }

      // Voice- and music-reactive particle belt.
      for (let i = 0; i < BELT.length; i++) {
        const dot = beltDots.current[i];
        if (!dot) continue;
        const b = BELT[i];
        const wave = 0.5 + 0.5 * Math.sin(t * 4.2 + b.phase);
        const r = b.size * (0.72 + wave * 0.28 + voice * wave * 0.9 + music * wave * 1.1);
        dot.setAttribute("r", r.toFixed(2));
        dot.setAttribute("opacity", (0.28 + wave * 0.3 + voice * 0.42 + music * 0.4).toFixed(2));
      }

      // PWR telemetry at ~4Hz (cheap DOM write, tabular feel).
      if (pwrText.current && Math.floor(t * 4) !== Math.floor((t - dt * speed) * 4)) {
        pwrText.current.textContent = "PWR " + String(Math.round(load * 100)).padStart(3, "0") + "%";
      }

      // Alert flecks: whisper-faint at idle, pulsing red on alert.
      if (flecks.current) {
        const flicker = alertBoost > 0 ? 0.75 + Math.sin(t * 9) * 0.25 : 1;
        flecks.current.setAttribute(
          "opacity",
          (0.12 + alertBoost * 0.78 * flicker).toFixed(2)
        );
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <svg
      viewBox="-500 -500 1000 1000"
      className="w-full h-full"
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <defs>
        <radialGradient id="mk2-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={c.white} stopOpacity="0.95" />
          <stop offset="26%" stopColor={c.accent} stopOpacity="0.7" />
          <stop offset="58%" stopColor={c.accent} stopOpacity="0.22" />
          <stop offset="100%" stopColor={c.accent} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="mk2-iris" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#010608" stopOpacity="0.95" />
          <stop offset="80%" stopColor="#010508" stopOpacity="0.97" />
          <stop offset="100%" stopColor={c.deep} stopOpacity="0.35" />
        </radialGradient>
        <filter id="mk2-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="mk2-halo" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="mk2-text" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* ── Layer 1 · outer structural rings (Image 1's white orbit) ── */}
      <g ref={gStruct} style={{ willChange: "transform" }}>
        <circle r={442} fill="none" stroke={c.white} strokeOpacity={0.14} strokeWidth={1} />
        <circle
          r={430}
          fill="none"
          stroke={c.white}
          strokeOpacity={0.5}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray="250 90 160 130 330 70 120 220"
        />
        <circle
          r={456}
          fill="none"
          stroke={c.white}
          strokeOpacity={0.22}
          strokeWidth={1}
          strokeDasharray="3 14"
        />
        {/* red alert flecks — whisper-faint at idle, alive on alert */}
        <g ref={flecks} opacity={0.12}>
          {[
            [18, 415], [95, 388], [152, 441], [205, 372], [248, 428],
            [300, 395], [342, 448], [56, 366],
          ].map(([deg, rad], i) => (
            <circle
              key={i}
              cx={Math.cos((deg * Math.PI) / 180) * rad}
              cy={Math.sin((deg * Math.PI) / 180) * rad}
              r={i % 3 === 0 ? 5 : 3.5}
              fill="#FF2D55"
              filter="url(#mk2-soft)"
            />
          ))}
        </g>
      </g>

      {/* ── Layer 2 · tick ring ─────────────────────────────────────── */}
      <g ref={gTicks} style={{ willChange: "transform" }}>
        <circle
          r={370}
          fill="none"
          stroke={c.accent}
          strokeOpacity={0.35}
          strokeWidth={7}
          strokeDasharray={DASH.ticksMain}
        />
        <circle
          r={370}
          fill="none"
          stroke={c.soft}
          strokeOpacity={0.7}
          strokeWidth={9}
          strokeDasharray={DASH.ticksBright}
        />
        <circle r={352} fill="none" stroke={c.white} strokeOpacity={0.1} strokeWidth={1} />
      </g>

      {/* ── Layer 3 · voice-reactive particle belt ──────────────────── */}
      <g ref={gBelt} style={{ willChange: "transform" }}>
        <circle
          r={262}
          fill="none"
          stroke={c.accent}
          strokeOpacity={0.16}
          strokeWidth={2.5}
          strokeDasharray={DASH.dots}
          strokeLinecap="round"
        />
        {BELT.map((b, i) => {
          const rad = (b.angle * Math.PI) / 180;
          const colors = [c.accent, c.soft, c.white, c.deep];
          return (
            <circle
              key={i}
              ref={(el) => {
                beltDots.current[i] = el;
              }}
              cx={Math.cos(rad) * b.radius}
              cy={Math.sin(rad) * b.radius}
              r={b.size}
              fill={colors[b.colorIdx]}
              opacity={0.4}
            />
          );
        })}
      </g>

      {/* ── Layer 4 · segmented energy ring — THE blue circle (Image 1's hero) ── */}
      <g ref={gSegWrap} style={{ willChange: "transform" }}>
      {/* Soft glow underlay so the collar radiates without washing the page */}
      <circle
        ref={segGlow}
        r={204}
        fill="none"
        stroke={c.ringBright}
        strokeOpacity={0.16}
        strokeWidth={15}
        strokeDasharray={DASH.segBright}
        filter="url(#mk2-halo)"
        style={{ willChange: "transform" }}
      />
      <g ref={gSeg} style={{ willChange: "transform" }}>
        {/* continuous saturated blue base ring */}
        <circle
          r={200}
          fill="none"
          stroke={c.ring}
          strokeOpacity={0.95}
          strokeWidth={8}
        />
        <circle
          ref={segRing}
          r={200}
          fill="none"
          stroke={c.ringBright}
          strokeOpacity={0.95}
          strokeWidth={16}
          strokeDasharray={DASH.segBright}
          strokeLinecap="round"
          filter="url(#mk2-soft)"
        />
      </g>
      <g ref={gSegB} style={{ willChange: "transform" }}>
        <circle
          r={200}
          fill="none"
          stroke={c.ring}
          strokeOpacity={0.55}
          strokeWidth={10}
          strokeDasharray={DASH.segDim}
        />
        <circle r={178} fill="none" stroke={c.ringBright} strokeOpacity={0.45} strokeWidth={2} />
      </g>
      </g>

      {/* ── Layer 5 · inner collar ──────────────────────────────────── */}
      <g ref={gCollar} style={{ willChange: "transform" }}>
        <circle
          r={150}
          fill="none"
          stroke={c.accent}
          strokeOpacity={0.5}
          strokeWidth={3.5}
          strokeDasharray="5 10"
          strokeLinecap="round"
        />
        <circle r={134} fill="none" stroke={c.white} strokeOpacity={0.18} strokeWidth={1} />
      </g>

      {/* ── Layer 6 · core + state label ────────────────────────────── */}
      <g ref={gCore} style={{ willChange: "transform", transformOrigin: "0 0" }}>
        {/* tight bloom — glows on the core, not the page */}
        <circle r={118} fill={c.accent} opacity={0.1} filter="url(#mk2-halo)" />
        <circle r={96} fill="url(#mk2-core)" />
        <circle r={78} fill="url(#mk2-iris)" />
        {/* filled center disc — the MARK II's blue heart (contained, no blur) */}
        <circle r={70} fill={c.ringBright} opacity={0.16} />
        <circle r={70} fill="none" stroke={c.ringBright} strokeOpacity={0.6} strokeWidth={1.5} />
        <circle ref={coreDot} r={78} fill="none" stroke={c.soft} strokeOpacity={0.45} strokeWidth={1.2} />

        <AnimatePresence mode="wait">
          <motion.g
            key={label}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            <text
              y={4}
              textAnchor="middle"
              fill={c.white}
              fontSize={30}
              fontFamily="Orbitron, sans-serif"
              fontWeight={700}
              letterSpacing={5}
              filter="url(#mk2-text)"
            >
              {label}
            </text>
            <text
              y={30}
              textAnchor="middle"
              fill={c.accent}
              fontSize={11}
              fontFamily="Orbitron, sans-serif"
              fontWeight={500}
              letterSpacing={3.5}
              opacity={0.65}
            >
              J.A.R.V.I.S · MARK II
            </text>
          </motion.g>
        </AnimatePresence>
      </g>

      {/* ── Layer 7 · quiet telemetry on the outer field ────────────── */}
      <g
        ref={gTele}
        fontFamily="Orbitron, sans-serif"
        fontSize={13}
        letterSpacing={2.5}
        fill={c.white}
        opacity={0}
      >
        <text x={-338} y={-336} textAnchor="start">
          CORE MK.II
        </text>
        <text ref={pwrText} x={338} y={-336} textAnchor="end">
          PWR 040%
        </text>
        <text x={0} y={472} textAnchor="middle" fontSize={11} letterSpacing={4}>
          STARK INDUSTRIES · ARC REACTOR
        </text>
      </g>
    </svg>
  );
}

/* ─── Container: boot, wake/sleep, mount fade (unchanged behavior) ────── */

export default function ArcReactor() {
  const { setState, setBootProgress, bootComplete, setBootComplete } =
    useJarvisStore();
  const [isClient, setIsClient] = useState(false);
  const hue = useJarvisStore((s) => s.reactorHue);
  const [size, setSize] = useState(0);

  // Responsive: the reactor stays a centerpiece, never a sprawl —
  // scaled to the smaller viewport dimension and capped on big monitors.
  useEffect(() => {
    const fit = () =>
      setSize(
        Math.min(window.innerWidth, window.innerHeight) * 0.66
      );
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // The power gate calls this in its onClick — the same user gesture that
  // clears the overlay, so the AudioContext is unlocked right as the
  // assembly begins. Sound and motion start in the same instant.
  const startBoot = useCallback(() => {
    if (useJarvisStore.getState().assemblyStarted) return;
    useJarvisStore.getState().startAssembly();
    // Warm the repulsor sound inside this gesture so every later toggle
    // (even the first one right after a refresh) blasts instantly.
    primeRepulsor();

    const steps = [
      { progress: 0, delay: 0 },
      { progress: 10, delay: 500 },
      { progress: 30, delay: 1000 },
      { progress: 50, delay: 1800 },
      { progress: 70, delay: 2500 },
      { progress: 85, delay: 3000 },
      { progress: 100, delay: 3500 },
    ];

    (async () => {
      for (const step of steps) {
        await new Promise((resolve) =>
          setTimeout(resolve, step.delay - (steps[steps.indexOf(step) - 1]?.delay || 0))
        );
        setBootProgress(step.progress);
      }
      setBootComplete(true);
      setState("idle");
    })();
  }, [setBootProgress, setBootComplete, setState]);

  // Expose the boot trigger to the power-gate overlay via a custom event —
  // the gate lives in page.tsx, the reactor + audio live here.
  useEffect(() => {
    const onGate = () => startBoot();
    window.addEventListener("jarvis:power-gate", onGate);
    return () => window.removeEventListener("jarvis:power-gate", onGate);
  }, [startBoot]);

  const handleWake = useCallback(() => {
    if (!bootComplete) return;
    const currentState = useJarvisStore.getState().state;
    playRepulsor();
    setState(currentState === "sleep" ? "idle" : "sleep");
  }, [bootComplete, setState]);

  if (!isClient) return null;

  return (
    <motion.div
      className="absolute inset-0 z-10 cursor-pointer flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      onClick={handleWake}
    >
      <div
        className="relative"
        style={{ width: size || "66vmin", height: size || "66vmin" }}
      >
        <MarkIIReactor hue={hue} />
      </div>

      {bootComplete && (
        <motion.div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs font-rajdhani tracking-widest opacity-50"
          style={{ color: "#7EB8D4" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ delay: 6 }}
        >
          CLICK TO WAKE
        </motion.div>
      )}
    </motion.div>
  );
}
