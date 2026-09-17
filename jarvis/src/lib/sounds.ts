/**
 * Repulsor blast — shared, preload-once sound player.
 *
 * Two browser quirks killed the old per-component Audio:
 *  1. `currentTime = 0` on a lazily-created element often raced the load,
 *     so the first play after a refresh was silent.
 *  2. Replaying one shared element can't overlap itself and can hit
 *     play() deferral.
 *
 * Fix: preload the element at the power-gate press (inside a user gesture,
 * so the fetch + decode are unlocked), then every play() clones the node —
 * clones start instantly, overlap freely, and never block each other.
 */

let src: HTMLAudioElement | null = null;
let primed = false;

function ensureElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!src) {
    src = new Audio("/sounds/repulsor.mp3");
    src.preload = "auto";
    src.volume = 0.55;
  }
  return src;
}

/** Call inside a user gesture (power-gate press) to warm the sound. */
export function primeRepulsor() {
  const el = ensureElement();
  if (!el || primed) return;
  primed = true;
  // Load + decode now; a muted play() also unlocks the element itself.
  el.muted = true;
  el.play()
    .then(() => {
      el!.pause();
      el!.currentTime = 0;
      el!.muted = false;
    })
    .catch(() => {
      // Even if the muted play is refused, load() still warms the cache.
      el!.load();
      el!.muted = false;
    });
}

/** Fire the blast. Safe to call rapidly; overlapping plays are allowed. */
export function playRepulsor() {
  const el = ensureElement();
  if (!el) return;
  try {
    const blast = el.cloneNode(true) as HTMLAudioElement;
    blast.volume = 0.55;
    void blast.play().catch(() => {
      /* autoplay block — silently skip */
    });
  } catch {
    /* never let sound break the toggle */
  }
}
