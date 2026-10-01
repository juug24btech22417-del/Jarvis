// Pure presence-transition logic for the "phone arrives / phone leaves"
// automations. No I/O, no clock of its own — everything comes in through the
// snapshot, so every rule is testable and deterministic.
//
// The tracked device is the one the user marked as theirs (the phone). We only
// ever claim "left" after the phone has been missing continuously for the
// configured grace period, because phones sleep and drop off the network for a
// few seconds at a time — a false "left" would lock the desk mid-typing.

export type PresenceState = "home" | "away" | "unknown";

export interface PresenceConfig {
  /** True when at least one automation is switched on. */
  enabled: boolean;
  /** Seconds the phone must stay missing before we call it "left". */
  leaveGraceSeconds: number;
}

export interface PresenceSnapshot {
  now: number;
  /** Is the tracked phone visible in this scan? */
  present: boolean;
  /** Have we ever seen the phone? Without this we cannot say it "arrived". */
  everSeen: boolean;
  state: PresenceState;
  lastPresentAt: number;
  lastActionAt: number;
}

export interface PresenceDecision {
  state: PresenceState;
  lastPresentAt: number;
  lastActionAt: number;
  action: "arrived" | "left" | null;
  /** How long the phone has been missing, or null when it is here. */
  absentForMs: number | null;
}

export const DEFAULT_LEAVE_GRACE_SECONDS = 90;
/** Never run the same scene twice inside this window. */
export const ARRIVE_DEBOUNCE_MS = 60_000;
export const LEAVE_DEBOUNCE_MS = 30_000;

export function resolvePresenceConfig(cfg: {
  autoWelcome?: boolean;
  autoLockOnLeave?: boolean;
  leaveGraceSeconds?: number;
}): PresenceConfig {
  const grace = Number(cfg.leaveGraceSeconds);
  return {
    enabled: !!cfg.autoWelcome || !!cfg.autoLockOnLeave,
    leaveGraceSeconds:
      Number.isFinite(grace) && grace > 0 ? Math.min(grace, 3600) : DEFAULT_LEAVE_GRACE_SECONDS,
  };
}

export function evaluatePresence(cfg: PresenceConfig, snap: PresenceSnapshot): PresenceDecision {
  const { now, present, everSeen, state, lastPresentAt, lastActionAt } = snap;

  if (!everSeen) {
    // Nothing to track yet — stay quiet rather than greeting an empty room.
    return { state: "unknown", lastPresentAt: 0, lastActionAt, action: null, absentForMs: null };
  }

  if (present) {
    const arrived =
      cfg.enabled &&
      state === "away" &&
      now - lastActionAt >= ARRIVE_DEBOUNCE_MS &&
      lastPresentAt > 0;
    return {
      state: "home",
      lastPresentAt: now,
      lastActionAt: arrived ? now : lastActionAt,
      action: arrived ? "arrived" : null,
      absentForMs: null,
    };
  }

  const absentForMs = lastPresentAt ? Math.max(0, now - lastPresentAt) : null;
  const goneForGood =
    absentForMs != null && absentForMs >= cfg.leaveGraceSeconds * 1000;
  const shouldLeave =
    cfg.enabled && state === "home" && goneForGood && now - lastActionAt >= LEAVE_DEBOUNCE_MS;

  return {
    state: shouldLeave ? "away" : state,
    lastPresentAt,
    lastActionAt: shouldLeave ? now : lastActionAt,
    action: shouldLeave ? "left" : null,
    absentForMs,
  };
}
