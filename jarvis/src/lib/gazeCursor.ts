// The gaze motion model: engage → glide → settle, with a SELF-MEASURING
// dead zone.
//
// Extracted from the eye-control overlay so it can be tested. "The cursor
// dances around what I'm looking at" is the single most-reported gaze bug,
// and it lives entirely in this state machine: either the dead zone is
// smaller than the sensor noise (so the cursor never truly parks) or the
// hysteresis is too weak (so it chatters park → cross → glide → park).

export interface Point {
  x: number;
  y: number;
}

export interface GazeCursorOptions {
  /** Floor for the park radius, in screen fractions. */
  minRadius?: number;
  /** Ceiling — a wild signal must not be able to freeze the cursor. */
  maxRadius?: number;
  /** Park radius = noiseK × the measured per-frame wander. */
  noiseK?: number;
  /** Re-engage once the target leaves radius × exitK (the hysteresis). */
  exitK?: number;
  /** Exponential approach rate (1/s) while far from the target. */
  glideRate?: number;
  /** Slower rate inside `fineRadius`, for a precise landing. */
  fineRate?: number;
  /** Distance inside which the slower `fineRate` applies. */
  fineRadius?: number;
  /** Hard speed cap, screen-fractions per second. Nothing teleports. */
  maxSpeed?: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Consumes the filtered gaze target and returns the position the OS cursor
 * should be moved to — or `null` when the cursor must NOT move at all.
 *
 * `null` is a real answer, not an optimisation: "statue at rest" means zero
 * sends, so no downstream latency or rounding can nudge the pointer while
 * you hold a fixation.
 */
export class GazeCursor {
  private readonly minRadius: number;
  private readonly maxRadius: number;
  private readonly noiseK: number;
  private readonly exitK: number;
  private readonly glideRate: number;
  private readonly fineRate: number;
  private readonly fineRadius: number;
  private readonly maxSpeed: number;

  private anchor: Point | null = null;
  private prevTarget: Point | null = null;
  private noise = 0;
  private zone: number;
  private isParked = false;

  constructor(opts: GazeCursorOptions = {}) {
    this.minRadius = opts.minRadius ?? 0.009;
    this.maxRadius = opts.maxRadius ?? 0.06;
    this.noiseK = opts.noiseK ?? 3.5;
    this.exitK = opts.exitK ?? 1.7;
    this.glideRate = opts.glideRate ?? 15;
    this.fineRate = opts.fineRate ?? 10;
    this.fineRadius = opts.fineRadius ?? 0.07;
    this.maxSpeed = opts.maxSpeed ?? 2.6;
    this.zone = this.minRadius;
  }

  /** Current park radius, in screen fractions (diagnostics / HUDs). */
  get radius(): number {
    return this.zone;
  }

  get parked(): boolean {
    return this.isParked;
  }

  /** Wipe all state. The next step() PARKS at the first target it sees —
   *  after a tracking dropout, resuming a stale anchor glides the cursor
   *  across the screen to catch up. */
  reset(): void {
    this.anchor = null;
    this.prevTarget = null;
    this.isParked = false;
    // The learned noise floor is deliberately KEPT: a single dropped frame
    // should not throw away the stability the user's signal taught us.
  }

  /** Full reset including the learned noise floor. */
  resetAll(): void {
    this.reset();
    this.noise = 0;
    this.zone = this.minRadius;
  }

  /**
   * Feed one filtered gaze target.
   * @param target screen position 0..1
   * @param dt seconds since the previous step
   * @returns the new cursor position, or null to leave the cursor untouched
   */
  step(target: Point, dt: number): Point | null {
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y)) {
      this.reset();
      return null;
    }

    // First target after (re)start: PARK there. Never leap.
    if (!this.anchor) {
      this.anchor = { x: clamp01(target.x), y: clamp01(target.y) };
      this.prevTarget = { ...this.anchor };
      return null;
    }

    // Per-frame wander of the target itself — this IS the noise floor.
    const wander = Math.hypot(target.x - this.prevTarget!.x, target.y - this.prevTarget!.y);
    this.prevTarget = { x: target.x, y: target.y };

    const dx = target.x - this.anchor.x;
    const dy = target.y - this.anchor.y;
    const dist = Math.hypot(dx, dy);
    const wasParked = this.isParked;
    const exitR = this.zone * this.exitK;

    // LAND on the tight radius, LEAVE on the wide one. Parking at the exit
    // radius would stop the cursor up to ~2.5% of the screen away from the
    // thing you are looking at; the wide release radius is what keeps the
    // state sticky against noise.
    if (wasParked ? dist < exitR : dist < this.zone) {
      if (wasParked) {
        // TWO consecutive in-zone frames → the wander between them is pure
        // noise. (The first frame after a glide carries the glide step
        // itself, which is signal — letting it in would ratchet the radius
        // up on every movement.)
        this.noise = this.noise * 0.9 + wander * 0.1;
        this.zone = Math.max(this.minRadius, Math.min(this.maxRadius, this.noise * this.noiseK));
      }
      this.isParked = true;
      return null; // parked — the statue
    }

    this.isParked = false;
    // Moving: relax the learned noise floor so one noisy stretch doesn't
    // leave a permanently wide dead zone behind it.
    this.noise *= 0.995;
    this.zone = Math.max(this.minRadius, Math.min(this.maxRadius, this.noise * this.noiseK));

    const rate = dist < this.fineRadius ? this.fineRate : this.glideRate;
    const alpha = 1 - Math.exp(-rate * dt);
    const stepLen = Math.min(dist * alpha, this.maxSpeed * dt);
    const k = stepLen / dist;
    this.anchor = {
      x: clamp01(this.anchor.x + dx * k),
      y: clamp01(this.anchor.y + dy * k),
    };
    return { ...this.anchor };
  }
}
