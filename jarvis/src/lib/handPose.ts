// Hand pose classification and the panic-freeze release rule.
//
// Extracted from AirMouseControl on purpose. These are PURE THRESHOLD
// DECISIONS, and the reported bugs here were pure threshold bugs ("it freezes
// even though I never showed it a palm", "it won't unfreeze when I point").
// Logic like that buried inside a 700-line component can only be debugged by
// waving at a webcam; here it can be driven with synthetic frames in a test.

/**
 * The subset of a hand frame that pose classification reads.
 *
 * Declared structurally rather than imported from the hook so this module —
 * and its tests — stay free of React and of the app's path aliases.
 */
export interface PoseFrame {
  handFound: boolean;
  pinch: number;
  fist: number;
  curl: { index: number; middle: number; ring: number; pinky: number };
  ext: { index: number; middle: number; ring: number; pinky: number };
  thumbUp: boolean;
  fingers: { thumb: boolean; index: boolean; middle: boolean; ring: boolean; pinky: boolean };
}

export type Pose = "none" | "point" | "two" | "thumb" | "fist" | "palm";

/**
 * Geometric straightness thresholds, applied to the raw tip→PIP extension
 * ratio (`ext`).
 *
 * THE DEAD BAND IS THE POINT. An open palm requires middle/ring/pinky above
 * EXT_STRAIGHT; a point requires middle/ring below EXT_NOT_STRAIGHT. Since
 * EXT_NOT_STRAIGHT < EXT_STRAIGHT, the two poses have NO overlapping region:
 * a ratio landing in between belongs to neither, so a finger resting near the
 * boundary can never flip the classification from "point" to "palm".
 *
 * That guarantee is what fixes the reported bug. The old classifier used
 * `curl.* < 0.35` as its open-hand test, and a *relaxed* pointing hand — index
 * out, the other three loosely folded — scores curl ≈ 0.2-0.35, so it was read
 * as an open palm and armed the panic freeze. The same looseness was
 * compounded by the finger hysteresis booleans, which stay "extended" for a
 * while after a finger folds (exit threshold 0.95), so even a boolean OR-path
 * would have re-introduced the overlap.
 */
export const EXT_STRAIGHT = 1.06;
export const EXT_NOT_STRAIGHT = 1.05;

/**
 * Is this frame an open palm?
 *
 * The ONLY pose that arms the panic freeze, so it is gated on strict
 * geometry: every one of the four fingers measurably straighter than its PIP
 * joint, and no thumb-index pinch (an open palm has the thumb spread away,
 * a pinch does not).
 */
export function isOpenPalm(f: PoseFrame): boolean {
  if (!f.handFound) return false;
  if (f.pinch >= 0.6) return false;
  return (
    f.ext.index > EXT_STRAIGHT &&
    f.ext.middle > EXT_STRAIGHT &&
    f.ext.ring > EXT_STRAIGHT &&
    f.ext.pinky > EXT_STRAIGHT
  );
}

/** Classify a hand frame into one gesture pose. */
export function classifyPose(f: PoseFrame): Pose {
  if (!f.handFound) return "none";
  const { fingers, pinch, fist, curl, ext, thumbUp } = f;

  // Fist first — the thumb-up geometry then splits a deliberate 👍 from a ✊
  // at identical curl strength.
  if (fist > 0.5) return thumbUp ? "thumb" : "fist";

  // Open palm — checked BEFORE point so the two can never be confused; see
  // the dead-band guarantee above.
  if (isOpenPalm(f)) return "palm";

  // Scroll (✌️): index + middle out, ring in.
  if (ext.index > EXT_STRAIGHT && ext.middle > EXT_STRAIGHT && ext.ring < EXT_NOT_STRAIGHT) {
    return "two";
  }

  // Point (☝️): index out, middle and ring folded or level. Pinky is ignored
  // — a splayed pinky used to break pointing entirely.
  if (ext.index > EXT_STRAIGHT && ext.middle < EXT_NOT_STRAIGHT && ext.ring < EXT_NOT_STRAIGHT) {
    return "point";
  }

  // Thumb out with the rest folded. pinch < 0.3 keeps a real 🤏 out of here.
  if (
    fingers.thumb &&
    curl.index > 0.45 &&
    curl.middle > 0.45 &&
    curl.ring > 0.45 &&
    pinch < 0.3
  ) {
    return "thumb";
  }

  return "none";
}

/** Frames of a deliberate non-palm pose needed to leave the panic freeze. */
export const FREEZE_RELEASE_FRAMES = 3;

/**
 * Advance the freeze-release counter.
 *
 * The old rule hard-RESET on any frame that wasn't a recognized pose, and
 * demanded 4 CONSECUTIVE recognized frames. With a real camera, pose
 * classification flickers (a pointing hand alternates "point" and "none" as
 * landmarks jitter), so the counter kept restarting and the user stayed
 * frozen no matter how they waved — the reported "it doesn't unfreeze".
 *
 * Now: a held open palm keeps it at zero, an unrecognized frame is NEUTRAL
 * (neither progress nor reset — classification flickers, intent doesn't),
 * and any recognized non-palm pose makes progress.
 */
export function advanceFreezeRelease(counter: number, pose: Pose): number {
  if (pose === "palm") return 0;
  if (pose === "none") return counter;
  return counter + 1;
}
