// One-webcam-at-a-time lock for the vision features (air-mouse, eye control,
// gesture DJ). Two MediaPipe pipelines fighting over one camera double the
// latency and steal each other's frames — first claim wins, and the loser's
// hook reports "camera busy" until the winner releases.

export type VisionOwner = "air-mouse" | "eyes" | "dj";

const EVENT = "jarvis:vision-lock";

let holder: VisionOwner | null = null;

/** Try to claim the camera for `owner`. Returns false if someone else holds it. */
export function claimVision(owner: VisionOwner): boolean {
  if (holder && holder !== owner) return false;
  holder = owner;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { holder } }));
  }
  return true;
}

/** Release the camera. No-op if `owner` isn't the current holder. */
export function releaseVision(owner: VisionOwner) {
  if (holder !== owner) return;
  holder = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { holder } }));
  }
}

/** Current holder, if any. */
export function visionHolder(): VisionOwner | null {
  return holder;
}

/** Subscribe to lock changes. Returns an unsubscribe fn. */
export function onVisionLockChange(
  cb: (holder: VisionOwner | null) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  const h = (e: Event) => cb((e as CustomEvent).detail?.holder ?? null);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
