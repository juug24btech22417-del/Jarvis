// One-Euro filter (Casiez et al., CHI 2012) — adaptive low-pass filter for
// pointer smoothing. Kills hand-tracking jitter at rest while staying
// responsive during fast moves (cutoff rises with speed via the beta term).
//
// Used by the air-mouse to smooth MediaPipe fingertip coords before they
// drive the real OS cursor.

export class OneEuroFilter {
  private hatX: number | null = null;
  private hatDx = 0;
  private lastT: number | null = null;

  constructor(
    /** Min cutoff frequency (Hz) — lower = smoother at rest. */
    private minCutoff = 1.0,
    /** Speed coefficient — higher = snappier during fast moves. */
    private beta = 0.02,
    /** Cutoff for the derivative (velocity) estimate. */
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /**
   * Feed a sample; returns the smoothed value.
   * @param x raw sample
   * @param t timestamp in ms (performance.now())
   */
  filter(x: number, t: number): number {
    if (this.hatX === null || this.lastT === null) {
      this.hatX = x;
      this.lastT = t;
      return x;
    }
    const dt = Math.max(1e-3, (t - this.lastT) / 1000);
    this.lastT = t;

    // Estimate velocity and smooth it.
    const dx = (x - this.hatX) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    this.hatDx = aD * dx + (1 - aD) * this.hatDx;

    // Speed-adaptive cutoff.
    const cutoff = this.minCutoff + this.beta * Math.abs(this.hatDx);
    const a = OneEuroFilter.alpha(cutoff, dt);
    this.hatX = a * x + (1 - a) * this.hatX;
    return this.hatX;
  }

  reset(): void {
    this.hatX = null;
    this.hatDx = 0;
    this.lastT = null;
  }
}
