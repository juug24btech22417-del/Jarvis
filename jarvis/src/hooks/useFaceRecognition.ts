"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  loadFaceApiModels,
  extractFaceDescriptor,
  isFaceApiReady,
  descriptorToArray,
} from '@/lib/security/face-recognition';

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
            data: {
              name,
              descriptor: result.descriptor,
            },
          }),
        });

        const data = await response.json();

        if (data.success) {
          return { success: true, face: data.face };
        } else {
          return { success: false, error: data.error };
        }
      } catch (err) {
        return { success: false, error: 'Failed to register face' };
      }
    },
    [captureAndExtract]
  );

  const verifyFace = useCallback(
    async (descriptor: number[]) => {
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

        if (data.success && data.access === 'granted') {
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
    []
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
    videoRef: videoRef as React.RefObject<HTMLVideoElement | null>,
    stream,
    isCameraActive,
  };
}