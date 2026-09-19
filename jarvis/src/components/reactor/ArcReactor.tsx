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
 * Music: the belt and the hero ring are a circular equalizer. MusicSpectrum
 * turns the system peak meter into 28 amplitude bands — interpolated onto
 * this animation clock so nothing staircases — and every belt cluster and
 * flare arc reads its own band: columns grow outward with the music and
 * settle back as it falls. Nothing is random; the same bar always reads the
 * same way. While no music is playing the spectrum fades to zero and the
 * reactor is exactly its calm self.
 *
 * Replaces the old WebGL orb: no scene fog (which tinted the whole page
 * cyan), no canvas glare — sits cleanly on a pure black background.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useJarvisStore } from "@/store/jarvis.store";
import { useAudioReactivity } from "@/hooks/useAudioReactivity";
import { MusicSpectrum, bandAtAngle, SPECTRUM_BANDS } from "@/lib/audio/MusicSpectrum";
import { playRepulsor } from "@/lib/sounds";

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

/* ─── Amplitude response tuning (the "butter" numbers) ──────────────────
 * Band energy → displacement, then a slew-limited follower. The bands are
 * already smoothed (crisp attack, silky release) by MusicSpectrum, so these
 * exist to bound per-frame motion, not to do the shaping: set them too slow
 * and they eat the very amplitude swing they are meant to carry. A kick
 * rises in 5ms; an element needs a few frames to swell, never a teleport. */
/* ─── Amplitude response tuning (Apple-grade fluid physics) ─────────────
 * Band energy → radial expansion + stepped waveform follower.
 * Crisp attack (~20/s) gives immediate punch on kicks and transients;
 * silky release (~7.5/s) gives luxurious Apple-like float back. */
const BELT_REACH = 30; // max radial travel of outermost stepped dot
const BELT_ATTACK = 22; // 1/s — crisp attack (immediate punch)
const BELT_RELEASE = 10.5; // 1/s — silky exponential decay
const ARC_ATTACK = 18; // 1/s — flare arcs ride the band directly
const ARC_RELEASE = 8;

/* ─── Circular Stepped Waveform Layout (Pic 1 & Pic 2) ──────────────────
 * Radiating outward directly from EVERYWHERE along the blue reactor strip.
 * 48 radial columns wrap the full 360° perimeter (every 7.5°).
 * Each column has discrete stepped dots that erupt outward on beats. */

export const TOTAL_COLUMNS = 48;
export const STEPS_PER_COL = 5;

interface BeltDot {
  angle: number;   // degrees
  radius: number;  // base radius in viewBox units
  size: number;    // base dot radius
  phase: number;   // idle breath phase
  colorIdx: number;// index into palette [accent, soft, white, deep]
  band: number;    // 0..1 shimmer seed
  bandIdx: number; // spectrum band this column reads
  slot: number;    // 0..1 radial fraction in the column
  stepIdx: number; // 0..STEPS_PER_COL - 1
  colIdx: number;  // 0..TOTAL_COLUMNS - 1
}

function buildBelt(): BeltDot[] {
  const dots: BeltDot[] = [];
  for (let c = 0; c < TOTAL_COLUMNS; c++) {
    // Distributed evenly across all 360 degrees of the reactor perimeter
    const angle = (c * 360) / TOTAL_COLUMNS;
    const bandIdx = bandAtAngle(angle);
    for (let s = 0; s < STEPS_PER_COL; s++) {
      // Base radius steps outward directly from the blue reactor collar (~212)
      const radius = 222 + s * 14;
      // Dot size: subtle outward graduation (3.0 to 4.0, within 0.8 < r < 6)
      const size = 3.0 + s * 0.25;
      // Palette progression: base accent cyan -> soft glowing cyan -> bright white
      const colorIdx = s <= 1 ? 0 : s <= 2 ? 1 : 2;
      const slot = s / (STEPS_PER_COL - 1);
      const phase = ((c * 0.45 + s * 0.35) % (Math.PI * 2));
      const band = ((c * 19 + s * 29) % 100) / 100;

      dots.push({
        angle,
        radius,
        size,
        phase,
        colorIdx,
        band,
        bandIdx,
        slot,
        stepIdx: s,
        colIdx: c,
      });
    }
  }
  return dots;
}

const BELT = buildBelt();

/* ─── Hero-ring flare segments (deterministic — circular equalizer) ──────
 * The big blue ring is divided into arcs; each arc reads its own spectrum
 * band and flares thicker, brighter and nudged outward with that band's
 * amplitude — the reference HUD's hot patches, but driven by the music
 * instead of by chance. */

interface HeroSeg {
  a0: number; // start angle, degrees
  a1: number; // end angle, degrees
  band: number; // 0..1 — shapes attack/tail per segment
  bandIdx: number; // spectrum band this arc reads
}

function buildHeroSegs(): HeroSeg[] {
  const segs: HeroSeg[] = [];
  let seed = 23;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const N = 28;
  const span = 360 / N; // 12.85° per slot, arc fills ~9.5° of it
  for (let i = 0; i < N; i++) {
    const jitter = (rand() - 0.5) * 2.2;
    const a0 = i * span + 1.7 + jitter;
    segs.push({
      a0,
      a1: a0 + span - 3.4 + rand() * 1.2,
      band: rand(),
      bandIdx: bandAtAngle(a0),
    });
  }
  return segs;
}

const HERO_SEGS = buildHeroSegs();

/** SVG arc path at radius r from angle a0 to a1 (degrees). */
function arcPath(r: number, a0: number, a1: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const x0 = Math.cos(rad(a0)) * r;
  const y0 = Math.sin(rad(a0)) * r;
  const x1 = Math.cos(rad(a1)) * r;
  const y1 = Math.sin(rad(a1)) * r;
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

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
  const segFlare = useRef<(SVGPathElement | null)[]>([]); // hero-ring flare arcs

  // Single animation loop — every ring, every dot, every breath, and the
  // whole boot assembly. One clock, so motion and beats stay in perfect sync.
  // All store values read via getState() (no subscriptions, no re-renders).
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let t = 0;                            // seconds of accumulated animation time
    let bootStart: number | null = null;  // timestamp of the power-gate press
    // Integrated rotation angles — advanced by dt each frame so tempo
    // changes ACCELERATE smoothly instead of teleporting the angle.
    let rotCollar = 0, rotBelt = 0, rotTicks = 0, rotStruct = 0, rotSegA = 0, rotSegB = 0;

    // Amplitude equalizer state. The engine owns the DSP — timeline,
    // auto-gain, band splitting (lib/audio/MusicSpectrum.ts). This closure
    // owns only per-element follower state, which is inherently visual.
    let spec: MusicSpectrum | null = null;
    let lastSeq = -1;                                  // newest meter batch fed
    let spinE = 0;                                     // smoothed spin accent
    const jumpCur = new Float32Array(BELT.length);     // per-dot column state
    const segCur = new Float32Array(HERO_SEGS.length); // per-arc flare state

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
      const baseSpeed =
        st.state === "sleep" ? 0.12 : st.state === "booting" ? 0.35 : 1;
      t += dt * baseSpeed;

      const voice = st.voiceLevel;
      const load = st.reactorLoad;

      /* ── Read the circular equalizer ───────────────────────────────
       * The engine owns the DSP: it interpolates the raw meter samples onto
       * this animation clock, normalizes loudness (a whisper-quiet session
       * animates as hard as a club rig), and splits the envelope into 28
       * amplitude bands with crisp attack / silky release. We only read —
       * no per-frame randomness, no metronome, no beat guessing. A late or
       * dropped poll is absorbed by the playback delay, so it can never
       * stall or step the animation.
       */
      const audio = audioRef.current;
      if (!spec) spec = new MusicSpectrum();
      if (audio.seq !== lastSeq) {
        lastSeq = audio.seq;
        if (audio.envelope.length >= 2) {
          spec.pushEnvelope(audio.envelope, audio.envelopeT, now);
        } else {
          spec.pushLevel(audio.level, now);
        }
      }
      spec.update(dt, now, audio.musicPlaying);

      const bands = spec.bands;
      const active = spec.active;    // music presence — fades in and out
      const music = spec.energy;     // overall dance amount
      const musicBass = spec.bass;   // sustained low-end body
      const musicHit = spec.hit;     // transient accents
      // Beat punch = the kick band plus the transient layer.
      const thumpVal = Math.min(1, spec.mid * 0.8 + musicHit * 0.45);
      // Spin accent, SMOOTHED then INTEGRATED below — never multiplies `t`
      // directly, so energy changes accelerate instead of teleporting.
      spinE += (musicBass * 0.6 + musicHit * 0.4 - spinE) * Math.min(1, dt * 4);
      const spin = baseSpeed * (1 + Math.min(1, spinE) * 0.3);
      rotCollar += dt * 9 * spin;
      rotBelt += dt * 7 * spin;
      rotTicks -= dt * 4.5 * spin;
      rotStruct += dt * 2.2 * spin;
      rotSegA += dt * 20 * spin;
      rotSegB -= dt * 13 * spin;

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
          (1 + Math.sin(t * 1.35) * 0.022 + voice * 0.07 + thumpVal * 0.13 + alertBoost * 0.06) *
          Math.max(0.0001, pCore);
        gCore.current.setAttribute("transform", "scale(" + breath.toFixed(4) + ")");
        gCore.current.setAttribute("opacity", pCore.toFixed(3));
      }
      if (gCollar.current) {
        const s = (0.5 + 0.5 * pCollar) * (1 + thumpVal * 0.05);
        gCollar.current.setAttribute(
          "transform",
          "rotate(" + rotCollar.toFixed(2) + ") scale(" + s.toFixed(4) + ")"
        );
        gCollar.current.setAttribute("opacity", Math.min(1, pCollar * (0.82 + music * 0.18) + thumpVal * 0.1).toFixed(3));
      }
      if (gBelt.current) {
        const s = (1.3 - 0.3 * pBelt) * (1 + musicBass * 0.035);
        gBelt.current.setAttribute(
          "transform",
          "rotate(" + rotBelt.toFixed(2) + ") scale(" + s.toFixed(4) + ")"
        );
        gBelt.current.setAttribute("opacity", (pBelt * (0.8 + music * 0.2)).toFixed(3));
      }
      if (gSegWrap.current) {
        const s = (0.6 + 0.4 * pRing) * (1 + musicBass * 0.05 + musicHit * 0.02);
        gSegWrap.current.setAttribute("transform", "scale(" + s.toFixed(4) + ")");
        gSegWrap.current.setAttribute("opacity", (pRing * (0.88 + musicHit * 0.12)).toFixed(3));
      }
      if (gTicks.current) {
        const s = (0.3 + 0.7 * pTicks) * (1 + musicHit * 0.02);
        gTicks.current.setAttribute(
          "transform",
          "rotate(" + rotTicks.toFixed(2) + ") scale(" + s.toFixed(4) + ")"
        );
        gTicks.current.setAttribute("opacity", (pTicks * (0.85 + musicHit * 0.15)).toFixed(3));
      }
      if (gStruct.current) {
        const s = (1.5 - 0.5 * pOrbit) * (1 + musicBass * 0.012);
        const rot = -30 * (1 - pOrbit) + rotStruct;
        gStruct.current.setAttribute("transform", "rotate(" + rot.toFixed(2) + ") scale(" + s.toFixed(4) + ")");
        gStruct.current.setAttribute("opacity", pOrbit.toFixed(3));
      }
      if (gTele.current) {
        gTele.current.setAttribute("opacity", (0.4 * pTele).toFixed(3));
      }
      // Inner counter-rotating segments live inside the hero wrapper.
      if (!reduced) {
        if (gSeg.current) gSeg.current.setAttribute("transform", "rotate(" + rotSegA.toFixed(2) + ")");
        if (gSegB.current) gSegB.current.setAttribute("transform", "rotate(" + rotSegB.toFixed(2) + ")");
      }

      if (coreDot.current) {
        coreDot.current.setAttribute(
          "opacity",
          String((0.75 + Math.sin(t * 1.35) * 0.1 + voice * 0.15 + thumpVal * 0.3 + musicHit * 0.3) * pCore)
        );
      }

      // Hero ring: the uniform collar stays a calm frame — it breathes with
      // overall fullness while the flare arcs below carry the equalizer.
      // (A thumping base ring reads as disco; a steady one reads as a HUD.)
      if (segRing.current) {
        segRing.current.setAttribute(
          "stroke-width",
          String(14 + load * 10 + musicBass * 3.5 + musicHit * 1.5 + alertBoost * 5)
        );
      }
      if (segGlow.current) {
        segGlow.current.setAttribute(
          "stroke-width",
          String(15 + load * 8 + musicBass * 3 + musicHit * 1.5 + alertBoost * 4)
        );
        segGlow.current.setAttribute(
          "stroke-opacity",
          String(0.14 + load * 0.16 + musicBass * 0.16 + musicHit * 0.07 + alertBoost * 0.12)
        );
      }

      // ── Circular Stepped Waveform Equalizer (Pic 1 & Pic 2) ──
      // 28 columns radiate from the blue reactor strip.
      // Driven directly by the spectrum bands for zero lag and Apple-silky physics.
      for (let i = 0; i < BELT.length; i++) {
        const dot = beltDots.current[i];
        if (!dot) continue;
        const b = BELT[i];
        const rad = (b.angle * Math.PI) / 180;

        // Band amplitude from circular equalizer + beat punch
        const bandVal = bands[b.bandIdx];
        const amt = active > 0.001 ? 0.02 * active + 0.60 * bandVal + 0.42 * thumpVal : 0;
        const reachScale = 0.45 + 0.55 * b.slot;
        const target = reduced ? 0 : BELT_REACH * reachScale * amt;
        const cur = jumpCur[i];
        const next =
          cur + (target - cur) * Math.min(1, dt * (target > cur ? BELT_ATTACK : BELT_RELEASE));
        jumpCur[i] = next;

        const R = b.radius + next;
        dot.setAttribute("cx", (Math.cos(rad) * R).toFixed(2));
        dot.setAttribute("cy", (Math.sin(rad) * R).toFixed(2));

        const wave = 0.5 + 0.5 * Math.sin(t * (2.4 + b.band * 2.8) + b.phase);

        // Stepped waveform illumination (Pic 2):
        // Height of the stepped column tracks the smoothed excursion
        const cAmp = Math.min(1, Math.max(0, next / (BELT_REACH * reachScale || 1)));
        const step = b.stepIdx;
        const totalSteps = STEPS_PER_COL; // 6
        const activeLevel = cAmp * totalSteps;

        if (active > 0.001 && cAmp > 0.03) {
          if (step < Math.floor(activeLevel)) {
            // Fully illuminated step
            const r = b.size * (1.0 + 0.14 * cAmp);
            const op = Math.min(0.96, 0.72 + 0.24 * (step / totalSteps));
            dot.setAttribute("r", r.toFixed(2));
            dot.setAttribute("opacity", op.toFixed(3));
          } else if (step === Math.floor(activeLevel)) {
            // Crest step: the glowing tip of the stepped column
            const frac = activeLevel - step;
            const r = b.size * (1.0 + 0.30 * frac);
            const op = Math.min(0.92, 0.25 + 0.70 * frac);
            dot.setAttribute("r", r.toFixed(2));
            dot.setAttribute("opacity", op.toFixed(3));
          } else {
            // Dormant step above current peak — completely hidden
            dot.setAttribute("opacity", "0");
          }
        } else {
          // Zero audio / idle standby — completely hidden (no ghost dots)
          dot.setAttribute("opacity", "0");
        }
      }

      // ── Hero-ring circular equalizer: one arc per band ──
      // The 28 arcs map 1:1 onto the 28 bands, so the ring lights up as a
      // real equalizer: the low bands at the sides sit long and heavy while
      // the top and bottom flicker with the transients. Same butter physics
      // as the dots — crisp flare, silky relax, bounded per frame.
      for (let i = 0; i < HERO_SEGS.length; i++) {
        const p = segFlare.current[i];
        if (!p) continue;
        const hs = HERO_SEGS[i];
        const amtS = active > 0.001 ? 0.1 * active + 0.9 * bands[hs.bandIdx] : 0;
        const targetS = reduced ? 0 : amtS;
        const curS = segCur[i];
        const nextS =
          curS + (targetS - curS) * Math.min(1, dt * (targetS > curS ? ARC_ATTACK : ARC_RELEASE));
        segCur[i] = nextS;
        // Flare = thicker + brighter + nudged outward along the rim.
        const radS = 200 + nextS * 10;
        p.setAttribute("d", arcPath(radS, hs.a0, hs.a1));
        p.setAttribute("stroke-width", (7 + nextS * 16).toFixed(2));
        p.setAttribute("stroke-opacity", (0.16 + nextS * 0.72).toFixed(3));
      }

      // PWR telemetry at ~4Hz (cheap DOM write, tabular feel).
      if (pwrText.current && Math.floor(t * 4) !== Math.floor((t - dt * baseSpeed) * 4)) {
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

      {/* ── Layer 3 · circular stepped waveform equalizer (Pic 1 & Pic 2) ── */}
      <g ref={gBelt} style={{ willChange: "transform" }}>
        {BELT.map((b, i) => {
          const rad = (b.angle * Math.PI) / 180;
          const colors = [c.accent, c.soft, c.white, c.deep];
          return (
            <circle
              key={i}
              ref={(el) => {
                beltDots.current[i] = el;
              }}
              data-band={b.bandIdx}
              cx={Math.cos(rad) * b.radius}
              cy={Math.sin(rad) * b.radius}
              r={b.size}
              fill={colors[b.colorIdx]}
              opacity={0}
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
        {/* circular-equalizer flare arcs — one per spectrum band.
            data-band is for the reactor test suites (scratch/test-*.mjs). */}
        {HERO_SEGS.map((hs, i) => (
          <path
            key={i}
            ref={(el) => {
              segFlare.current[i] = el;
            }}
            data-band={hs.bandIdx}
            d={arcPath(200, hs.a0, hs.a1)}
            fill="none"
            stroke={c.ringBright}
            strokeWidth={7}
            strokeOpacity={0.16}
            strokeLinecap="round"
          />
        ))}
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

  const assemblyStarted = useJarvisStore((s) => s.assemblyStarted);
  const bootTriggered = useRef(false);

  // The power gate calls this in its onClick — the same user gesture that
  // clears the overlay, so the AudioContext is unlocked right as the
  // assembly begins. Sound and motion start in the same instant.
  const startBoot = useCallback(() => {
    if (bootTriggered.current) return;
    bootTriggered.current = true;
    useJarvisStore.getState().startAssembly();
    // The gate click is a real user gesture: this play both fires the
    // ignition blast AND loads/unlocks the element, so every later toggle
    // (even the first one right after a restart) sounds instantly.
    playRepulsor();

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

  // Expose the boot trigger to the power-gate overlay via custom event + store state
  useEffect(() => {
    const onGate = () => startBoot();
    window.addEventListener("jarvis:power-gate", onGate);
    if (useJarvisStore.getState().assemblyStarted) {
      startBoot();
    }
    return () => window.removeEventListener("jarvis:power-gate", onGate);
  }, [startBoot]);

  useEffect(() => {
    if (assemblyStarted) {
      startBoot();
    }
  }, [assemblyStarted, startBoot]);

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
