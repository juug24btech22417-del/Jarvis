/**
 * Repulsor blast — WebAudio one-shot, decoded from EMBEDDED bytes.
 *
 * Why not an <audio src="/sounds/repulsor.mp3">: the dashboard holds
 * several long-lived HTTP connections (SSE /api/events/stream, polling,
 * HMR websocket) and Chromium caps ~6 per host — the media request landed
 * behind them and stalled forever (loadstart → stalled, readyState 0),
 * so the blast was silent even though play() fired on every trigger.
 * data: URIs are rejected by Chromium's media stack and blob: URLs failed
 * the same way; the media-element route is simply too fragile here.
 *
 * WebAudio (decodeAudioData + BufferSource) needs no network at all — the
 * mp3 is embedded as base64 and decoded once, in-memory. For short one-shot
 * SFX this is the standard game-audio path: instant, reliable, polyphonic.
 *
 * The first call happens inside the power-gate press (a real user gesture):
 * that both fires the ignition blast and unlocks the AudioContext. Every
 * later call just starts a fresh source node — instant and reliable.
 */

import { REPULSOR_B64 } from "./repulsorData";

let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let decoding: Promise<AudioBuffer | null> | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Decode the embedded mp3 once; reuse the AudioBuffer for every blast. */
function decode(): Promise<AudioBuffer | null> {
  if (buffer) return Promise.resolve(buffer);
  if (decoding) return decoding;
  const c = getCtx();
  if (!c) return Promise.resolve(null);
  const bin = atob(REPULSOR_B64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  decoding = c.decodeAudioData(bytes.buffer).then(
    (b) => {
      buffer = b;
      return b;
    },
    (e) => {
      console.warn("[sounds] repulsor decode failed:", e && e.name);
      return null;
    }
  );
  return decoding;
}

/** Optional warm-up: start decoding early so the first blast has zero lag. */
export function primeRepulsor() {
  getCtx();
  void decode();
}

// Kick off decoding the moment this module loads (client-side), so the
// ignition blast at the power gate has zero decode lag. The AudioContext
// starts suspended but decodeAudioData works regardless of state.
if (typeof window !== "undefined") {
  try {
    primeRepulsor();
  } catch {
    /* lazy path in playRepulsor covers it */
  }
}

/** Fire the blast. Repeated calls overlap freely — fine for a blast. */
export function playRepulsor() {
  void (async () => {
    try {
      const c = getCtx();
      if (!c) return;
      // Must run inside a user gesture the first time (autoplay policy).
      if (c.state === "suspended") await c.resume();
      const buf = await decode();
      if (!buf) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      const gain = c.createGain();
      gain.gain.value = 0.55;
      src.connect(gain).connect(c.destination);
      src.start(0);
    } catch (e) {
      // Loud enough to see in devtools if playback is ever blocked again —
      // silent swallowing is how this bug hid for so long.
      console.warn("[sounds] repulsor play failed:", e);
    }
  })();
}
