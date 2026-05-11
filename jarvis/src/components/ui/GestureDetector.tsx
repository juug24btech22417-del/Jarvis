"use client";

import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, CameraOff } from "lucide-react";
import { useGesture, getGestureDisplayName, getGestureStyle } from "@/hooks/useGesture";
import { useJarvisStore } from "@/store/jarvis.store";

export default function GestureDetector() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const { gestureDetected, setGestureDetected } = useJarvisStore();

  const gestureState = useGesture(videoRef, enabled);

  const toggleCamera = async () => {
    if (!enabled) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 320, height: 240 },
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setEnabled(true);
      } catch (err) {
        console.error("Camera access denied:", err);
        alert("Camera access is required for gesture control");
      }
    } else {
      // Stop camera
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((track) => track.stop());
        videoRef.current.srcObject = null;
      }
      setEnabled(false);
    }
  };

  const { color, icon } = getGestureStyle(gestureState.currentGesture);

  return (
    <>
      {/* Camera button */}
      <motion.button
        onClick={toggleCamera}
        className={`fixed bottom-24 right-6 z-50 p-3 rounded-full transition-colors ${
          enabled
            ? "bg-reactor-core text-deep-space"
            : "bg-panel-glass text-text-secondary hover:bg-panel-border"
        }`}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title={enabled ? "Disable gesture control" : "Enable gesture control"}
      >
        {enabled ? <Camera className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
      </motion.button>

      {/* Hidden video element for MediaPipe */}
      <video
        ref={videoRef}
        className="hidden"
        playsInline
        muted
      />

      {/* Gesture preview panel */}
      <AnimatePresence>
        {enabled && showPreview && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, x: 20 }}
            className="fixed bottom-36 right-6 z-50 w-48 holographic-panel overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border">
              <span className="font-orbitron text-xs text-reactor-core tracking-wider">
                GESTURE
              </span>
              <button
                onClick={() => setShowPreview(false)}
                className="text-text-secondary/50 hover:text-text-secondary"
              >
                ×
              </button>
            </div>

            {/* Current gesture display */}
            <div className="p-4 text-center">
              <motion.div
                key={gestureState.currentGesture}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-4xl mb-2"
                style={{ color }}
              >
                {icon}
              </motion.div>
              <div
                className="font-rajdhani text-sm font-medium"
                style={{ color }}
              >
                {getGestureDisplayName(gestureState.currentGesture)}
              </div>
              {gestureState.handVisible ? (
                <div className="mt-2 flex justify-center">
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <motion.div
                        key={i}
                        className="w-1 h-3 rounded-full"
                        style={{ backgroundColor: color }}
                        animate={{
                          opacity: gestureState.confidence > i / 5 ? 1 : 0.2,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-text-secondary/50 text-xs">
                  No hand detected
                </div>
              )}
            </div>

            {/* Gesture legend */}
            <div className="px-3 pb-3 border-t border-panel-border/50">
              <div className="text-[10px] text-text-secondary/50 mb-2 mt-2">
                GESTURE GUIDE
              </div>
              <div className="space-y-1">
                {[
                  { gesture: "open_palm", label: "Wake JARVIS", icon: "✋" },
                  { gesture: "closed_fist", label: "Sleep", icon: "✊" },
                  { gesture: "two_finger_point", label: "Voice Mode", icon: "✌️" },
                  { gesture: "thumbs_up", label: "Confirm", icon: "👍" },
                ].map(({ gesture, label, icon }) => (
                  <div
                    key={gesture}
                    className={`flex items-center gap-2 text-xs ${
                      gestureState.currentGesture === gesture
                        ? "text-reactor-core"
                        : "text-text-secondary/50"
                    }`}
                  >
                    <span>{icon}</span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gesture detection toast */}
      <AnimatePresence>
        {gestureDetected && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            onAnimationComplete={() => setTimeout(() => setGestureDetected(null), 2000)}
            className="fixed bottom-40 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full holographic-panel"
          >
            <div className="flex items-center gap-2">
              <span className="text-2xl">{gestureDetected ? getGestureStyle(gestureDetected).icon : "✋"}</span>
              <span
                className="font-rajdhani font-medium"
                style={{ color: gestureDetected ? getGestureStyle(gestureDetected).color : "#00D4FF" }}
              >
                {gestureDetected ? getGestureDisplayName(gestureDetected) : "Unknown"} detected
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
