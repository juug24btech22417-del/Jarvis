// Eye-gaze calibration — maps raw eye-look blendshape signals to screen
// coordinates with an affine transform fit from a 9-point calibration ritual.
//
// Raw gaze (hRaw, vRaw) is roughly linear in screen position for small head
// poses; an affine map (6 params) absorbed per-user eye geometry and webcam
// placement. 9 points give a stable least-squares fit; the residual doubles
// as a quality score.

export interface GazePoint {
  /** Raw horizontal signal. */
  h: number;
  /** Raw vertical signal. */
  v: number;
  /** Screen target, normalized 0..1. */
  sx: number;
  sy: number;
}

/** Affine map coefficients: sx = a*h + b*v + c · sy = d*h + e*v + f. */
export type AffineCoeffs = [number, number, number, number, number, number];

export const CALIB_POINTS: Array<[number, number]> = [
  [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
  [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
  [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
];

const STORE_KEY = "jarvis:eye-calib";

/** Solve the 3×3 normal equations XᵀXw = Xᵀy (Gaussian elimination). */
function solve3(m: number[][], rhs: number[]): number[] | null {
  const a = [m[0], m[1], m[2]].map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (Math.abs(a[piv][col]) < 1e-12) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= 3; c++) a[r][c] -= f * a[col][c];
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
}

/**
 * Fit the affine map from calibration samples. Returns null if degenerate
 * (e.g. all samples identical — user never actually moved their gaze).
 */
export function fitAffine(samples: GazePoint[]): { coeffs: AffineCoeffs; residual: number } | null {
  if (samples.length < 6) return null;
  // X rows: [h, v, 1]
  const XtX = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const XtSx = [0, 0, 0];
  const XtSy = [0, 0, 0];
  for (const s of samples) {
    const row = [s.h, s.v, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) XtX[i][j] += row[i] * row[j];
      XtSx[i] += row[i] * s.sx;
      XtSy[i] += row[i] * s.sy;
    }
  }
  const wx = solve3(XtX, XtSx);
  const wy = solve3(XtX, XtSy);
  if (!wx || !wy) return null;

  let residual = 0;
  for (const s of samples) {
    const ex = wx[0] * s.h + wx[1] * s.v + wx[2] - s.sx;
    const ey = wy[0] * s.h + wy[1] * s.v + wy[2] - s.sy;
    residual += ex * ex + ey * ey;
  }
  return { coeffs: [wx[0], wx[1], wx[2], wy[0], wy[1], wy[2]], residual: Math.sqrt(residual / samples.length) };
}

export function mapGaze(coeffs: AffineCoeffs, h: number, v: number): { x: number; y: number } {
  const x = coeffs[0] * h + coeffs[1] * v + coeffs[2];
  const y = coeffs[3] * h + coeffs[4] * v + coeffs[5];
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

export function saveCalibration(coeffs: AffineCoeffs) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ coeffs }));
  } catch {}
}

export function loadCalibration(): AffineCoeffs | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { coeffs: AffineCoeffs };
    if (!Array.isArray(parsed.coeffs) || parsed.coeffs.length !== 6) return null;
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
