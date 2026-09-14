"use client";

/**
 * useAudioReactivity — live system-audio state for the reactor.
 *
 * Polls /api/system/audio at ~8Hz into a module-level shared object and
 * returns a stable ref. Components read ref.current inside useFrame so
 * the 3D scene reacts every frame without triggering React re-renders.
 */

import { useRef, useEffect } from "react";

export interface AudioReactivityState {
  /** 0..1 recent peak envelope — drives beat pulse */
  reactivity: number;
  /** Music/content actually playing (latched over beat gaps) */
  musicPlaying: boolean;
  /** Instantaneous 0..1 peak */
  level: number;
}

const shared: AudioReactivityState = {
  reactivity: 0,
  musicPlaying: false,
  level: 0,
};

let poller: ReturnType<typeof setInterval> | null = null;
let consumers = 0;

export function useAudioReactivity() {
  const ref = useRef<AudioReactivityState>(shared);

  useEffect(() => {
    consumers++;
    if (!poller) {
      poller = setInterval(async () => {
        try {
          const res = await fetch("/api/system/audio", { cache: "no-store" });
          const d = await res.json();
          if (d?.success) {
            shared.reactivity = Number(d.reactivity) || 0;
            shared.musicPlaying = !!d.musicPlaying;
            shared.level = Number(d.level) || 0;
          }
        } catch {
          /* server briefly down — keep last values */
        }
      }, 120);
    }
    return () => {
      consumers--;
      if (consumers <= 0 && poller) {
        clearInterval(poller);
        poller = null;
      }
    };
  }, []);

  return ref;
}
