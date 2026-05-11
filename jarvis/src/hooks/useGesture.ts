"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Hands, Results } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import { useJarvisStore } from "@/store/jarvis.store";

// Gesture types
export type GestureType =
  | "open_palm"
  | "closed_fist"
  | "two_finger_point"
  | "swipe_left"
  | "swipe_right"
  | "thumbs_up"
  | "none";

interface GestureState {
  currentGesture: GestureType;
  confidence: number;
  handVisible: boolean;
}

interface Landmark {
  x: number;
  y: number;
}

// Calculate distance between two landmarks
function distance(p1: Landmark, p2: Landmark): number {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

// Detect gesture from hand landmarks
function detectGesture(landmarks: Landmark[]): GestureType {
  // Finger tip indices: 8 (index), 12 (middle), 16 (ring), 20 (pinky)
  // Finger base indices: 5, 9, 13, 17
  // Thumb: 4 (tip), 2 (base)

  const tips = [8, 12, 16, 20];
  const bases = [5, 9, 13, 17];
  const wrist = landmarks[0];

  // Check if fingers are extended
  const fingersExtended = tips.map((tipIdx, i) => {
    const tip = landmarks[tipIdx];
    const base = landmarks[bases[i]];
    // Finger is extended if tip is further from wrist than base
    return distance(tip, wrist) > distance(base, wrist) * 1.2;
  });

  const extendedCount = fingersExtended.filter(Boolean).length;

  // Check thumb (special case)
  const thumbTip = landmarks[4];
  const thumbBase = landmarks[2];
  const thumbExtended = distance(thumbTip, wrist) > distance(thumbBase, wrist) * 1.1;

  // Detect gestures
  if (extendedCount === 0 && !thumbExtended) {
    return "closed_fist";
  }

  if (extendedCount === 4 && thumbExtended) {
    return "open_palm";
  }

  if (extendedCount === 2 && fingersExtended[0] && fingersExtended[1]) {
    return "two_finger_point";
  }

  if (thumbExtended && extendedCount === 0) {
    // Check if thumb is pointing up
    const thumbTipY = landmarks[4].y;
    const thumbBaseY = landmarks[2].y;
    if (thumbTipY < thumbBaseY - 0.1) {
      return "thumbs_up";
    }
  }

  return "none";
}

export function useGesture(
  videoRef: React.RefObject<HTMLVideoElement>,
  enabled: boolean = true
) {
  const [gestureState, setGestureState] = useState<GestureState>({
    currentGesture: "none",
    confidence: 0,
    handVisible: false,
  });

  const handsRef = useRef<Hands | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const lastGestureTime = useRef<number>(0);
  const gestureHistory = useRef<GestureType[]>([]);
  const { setState, setGestureDetected } = useJarvisStore();

  // Process hand tracking results
  const onResults = useCallback((results: Results) => {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      const gesture = detectGesture(landmarks);

      // Add to history for smoothing
      gestureHistory.current.push(gesture);
      if (gestureHistory.current.length > 5) {
        gestureHistory.current.shift();
      }

      // Get most common gesture in history
      const counts: Record<string, number> = {};
      let maxCount = 0;
      let mostCommon: GestureType = "none";

      gestureHistory.current.forEach((g) => {
        counts[g] = (counts[g] || 0) + 1;
        if (counts[g] > maxCount) {
          maxCount = counts[g];
          mostCommon = g;
        }
      });

      const confidence = maxCount / gestureHistory.current.length;

      // Only update if confidence is high enough
      if (confidence > 0.6) {
        setGestureState({
          currentGesture: mostCommon,
          confidence,
          handVisible: true,
        });

        // Trigger actions based on gesture
        const now = Date.now();
        if (now - lastGestureTime.current > 1500) {
          // Debounce 1.5 seconds
          lastGestureTime.current = now;
          setGestureDetected(mostCommon);

          // Handle gesture actions
          const gesture = mostCommon as GestureType;
          if (gesture === "open_palm") {
            setState("listening");
          } else if (gesture === "closed_fist") {
            setState("sleep");
          } else if (gesture === "two_finger_point") {
            setState("listening");
          } else if (gesture === "thumbs_up") {
            // Confirm last action
          }
        }
      }
    } else {
      setGestureState((prev) => ({ ...prev, handVisible: false }));
      gestureHistory.current = [];
    }
  }, [setState, setGestureDetected]);

  // Initialize MediaPipe Hands
  useEffect(() => {
    if (!enabled || !videoRef.current) return;

    const hands = new Hands({
      locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
      },
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults(onResults);
    handsRef.current = hands;

    // Initialize camera
    const camera = new Camera(videoRef.current, {
      onFrame: async () => {
        await hands.send({ image: videoRef.current! });
      },
      width: 320,
      height: 240,
    });

    cameraRef.current = camera;
    camera.start();

    return () => {
      camera.stop();
      hands.close();
    };
  }, [enabled, videoRef, onResults]);

  return gestureState;
}

// Hook for gesture display name
export function getGestureDisplayName(gesture: GestureType | string | null): string {
  const names: Record<string, string> = {
    open_palm: "Open Palm",
    closed_fist: "Closed Fist",
    two_finger_point: "Two Finger Point",
    swipe_left: "Swipe Left",
    swipe_right: "Swipe Right",
    thumbs_up: "Thumbs Up",
    none: "No Gesture",
  };
  return gesture ? names[gesture] || "Unknown" : "Unknown";
}

// Hook for gesture icon/color
export function getGestureStyle(gesture: GestureType | string | null): {
  color: string;
  icon: string;
} {
  switch (gesture) {
    case "open_palm":
      return { color: "#00FF9D", icon: "✋" };
    case "closed_fist":
      return { color: "#FF2D55", icon: "✊" };
    case "two_finger_point":
      return { color: "#00D4FF", icon: "✌️" };
    case "thumbs_up":
      return { color: "#00FF9D", icon: "👍" };
    default:
      return { color: "#7EB8D4", icon: "✋" };
  }
}
