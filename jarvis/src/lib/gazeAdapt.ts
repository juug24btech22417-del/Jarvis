// Online per-user gaze refinement — Recursive Least Squares over the RESIDUAL
// of the base gaze map.
//
// ─── Why residual, not a second calibration ──────────────────────────────
// The quadratic ritual fit (`eyeCalibration.ts`) is a one-shot estimate from 17
// samples. It is good, but it is frozen: posture shifts, a moved webcam, a new
// chair height or a different pair of glasses all invalidate it, and the user's
// only recourse is to run the whole 17-dot ritual again. Meanwhile the app is
// constantly producing FREE, perfectly labelled gaze data — every practice-drill
// hit and every dwell-completed target is a moment where we know both the raw
// eye signal and the screen point the user was actually looking at.
//
// This turns those into an online correction. It models the ERROR of whatever
// base map is in use as a small affine function of the raw features:
//
//   base(h, v, yaw, pitch)  →  (bx, by)          the map in use
//   residual ≈ Wx · φ,  Wy · φ   with φ = [h, v, yaw, pitch, 1]
//   final    = base + trust · residual
//
// Learning the RESIDUAL (rather than re-fitting the map) has three properties
// that matter for a live control loop:
//
//   1. It starts at EXACTLY zero correction, so with no data it cannot make a
//      working map worse — the failure mode is "no improvement", never "cursor
//      now flies to a corner".
//   2. It absorbs gain, offset and cross-axis error in the zone the user
//      actually works in, which is what a one-shot 17-dot fit gets wrong.
//   3. It keeps improving with use at ~O(1) per sample of cost (RLS update),
//      so it is safe to run inside a 30Hz perception loop.
//
// ─── Guard rails (this drives a real cursor, so caution is the feature) ───
//   • SAMPLE REJECTION — a sample whose residual is large under the CURRENT
//     model is far more likely to be a mislabelled/mis-timed fixation than a
//     genuine 30%-of-screen model error, so it is dropped.
//   • TRUST RAMP — the correction is scaled by min(1, n / TRUST_SAMPLES), so
//     the first few samples nudge instead of snap. A jump in cursor position
//     mid-use is the exact thing that makes a gaze pointer feel broken.
//   • BOUNDED OUTPUT — weights are clamped and the applied correction is
//     capped, so no amount of bad data can throw the cursor off the screen.
//   • MODE KEYING — a correction learned under the calibration-free AutoGain
//     map is meaningless under a quadratic fit, so switching maps discards it
//     instead of applying a correction that belongs to a different function.
//   • FORGETTING FACTOR — λ < 1 lets the model track a moved webcam instead of
//     averaging new and old geometry together forever.

export type GazeMapMode = "auto" | "calib";

/** One observations pair: raw signals + the screen point truly looked at. */
export interface GazeSample {
  h: number;
  v: number;
  yaw?: number;
  pitch?: number;
  /** Screen coordinates 0..1 of the point the user was actually looking at. */
  x: number;
  y: number;
  /** Which base map produced this sample's features (see MODE KEYING). */
  mode?: GazeMapMode;
}

export interface GazePoint2 {
  x: number;
  y: number;
}

/** φ = [h, v, yaw, pitch, 1] — affine in the raw features. */
const N_FEAT = 5;
/** Forgetting factor. 1 = pure average; lower tracks drift faster. */
const LAMBDA = 0.985;
/** Initial covariance — an uninformative prior, so the first samples bite. */
const P0 = 1000;
/** Weighted sample count before the correction is applied at full strength. */
const TRUST_SAMPLES = 12;
/** Accepted samples kept for the rolling error metric. */
const ERROR_WINDOW = 25;
/** Hard cap on the applied correction (screen fractions). */
const MAX_CORRECTION = 0.25;
/** Samples whose residual exceeds this are treated as mislabelled. */
const MAX_RESIDUAL = 0.3;
/** Weight clamp — even a pathological fit cannot produce a wild correction. */
const MAX_WEIGHT = 6;

const STORE_KEY = "jarvis:gaze-adapt-v1";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Recursive least squares on the residual of a base gaze map.
 *
 * Both axes share the same feature vector, so ONE covariance update per sample
 * serves both — the whole update is ~25 multiply-adds, i.e. free at 30Hz.
 */
export class GazeAdapter {
  /** [wx0..wx4, wy0..wy4] */
  private w = new Float64Array(N_FEAT * 2);
  /** N_FEAT × N_FEAT covariance, row-major. */
  private P = new Float64Array(N_FEAT * N_FEAT * 2); // two independent covariances
  private n = 0;
  private mode: GazeMapMode | null = null;
  /** Sum of accepted label weights — what the trust ramp is measured in. */
  private wSum = 0;
  /** Rolling end-to-end error after correction, in screen fractions. */
  private errs: number[] = [];
  /** Rolling error of the UNCORRECTED base map, for comparison. */
  private rawErrs: number[] = [];

  constructor() {
    this.reset();
  }

  /** Learned samples so far (diagnostics / HUDs). */
  get samples(): number {
    return this.n;
  }

  /** Which base map this correction belongs to, or null before any sample. */
  get boundMode(): GazeMapMode | null {
    return this.mode;
  }

  /** How strongly the correction is currently applied, 0..1. */
  get trust(): number {
    return Math.min(1, this.wSum / TRUST_SAMPLES);
  }

  /**
   * Mean distance (screen fractions) between the corrected prediction and the
   * labelled truth, over the last ERROR_WINDOW accepted samples. This is the
   * "how good is eye control right now" number: 0.03 = 3% of the screen.
   * `null` before any sample has been learned.
   */
  get meanError(): number | null {
    if (this.errs.length === 0) return null;
    return this.errs.reduce((a, b) => a + b, 0) / this.errs.length;
  }

  /** The same measure for the UNCORRECTED base map, i.e. what learning bought. */
  get rawMeanError(): number | null {
    if (this.rawErrs.length === 0) return null;
    return this.rawErrs.reduce((a, b) => a + b, 0) / this.rawErrs.length;
  }

  /** Drop the learned model (keeps nothing). */
  reset(): void {
    this.w = new Float64Array(N_FEAT * 2);
    this.P = new Float64Array(N_FEAT * N_FEAT * 2);
    for (const off of [0, N_FEAT * N_FEAT]) {
      for (let i = 0; i < N_FEAT; i++) this.P[off + i * N_FEAT + i] = P0;
    }
    this.n = 0;
    this.mode = null;
    this.wSum = 0;
    this.errs = [];
    this.rawErrs = [];
  }

  private static features(s: GazeSample): number[] {
    return [s.h, s.v, s.yaw ?? 0, s.pitch ?? 0, 1];
  }

  /**
   * Apply the learned correction to a base prediction.
   *
   * Safe on any input, including before any sample exists (returns `base`
   * unchanged) and on non-finite features (returns `base`).
   */
  correct(features: { h: number; v: number; yaw?: number; pitch?: number }, base: GazePoint2): GazePoint2 {
    const { h, v, yaw = 0, pitch = 0 } = features;
    if (![h, v, yaw, pitch, base.x, base.y].every((n) => Number.isFinite(n))) return base;
    if (this.n === 0) return base;

    const phi = [h, v, yaw, pitch, 1];
    const trust = this.trust;
    let rx = 0;
    let ry = 0;
    for (let i = 0; i < N_FEAT; i++) {
      rx += this.w[i] * phi[i];
      ry += this.w[N_FEAT + i] * phi[i];
    }
    const cx = clamp(rx, -MAX_CORRECTION, MAX_CORRECTION) * trust;
    const cy = clamp(ry, -MAX_CORRECTION, MAX_CORRECTION) * trust;
    return { x: clamp(base.x + cx, 0, 1), y: clamp(base.y + cy, 0, 1) };
  }

  /**
   * Fold in one labelled observation.
   *
   * @param sample raw features + the screen point actually looked at
   * @param base   what the base map predicts for those features
   * @param weight how much to believe the label, 0..1 (see gazeClickLesson).
   *               A blink click that missed a control by 10% of the screen is
   *               weaker evidence than a fixation the user held on a target,
   *               so it must move the model less — and build trust slower.
   * @returns true when the sample was accepted
   */
  push(sample: GazeSample, base: GazePoint2, weight = 1): boolean {
    const { h, v, yaw = 0, pitch = 0, x, y } = sample;
    if (![h, v, yaw, pitch, x, y, base.x, base.y].every((n) => Number.isFinite(n))) return false;
    if (!Number.isFinite(weight) || weight <= 0) return false;
    const wSample = Math.min(1, weight);

    // MODE KEYING: a correction learned on top of one map cannot be applied to
    // another. Switching maps restarts the learner rather than corrupting it.
    const mode = sample.mode ?? this.mode ?? "auto";
    if (this.mode !== null && this.mode !== mode) this.reset();
    this.mode = mode;

    const targetX = clamp(x, 0, 1);
    const targetY = clamp(y, 0, 1);
    const rx = targetX - base.x;
    const ry = targetY - base.y;

    // SAMPLE REJECTION — compare against what the model currently predicts,
    // not against zero, so a good model makes the gate tighter over time.
    const phi = GazeAdapter.features(sample);
    let predX = 0;
    let predY = 0;
    for (let i = 0; i < N_FEAT; i++) {
      predX += this.w[i] * phi[i];
      predY += this.w[N_FEAT + i] * phi[i];
    }
    const errX = Math.abs(rx - predX * this.trust);
    const errY = Math.abs(ry - predY * this.trust);
    if (Math.hypot(errX, errY) > MAX_RESIDUAL) return false;

    // ── RLS update, per axis (shared φ, independent covariance) ──────────
    for (let axis = 0; axis < 2; axis++) {
      const wOff = axis * N_FEAT;
      const pOff = axis * N_FEAT * N_FEAT;

      // Pφ
      const Pp = new Array<number>(N_FEAT).fill(0);
      for (let i = 0; i < N_FEAT; i++) {
        let s = 0;
        for (let j = 0; j < N_FEAT; j++) s += this.P[pOff + i * N_FEAT + j] * phi[j];
        Pp[i] = s;
      }
      // denominator = λ + φᵀPφ
      let denom = LAMBDA;
      for (let i = 0; i < N_FEAT; i++) denom += phi[i] * Pp[i];
      if (!Number.isFinite(denom) || denom < 1e-9) continue;

      // K = Pφ / denom ; w += K·(residual − φᵀw) ; P = (P − KφᵀP)/λ
      // A weighted label is a FRACTIONAL sample: the step and the covariance
      // shrink together, so a weak label contributes proportionally less
      // evidence instead of being treated like a held fixation.
      const K = new Array<number>(N_FEAT);
      for (let i = 0; i < N_FEAT; i++) K[i] = (Pp[i] / denom) * wSample;

      // Innovation: how wrong the model is for THIS axis, this sample. RLS
      // pushes the weights along K until that error is absorbed.
      const target = axis === 0 ? rx : ry;
      let fitted = 0;
      for (let i = 0; i < N_FEAT; i++) fitted += this.w[wOff + i] * phi[i];
      const innovation = target - fitted;

      for (let i = 0; i < N_FEAT; i++) {
        this.w[wOff + i] = clamp(this.w[wOff + i] + K[i] * innovation, -MAX_WEIGHT, MAX_WEIGHT);
      }

      // P = (P − K φᵀ P) / λ
      const KP = new Float64Array(N_FEAT * N_FEAT);
      for (let i = 0; i < N_FEAT; i++) {
        for (let j = 0; j < N_FEAT; j++) KP[i * N_FEAT + j] = K[i] * Pp[j];
      }
      for (let i = 0; i < N_FEAT; i++) {
        for (let j = 0; j < N_FEAT; j++) {
          const v2 = (this.P[pOff + i * N_FEAT + j] - KP[i * N_FEAT + j]) / LAMBDA;
          this.P[pOff + i * N_FEAT + j] = Number.isFinite(v2) ? v2 : 0;
        }
      }
    }

    this.n++;
    // The trust ramp is about how long the user has been training the model,
    // not about how confident any one label was: an accepted label counts as
    // at least half an observation of progress. Without the floor a stream of
    // inferred (near-miss click) labels — each individually weak, together
    // plenty of evidence — would never reach full strength, and the correction
    // would stay applied at a fraction of what the fitted model can justify.
    // The label's own weight still scales how far the FIT may move.
    this.wSum += Math.max(0.5, wSample);

    // Accuracy telemetry: how far the CORRECTED prediction still is from the
    // label, versus how far the raw base map was. This is what makes "it learns
    // from my gaze" a measurable claim rather than a feeling.
    const corrected = this.correct({ h, v, yaw, pitch }, base);
    this.errs.push(Math.hypot(targetX - corrected.x, targetY - corrected.y));
    this.rawErrs.push(Math.hypot(targetX - base.x, targetY - base.y));
    if (this.errs.length > ERROR_WINDOW) this.errs.shift();
    if (this.rawErrs.length > ERROR_WINDOW) this.rawErrs.shift();
    return true;
  }

  /** Serializable state (localStorage / diagnostics). */
  toJSON(): { v: 1; n: number; ws: number; mode: GazeMapMode | null; w: number[]; P: number[] } {
    return {
      v: 1,
      n: this.n,
      // Trust is measured in WEIGHT, so it must survive a reload — otherwise a
      // user who has earned full trust over weeks drops back to a timid ramp.
      ws: this.wSum,
      mode: this.mode,
      w: Array.from(this.w),
      P: Array.from(this.P),
    };
  }

  /** Restore state; returns false and leaves the adapter empty on bad input. */
  fromJSON(raw: unknown): boolean {
    const data = raw as {
      v?: number;
      n?: number;
      ws?: number;
      mode?: string | null;
      w?: number[];
      P?: number[];
    };
    if (!data || data.v !== 1) return false;
    if (!Array.isArray(data.w) || data.w.length !== N_FEAT * 2) return false;
    if (!Array.isArray(data.P) || data.P.length !== N_FEAT * N_FEAT * 2) return false;
    if (!data.w.every((n) => Number.isFinite(n))) return false;
    if (!data.P.every((n) => Number.isFinite(n) && Math.abs(n) < 1e12)) return false;
    this.w = Float64Array.from(data.w);
    this.P = Float64Array.from(data.P);
    this.n = typeof data.n === "number" && Number.isFinite(data.n) ? Math.max(0, data.n) : 0;
    this.wSum =
      typeof data.ws === "number" && Number.isFinite(data.ws) && data.ws >= 0
        ? data.ws
        : // Older payloads have no weight total — fall back to the raw count.
          this.n;
    this.errs = [];
    this.rawErrs = [];
    this.mode = data.mode === "auto" || data.mode === "calib" ? data.mode : null;
    return true;
  }
}

/** Persist the adapter (best-effort — a private-mode browser just skips it). */
export function saveGazeAdapter(adapter: GazeAdapter): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(adapter.toJSON()));
  } catch {
    /* storage unavailable — the adapter still works for this session */
  }
}

/** Load the persisted adapter, or null when absent/stale/corrupt. */
export function loadGazeAdapter(): GazeAdapter | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const adapter = new GazeAdapter();
    return adapter.fromJSON(JSON.parse(raw)) ? adapter : null;
  } catch {
    return null;
  }
}

export function clearGazeAdapter(): void {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}
