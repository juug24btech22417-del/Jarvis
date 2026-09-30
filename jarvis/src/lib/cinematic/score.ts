"use client";

// ─── Cinematic score — fully synthesized, zero assets ─────────────────────
//
// Every sound in the Avengers Assemble sequence is generated with WebAudio.
// No mp3 to fetch, no decode race, no missing-file silence — the same reason
// lib/sounds.ts embeds its repulsor blast. A cinematic needs a score that is
// *guaranteed* to land on the beat, so we build it on demand.
//
// Layers:
//   riser        — filtered-noise + rising saw, the "something is coming" build
//   impact       — sub-bass drop + noise slam + detuned metal cluster (the BOOM)
//   portal hum   — sustained saws + rumbling noise, looped under the portal
//   choir swell  — detuned chord pad, the "epic" breath under the reveal
//   finale hit   — bigger impact + descending sub + crash
//
// Everything routes through one master chain (gain → compressor) so stacked
// layers never clip. The AudioContext is created lazily and primed on a real
// user gesture by the app's power gate (see primeScore), so the very first
// voice-triggered run can play immediately.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 24;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp).connect(ctx.destination);
  return ctx;
}

/** Unlock + warm the context inside a real user gesture (power gate). */
export function primeScore(): void {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume().catch(() => {});
  // A silent blip forces the graph to materialize so the first real hit is
  // sample-accurate instead of paying node-construction cost on the beat.
  try {
    const g = c.createGain();
    g.gain.value = 0;
    const o = c.createOscillator();
    o.connect(g).connect(master ?? c.destination);
    o.start();
    o.stop(c.currentTime + 0.01);
  } catch {
    /* non-fatal */
  }
}

function now(): number {
  return ctx ? ctx.currentTime : 0;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(c.sampleRate * seconds));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Filtered noise sweep that rises in pitch and loudness. */
export function playRiser(durationS = 1.1, peakGain = 0.5): void {
  const c = ensureCtx();
  if (!c) return;
  const t = now();

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, durationS + 0.1);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(180, t);
  bp.frequency.exponentialRampToValueAtTime(5200, t + durationS);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peakGain, t + durationS * 0.92);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durationS + 0.08);
  src.connect(bp).connect(g).connect(master ?? c.destination);
  src.start(t);
  src.stop(t + durationS + 0.1);

  // Rising saw an octave under the sweep — the harmonic that makes it feel huge.
  const saw = c.createOscillator();
  saw.type = "sawtooth";
  saw.frequency.setValueAtTime(55, t);
  saw.frequency.exponentialRampToValueAtTime(440, t + durationS);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(3600, t + durationS);
  const sg = c.createGain();
  sg.gain.setValueAtTime(0.0001, t);
  sg.gain.exponentialRampToValueAtTime(peakGain * 0.6, t + durationS * 0.95);
  sg.gain.exponentialRampToValueAtTime(0.0001, t + durationS + 0.06);
  saw.connect(lp).connect(sg).connect(master ?? c.destination);
  saw.start(t);
  saw.stop(t + durationS + 0.1);
}

/** The detonation — sub drop + noise slam + metallic cluster. */
export function playImpact(power = 1): void {
  const c = ensureCtx();
  if (!c) return;
  const t = now();
  const p = Math.max(0.2, Math.min(1.6, power));

  // Sub-bass drop.
  const sub = c.createOscillator();
  sub.type = "sine";
  sub.frequency.setValueAtTime(140 * p, t);
  sub.frequency.exponentialRampToValueAtTime(32, t + 0.75);
  const subG = c.createGain();
  subG.gain.setValueAtTime(0.0001, t);
  subG.gain.exponentialRampToValueAtTime(0.9 * p, t + 0.015);
  subG.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
  sub.connect(subG).connect(master ?? c.destination);
  sub.start(t);
  sub.stop(t + 1);

  // Noise slam through a closing lowpass.
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 0.7);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(9000, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + 0.6);
  const ng = c.createGain();
  ng.gain.setValueAtTime(0.7 * p, t);
  ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
  n.connect(lp).connect(ng).connect(master ?? c.destination);
  n.start(t);
  n.stop(t + 0.7);

  // Metallic cluster — detuned squares read as "armour slamming shut".
  const base = 220;
  for (let i = 0; i < 5; i++) {
    const o = c.createOscillator();
    o.type = "square";
    o.frequency.value = base * (1 + i * 0.37) * (1 + (Math.random() - 0.5) * 0.02);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.05 * p, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.28 + i * 0.04);
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 600;
    o.connect(hp).connect(og).connect(master ?? c.destination);
    o.start(t + i * 0.012);
    o.stop(t + 0.5);
  }
}

/** Sustained portal rumble. Returns a stop() to fade it out. */
export function startPortalHum(): () => void {
  const c = ensureCtx();
  if (!c) return () => {};
  const t = now();
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.28, t + 0.5);
  g.connect(master ?? c.destination);

  const stop: Array<() => void> = [];

  // Two detuned saws → low, wide rumble.
  for (const f of [38, 57.3]) {
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    o.connect(lp).connect(g);
    o.start(t);
    stop.push(() => {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    });
  }

  // Rumbling noise bed with a slow tremolo.
  const n = c.createBufferSource();
  n.buffer = noiseBuffer(c, 2.2);
  n.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 320;
  bp.Q.value = 0.9;
  const trem = c.createGain();
  trem.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.frequency.value = 6.5;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.5;
  lfo.connect(lfoG).connect(trem.gain);
  lfo.start(t);
  n.connect(bp).connect(trem).connect(g);
  n.start(t);
  stop.push(() => {
    try {
      n.stop();
      lfo.stop();
    } catch {
      /* already stopped */
    }
  });

  return () => {
    const tc = ctx ? ctx.currentTime : t;
    try {
      g.gain.cancelScheduledValues(tc);
      g.gain.setValueAtTime(g.gain.value, tc);
      g.gain.exponentialRampToValueAtTime(0.0001, tc + 0.6);
    } catch {
      /* ignore */
    }
    setTimeout(() => stop.forEach((s) => s()), 700);
  };
}

/** Detuned chord pad — the epic breath under the reveal. */
export function playChoirSwell(durationS = 3.2, peakGain = 0.16): void {
  const c = ensureCtx();
  if (!c) return;
  const t = now();
  const chord = [110, 164.81, 220, 261.63, 329.63]; // A2 E3 A3 C4 E4

  const bus = c.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(peakGain, t + durationS * 0.5);
  bus.gain.exponentialRampToValueAtTime(0.0001, t + durationS);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 2200;
  bus.connect(lp).connect(master ?? c.destination);

  chord.forEach((f, i) => {
    for (const det of [-4, 4]) {
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      o.detune.value = det + (Math.random() - 0.5) * 3;
      const vib = c.createOscillator();
      vib.frequency.value = 4.4 + i * 0.3;
      const vibG = c.createGain();
      vibG.gain.value = 3.5;
      vib.connect(vibG).connect(o.detune);
      vib.start(t);
      vib.stop(t + durationS);
      const og = c.createGain();
      og.gain.value = 0.22;
      o.connect(og).connect(bus);
      o.start(t + i * 0.03);
      o.stop(t + durationS);
    }
  });
}

/** Bigger, longer detonation for the finale. */
export function playFinaleHit(): void {
  playImpact(1.5);
  const c = ensureCtx();
  if (!c) return;
  const t = now();
  const crash = c.createBufferSource();
  crash.buffer = noiseBuffer(c, 2.4);
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.setValueAtTime(2400, t);
  hp.frequency.exponentialRampToValueAtTime(700, t + 2.2);
  const g = c.createGain();
  g.gain.setValueAtTime(0.35, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
  crash.connect(hp).connect(g).connect(master ?? c.destination);
  crash.start(t);
  crash.stop(t + 2.4);
}

/** Short sharp transient — used for each hero window docking. */
export function playSnapCrack(gain = 1): void {
  const c = ensureCtx();
  if (!c) return;
  const t = now();
  const o = c.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(1800, t);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.09);
  const g = c.createGain();
  g.gain.setValueAtTime(0.06 * gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g).connect(master ?? c.destination);
  o.start(t);
  o.stop(t + 0.14);
}
