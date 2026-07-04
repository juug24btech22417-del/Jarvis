// Pure decay functions for the forgetting curve.
// No DB access — easy to unit test, easy to call from anywhere.

/**
 * Ebbinghaus-inspired decay schedule. Times in milliseconds.
 *
 * <1d          -> 1.0 (vivid)
 * 1-3d         -> 0.7 (fresh)
 * 3-7d         -> 0.4 (fading)
 * 7-30d        -> 0.2 (dim)
 * >30d         -> 0.1 (archive)
 *
 * Pinned items are always 1.0 (immune to decay).
 * Items accessed in the last hour are boosted to 1.0 (recently used).
 */
export const DECAY_THRESHOLDS = {
  oneDayMs: 24 * 60 * 60 * 1000,
  threeDayMs: 3 * 24 * 60 * 60 * 1000,
  sevenDayMs: 7 * 24 * 60 * 60 * 1000,
  thirtyDayMs: 30 * 24 * 60 * 60 * 1000,
  recentAccessMs: 60 * 60 * 1000,
} as const;

export const ARCHIVE_THRESHOLD = 0.15;

export interface DecayInput {
  baseStrength: number;
  lastAccessed: Date | null;
  createdAt: Date;
  pinned: boolean;
  now?: Date;
}

/**
 * Compute current strength given a memory's age and last access.
 * Pinned = always 1.0. Recently accessed (<1h) = boost to 1.0.
 * Otherwise multiply baseStrength by the decay tier.
 */
export function computeStrength(input: DecayInput): number {
  const now = input.now ?? new Date();
  if (input.pinned) return 1.0;

  if (input.lastAccessed) {
    const sinceAccess = now.getTime() - input.lastAccessed.getTime();
    if (sinceAccess < DECAY_THRESHOLDS.recentAccessMs) {
      return Math.min(1.0, input.baseStrength);
    }
  }

  const reference = input.lastAccessed ?? input.createdAt;
  const age = now.getTime() - reference.getTime();

  let tier: number;
  if (age < DECAY_THRESHOLDS.oneDayMs) tier = 1.0;
  else if (age < DECAY_THRESHOLDS.threeDayMs) tier = 0.7;
  else if (age < DECAY_THRESHOLDS.sevenDayMs) tier = 0.4;
  else if (age < DECAY_THRESHOLDS.thirtyDayMs) tier = 0.2;
  else tier = 0.1;

  return clamp01(input.baseStrength * tier);
}

/**
 * Should this memory be archived (soft-deleted, hidden from default queries)?
 */
export function shouldArchive(input: DecayInput): boolean {
  if (input.pinned) return false;
  return computeStrength(input) < ARCHIVE_THRESHOLD;
}

/**
 * Apply a reinforcement delta to baseStrength, clamped to [0, 1.5].
 * Returning a clamped value lets you simply write it back to baseStrength.
 */
export function applyReinforcement(
  baseStrength: number,
  delta: number
): number {
  return Math.max(0, Math.min(1.5, baseStrength + delta));
}

/**
 * Render a memory as a CSS opacity [0.25, 1.0] for visual decay.
 * Archived = 0.15 (barely visible).
 */
export function strengthToOpacity(strength: number, archived: boolean): number {
  if (archived) return 0.15;
  // Map [0, 1.0] -> [0.25, 1.0]. Above 1.0 (boosted) caps at 1.0.
  return Math.max(0.25, Math.min(1.0, strength));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1.0, n));
}

/**
 * Human-readable label for the current decay tier (useful for UI badges).
 */
export function decayLabel(strength: number): string {
  if (strength >= 0.9) return "vivid";
  if (strength >= 0.6) return "fresh";
  if (strength >= 0.3) return "fading";
  if (strength >= 0.15) return "dim";
  return "archived";
}