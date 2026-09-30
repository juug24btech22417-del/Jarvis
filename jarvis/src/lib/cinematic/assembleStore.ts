"use client";

// ─── Avengers Assemble — cinematic state ─────────────────────────────────
//
// One tiny external store that every cinematic layer reads. The orchestrator
// (components/cinematic/AvengersAssemble) advances the PHASE on a timeline;
// layers render themselves off that phase plus a shared start timestamp, so
// audio, WebGL, DOM windows and the AR camera all stay frame-locked to the
// same clock instead of each keeping a private one.
//
// `runId` bumps on every trigger so re-triggering replays the entrance
// animations even if the phase name happens to be the same.

import { create } from "zustand";

export type AssemblePhase =
  | "idle"     // not running
  | "charge"   // riser + title slam
  | "portal"   // Bifrost opens, beam slams down
  | "assault"  // hero windows fly in and dock
  | "suitup"   // AR armour assembles on the user
  | "finale";  // everything converges and detonates

export interface AssembleState {
  active: boolean;
  phase: AssemblePhase;
  /** Monotonic id — increments each trigger; use as an animation key. */
  runId: number;
  /** performance.now() when the run began (0 when idle). */
  startedAt: number;
  /** 0..1 master energy ramp — layers can scale with it. */
  intensity: number;
  /** Reduced-motion preference captured at trigger time. */
  reduced: boolean;
  start: () => void;
  end: () => void;
  setPhase: (phase: AssemblePhase) => void;
  setIntensity: (n: number) => void;
}

export const useAssembleStore = create<AssembleState>((set, get) => ({
  active: false,
  phase: "idle",
  runId: 0,
  startedAt: 0,
  intensity: 0,
  reduced: false,
  start: () => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    set({
      active: true,
      phase: "charge",
      runId: get().runId + 1,
      startedAt:
        typeof performance !== "undefined" ? performance.now() : Date.now(),
      intensity: 0,
      reduced: !!reduced,
    });
  },
  end: () => set({ active: false, phase: "idle", intensity: 0 }),
  setPhase: (phase) => set({ phase }),
  setIntensity: (intensity) => set({ intensity }),
}));

/** Imperative trigger — safe to call from anywhere (voice command, button). */
export function startAssemble() {
  useAssembleStore.getState().start();
}

export function stopAssemble() {
  useAssembleStore.getState().end();
}

export function assembleActive() {
  return useAssembleStore.getState().active;
}
