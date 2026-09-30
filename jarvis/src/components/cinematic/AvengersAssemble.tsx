"use client";

// ─── AvengersAssemble — the orchestrator ─────────────────────────────────
//
// Owns the single timeline for the whole sequence and drives every layer off
// the shared store. Mount once near the root; it renders nothing while idle.
//
//   0.0s  charge    riser + title slam
//   0.9s  portal    impact + Bifrost opens + portal hum + choir swell
//   2.4s  assault   six hero windows fly in and dock
//   6.0s  suitup    AR armour assembles on the user
//   9.8s  finale    everything converges and detonates
//  13.5s  idle      layers fade out
//
// Intensity eases in a rAF loop (0 → 1 over the charge, 1 through the body,
// back to 0 over the finale) so WebGL brightness and the particle storm scale
// smoothly instead of stepping at phase changes.

import { useCallback, useEffect, useRef } from "react";
import { useAssembleStore } from "@/lib/cinematic/assembleStore";
import { useJarvisStore } from "@/store/jarvis.store";
import {
  playRiser,
  playImpact,
  startPortalHum,
  playChoirSwell,
  playFinaleHit,
  playSnapCrack,
} from "@/lib/cinematic/score";
import CinematicGrade from "./CinematicGrade";
import BifrostPortal from "./BifrostPortal";
import HeroAssault from "./HeroAssault";
import SuitUpAR from "./SuitUpAR";

const T_IMPACT = 900;
const T_ASSAULT = 2400;
const T_SUITUP = 6000;
const T_FINALE = 9800;
const T_END = 13500;
const FADE_IN = 1200;
const FADE_OUT = 1600;

export default function AvengersAssemble() {
  const active = useAssembleStore((s) => s.active);
  const runId = useAssembleStore((s) => s.runId);
  const rafRef = useRef(0);

  const pulse = useCallback(() => {
    useJarvisStore.getState().pulseReactor();
  }, []);

  useEffect(() => {
    if (!active) return;

    const timers: number[] = [];
    let stopHum: (() => void) | null = null;
    const reduced = useAssembleStore.getState().reduced;

    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };

    // ── Score ──────────────────────────────────────────────────────────
    if (!reduced) {
      playRiser(1.05, 0.55);
      at(T_IMPACT, () => {
        playImpact(1.2);
        stopHum = startPortalHum();
        playChoirSwell(4.5, 0.14);
      });
      at(1500, () => playSnapCrack(1));
      at(T_ASSAULT + 60, () => playSnapCrack(0.8));
      at(T_ASSAULT + 260, () => playSnapCrack(0.8));
      at(T_ASSAULT + 460, () => playSnapCrack(0.8));
      at(T_ASSAULT + 660, () => playSnapCrack(0.8));
      at(T_SUITUP, () => playSnapCrack(1));
      at(T_FINALE, () => {
        playFinaleHit();
        playChoirSwell(3.6, 0.1);
        stopHum?.();
        stopHum = null;
      });
    }

    // ── Phase timeline (runs under reduced motion too; just no shake) ────
    at(T_IMPACT, () => {
      useAssembleStore.getState().setPhase("portal");
      pulse();
    });
    at(T_ASSAULT, () => useAssembleStore.getState().setPhase("assault"));
    at(T_SUITUP, () => useAssembleStore.getState().setPhase("suitup"));
    at(T_FINALE, () => {
      useAssembleStore.getState().setPhase("finale");
      pulse();
    });
    at(T_END, () => {
      stopHum?.();
      stopHum = null;
      useAssembleStore.getState().end();
    });

    // ── Intensity ramp ────────────────────────────────────────────────
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const st = useAssembleStore.getState();
      if (!st.active) return;
      const elapsed = performance.now() - st.startedAt;
      let v: number;
      if (elapsed < FADE_IN) {
        v = elapsed / FADE_IN;
      } else if (elapsed > T_END - FADE_OUT) {
        v = Math.max(0, (T_END - elapsed) / FADE_OUT);
      } else {
        v = 1;
      }
      v = v * v * (3 - 2 * v); // smoothstep
      if (Math.abs(v - st.intensity) > 0.005) st.setIntensity(v);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(rafRef.current);
      stopHum?.();
    };
  }, [active, runId, pulse]);

  if (!active) return null;

  return (
    <>
      <BifrostPortal />
      <HeroAssault />
      <SuitUpAR />
      <CinematicGrade />
    </>
  );
}
