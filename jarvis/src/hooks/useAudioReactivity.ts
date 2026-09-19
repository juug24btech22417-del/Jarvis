"use client";

/**
 * useAudioReactivity — live system-audio state for the reactor.
 *
 * Polls /api/system/audio at ~10Hz into a module-level shared object and
 * returns a stable ref. Components read ref.current inside their animation
 * loop so audio never triggers a React re-render.
 *
 * Besides the smoothed scalars (kept for simple "how loud?" checks) this
 * forwards the raw timestamped peak envelope. The engine interpolates that
 * onto its own clock, so 60/120fps animation stays silky even though the
 * data arrives in 100ms bursts — see lib/audio/MusicSpectrum.ts.
 */

import { useRef, useEffect } from "react";

export interface AudioReactivityState {
  /** 0..1 recent peak envelope — latched over a few seconds */
  reactivity: number;
  /** Music/content actually playing (latched over beat gaps) */
  musicPlaying: boolean;
  /** Instantaneous 0..1 peak */
  level: number;
  /** Raw peaks, oldest first (0..1) */
  envelope: number[];
  /** Server timestamps (ms) matching `envelope` */
  envelopeT: number[];
  /** Nominal spacing of the envelope samples (ms) */
  envelopeDt: number;
  /** Bumped on every response — lets consumers detect fresh batches */
  seq: number;
}

/*
 * Every poll refreshes the reactor's jitter buffer, and the newest sample is
 * up to one poll interval old by the time the next one lands — so this
 * interval is the floor on the reactor's response time. 40ms keeps the
 * visual feeling immediate; MusicSpectrum sizes its buffer from the cadence
 * it actually observes, so a slower poll degrades gracefully instead of
 * starving the animation.
 */
const POLL_MS = 40;

const shared: AudioReactivityState = {
  reactivity: 0,
  musicPlaying: false,
  level: 0,
  envelope: [],
  envelopeT: [],
  envelopeDt: 25,
  seq: 0,
};

let poller: ReturnType<typeof setInterval> | null = null;
let consumers = 0;
let inFlight = false;

export function useAudioReactivity() {
  const ref = useRef<AudioReactivityState>(shared);

  useEffect(() => {
    consumers++;
    if (!poller) {
      poller = setInterval(async () => {
        // Never overlap requests: concurrent responses can land out of order
        // and one would rewind the timeline the other just advanced.
        if (inFlight) return;
        inFlight = true;
        try {
          const res = await fetch("/api/system/audio", { cache: "no-store" });
          const d = await res.json();
          if (d?.success) {
            shared.reactivity = Number(d.reactivity) || 0;
            shared.musicPlaying = !!d.musicPlaying;
            shared.level = Number(d.level) || 0;
            if (Array.isArray(d.envelope) && Array.isArray(d.envelopeT)) {
              shared.envelope = d.envelope;
              shared.envelopeT = d.envelopeT;
              shared.envelopeDt = Number(d.envelopeDt) || 25;
            } else {
              shared.envelope = [shared.level];
              shared.envelopeT = [Date.now()];
              shared.envelopeDt = POLL_MS;
            }
            shared.seq++;
          }
        } catch {
          /* server briefly down — keep last values */
        } finally {
          inFlight = false;
        }
      }, POLL_MS);
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
