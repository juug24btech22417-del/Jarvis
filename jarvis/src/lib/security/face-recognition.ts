// Face Recognition Service using face-api.js
// Both registration and live scanning use the SAME pipeline:
//   TinyFaceDetector (inputSize 224) → tiny landmarks → FaceNet descriptor
// This guarantees descriptors are always comparable.

let faceApiModelsLoaded = false;

const DETECTOR_OPTIONS = { inputSize: 224 as const, scoreThreshold: 0.4 };

// ─── Model loading ────────────────────────────────────────────────────────────

export async function loadFaceApiModels(): Promise<boolean> {
  if (faceApiModelsLoaded) return true;

  try {
    const faceApi = await import('face-api.js');
    const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

    await Promise.all([
      faceApi.loadTinyFaceDetectorModel(MODEL_URL),
      faceApi.loadFaceLandmarkTinyModel(MODEL_URL),
      faceApi.loadFaceRecognitionModel(MODEL_URL),
    ]);

    faceApiModelsLoaded = true;
    console.log('[FaceRecognition] Models loaded successfully');
    return true;
  } catch (error) {
    console.error('[FaceRecognition] Failed to load models:', error);
    return false;
  }
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
  const faceApi = await import('face-api.js');
  const options = new faceApi.TinyFaceDetectorOptions(DETECTOR_OPTIONS);

  const result = await faceApi
    .detectSingleFace(input, options)
    .withFaceLandmarks(true)   // tiny model — same as live scan
    .withFaceDescriptor();

  if (!result) return null;

  return {
    box: result.detection.box,
    landmarks: result.landmarks as any,
    descriptor: result.descriptor,
  };
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