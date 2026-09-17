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
 * Music: a butter-smooth beat engine runs inside the rAF loop — asymmetric
 * attack/release envelopes (hits punch in instantly, tails melt slowly),
 * adaptive onset threshold, one-shot hit flash, and music-modulated
 * rotation speed. Every ring, tick, and belt dot dances to it.
 *
 * Replaces the old WebGL orb: no scene fog (which tinted the whole page
 * cyan), no canvas glare — sits cleanly on a pure black background.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useJarvisStore } from "@/store/jarvis.store";
import { useAudioReactivity } from "@/hooks/useAudioReactivity";
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

/* ─── Particle belt layout (deterministic — no hydration drift) ───────── */

interface BeltDot {
  angle: number; // degrees
  radius: number;
  size: number;
  phase: number;
  colorIdx: number;
  band: number;  // 0..1 pseudo-frequency band — dots pop on beats per-band
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
        band: rand(),
      });
    }
  }
  return dots;
}

const BELT = buildBelt();

/* ─── Hero-ring flare segments (deterministic — circular equalizer) ──────
 * The big blue ring is divided into arcs; each fires independently on
 * beats (scattered lottery) — thick, bright, nudged outward — like the
 * reference reactor's hot patches that rearrange around the rim. */

interface HeroSeg {
  a0: number; // start angle, degrees
  a1: number; // end angle, degrees
  band: number; // 0..1 — shapes attack/tail per segment
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

    // Beat-clock music engine state — lives in this closure, mutated in rAF.
    let m: {
      lastSampleT: number; prevLevel: number; avg: number; peakMax: number;
      onsets: number[];                                  // recent hit timestamps
      clockOn: boolean; period: number; origin: number;  // metronome PLL
      beatsFired: number; lastBeatAt: number;
      body: number; spinE: number;                       // smoothed fullness / spin
      lastAccent: number; lastAccentRolls: Float32Array; // real-hit accents
      lastRolls: Float32Array;                           // per-beat dot lottery
      segRolls: Float32Array; segCur: Float32Array;      // hero-seg lottery/followers
      segAccentRolls: Float32Array;
      prevRolls: Float32Array; prevSegRolls: Float32Array; rollAt: number;
      jumpCur: Float32Array;                             // per-dot displacement state
    } | null = null;

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

      /* ── Butter music engine ──────────────────────────────────────
       * Input: 8Hz system peak meter. Output: per-frame envelopes that
       * behave like Apple motion — instant punch, silky tails.
       * All state lives in `m` (per-effect closure), so hot reloads and
       * component remounts start fresh.
       */
      const audio = audioRef.current;
      if (!m) {
        m = {
          lastSampleT: 0, prevLevel: 0, avg: 0.09, peakMax: 0.09,
          onsets: [],
          clockOn: false, period: 500, origin: 0, beatsFired: 0, lastBeatAt: -9,
          body: 0, spinE: 0,
          lastAccent: -9, lastAccentRolls: new Float32Array(BELT.length),
          lastRolls: new Float32Array(BELT.length),
          segRolls: new Float32Array(HERO_SEGS.length),
          segCur: new Float32Array(HERO_SEGS.length),
          segAccentRolls: new Float32Array(HERO_SEGS.length),
          prevRolls: new Float32Array(BELT.length),
          prevSegRolls: new Float32Array(HERO_SEGS.length),
          rollAt: 0,
          jumpCur: new Float32Array(BELT.length),
        };
      }
      const s = audio.musicPlaying ? audio.reactivity : 0;
      // Feed at ~8Hz (the meter's cadence), not every frame.
      if (s > 0 || now - m.lastSampleT > 300) {
        if (now - m.lastSampleT >= 110) {
          // Slow-adaptive mean of recent energy — self-calibrating so quiet
          // rooms and loud clubs both produce visible hits.
          m.avg = m.avg * 0.98 + s * 0.02;
          // Running peak with ~6s half-life — the song's own loudness
          // reference. Everything visual is scaled RELATIVE to this, so a
          // quiet laptop volume animates just as big as a club rig.
          m.peakMax = Math.max(m.peakMax * Math.exp(-0.125 / 6), s);
          m.lastSampleT = now;
          // Onset = RISING EDGE over the adaptive-average gate.
          const gate = Math.max(0.03, m.avg * 1.4);
          const lastOn = m.onsets.length ? m.onsets[m.onsets.length - 1] : -9e9;
          const onset = s > gate && m.prevLevel <= gate && now - lastOn > 200;
          m.prevLevel = s;
          if (onset) {
            m.onsets.push(now);
            if (m.onsets.length > 12) m.onsets.shift();
            // Accent lottery: some dots get an extra snap on real hits.
            for (let i = 0; i < m.lastAccentRolls.length; i++) {
              m.lastAccentRolls[i] = Math.random() < 0.55 ? 1 : 0;
            }
            for (let i = 0; i < m.segAccentRolls.length; i++) {
              m.segAccentRolls[i] = Math.random() < 0.5 ? 1 : 0;
            }
            m.lastAccent = now;
            // Tempo estimate: median of inter-onset intervals folded into
            // the musical range (240..960ms) — resolves half/double confusion.
            const iv: number[] = [];
            for (let i = 1; i < m.onsets.length; i++) {
              let d = m.onsets[i] - m.onsets[i - 1];
              while (d < 240) d *= 2;
              while (d > 960) d /= 2;
              iv.push(d);
            }
            if (iv.length >= 3) {
              iv.sort((a, b) => a - b);
              const med = iv[Math.floor(iv.length / 2)];
              // Phase-locked loop: nudge clock phase 35% toward the real
              // hit, drift period 25% toward the song's tempo. Re-syncs
              // smoothly, never jumps.
              const ph = ((now - m.origin) / m.period) % 1;
              const err = ph > 0.5 ? ph - 1 : ph;
              m.origin += err * m.period * 0.35;
              m.period += (med - m.period) * 0.25;
              m.period = Math.min(960, Math.max(260, m.period));
            }
          }
        }
      }

      // ── Beat clock: the reactor's own metronome, welded to the song ──
      // Runs CONTINUOUSLY while music plays — a discrete thump on EVERY
      // beat, even in quiet passages. Real hits steer it (PLL above) and
      // add accents; the grid keeps the pulse relentless and in time.
      if (audio.musicPlaying && !m.clockOn) {
        m.clockOn = true;
        m.origin = now;
        m.beatsFired = 0;
        m.lastBeatAt = now;
      } else if (!audio.musicPlaying) {
        m.clockOn = false;
      }
      if (m.clockOn) {
        const beatIdx = Math.floor((now - m.origin) / m.period);
        if (beatIdx > m.beatsFired) {
          m.beatsFired = beatIdx;
          m.lastBeatAt = m.origin + beatIdx * m.period;
          // Fresh dot lottery EVERY beat — but CROSSFADED over ~120ms from
          // the previous roll: scatter rearranges while every target stays
          // continuous. No steps, even when a whole new hand is dealt.
          m.prevRolls.set(m.lastRolls);
          for (let i = 0; i < m.lastRolls.length; i++) {
            m.lastRolls[i] = Math.random() < 0.75 ? 0.3 + Math.random() * 0.7 : Math.random() * 0.2;
          }
          // Hero-segment lottery: ~45% of arcs fire per beat — hot patches
          // rearrange (circular equalizer), crossfaded like the dots.
          m.prevSegRolls.set(m.segRolls);
          for (let i = 0; i < m.segRolls.length; i++) {
            m.segRolls[i] = Math.random() < 0.45 ? 0.5 + Math.random() * 0.5 : Math.random() * 0.15;
          }
          m.rollAt = now;
        }
      }

      // ── Envelopes: pure functions of time-since-event (the butter) ──
      // No follower dynamics → zero overshoot, zero jitter, perfectly
      // repeatable crisp-attack / silky-decay curves.
      const tsBeat = m.clockOn ? Math.max(0, (now - m.lastBeatAt) / 1000) : 9;
      const tsOn = Math.max(0, (now - m.lastAccent) / 1000);
      // Continuous shapes: each beat's envelope OVERLAPS the previous one's
      // tail (max-carry) — at a beat boundary the new rise replaces the old
      // fall exactly where it stands, so dots redirect mid-air. Zero cut,
      // zero snap-back, no matter the tempo.
      const thumpA = (age: number) =>
        Math.min(1, age / 0.05) * Math.exp(-Math.max(0, age - 0.05) / 0.26);
      const thumpShape = Math.max(thumpA(tsBeat), thumpA(tsBeat + m.period / 1000));
      const accentA = (age: number) =>
        Math.min(1, age / 0.03) * Math.exp(-Math.max(0, age - 0.03) / 0.18);
      const lastGap = m.onsets.length >= 2 ? m.onsets[m.onsets.length - 1] - m.onsets[m.onsets.length - 2] : 1e9;
      const accentShape = m.lastAccent < 0 ? 0 : Math.max(accentA(tsOn), accentA(tsOn + Math.min(lastGap, 2e9) / 1000));
      // Body: slow fullness — moderately fast in, slow out.
      m.body += (s - m.body) * (s > m.body ? Math.min(1, dt * 10) : Math.min(1, dt * 1.8));
      // Normalized energy RELATIVE to the song's own recent peak (floor
      // 0.5): every beat reads at full amplitude regardless of the
      // machine's volume setting — quiet parts still pulse at half power.
      const energyN = audio.musicPlaying
        ? Math.min(1, Math.max(0.5, (s * 1.5) / Math.max(m.peakMax, 0.07)))
        : 0;
      const thumpVal = thumpShape * energyN * (0.62 + 0.38 * Math.min(1, accentShape * 1.2 + m.body * 0.5));
      const musicBass = m.body;                                 // slow fullness
      const musicHit = thumpVal + accentShape * 0.5 * energyN;  // transient layer
      const music = Math.min(1, m.body * 0.5 + thumpVal * 0.7); // overall dance amount
      // Spin accent, SMOOTHED then INTEGRATED below — never multiplies `t`
      // directly, so tempo changes accelerate instead of teleporting.
      m.spinE += (m.body * 0.5 + thumpVal * 0.5 - m.spinE) * Math.min(1, dt * 4);
      const spin = baseSpeed * (1 + Math.min(1, m.spinE) * 0.3);
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
          String((0.75 + Math.sin(t * 1.35) * 0.1 + voice * 0.15 + thumpVal * 0.3 + accentShape * 0.12) * pCore)
        );
      }

      // Hero ring: thickness breathes with the music's bass+transient.
      if (segRing.current) {
        segRing.current.setAttribute(
          "stroke-width",
          String(14 + load * 10 + musicBass * 9 + musicHit * 2.5 + alertBoost * 5)
        );
      }
      if (segGlow.current) {
        segGlow.current.setAttribute(
          "stroke-width",
          String(15 + load * 8 + musicBass * 7 + musicHit * 3 + alertBoost * 4)
        );
        segGlow.current.setAttribute(
          "stroke-opacity",
          String(0.14 + load * 0.16 + musicBass * 0.2 + musicHit * 0.08 + alertBoost * 0.12)
        );
      }

      // Voice- and music-reactive particle belt. Each dot owns a pseudo-band:
      // band 0 pops on the transient, band 1 rides the body — beats scatter
      // around the ring like an equalizer instead of pulsing uniformly.
      for (let i = 0; i < BELT.length; i++) {
        const dot = beltDots.current[i];
        if (!dot) continue;
        const b = BELT[i];
        const rad = (b.angle * Math.PI) / 180;
        // Per-dot wave rate (derived from band) — decorrelates the bass body.
        const wave = 0.5 + 0.5 * Math.sin(t * (2.6 + b.band * 3.2) + b.phase);
        // THE JUMP: each dot physically leaps OUTWARD along its spoke on
        // every beat — own distance, own float-back. Scatter rearranges
        // every beat (fresh lottery), like the reference. A slew-rate-
        // limited follower chases the target: fast attack launches the
        // leap, slow release floats it home — and even a brand-new bigger
        // jump mid-float can only accelerate the dot smoothly. No teleports.
        const atk = 0.05 + (b.phase / (Math.PI * 2)) * 0.05;   // 50..100ms launch
        const tau = 0.24 + b.band * 0.18;                      // 240..420ms float
        const jumpA = (age: number) =>
          Math.min(1, age / atk) * Math.exp(-Math.max(0, age - atk) / tau);
        const jumpShape = Math.max(jumpA(tsBeat), jumpA(tsBeat + m.period / 1000));
        const bonusA = (age: number) =>
          Math.min(1, age / 0.03) * Math.exp(-Math.max(0, age - 0.03) / 0.15);
        const bonusShape =
          m.lastAccentRolls[i] *
          (m.lastAccent < 0 ? 0 : Math.max(bonusA(tsOn), bonusA(tsOn + Math.min(lastGap, 2e9) / 1000)));
        const mixR = Math.min(1, tsBeat / 0.12);
        const roll = m.prevRolls[i] + (m.lastRolls[i] - m.prevRolls[i]) * mixR;
        const target =
          (reduced ? 0 : 1) *
          (roll * (30 + b.band * 46) * energyN * jumpShape +
            bonusShape * 20 * energyN);
        // Asymmetric follower: attack 14/s (punchy launch), release 5.5/s
        // (silky float home). dt is clamped, so steps are bounded.
        const cur = m.jumpCur[i];
        const k = target > cur ? 14 : 5.5;
        const next = Math.min(34, cur + (target - cur) * Math.min(1, dt * k));
        m.jumpCur[i] = next;
        const R = b.radius + next;
        dot.setAttribute("cx", (Math.cos(rad) * R).toFixed(2));
        dot.setAttribute("cy", (Math.sin(rad) * R).toFixed(2));
        // Size stays crisp — the leap carries the beat, not balloon-glow.
        const r = b.size * (0.74 + wave * 0.2 + voice * wave * 0.5 + m.lastRolls[i] * jumpShape * 0.7);
        dot.setAttribute("r", r.toFixed(2));
        dot.setAttribute(
          "opacity",
          Math.min(0.85, 0.3 + wave * 0.22 + jumpShape * m.lastRolls[i] * 0.38).toFixed(2)
        );
      }

      // ── Hero-ring circular equalizer: arcs flare individually ──
      // Same physics as the dots: slew-limited follower per arc (crisp
      // flare, silky relax) chasing a per-beat scattered lottery target.
      // Thickness + brightness + outward nudge — hot patches rearrange
      // every beat while the ring's overall silhouette stays steady.
      for (let i = 0; i < HERO_SEGS.length; i++) {
        const p = segFlare.current[i];
        if (!p) continue;
        const hs = HERO_SEGS[i];
        const atkS = 0.03 + hs.band * 0.04;   // 30..70ms flare
        const tauS = 0.16 + hs.band * 0.26;   // 160..420ms relax
        // Rim-sweep: arcs ignite in a wave chasing around the rim (~55ms
        // full circle) — the flare travels like the reference, and every
        // arc peaks at its own moment.
        const delayS = (hs.a0 / 360) * 0.055;
        const flareA = (age: number) =>
          age <= 0 ? 0 : Math.min(1, age / atkS) * Math.exp(-Math.max(0, age - atkS) / tauS);
        const shapeS = Math.max(
          flareA(tsBeat - delayS),
          flareA(tsBeat - delayS + m.period / 1000)
        );
        const bonusS =
          m.segAccentRolls[i] *
          (m.lastAccent < 0 ? 0 : Math.max(accentA(tsOn), accentA(tsOn + Math.min(lastGap, 2e9) / 1000)));
        const mixS = Math.min(1, tsBeat / 0.12);
        const rollS = m.prevSegRolls[i] + (m.segRolls[i] - m.prevSegRolls[i]) * mixS;
        const targetS = (reduced ? 0 : 1) * energyN * (rollS * shapeS + bonusS * shapeS * 0.5);
        const curS = m.segCur[i];
        const kS = targetS > curS ? 20 : 6;
        const nextS = curS + (targetS - curS) * Math.min(1, dt * kS);
        m.segCur[i] = nextS;
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
        {/* circular-equalizer flare arcs — each fires independently on beats */}
        {HERO_SEGS.map((hs, i) => (
          <path
            key={i}
            ref={(el) => {
              segFlare.current[i] = el;
            }}
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

  // The power gate calls this in its onClick — the same user gesture that
  // clears the overlay, so the AudioContext is unlocked right as the
  // assembly begins. Sound and motion start in the same instant.
  const startBoot = useCallback(() => {
    if (useJarvisStore.getState().assemblyStarted) return;
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
