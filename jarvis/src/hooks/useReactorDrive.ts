// Tier 3A — Map JarvisState + persona + alerts into reactor truth.
// Single source of reactorMode / reactorHue / reactorLoad / reactorPulse.
// Picked up by EnergyRings / ReactorCore / ReactorParticles.

"use client";

import { useEffect } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import { VOICE_PROFILES } from "@/lib/persona/voiceProfiles";

/** Map state → reactor mode. Keeps existing EnergyRings multipliers stable. */
function mapMode(
  state: ReturnType<typeof useJarvisStore.getState>["state"],
  persona: ReturnType<typeof useJarvisStore.getState>["persona"],
  activeAlerts: number,
  activePanel: ReturnType<typeof useJarvisStore.getState>["activePanel"]
) {
  if (activeAlerts > 0) return "alert" as const;
  if (state === "thinking") return "focused" as const;
  if (state === "speaking") return "speaking" as const;
  if (state === "listening") return "listening" as const;
  if (persona === "whisper" || (state !== "booting" && new Date().getHours() >= 22))
    return "whisper" as const;
  if (activePanel === "code") return "focused" as const;
  return "idle" as const;
}

/** Map persona + mode → reactor hue. */
function mapHue(
  mode: ReturnType<typeof useJarvisStore.getState>["reactorMode"],
  persona: ReturnType<typeof useJarvisStore.getState>["persona"]
) {
  if (mode === "alert") return "red" as const;
  if (mode === "focused" || persona === "tactical") return "gold" as const;
  if (mode === "whisper") return "dim" as const;
  return "cyan" as const;
}

/** Map state + load → numeric reactor load (0..1). */
function mapLoad(
  state: ReturnType<typeof useJarvisStore.getState>["state"],
  activeAlerts: number,
  activePanel: ReturnType<typeof useJarvisStore.getState>["activePanel"]
) {
  let base = 0.35;
  if (state === "listening") base = 0.55;
  else if (state === "thinking") base = 0.8;
  else if (state === "speaking") base = 0.65;
  else if (state === "booting") base = 0.2;
  if (activeAlerts > 0) base = Math.max(base, 0.85);
  if (activePanel === "code") base = Math.max(base, 0.6);
  return base;
}

export function useReactorDrive() {
  const state = useJarvisStore((s) => s.state);
  const persona = useJarvisStore((s) => s.persona);
  const activeAlerts = useJarvisStore((s) => s.activeAlerts);
  const activePanel = useJarvisStore((s) => s.activePanel);

  const setReactorMode = useJarvisStore((s) => s.setReactorMode);
  const setReactorHue = useJarvisStore((s) => s.setReactorHue);
  const setReactorLoad = useJarvisStore((s) => s.setReactorLoad);

  useEffect(() => {
    const mode = mapMode(state, persona, activeAlerts, activePanel);
    const hue = mapHue(mode, persona);
    const load = mapLoad(state, activeAlerts, activePanel);

    setReactorMode(mode);
    setReactorHue(hue);
    setReactorLoad(load);
  }, [state, persona, activeAlerts, activePanel, setReactorMode, setReactorHue, setReactorLoad]);

  // Mirror persona hue into store for UI bits (StatusHUD, PersonaSwitcher chip).
  useEffect(() => {
    const profile = VOICE_PROFILES[persona];
    if (profile) setReactorHue(profile.hue);
  }, [persona, setReactorHue]);
}