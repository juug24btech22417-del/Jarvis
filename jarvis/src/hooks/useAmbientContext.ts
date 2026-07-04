// Tier 3C — Aggregate ambient signals (time, dayPhase, biometrics, alerts,
// system load) into one object that BriefingService and the StatusHUD use.

"use client";

import { useEffect, useState } from "react";
import { useJarvisStore } from "@/store/jarvis.store";

export type DayPhase = "night" | "dawn" | "morning" | "midday" | "afternoon" | "evening" | "dusk";

export function getDayPhase(hour: number): DayPhase {
  if (hour < 5) return "night";
  if (hour < 7) return "dawn";
  if (hour < 11) return "morning";
  if (hour < 14) return "midday";
  if (hour < 17) return "afternoon";
  if (hour < 19) return "evening";
  if (hour < 22) return "dusk";
  return "night";
}

export interface AmbientContext {
  hour: number;
  dayPhase: DayPhase;
  isWeekend: boolean;
  biometricsActive: boolean;
  activeAlerts: number;
  isHeadphonesIn: boolean;
  /** Optional: numeric CPU load if the system-health API has reported it. */
  cpuLoad?: number;
}

export function useAmbientContext(): AmbientContext {
  const biometricsActive = useJarvisStore((s) => s.biometricActive);
  const activeAlerts = useJarvisStore((s) => s.activeAlerts);

  const [now, setNow] = useState<Date>(() => new Date());

  // Tick once per minute to keep hour / phase fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Best-effort headphones heuristic — same one useAutoPersona uses.
  const isHeadphonesIn =
    typeof navigator !== "undefined" &&
    "mediaSession" in navigator &&
    // @ts-ignore — metadata may be unset.
    !!navigator.mediaSession?.metadata;

  return {
    hour: now.getHours(),
    dayPhase: getDayPhase(now.getHours()),
    isWeekend: now.getDay() === 0 || now.getDay() === 6,
    biometricsActive,
    activeAlerts,
    isHeadphonesIn,
  };
}