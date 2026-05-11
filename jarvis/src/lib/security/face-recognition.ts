// Face Recognition Service using face-api.js
// Provides real-time face detection, recognition, and descriptor extraction

let faceApiLoaded = false;
let faceApiModelsLoaded = false;

// Load face-api.js models
export async function loadFaceApiModels(): Promise<boolean> {
  if (faceApiModelsLoaded) return true;

  try {
    // Import face-api.js dynamically
    const faceApi = await import('face-api.js');

    // Load models from CDN
    const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';

    await Promise.all([
      faceApi.loadTinyFaceDetectorModel(MODEL_URL),
      faceApi.loadFaceLandmarkTinyModel(MODEL_URL),
      faceApi.loadFaceRecognitionModel(MODEL_URL),
    ]);

    faceApiLoaded = true;
    faceApiModelsLoaded = true;
    console.log('[FaceRecognition] Models loaded successfully');
    return true;
  } catch (error) {
    console.error('[FaceRecognition] Failed to load models:', error);
    return false;
  }
}

// Check if models are loaded
export function isFaceApiReady(): boolean {
  return faceApiModelsLoaded;
}

// Detect faces in an image/video element
export async function detectFaces(
  input: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | string
): Promise<Array<{
  box: { x: number; y: number; width: number; height: number };
  landmarks?: any;
  descriptor: Float32Array;
}>> {
  if (!faceApiModelsLoaded) {
    await loadFaceApiModels();
  }

  const faceApi = await import('face-api.js');
  const options = new faceApi.TinyFaceDetectorOptions({
    inputSize: 416,
    scoreThreshold: 0.5,
  });

  let imgElement: HTMLImageElement;
  if (typeof input === 'string') {
    // It's a base64 image
    imgElement = new Image();
    imgElement.src = input;
    await new Promise((resolve) => (imgElement.onload = resolve));
  } else if (input instanceof HTMLVideoElement) {
    // Create image from video frame
    imgElement = new Image();
    const canvas = document.createElement('canvas');
    canvas.width = input.videoWidth;
    canvas.height = input.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.drawImage(input, 0, 0);
    imgElement.src = canvas.toDataURL();
    await new Promise((resolve) => (imgElement.onload = resolve));
  } else if (input instanceof HTMLCanvasElement) {
    imgElement = new Image();
    imgElement.src = input.toDataURL();
    await new Promise((resolve) => (imgElement.onload = resolve));
  } else {
    imgElement = input as HTMLImageElement;
  }

  const detections = await faceApi.detectAllFaces(imgElement, options);
  const results = [];

  for (const detection of detections) {
    const descriptorOrArray = await faceApi.computeFaceDescriptor(imgElement);
    // Handle the case where it returns an array (take first if array)
    const descriptor = Array.isArray(descriptorOrArray) ? descriptorOrArray[0] : descriptorOrArray;
    results.push({
      box: detection.box,
      descriptor,
    });
    break; // Only use first face
  }

  return results;
}

// Extract face descriptor from an image (base64)
export async function extractFaceDescriptor(
  imageData: string
): Promise<Float32Array | null> {
  if (!faceApiModelsLoaded) {
    const loaded = await loadFaceApiModels();
    if (!loaded) return null;
  }

  try {
    const faceApi = await import('face-api.js');

    // Load image from base64
    const img = new Image();
    img.src = imageData;
    await new Promise((resolve) => (img.onload = resolve));

    const options = new faceApi.TinyFaceDetectorOptions({
      inputSize: 416,
      scoreThreshold: 0.5,
    });

    const detections = await faceApi.detectAllFaces(img, options);

    if (detections.length === 0) {
      console.log('[FaceRecognition] No face detected');
      return null;
    }

    if (detections.length > 1) {
      console.log('[FaceRecognition] Multiple faces detected, using first one');
    }

    const descriptorOrArray = await faceApi.computeFaceDescriptor(img);
    // Handle the case where it returns an array (take first if array)
    const descriptor = Array.isArray(descriptorOrArray) ? descriptorOrArray[0] : descriptorOrArray;

    return descriptor;
  } catch (error) {
    console.error('[FaceRecognition] Error extracting descriptor:', error);
    return null;
  }
}

// Compare two face descriptors
export function compareFaces(
  descriptor1: number[],
  descriptor2: number[]
): number {
  // Euclidean distance
  let sum = 0;
  for (let i = 0; i < descriptor1.length; i++) {
    sum += Math.pow(descriptor1[i] - descriptor2[i], 2);
  }
  return Math.sqrt(sum);
}

// Find matching face from a list
export function findMatchingFace(
  queryDescriptor: number[],
  authorizedFaces: Array<{ id: string; name: string; descriptor: number[] }>,
  threshold: number = 0.6
): { face: { id: string; name: string }; distance: number } | null {
  let bestMatch: { face: { id: string; name: string }; distance: number } | null = null;

  for (const face of authorizedFaces) {
    const distance = compareFaces(queryDescriptor, face.descriptor);
    if (distance < threshold) {
      if (!bestMatch || distance < bestMatch.distance) {
        bestMatch = { face: { id: face.id, name: face.name }, distance };
      }
    }
  }

  return bestMatch;
}

// Convert Float32Array to regular array for storage
export function descriptorToArray(descriptor: Float32Array): number[] {
  return Array.from(descriptor);
}

// Convert regular array back to Float32Array
export function arrayToDescriptor(arr: number[]): Float32Array {
  return new Float32Array(arr);
}