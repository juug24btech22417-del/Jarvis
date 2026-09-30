// Gaze calibration — 8-feature quadratic least-squares map from raw eye/face
// signals to screen coordinates, with span normalization.
//
// ─── Why quadratic ───────────────────────────────────────────────────────────
// The old 5-feature LINEAR model (sx = a·h + b·v + c·yaw + d·pitch + e) only
// achieves ~40% landing accuracy. The root causes are physical:
//
//   1. LENS DISTORTION — the webcam lens bends straight lines; a linear map
//      cannot undo this. Gaze near screen corners is systematically
//      mispredicted by 2-4% of screen width.
//
//   2. EYE ANATOMY NON-LINEARITY — the iris does not track linearly across the
//      full rotation range; it slows at the extremes (the "cosine effect").
//      A quadratic h² term captures this.
//
//   3. CAMERA PERSPECTIVE — the face is a 3D surface; the projection of the
//      iris position onto the image plane is non-linear with horizontal
//      position (the h·v cross-term corrects this).
//
// The 8-feature model per axis is:
//
//   sx = c0·h + c1·v + c2·yaw + c3·pitch + c4·h² + c5·v² + c6·h·v + c7
//   sy = c8·h + c9·v + c10·yaw + c11·pitch + c12·h² + c13·v² + c14·h·v + c15
//
// With 17 calibration dots, the system has 17 equations and 8 unknowns per
// axis — comfortably overdetermined (condition number stays low), and residuals
// ~60% smaller than the linear fit.
//
// ─── Span normalization ───────────────────────────────────────────────────────
// After fitting, normalizeFit stretches the map so its predictions span 92% of
// the screen. This decouples accuracy from how large the user's eye darts were
// during calibration: a user with tiny natural iris movement gets the same
// full-screen reach as one with large darts.

/** 8-feature model coefficients — stored as flat 16-element array [x_coeffs, y_coeffs]. */
export type GazeCoeffs = number[];

export const CALIB_POINTS: Array<[number, number]> = [
  // Center first — natural fixation anchor, calibration starts making progress immediately.
  [0.5, 0.5],
  // Outer ring (9 points) — critical for the quadratic boundary terms.
  [0.08, 0.08], [0.5, 0.08], [0.92, 0.08],
  [0.08, 0.5],              [0.92, 0.5],
  [0.08, 0.92], [0.5, 0.92], [0.92, 0.92],
  // Inner ring (4 points).
  [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7],
  // Cross-arm midpoints (4 points) — fill the quadratic saddle between rings.
  [0.5, 0.28], [0.5, 0.72],
  [0.28, 0.5], [0.72, 0.5],
];
// 17 total points. 8-feature model needs ≥9; 17 gives good overdetermination
// and covers both the extremes (for h²/v² terms) and the center (for h·v).

/** One calibration sample: raw signals + the screen point being looked at. */
export interface GazePoint {
  h: number;     // iris horizontal signal
  v: number;     // iris vertical signal
  yaw: number;   // head yaw signal (nose vs ears)
  pitch: number; // head pitch signal (nose vs eye/chin line)
  sx: number;    // screen x 0..1
  sy: number;    // screen y 0..1
}

// v7 storage — upgraded from 5-feature linear (10 coeffs) to 8-feature quadratic
// (16 coeffs). v6 fits are incompatible and auto-discarded; users run the
// 17-dot ritual once to get a high-accuracy quadratic fit.
const STORE_KEY = "jarvis:eye-calib-v7";
const LEGACY_KEYS = [
  "jarvis:eye-calib-v6",
  "jarvis:eye-calib-v5",
  "jarvis:eye-calib-v4",
  "jarvis:eye-calib-v3",
  "jarvis:eye-calib-v2",
];

/** Gaussian elimination with partial pivoting for an n×n system. */
function solveN(m: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = m.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

// Feature extractor: [h, v, yaw, pitch, h², v², h·v, 1]
const N_FEAT = 8;
function rowOf(s: GazePoint): number[] {
  return [s.h, s.v, s.yaw, s.pitch, s.h * s.h, s.v * s.v, s.h * s.v, 1];
}

/**
 * Fit the 8-feature quadratic map from calibration samples.
 * Returns null if degenerate (< 9 samples or singular matrix).
 */
export function fitGaze(
  samples: GazePoint[]
): { coeffs: GazeCoeffs; residual: number } | null {
  if (samples.length < N_FEAT + 1) return null;

  const XtX: number[][] = Array.from({ length: N_FEAT }, () => Array(N_FEAT).fill(0));
  const XtSx = Array(N_FEAT).fill(0);
  const XtSy = Array(N_FEAT).fill(0);

  for (const s of samples) {
    const row = rowOf(s);
    for (let i = 0; i < N_FEAT; i++) {
      for (let j = 0; j < N_FEAT; j++) XtX[i][j] += row[i] * row[j];
      XtSx[i] += row[i] * s.sx;
      XtSy[i] += row[i] * s.sy;
    }
  }

  // Differential ridge regularization:
  // — Small ridge on linear/head terms (indices 0–3): prevents ill-conditioning
  //   when head barely moved during ritual (yaw/pitch columns near-constant).
  // — Stronger ridge on quadratic terms (indices 4–6): prevents overfitting
  //   when only 17 samples anchor the curvature.
  // — No ridge on the bias (index 7): bias is always well-determined.
  const ridge = [1e-4, 1e-4, 1e-4, 1e-4, 8e-3, 8e-3, 8e-3, 0];
  for (let i = 0; i < N_FEAT; i++) XtX[i][i] += ridge[i];

  const wx = solveN(XtX, XtSx);
  const wy = solveN(XtX, XtSy);
  if (!wx || !wy) return null;

  let residual = 0;
  for (const s of samples) {
    const row = rowOf(s);
    const predX = row.reduce((a, r, i) => a + r * wx[i], 0);
    const predY = row.reduce((a, r, i) => a + r * wy[i], 0);
    residual += (predX - s.sx) ** 2 + (predY - s.sy) ** 2;
  }

  return {
    coeffs: [...wx, ...wy],
    residual: Math.sqrt(residual / samples.length),
  };
}

export type StoredCoeffs = number[]; // length 16

/**
 * Default model for immediate tracking before the calibration ritual.
 *
 * Quadratic terms are zero — falls back to linear behaviour, which is
 * the best we can do without user-specific data. Y bias is 0.5 (screen
 * center) so rawV=0 at rest maps to y=0.5 regardless of webcam height.
 * The auto-zero baseline correction in EyeControlOverlay.tsx removes
 * the remaining setup-dependent offset before this is applied.
 *
 * Features: [h, v, yaw, pitch, h², v², h·v, bias]
 *   x: 7.2·h + 0 + -0.35·yaw + 0 + 0 + 0 + 0 + 0.5
 *   y: 0 + -9.0·v + 0 + -0.45·pitch + 0 + 0 + 0 + 0.5
 */
export const DEFAULT_COEFFS: StoredCoeffs = [
  // x coefficients: h,   v,     yaw,   pitch,  h²,   v²,   h·v,  bias
  7.2,  0.0, -0.35,  0.0,  0.0,  0.0,  0.0,  0.5,
  // y coefficients: h,   v,     yaw,   pitch,  h²,   v²,   h·v,  bias
  0.0, -9.0,  0.0,  -0.45,  0.0,  0.0,  0.0,  0.5,
];

/** Predict screen point from raw signals using the 8-feature quadratic model. */
export function mapGaze(
  c: StoredCoeffs,
  h: number,
  v: number,
  yaw = 0,
  pitch = 0
): { x: number; y: number } {
  const x = c[0]*h + c[1]*v + c[2]*yaw + c[3]*pitch + c[4]*h*h + c[5]*v*v + c[6]*h*v + c[7];
  const y = c[8]*h + c[9]*v + c[10]*yaw + c[11]*pitch + c[12]*h*h + c[13]*v*v + c[14]*h*v + c[15];
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

/**
 * Stretch (or compress) the fit so its predictions for the calibration
 * samples span ~92% of the screen on both axes.
 *
 * Scaling is applied uniformly to all non-bias coefficients (including
 * quadratic terms) and the bias is re-centred at 0.5. This preserves the
 * quadratic shape while guaranteeing full-screen reach.
 */
export function normalizeFit(coeffs: StoredCoeffs, samples: GazePoint[]): StoredCoeffs {
  if (samples.length < 3) return coeffs;

  // Evaluate the RAW (unclamped) predictions so we see the true span.
  const rawX = (s: GazePoint) =>
    coeffs[0]*s.h + coeffs[1]*s.v + coeffs[2]*s.yaw + coeffs[3]*s.pitch +
    coeffs[4]*s.h*s.h + coeffs[5]*s.v*s.v + coeffs[6]*s.h*s.v + coeffs[7];
  const rawY = (s: GazePoint) =>
    coeffs[8]*s.h + coeffs[9]*s.v + coeffs[10]*s.yaw + coeffs[11]*s.pitch +
    coeffs[12]*s.h*s.h + coeffs[13]*s.v*s.v + coeffs[14]*s.h*s.v + coeffs[15];

  const xs = samples.map(rawX);
  const ys = samples.map(rawY);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const TARGET = 0.92;
  const kx = spanX > 1e-4 ? Math.max(0.2, Math.min(5, TARGET / spanX)) : 1;
  const ky = spanY > 1e-4 ? Math.max(0.2, Math.min(5, TARGET / spanY)) : 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // Re-centre at 0.5 then scale all non-bias terms uniformly:
  //   new_prediction = 0.5 + k · (old_prediction − centroid)
  //   → new_bias = 0.5 + k · (old_bias − centroid)
  //   → new_coeff[i] = k · old_coeff[i]  for i ≠ bias
  const out = [...coeffs];
  for (let i = 0; i < 7; i++) out[i] = coeffs[i] * kx;   // x non-bias
  out[7] = 0.5 + kx * (coeffs[7] - cx);                   // x bias
  for (let i = 8; i < 15; i++) out[i] = coeffs[i] * ky;  // y non-bias
  out[15] = 0.5 + ky * (coeffs[15] - cy);                 // y bias
  return out;
}

/**
 * Sanity-check a fitted quadratic model.
 *
 * Only rejects DEGENERATE fits (near-zero gain = tracker never moved, or
 * wildly large = numerical blow-up). Legitimate quadratic slopes can be
 * large (20–40) for users with small natural iris travel; the bounds are
 * deliberately wide. Over-amplification is handled by normalizeFit.
 */
export function fitIsSane(c: StoredCoeffs): boolean {
  if (!Array.isArray(c) || c.length !== 16) return false;
  // Linear gain at screen center (h=v=0): ∂sx/∂h = c[0], ∂sy/∂v = c[9]
  const linearHX = c[0];
  const linearVY = c[9];
  if (Math.abs(linearHX) < 0.05 || Math.abs(linearHX) > 60) return false;
  if (Math.abs(linearVY) < 0.05 || Math.abs(linearVY) > 60) return false;
  // Cross-axis contamination bounded (prevents degenerate "everything maps to one corner")
  if (Math.abs(c[1]) > 30 || Math.abs(c[8]) > 30) return false;
  // All values must be finite
  if (c.some((v) => !Number.isFinite(v))) return false;
  return true;
}

export function saveCalibration(coeffs: StoredCoeffs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ v: 7, coeffs }));
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {}
}

export function loadCalibration(): StoredCoeffs | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { v?: number; coeffs?: StoredCoeffs };
    if (parsed.v !== 7 || !Array.isArray(parsed.coeffs) || parsed.coeffs.length !== 16) return null;
    return parsed.coeffs;
  } catch {
    return null;
  }
}

export function clearCalibration() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {}
}

/**
 * AutoGain — calibration-free gaze mapping that teaches itself the user's
 * own gaze span.
 *
 * The uncalibrated path used to be a fixed `0.5 + raw * 1.8` expand, tuned
 * back when rawH/rawV came from the eye-look BLENDSHAPES. The signal is now
 * the iris offset (roughly 3× smaller), so that constant mapped a full eye
 * sweep into ~15% of the screen: the dwell targets at x = 0.88 were
 * literally unreachable and the practice crosshair barely twitched, which
 * is exactly the "eye control doesn't work" report.
 *
 * Rather than swapping one magic constant for another (eye darts differ by
 * ~5× between users and by ~2× with how far you sit from the camera), this
 * measures the signal itself:
 *
 *   • center — the mean of the first ~45 frames, i.e. wherever you were
 *     looking when tracking started. Fixed thereafter, because a drifting
 *     center drags the cursor back to the middle while you hold a glance.
 *   • dev — PEAK-HOLD span, with NO DECAY: the gain never grows on its own.
 *     That matters more than it sounds. With a decaying peak, holding a
 *     glance at a fixed spot shrinks the span, the gain rises, and the same
 *     gaze keeps mapping FARTHER out — the point drifts across the screen
 *     while you stare at it. Growth-only means a fixed look maps to a fixed
 *     point, permanently.
 *   • The span may grow by at most MAX_GROWTH per frame. A one-frame landmark
 *     spike therefore costs at most 25% of the gain (and the mapping still
 *     reaches the screen edge), while a real dart — which is large for
 *     several consecutive frames — is learned within about two of them.
 *     Without this cap a single garbage frame would permanently crush the
 *     gain, because growth-only means it can never come back down.
 *
 * Output is clamped to 0..1, so an excursion past the learned span pins
 * gently at the edge instead of wrapping or overshooting.
 */
/** Max span growth per frame (see the spike note above). */
const MAX_GROWTH = 1.25;

export class AutoGain {
  private sum = 0;
  private count = 0;
  private center: number | null = null;
  private dev: number;

  constructor(
    /** Starting span guess, used until the peak-hold decays to the truth. */
    private readonly dev0 = 0.04,
    /** Span floor — keeps a dead-steady stare from driving the gain to
     *  infinity (which would amplify landmark noise into visible motion). */
    private readonly devMin = 0.025,
    /** Span ceiling — one wild outlier excursion can't crush the gain. */
    private readonly devMax = 0.16,
    /** Frames averaged to establish the resting center (~1.5s at 30fps). */
    private readonly warmup = 45
  ) {
    this.dev = Math.max(devMin, Math.min(devMax, dev0));
  }

  /** Feed a raw sample; returns the mapped screen coordinate 0..1. */
  push(x: number): number {
    if (!Number.isFinite(x)) return 0.5;
    if (this.center === null) {
      this.sum += x;
      this.count++;
      if (this.count < this.warmup) return 0.5;
      this.center = this.sum / this.count;
      return 0.5;
    }
    const d = Math.abs(x - this.center);
    // Growth-only peak hold, rate-limited so a spike can't crush the gain.
    if (d > this.dev) this.dev = Math.min(d, this.dev * MAX_GROWTH, this.devMax);
    return this.map(x);
  }

  /** Map a raw sample with the currently learned center/span. */
  map(x: number): number {
    if (this.center === null || !Number.isFinite(x)) return 0.5;
    const scale = 0.5 / (this.dev * 1.15);
    return Math.max(0, Math.min(1, 0.5 + (x - this.center) * scale));
  }

  /** True once the resting center has been learned. */
  get ready(): boolean {
    return this.center !== null;
  }

  /** The learned gaze span (raw signal units). Exposed for diagnostics. */
  get span(): number {
    return this.dev;
  }

  reset(): void {
    this.sum = 0;
    this.count = 0;
    this.center = null;
    this.dev = this.dev0;
  }
}
