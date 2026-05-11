"use client";

import { useCallback } from "react";

// Volume Control using Web Audio API (for browser audio)
export function useVolumeControl() {
  const setVolume = useCallback((level: number) => {
    // Browser-level volume control for media elements
    const mediaElements = document.querySelectorAll("audio, video");
    mediaElements.forEach((el) => {
      (el as HTMLMediaElement).volume = Math.max(0, Math.min(1, level / 100));
    });

    // Store preference
    localStorage.setItem("jarvis-volume", level.toString());
  }, []);

  const mute = useCallback(() => {
    const mediaElements = document.querySelectorAll("audio, video");
    mediaElements.forEach((el) => {
      (el as HTMLMediaElement).muted = true;
    });
    localStorage.setItem("jarvis-muted", "true");
  }, []);

  const unmute = useCallback(() => {
    const mediaElements = document.querySelectorAll("audio, video");
    mediaElements.forEach((el) => {
      (el as HTMLMediaElement).muted = false;
    });
    localStorage.setItem("jarvis-muted", "false");
  }, []);

  return { setVolume, mute, unmute };
}

// Clipboard API
export function useClipboard() {
  const readText = useCallback(async (): Promise<string | null> => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API not available");
      }
      const text = await navigator.clipboard.readText();
      return text;
    } catch (error) {
      console.error("[Clipboard] Read error:", error);
      return null;
    }
  }, []);

  const writeText = useCallback(async (text: string): Promise<boolean> => {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard API not available");
      }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("[Clipboard] Write error:", error);
      return false;
    }
  }, []);

  return { readText, writeText };
}

// Battery Status API
export function useBatteryStatus() {
  const getBattery = useCallback(async () => {
    try {
      // @ts-expect-error Battery API is not standard
      const battery = await navigator.getBattery?.();
      return battery ? {
        level: battery.level * 100,
        charging: battery.charging,
        timeRemaining: battery.dischargingTime,
      } : null;
    } catch {
      return null;
    }
  }, []);

  return { getBattery };
}

// Network Status
export function useNetworkStatus() {
  const getNetworkInfo = useCallback(() => {
    return {
      online: navigator.onLine,
      // @ts-expect-error Connection API not standard
      connectionType: navigator.connection?.effectiveType || "unknown",
      // @ts-expect-error Connection API not standard
      downlink: navigator.connection?.downlink || 0,
    };
  }, []);

  return { getNetworkInfo };
}
