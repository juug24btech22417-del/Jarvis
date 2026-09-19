/**
 * MusicSpectrum — turns the system-audio peak meter into a dancing
 * circular equalizer.
 *
 * The Windows meter hands us a raw 0..1 peak envelope at ~30-40Hz. That is a
 * genuine amplitude signal, but a single scalar — there is no N-channel FFT
 * anywhere in the stack (Spotify plays out-of-browser via Connect, so there
 * is no <audio> element to tap either). The bands are therefore *derived*
 * from amplitude, never invented with randomness:
 *
 *   1. RING BUFFER  samples queue up in order and are consumed by a
 *                   fractional read pointer that only ever moves FORWARD, at
 *                   ~1.0x, with the buffer's fill level steering the rate by
 *                   a couple of percent. This is how an audio sink consumes a
 *                   jittery stream: arrival jitter changes *how much* audio is
 *                   buffered, never *where* the reader is. A reader anchored
 *                   to arrival times instead would step every poll, and steps
 *                   are exactly what "buttery" is not.
 *   2. AUTO-GAIN    a running peak with a slow decay normalizes loudness, so a
 *                   whisper-quiet laptop session animates as hard as a club.
 *   3. FEATURES     three *genuinely different* views of the envelope, because
 *                   different filters are what make a spectrum look like one:
 *                     body  (the envelope)      → sustained low-end bars
 *                     pump  (≈4Hz minus slow)   → the kick/bass pumping
 *                     snap  (70ms difference)   → transients, hats, snares
 *   4. BANDS        band i takes a weighted mix of those features (bass leans
 *                   on body/pump, treble on snap), gets a small travelling
 *                   wave delay so flares sweep around the rim instead of
 *                   blinking in unison, then runs through its own asymmetric
 *                   follower: crisp attack, silky release.
 *
 * Every stage is an exponential in dt, so motion is identical at 60fps and
 * 144fps, and every output is continuous in time. When music stops the whole
 * spectrum fades to zero with its release constants; nothing snaps.
 */

export const SPECTRUM_BANDS = 28;

/** Difference window for the transient (snap) feature. */
const SNAP_WINDOW_MS = 70;

/** Peak-meter noise floor: below this we treat it as silence, not signal. */
const NOISE_GATE = 0.012;

/** Running-peak decay time constant (s) — the auto-gain reference. */
const PEAK_DECAY_TAU = 5;

/** Music-presence fade: quick to arrive, unhurried to leave. */
const FADE_IN_TAU = 0.16;
const FADE_OUT_TAU = 0.85;

/**
 * Buffered audio, in samples, that the reader tries to keep in hand. Sized
 * from the measured delivery cadence (× the slack) so a late poll drains
 * headroom instead of starving the reader; capped low so a degraded cadence
 * costs a brief hold rather than half a second of lag.
 */
const MIN_BUFFER_SAMPLES = 4;
// Capped deliberately: if delivery degrades, a brief hold in the motion is far
// less noticeable than the visual drifting half a second behind the music.
const MAX_BUFFER_SAMPLES = 9;
const BUFFER_SLACK = 1.5;
/**
 * Fill-level control. The gain is gentle around the target (a percent or two
 * of rate is imperceptible) but the clamp is wide, because a large overfill
 * — a long stall, or the first payload's whole 600ms of history — has to drain
 * in seconds. A slow drain is worse than a fast one here: while the buffer
 * drains, the visual runs at the wrong tempo relative to the music, which is
 * exactly the drift this exists to prevent.
 */
const RATE_GAIN = 0.01;
const RATE_CLAMP = 0.15;
/** Samples queued on the very first payload — never its whole history. */
const PRIME_SAMPLES = 6;
/** Absolute ceiling on buffered audio before old samples are dropped. */
const MAX_QUEUE_SAMPLES = 40;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export interface SpectrumFrame {
  /** Per-band energy 0..1 (raw — callers add their own visual floor) */
  bands: Float32Array;
  /** Overall dance amount 0..1 */
  energy: number;
  /** Low-end body (sustained) */
  bass: number;
  /** Beat-rate pumping */
  mid: number;
  /** Transients — hats, snares, plucks */
  treble: number;
  /** Fast accent envelope for one-shot flashes */
  hit: number;
  /** Music presence 0..1 — fades in/out when playback starts/stops */
  active: number;
}

/**
 * Which spectrum band a ring position maps to.
 *
 * The rim is MIRRORED about the vertical axis: the lowest band sits at both
 * horizontal sides (3 and 9 o'clock) and the highest at the top and bottom,
 * with every band appearing twice. A single clockwise sweep would leave the
 * ring permanently bottom-heavy; mirroring keeps the reactor balanced and
 * centred while still reading as a spectrum — and it puts the longest (bass)
 * columns on the horizontal, which is where the reference HUD's hot blue
 * patches live.
 */
export function bandAtAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  let t = a % 180;
  if (t > 90) t = 180 - t; // fold onto one half of the vertical axis
  return Math.min(SPECTRUM_BANDS - 1, Math.floor((t / 90) * SPECTRUM_BANDS));
}

export class MusicSpectrum {
  readonly bands = new Float32Array(SPECTRUM_BANDS);
  energy = 0;
  bass = 0;
  mid = 0;
  treble = 0;
  hit = 0;
  active = 0;

  /* ── Ring buffer ───────────────────────────────────────────────────── */
  private q: number[] = [];
  /** Newest server stamp accepted — dedupes the meter's overlapping windows. */
  private newestStamp = -1e9;
  /** Fractional index of the sample currently being rendered. */
  private readIdx = 0;
  /** Nominal spacing of meter samples (ms). */
  private stepMs = 25;
  /** Smoothed gap between deliveries (ms) — sizes the buffer. */
  private gapEma = 0;
  private lastDeliveryAt = -1e9;
  /** Real audio buffered, in ms — exposed for diagnostics. */
  bufferedMs = 0;

  /* ── Auto-gain ─────────────────────────────────────────────────────── */
  private peakMax = 0.12;

  /* ── Feature filters + previous-frame values (for the travelling wave) ─ */
  private slow = 0;
  private fast = 0;
  private snap = 0;
  private prevX = 0;
  private prevSlow = 0;
  private prevFast = 0;
  private prevSnap = 0;
  private hitEnv = 0;

  /**
   * Feed one poll's worth of samples. `tsServer` are the meter's own
   * timestamps (ms), oldest first; `nowClient` only measures how long it has
   * been since the previous delivery.
   *
   * Consecutive windows overlap heavily (600ms of history every poll), so
   * only the samples newer than the last accepted stamp are queued.
   */
  pushEnvelope(vals: number[], tsServer: number[], nowClient: number): void {
    const n = Math.min(vals.length, tsServer.length);
    if (n < 2) return;
    const newestStamp = tsServer[n - 1];
    // A slow request can land after a fresher one; its samples are already in
    // the queue, and re-queuing them would double the audio.
    if (newestStamp <= this.newestStamp) return;

    if (this.lastDeliveryAt > -1e8) {
      const gap = nowClient - this.lastDeliveryAt;
      // Deliberately slow: the buffer target must not chase poll jitter,
      // because moving it is what changes the visual's latency.
      if (gap > 0) this.gapEma = this.gapEma ? this.gapEma + (gap - this.gapEma) * 0.1 : gap;
    }

    // The meter's own cadence, from its own stamps.
    const gaps: number[] = [];
    for (let i = 1; i < n; i++) {
      const g = tsServer[i] - tsServer[i - 1];
      if (g >= 2) gaps.push(g);
    }
    gaps.sort((a, b) => a - b);
    if (gaps.length) this.stepMs = gaps[Math.floor(gaps.length / 2)];

    let first = n - 1;
    while (first > 0 && tsServer[first - 1] > this.newestStamp) first--;
    // The first payload carries a full window of history and there is nothing
    // to render it against yet; queueing all of it would start the visual
    // 600ms behind and take seconds to glide back. Start near the target.
    if (this.q.length === 0) first = Math.max(first, n - PRIME_SAMPLES);
    for (let k = first; k < n; k++) this.q.push(clamp01(vals[k]));

    this.newestStamp = newestStamp;
    this.lastDeliveryAt = nowClient;
    // Never let the queue outgrow what the reader can still reach.
    this.trim();
  }

  /**
   * Fallback for a payload without a timestamped envelope (older server, or
   * a stub): queue the lone level reading, one per delivery.
   */
  pushLevel(level: number, nowClient: number): void {
    if (this.lastDeliveryAt > -1e8) {
      const gap = nowClient - this.lastDeliveryAt;
      if (gap > 0) {
        this.gapEma = this.gapEma ? this.gapEma + (gap - this.gapEma) * 0.2 : gap;
        this.stepMs = Math.max(10, this.gapEma);
      }
    }
    this.q.push(clamp01(level));
    this.lastDeliveryAt = nowClient;
    this.trim();
  }

  private trim(): void {
    // Keep a comfortable margin of consumed history so the fractional read
    // pointer always has a sample behind it to interpolate from.
    let drop = this.readIdx - 8;
    // Hard ceiling: a long stall must not leave us rendering seconds behind.
    const fill = this.q.length - 1 - this.readIdx;
    if (fill > MAX_QUEUE_SAMPLES) drop = Math.max(drop, fill - MAX_QUEUE_SAMPLES);
    if (drop > 0) {
      const k = Math.min(Math.floor(drop), this.q.length - 1);
      if (k > 0) {
        this.q.splice(0, k);
        this.readIdx -= k;
      }
    }
  }

  /** Interpolated envelope at the read pointer. */
  private readValue(): number {
    const q = this.q;
    if (q.length === 0) return 0;
    const i = Math.max(0, Math.min(q.length - 1, this.readIdx));
    const i0 = Math.floor(i);
    const i1 = Math.min(q.length - 1, i0 + 1);
    const f = i - i0;
    return q[i0] + (q[i1] - q[i0]) * f;
  }

  /** Value at a fixed number of samples behind the read pointer. */
  private readBehind(samples: number): number {
    const q = this.q;
    if (q.length === 0) return 0;
    const i = Math.max(0, Math.min(q.length - 1, this.readIdx - samples));
    const i0 = Math.floor(i);
    const i1 = Math.min(q.length - 1, i0 + 1);
    const f = i - i0;
    return q[i0] + (q[i1] - q[i0]) * f;
  }

  /**
   * Advance one frame. `dtSec` is the frame delta, `now` the local monotonic
   * clock, `musicPlaying` the latched "anything playing?" flag.
   */
  update(dtSec: number, now: number, musicPlaying: boolean): SpectrumFrame {
    const dt = dtSec > 0 ? dtSec : 1 / 60;
    const dtMs = dt * 1000;

    /* ── Consume the queue: forward only, rate-steered by fill level ──── */
    const targetSamples = Math.min(
      MAX_BUFFER_SAMPLES,
      Math.max(MIN_BUFFER_SAMPLES, ((this.gapEma || 60) / this.stepMs) * BUFFER_SLACK)
    );
    const fill = this.q.length - 1 - this.readIdx;
    const err = fill - targetSamples;
    const rate = 1 + Math.max(-RATE_CLAMP, Math.min(RATE_CLAMP, err * RATE_GAIN));
    this.readIdx = Math.max(0, Math.min(this.q.length - 1, this.readIdx + rate * (dtMs / this.stepMs)));
    this.bufferedMs = Math.max(0, fill) * this.stepMs;

    /* ── Presence fade — the animation's own on/off switch ───────────── */
    const wantActive = musicPlaying ? 1 : 0;
    const fadeTau = wantActive > this.active ? FADE_IN_TAU : FADE_OUT_TAU;
    this.active += (wantActive - this.active) * (1 - Math.exp(-dt / fadeTau));
    if (!wantActive && this.active < 0.0005) this.active = 0;

    /* ── Read + auto-gain ────────────────────────────────────────────── */
    const gate = (v: number) => (v < NOISE_GATE ? 0 : v);
    const gNow = musicPlaying ? gate(this.readValue()) : 0;
    this.peakMax = Math.max(
      this.peakMax * Math.exp(-dt / PEAK_DECAY_TAU),
      Math.max(gNow, 0.02)
    );
    const scale = 1 / Math.max(this.peakMax * 0.88, 0.09);
    const x = Math.min(1.4, gNow * scale);
    const xAgo = musicPlaying
      ? Math.min(1.4, gate(this.readBehind(SNAP_WINDOW_MS / this.stepMs)) * scale)
      : 0;

    /* ── Three views of the envelope ─────────────────────────────────── */
    // Sustained body — smooths out the punch so "fullness" reads separately.
    this.slow += (x - this.slow) * (1 - Math.exp(-dt / 0.12));
    // Beat-rate pumping — the fast component the slow view cannot see.
    this.fast += (x - this.fast) * (1 - Math.exp(-dt / 0.045));
    const pump = Math.max(0, this.fast - this.slow);
    // Transients — a 70ms difference is a clean high-pass of the envelope.
    const slope = Math.max(0, (x - xAgo) / (SNAP_WINDOW_MS / 1000));
    const snapRaw = clamp01(slope * 0.05);
    const snapTau = snapRaw > this.snap ? 0.012 : 0.09;
    this.snap += (snapRaw - this.snap) * (1 - Math.exp(-dt / snapTau));

    /* ── Bands ───────────────────────────────────────────────────────── */
    const last = SPECTRUM_BANDS - 1;
    let energySum = 0;
    let bassSum = 0;
    let midSum = 0;
    let trebleSum = 0;
    let bassN = 0;
    let midN = 0;
    let trebleN = 0;

    for (let i = 0; i <= last; i++) {
      const p = i / last; // 0 = lowest band, 1 = highest
      // Family mix: lows read the amplitude itself (honest, full-size bars),
      // mids the beat-rate pump, highs the transients. The follower below does
      // the shaping, so a low band is never double-damped by the low-pass that
      // exists only to *define* the pump.
      const wBody = clamp01(1 - p / 0.65);
      const wPump = Math.exp(-(((p - 0.45) / 0.3) ** 2));
      const wSnap = clamp01((p - 0.3) / 0.7);
      // Travelling wave: each band reads the features a hair behind the
      // previous one, so flares sweep around the rim. Interpolating against
      // the previous frame keeps it continuous at any frame rate.
      const lagF = Math.min(1, ((i / SPECTRUM_BANDS) * 0.055) / dt);
      const bodyD = x + (this.prevX - x) * lagF;
      const pumpD = pump + (Math.max(0, this.prevFast - this.prevSlow) - pump) * lagF;
      const snapD = this.snap + (this.prevSnap - this.snap) * lagF;

      const sig = wBody * bodyD + wPump * pumpD * 1.6 + wSnap * snapD * 1.35;
      // Low bands carry more energy in real music — and look better long.
      const gain = 0.5 + 1.15 * Math.pow(1 - p, 1.3);
      const target = Math.min(1.1, Math.max(0, sig * gain)) * this.active;
      // Crisp attack (26–60ms), silky release (100–340ms), low bands heaviest.
      // The release must stay under a beat or the bars never fall between
      // hits; pure exponentials → no overshoot, frame-rate independent.
      const tau = target > this.bands[i] ? 0.026 + 0.034 * p : 0.34 - 0.24 * p;
      this.bands[i] += (target - this.bands[i]) * (1 - Math.exp(-dt / tau));

      const v = this.bands[i];
      energySum += v;
      if (p < 0.25) {
        bassSum += v;
        bassN++;
      } else if (p >= 0.35 && p <= 0.65) {
        midSum += v;
        midN++;
      } else if (p > 0.8) {
        trebleSum += v;
        trebleN++;
      }
    }

    this.prevX = x;
    this.prevSlow = this.slow;
    this.prevFast = this.fast;
    this.prevSnap = this.snap;

    this.energy = clamp01(energySum / SPECTRUM_BANDS);
    this.bass = bassN ? clamp01(bassSum / bassN) : 0;
    this.mid = midN ? clamp01(midSum / midN) : 0;
    this.treble = trebleN ? clamp01(trebleSum / trebleN) : 0;

    // Accent: snappy rise, ~200ms tapering decay, scaled by presence.
    const hitRaw = snapRaw * this.active;
    const hitTau = hitRaw > this.hitEnv ? 0.015 : 0.2;
    this.hitEnv += (hitRaw - this.hitEnv) * (1 - Math.exp(-dt / hitTau));
    this.hit = clamp01(this.hitEnv);

    return {
      bands: this.bands,
      energy: this.energy,
      bass: this.bass,
      mid: this.mid,
      treble: this.treble,
      hit: this.hit,
      active: this.active,
    };
  }
}
