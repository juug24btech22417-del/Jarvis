// Loader for the legacy @mediapipe packages (hands, camera_utils).
//
// These packages must NOT be bundled by webpack — their UMD wrapper breaks
// under the bundler and blows up at runtime with `TypeError: n is not a
// function` inside the WASM glue. They are also blocked by the app's CSP
// when loaded from an external CDN (script-src 'self').
//
// Solution: the runtime files are self-hosted in public/mediapipe/ (copied
// from node_modules — same version), loaded as plain <script> tags from our
// own origin, which is CSP-compliant and works fully offline.
// Types come from the local npm packages (type-only imports).

declare global {
  interface Window {
    Hands?: new (config: { locateFile: (file: string) => string }) => unknown;
    Camera?: new (
      videoEl: HTMLVideoElement,
      config: { onFrame: () => Promise<void>; width?: number; height?: number }
    ) => { start: () => Promise<void>; stop: () => void };
  }
}

const HANDS_URL = "/mediapipe/hands/hands.js";
const CAMERA_URL = "/mediapipe/camera_utils.js";

const cache = new Map<string, Promise<void>>();

/** Inject a script once; resolves when loaded, rejects on failure. */
function loadScript(src: string): Promise<void> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        // Someone else already injected it (e.g. another hook instance).
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(`script error: ${src}`)));
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.crossOrigin = "anonymous";
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`failed to load ${src}`));
      document.head.appendChild(s);
    });
    cache.set(src, p);
  }
  return p;
}

let handsPromise: Promise<new (config: { locateFile: (file: string) => string }) => unknown> | null = null;

/** Load hands.js from the CDN and return the window.Hands constructor. */
export function loadHandsClass() {
  if (!handsPromise) {
    handsPromise = loadScript(HANDS_URL).then(() => {
      if (!window.Hands) throw new Error("window.Hands missing after script load");
      return window.Hands;
    });
  }
  return handsPromise;
}

let cameraPromise: Promise<NonNullable<Window["Camera"]>> | null = null;

/** Load camera_utils.js from the CDN and return the window.Camera constructor. */
export function loadCameraClass() {
  if (!cameraPromise) {
    cameraPromise = loadScript(CAMERA_URL).then(() => {
      if (!window.Camera) throw new Error("window.Camera missing after script load");
      return window.Camera;
    });
  }
  return cameraPromise;
}
