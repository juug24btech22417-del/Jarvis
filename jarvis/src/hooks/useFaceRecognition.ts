"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  loadFaceApiModels,
  extractFaceDescriptor,
  isFaceApiReady,
  descriptorToArray,
} from '@/lib/security/face-recognition';

const STORAGE_KEY = 'jarvis_faces';

export interface StoredFace {
  id: string;
  name: string;
  descriptor: number[];
  createdAt: string;
}

export interface DetectedFace {
  descriptor: number[];
  confidence: number;
  timestamp: number;
}

export interface UseFaceRecognitionReturn {
  isLoading: boolean;
  isReady: boolean;
  error: string | null;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  captureAndExtract: () => Promise<DetectedFace | null>;
  registerFace: (name: string) => Promise<{ success: boolean; error?: string; face?: any }>;
  verifyFace: (descriptor: number[]) => Promise<{ match: boolean; person?: string; distance?: number }>;
  getStoredFaces: () => StoredFace[];
  matchAgainstStored: (descriptor: number[], threshold?: number) => { name: string; distance: number } | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  stream: MediaStream | null;
  isCameraActive: boolean;
}

export function useFaceRecognition(): UseFaceRecognitionReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Initialize face-api models on mount
  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      try {
        const success = await loadFaceApiModels();
        setIsReady(success);
        if (!success) {
          setError('Failed to load face recognition models');
        }
      } catch (err) {
        setError('Failed to initialize face recognition');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, []);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  const startCamera = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: 640,
          height: 480,
          facingMode: 'user',
        },
      });

      setStream(mediaStream);
      setIsCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error('Camera access denied:', err);
      setError('Camera access denied. Please allow camera permissions.');
      throw err;
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
      setIsCameraActive(false);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current) return null;

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8);
  }, []);

  const captureAndExtract = useCallback(async (): Promise<DetectedFace | null> => {
    if (!isReady) {
      setError('Face recognition not ready');
      return null;
    }

    const imageData = captureFrame();
    if (!imageData) {
      setError('Failed to capture frame');
      return null;
    }

    setIsLoading(true);
    try {
      const descriptor = await extractFaceDescriptor(imageData);
      if (!descriptor) {
        setError('No face detected in the frame');
        return null;
      }

      return {
        descriptor: descriptorToArray(descriptor),
        confidence: 0.95,
        timestamp: Date.now(),
      };
    } catch (err) {
      console.error('Face extraction failed:', err);
      setError('Failed to extract face descriptor');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [isReady, captureFrame]);

  // ─────────────────────────────────────────────────────────
  // localStorage helpers — faces persist across server restarts
  // ─────────────────────────────────────────────────────────

  const getStoredFaces = useCallback((): StoredFace[] => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }, []);

  const euclideanDistance = (a: number[], b: number[]) => {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
  };

  /** Client-side FaceMatcher — no server needed */
  const matchAgainstStored = useCallback(
    (descriptor: number[], threshold = 0.55): { name: string; distance: number } | null => {
      const faces = getStoredFaces();
      let best: { name: string; distance: number } | null = null;
      for (const face of faces) {
        const dist = euclideanDistance(descriptor, face.descriptor);
        if (dist < threshold && (!best || dist < best.distance)) {
          best = { name: face.name, distance: dist };
        }
      }
      return best;
    },
    [getStoredFaces]
  );

  const registerFace = useCallback(
    async (name: string) => {
      const result = await captureAndExtract();
      if (!result) {
        return { success: false, error: 'No face captured' };
      }

      try {
        const response = await fetch('/api/security', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'register',
            data: { name, descriptor: result.descriptor },
          }),
        });

        const data = await response.json();

        if (data.success) {
          // ✅ Save to localStorage → survives server restarts
          const stored = getStoredFaces();
          const filtered = stored.filter((f) => f.name.toLowerCase() !== name.toLowerCase());
          filtered.push({
            id: data.face.id,
            name,
            descriptor: result.descriptor,
            createdAt: data.face.createdAt,
          });
          localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
          return { success: true, face: data.face };
        } else {
          return { success: false, error: data.error };
        }
      } catch (err) {
        return { success: false, error: 'Failed to register face' };
      }
    },
    [captureAndExtract, getStoredFaces]
  );

  const verifyFace = useCallback(
    async (descriptor: number[]) => {
      // ✅ Try client-side first (works even when server restarted)
      const localMatch = matchAgainstStored(descriptor);
      if (localMatch) {
        return { match: true, person: localMatch.name, distance: localMatch.distance };
      }

      // Fallback: try server-side
      try {
        const response = await fetch('/api/security', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'verify',
            data: { descriptor },
          }),
        });

        const data = await response.json();

        if (data.success && data.access === 'granted' && data.person) {
          return {
            match: true,
            person: data.person,
            distance: 1 - data.confidence,
          };
        } else {
          return { match: false };
        }
      } catch (err) {
        console.error('Verification failed:', err);
        return { match: false };
      }
    },
    [matchAgainstStored]
  );

  return {
    isLoading,
    isReady,
    error,
    startCamera,
    stopCamera,
    captureAndExtract,
    registerFace,
    verifyFace,
    getStoredFaces,
    matchAgainstStored,
    videoRef: videoRef as React.RefObject<HTMLVideoElement | null>,
    stream,
    isCameraActive,
  };
}