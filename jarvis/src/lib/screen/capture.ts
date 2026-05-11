"use client";

import { useState, useCallback } from "react";

interface ScreenCaptureOptions {
  video?: boolean;
  audio?: boolean;
}

export function useScreenCapture() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const startCapture = useCallback(async (options: ScreenCaptureOptions = { video: true, audio: false }) => {
    if (typeof window === "undefined") {
      setError("Screen capture not available");
      return null;
    }

    try {
      setError(null);
      setIsCapturing(true);

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: options.video ?? true,
        audio: options.audio ?? false,
      });

      setStream(mediaStream);

      // Auto-stop when user stops sharing
      mediaStream.getVideoTracks()[0]?.addEventListener("ended", () => {
        setStream(null);
        setIsCapturing(false);
      });

      return mediaStream;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Screen capture failed";
      setError(errorMessage);
      setIsCapturing(false);
      return null;
    }
  }, []);

  const stopCapture = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setIsCapturing(false);
  }, [stream]);

  const captureScreenshot = useCallback(async (): Promise<string | null> => {
    if (!stream) {
      setError("No active screen capture");
      return null;
    }

    try {
      const videoTrack = stream.getVideoTracks()[0];
      const imageCapture = new (window as any).ImageCapture(videoTrack);

      const bitmap = await (imageCapture as any).grabFrame();

      // Create canvas to convert to data URL
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(bitmap, 0, 0);

      return canvas.toDataURL("image/png");
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Screenshot failed";
      setError(errorMessage);
      return null;
    }
  }, [stream]);

  return {
    stream,
    error,
    isCapturing,
    startCapture,
    stopCapture,
    captureScreenshot,
  };
}

// Check if screen capture is supported
export function isScreenCaptureSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
}
