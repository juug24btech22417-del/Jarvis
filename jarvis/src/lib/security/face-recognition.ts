// Face Recognition Service — @vladmandic/face-api engine (upgrade #13).
//
// Why the swap: old `face-api.js` (0.22.2, last touched 2020) ships an ancient
// TFJS that's noticeably worse in low light / side angles. @vladmandic/face-api
// is the maintained fork: same model weights, same 128-d descriptor space, but
// modern TFJS backends (webgl/webgpu) → better accuracy + faster inference.
//
// MIGRATION NOTE: descriptors are weight-compatible with the old engine —
// existing registered faces keep working, no re-enrollment needed.
// Models self-host from /public/models (vendored, offline-capable).
//
// ⚠️ LAZY LOADING IS REQUIRED: a top-level
// `import * as faceApi from '@vladmandic/face-api'` resolves to the package
// `main` — dist/face-api.node.js — which drags node-fetch/util into the
// webpack graph and crashes Next's SSR render of every page with
// "TypeError: this.util.TextEncoder is not a constructor". We dynamic-import
// the ESM **browser** build instead, deferring evaluation to the client where
// it runs on the WebGL backend.

const DETECTOR_OPTIONS = { inputSize: 320 as const, scoreThreshold: 0.35 };

const MODEL_URLS = [
  '/models', // vendored first (offline, fast)
  'https://justadudewhohacks.github.io/face-api.js/models', // CDN fallback
  'https://vladmandic.github.io/face-api/model', // maintainer's models (ssd etc.)
];

// Detection result shapes (independent of the node typings).
type FaceDetectionBox = { x: number; y: number; width: number; height: number };

type PresenceResult = { detection: { box: FaceDetectionBox } };

type FullResult = PresenceResult & {
  landmarks: { positions: Array<{ x: number; y: number }> };
  descriptor: Float32Array;
};

// The detect task is thenable: you can either await it directly (presence
// check) or chain .withFaceLandmarks().withFaceDescriptor() (recognition).
type DetectTask<R> = PromiseLike<R> & {
  withFaceLandmarks: (tiny?: boolean) => {
    withFaceDescriptor: () => PromiseLike<FullResult | null | undefined>;
  };
};

// Minimal structural type for the surface we use (the real typings target the
// node build, so we keep our own to stay honest without fighting the bundler).
type FaceApiModule = {
  nets: {
    tinyFaceDetector: { load: (url: string) => Promise<unknown>; isLoaded: boolean };
    faceLandmark68TinyNet: { load: (url: string) => Promise<unknown>; isLoaded: boolean };
    faceRecognitionNet: { load: (url: string) => Promise<unknown>; isLoaded: boolean };
  };
  TinyFaceDetectorOptions: new (opts: {
    inputSize: number;
    scoreThreshold: number;
  }) => unknown;
  detectSingleFace: (
    input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    options: unknown
  ) => DetectTask<PresenceResult | null | undefined>;
  tf?: {
    setBackend: (b: string) => Promise<boolean>;
    ready: Promise<unknown>;
  };
};

let faceApiModule: FaceApiModule | null = null;
let faceApiModulePromise: Promise<FaceApiModule | null> | null = null;
let faceApiModelsLoaded = false;

async function getFaceApi(): Promise<FaceApiModule | null> {
  if (faceApiModule) return faceApiModule;
  if (typeof window === 'undefined') return null; // browser-only — never during SSR
  if (!faceApiModulePromise) {
    faceApiModulePromise = import('@vladmandic/face-api/dist/face-api.esm.js')
      .then((m: any) => {
        faceApiModule = m as FaceApiModule;
        return faceApiModule;
      })
      .catch((err) => {
        console.error('[FaceRecognition] Failed to load face-api engine:', err);
        faceApiModulePromise = null; // allow retry on next call
        return null;
      });
  }
  return faceApiModulePromise;
}

async function tryLoadFrom(m: FaceApiModule, url: string): Promise<boolean> {
  try {
    // tinyFaceDetector + tiny landmarks + faceRecNet — the same trio as
    // before, so descriptors stay comparable with registered faces.
    await Promise.all([
      m.nets.tinyFaceDetector.load(url),
      m.nets.faceLandmark68TinyNet.load(url),
      m.nets.faceRecognitionNet.load(url),
    ]);
    // Sanity: net must actually be loaded (some CDNs 404 silently).
    return (
      m.nets.tinyFaceDetector.isLoaded &&
      m.nets.faceLandmark68TinyNet.isLoaded &&
      m.nets.faceRecognitionNet.isLoaded
    );
  } catch {
    return false;
  }
}

export async function loadFaceApiModels(): Promise<boolean> {
  if (faceApiModelsLoaded) return true;

  const m = await getFaceApi();
  if (!m) return false;

  // Kick off the WebGL backend before loading weights — big inference speedup.
  try {
    if (m.tf?.setBackend) {
      await m.tf.setBackend('webgl').catch(() => m.tf!.setBackend('cpu'));
      await m.tf.ready;
    }
  } catch {
    // backend dance failed — face-api manages its own backend fine.
  }

  for (const url of MODEL_URLS) {
    if (await tryLoadFrom(m, url)) {
      faceApiModelsLoaded = true;
      console.log(`[FaceRecognition] Models loaded from ${url}`);
      return true;
    }
  }
  console.error('[FaceRecognition] All model sources failed');
  return false;
}

export function isFaceApiReady(): boolean {
  return faceApiModelsLoaded;
}

// ─── Shared internal helper ───────────────────────────────────────────────────

async function detectWithDescriptor(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<{
  box: { x: number; y: number; width: number; height: number };
  landmarks: { positions: Array<{ x: number; y: number }> };
  descriptor: Float32Array;
} | null> {
  const m = await getFaceApi();
  if (!m) return null;

  const options = new m.TinyFaceDetectorOptions(DETECTOR_OPTIONS);

  const result = await m
    .detectSingleFace(input, options)
    .withFaceLandmarks(true) // tiny model — same as live scan
    .withFaceDescriptor();

  if (!result) return null;

  return {
    box: result.detection.box,
    landmarks: result.landmarks as any,
    descriptor: result.descriptor,
  };
}

/**
 * Face-presence check (no landmarks, no descriptor) — cheapest possible
 * "is there a face in frame" probe. Used by the ambient greeting hook
 * where identity doesn't matter, only presence.
 */
export async function detectFacePresence(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
): Promise<{ box: { x: number; y: number; width: number; height: number } } | null> {
  if (!faceApiModelsLoaded) {
    const loaded = await loadFaceApiModels();
    if (!loaded) return null;
  }
  try {
    const m = await getFaceApi();
    if (!m) return null;
    const options = new m.TinyFaceDetectorOptions(DETECTOR_OPTIONS);
    const result = await m.detectSingleFace(input, options);
    if (!result) return null;
    return { box: result.detection.box };
  } catch (error) {
    console.error('[FaceRecognition] detectFacePresence error:', error);
    return null;
  }
}

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Extract a face descriptor from a base64 image captured during registration.
 * Uses the SAME pipeline as detectSingleFaceWithLandmarks so descriptors match.
 */
export async function extractFaceDescriptor(
  imageData: string
): Promise<Float32Array | null> {
  if (!faceApiModelsLoaded) {
    const loaded = await loadFaceApiModels();
    if (!loaded) return null;
  }

  try {
    const img = new Image();
    img.src = imageData;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
    });

    const result = await detectWithDescriptor(img);
    if (!result) {
      console.log('[FaceRecognition] No face detected during registration');
      return null;
    }

    console.log('[FaceRecognition] Descriptor extracted for registration, length:', result.descriptor.length);
    return result.descriptor;
  } catch (error) {
    console.error('[FaceRecognition] Error extracting descriptor:', error);
    return null;
  }
}

// ─── Live scanning ────────────────────────────────────────────────────────────

/**
 * Detect a single face from a live video frame with landmarks + descriptor.
 * Uses the SAME pipeline as extractFaceDescriptor.
 */
export async function detectSingleFaceWithLandmarks(
  video: HTMLVideoElement
): Promise<{
  box: { x: number; y: number; width: number; height: number };
  landmarks: { positions: Array<{ x: number; y: number }> };
  descriptor: Float32Array;
} | null> {
  if (!faceApiModelsLoaded) {
    await loadFaceApiModels();
  }

  try {
    return await detectWithDescriptor(video);
  } catch (error) {
    console.error('[FaceRecognition] detectSingleFaceWithLandmarks error:', error);
    return null;
  }
}

// ─── Comparison utilities ─────────────────────────────────────────────────────

export function compareFaces(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export function findMatchingFace(
  queryDescriptor: number[],
  authorizedFaces: Array<{ id: string; name: string; descriptor: number[] }>,
  threshold = 0.55
): { face: { id: string; name: string }; distance: number } | null {
  let best: { face: { id: string; name: string }; distance: number } | null = null;

  for (const face of authorizedFaces) {
    const d = compareFaces(queryDescriptor, face.descriptor);
    if (d < threshold && (!best || d < best.distance)) {
      best = { face: { id: face.id, name: face.name }, distance: d };
    }
  }

  return best;
}

export function descriptorToArray(descriptor: Float32Array): number[] {
  return Array.from(descriptor);
}

export function arrayToDescriptor(arr: number[]): Float32Array {
  return new Float32Array(arr);
}
