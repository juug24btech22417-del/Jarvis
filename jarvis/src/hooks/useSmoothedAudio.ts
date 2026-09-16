"use client";

/**
 * useSmoothedAudio — blends mic voiceLevel + system audio meter
 * into one butter-smooth 0..1 value for the reactor.
 *
 * Uses exponential moving average (EMA) with separate attack/release
 * times so beats punch in hard but tails decay slowly — Apple-level feel.
 *
 * Reads ref.current inside useFrame so it never triggers re-renders.
 */

import { useRef, useEffect } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import { useAudioReactivity } from "@/hooks/useAudioReactivity";

export interface SmoothedAudioState {
  /** Combined 0..1 audio energy — the single value the reactor reads */
  energy: number;
  /** Raw 0..1 beat pulse (fast attack, slow release) */
  beat: number;
  /** True when system audio is playing (not just mic) */
  musicPlaying: boolean;
  /** Instantaneous peak for flash effects */
  peak: number;
}

const EMA_ATTACK = 0.4;   // fast rise
const EMA_RELEASE = 0.08;  // slow decay

const shared: SmoothedAudioState = {
  energy: 0,
  beat: 0,
  musicPlaying: false,
  peak: 0,
};

let poller: ReturnType<typeof setInterval> | null = null;
let consumers = 0;

export function useSmoothedAudio() {
  const ref = useRef<SmoothedAudioState>(shared);
  const systemAudioRef = useAudioReactivity();

  // Shared EMA state (persists across renders via module-level)
  useEffect(() => {
    consumers++;
    if (!poller) {
      poller = setInterval(() => {
        const sys = systemAudioRef.current;
        const mic = useJarvisStore.getState().voiceLevel;

        // System audio is the primary driver (music, YouTube, Spotify)
        // Mic is secondary (voice commands shouldn't make the reactor dance)
        const raw = sys.musicPlaying
          ? Math.max(sys.reactivity * 0.85, mic * 0.15)
          : mic * 0.3; // mic alone is dampened

        // EMA smoothing with separate attack/release
        const alpha = raw > shared.energy ? EMA_ATTACK : EMA_RELEASE;
        shared.energy = shared.energy + alpha * (raw - shared.energy);

        // Beat detection: fast rise, slow decay
        const beatRaw = sys.musicPlaying ? sys.reactivity : 0;
        const beatAlpha = beatRaw > shared.beat ? 0.5 : 0.06;
        shared.beat = shared.beat + beatAlpha * (beatRaw - shared.beat);

        shared.musicPlaying = sys.musicPlaying;
        shared.peak = Math.max(sys.level, mic);
      }, 16); // ~60fps — one tick per frame
    }
    return () => {
      consumers--;
      if (consumers <= 0 && poller) {
        clearInterval(poller);
        poller = null;
        shared.energy = 0;
        shared.beat = 0;
        shared.peak = 0;
      }
    };
  }, [systemAudioRef]);

  return ref;
}
