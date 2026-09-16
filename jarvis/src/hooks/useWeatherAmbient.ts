"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Weather-reactive ambient config.
 * Fetches live weather every 10 min and maps condition → particle params
 * that the background particle system + CSS read to shift the mood.
 */

export type WeatherCondition = "clear" | "cloudy" | "rain" | "storm" | "snow" | "fog";

interface WeatherAmbient {
  condition: WeatherCondition;
  temperature: number;
  /** Particle colors — array of hex for the gradient drift */
  particleColors: string[];
  /** How many CSS particles to render (default 50) */
  particleCount: number;
  /** CSS animation speed multiplier */
  driftSpeed: number;
  /** Whether to show rain streaks overlay */
  showRainStreaks: boolean;
  /** Whether to show fog overlay */
  showFog: boolean;
  /** Tint applied to the entire scene (CSS filter) */
  sceneFilter: string;
  /** Background gradient overlay color */
  overlayColor: string;
}

const AMBIENT_PRESETS: Record<WeatherCondition, WeatherAmbient> = {
  clear: {
    condition: "clear",
    temperature: 25,
    particleColors: ["#FFD700", "#FFA500", "#FF8C00", "#FFB347", "#FFE4B5"],
    particleCount: 35,
    driftSpeed: 1.2,
    showRainStreaks: false,
    showFog: false,
    sceneFilter: "saturate(1.1) brightness(1.02)",
    overlayColor: "rgba(255, 200, 50, 0.03)",
  },
  cloudy: {
    condition: "cloudy",
    temperature: 20,
    particleColors: ["#7EB8D4", "#A8C8D8", "#8BAAB8", "#B0C4D8", "#94A8B8"],
    particleCount: 45,
    driftSpeed: 0.8,
    showRainStreaks: false,
    showFog: false,
    sceneFilter: "saturate(0.85) brightness(0.97)",
    overlayColor: "rgba(120, 160, 190, 0.04)",
  },
  rain: {
    condition: "rain",
    temperature: 16,
    particleColors: ["#4A90D9", "#5BA3E0", "#3B7CC8", "#6B9BD2", "#2E6EB3"],
    particleCount: 70,
    driftSpeed: 2.5,
    showRainStreaks: true,
    showFog: false,
    sceneFilter: "saturate(0.9) brightness(0.92) hue-rotate(-5deg)",
    overlayColor: "rgba(40, 80, 160, 0.06)",
  },
  storm: {
    condition: "storm",
    temperature: 14,
    particleColors: ["#3B5998", "#4169AA", "#2C4880", "#5570B0", "#1E3A6F"],
    particleCount: 90,
    driftSpeed: 3.5,
    showRainStreaks: true,
    showFog: true,
    sceneFilter: "saturate(0.7) brightness(0.85) contrast(1.1)",
    overlayColor: "rgba(30, 40, 80, 0.08)",
  },
  snow: {
    condition: "snow",
    temperature: -2,
    particleColors: ["#E8F4FF", "#D0E8F8", "#F0F8FF", "#C8DFF0", "#FFFFFF"],
    particleCount: 80,
    driftSpeed: 1.0,
    showRainStreaks: false,
    showFog: false,
    sceneFilter: "saturate(0.6) brightness(1.08)",
    overlayColor: "rgba(200, 220, 240, 0.05)",
  },
  fog: {
    condition: "fog",
    temperature: 12,
    particleColors: ["#A0B0C0", "#B0C0D0", "#90A0B0", "#C0D0E0", "#8090A0"],
    particleCount: 40,
    driftSpeed: 0.4,
    showRainStreaks: false,
    showFog: true,
    sceneFilter: "saturate(0.65) brightness(0.95) blur(0.3px)",
    overlayColor: "rgba(160, 180, 200, 0.06)",
  },
};

function mapCondition(desc: string): WeatherCondition {
  const d = desc.toLowerCase();
  if (d.includes("thunder") || d.includes("storm")) return "storm";
  if (d.includes("rain") || d.includes("drizzle") || d.includes("shower")) return "rain";
  if (d.includes("snow") || d.includes("sleet") || d.includes("blizzard")) return "snow";
  if (d.includes("fog") || d.includes("mist") || d.includes("haze")) return "fog";
  if (d.includes("cloud") || d.includes("overcast")) return "cloudy";
  return "clear";
}

export function useWeatherAmbient(): WeatherAmbient {
  const [ambient, setAmbient] = useState<WeatherAmbient>(AMBIENT_PRESETS.clear);

  const fetchWeather = useCallback(async () => {
    try {
      // Try the existing weather API with a default city
      const res = await fetch("/api/weather?city=Bangalore");
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.description) return;

      const condition = mapCondition(data.description);
      const preset = { ...AMBIENT_PRESETS[condition], temperature: data.temperature ?? AMBIENT_PRESETS[condition].temperature };

      setAmbient(preset);
    } catch {
      // On failure, keep current ambient
    }
  }, []);

  useEffect(() => {
    fetchWeather();
    const interval = setInterval(fetchWeather, 10 * 60 * 1000); // every 10 min
    return () => clearInterval(interval);
  }, [fetchWeather]);

  return ambient;
}
