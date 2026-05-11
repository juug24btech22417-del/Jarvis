"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useJarvisStore } from "@/store/jarvis.store";

interface VoiceVisualizerProps {
  barCount?: number;
}

export default function VoiceVisualizer({ barCount = 32 }: VoiceVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const [audioData, setAudioData] = useState<number[]>(new Array(barCount).fill(0));
  const { state, voiceLevel } = useJarvisStore();

  // Simulate audio visualization - throttled to prevent flickering
  useEffect(() => {
    let lastTime = 0;
    const targetInterval = 50; // Update every 50ms (20fps) to reduce jitter

    const updateAudioData = () => {
      const now = performance.now();
      if (now - lastTime >= targetInterval) {
        lastTime = now;

        setAudioData((prev) => {
          return prev.map((_, i) => {
            // Smooth wave pattern - slower and more consistent
            const time = Date.now() * 0.002;
            const wave = Math.sin(time + i * 0.3) * 0.3 + 0.5;

            // Voice level with minimal random variation for smoothness
            const level = voiceLevel * (0.6 + Math.sin(time * 0.1 + i) * 0.1);

            // Combine wave and voice level
            let value = wave * 0.2 + level * 0.8;

            // Smooth scaling based on state
            switch (state) {
              case "listening":
                value *= 0.8;
                break;
              case "thinking":
                value *= 1.0;
                break;
              case "speaking":
                value *= 0.9;
                break;
              case "sleep":
                value = 0;
                break;
              default:
                value *= 0.2;
            }

            return Math.max(0, Math.min(1, value));
          });
        });
      }

      animationRef.current = requestAnimationFrame(updateAudioData);
    };

    animationRef.current = requestAnimationFrame(updateAudioData);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [state, voiceLevel, barCount]);

  // Draw on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Get colors based on state
    let baseColor = "#00D4FF";
    let glowColor = "#7DF9FF";

    switch (state) {
      case "listening":
        baseColor = "#00FF9D";
        glowColor = "#00FF9D";
        break;
      case "thinking":
        baseColor = "#FF6B2B";
        glowColor = "#FF6B2B";
        break;
      case "speaking":
        baseColor = "#00D4FF";
        glowColor = "#7DF9FF";
        break;
      case "sleep":
        baseColor = "#1a3a4a";
        glowColor = "#1a3a4a";
        break;
    }

    // Draw bars
    const barWidth = (rect.width / barCount) * 0.7;
    const gap = (rect.width / barCount) * 0.3;

    audioData.forEach((value, i) => {
      const x = i * (barWidth + gap) + gap / 2;
      const barHeight = value * rect.height * 0.9;
      const y = (rect.height - barHeight) / 2;

      // Draw bar with gradient
      const gradient = ctx.createLinearGradient(0, y + barHeight, 0, y);
      gradient.addColorStop(0, baseColor + "40");
      gradient.addColorStop(0.5, baseColor + "80");
      gradient.addColorStop(1, glowColor);

      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, barHeight);

      // Add glow effect
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = value * 10;
    });

    ctx.shadowBlur = 0;
  }, [audioData, state, barCount]);

  if (state === "sleep") {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      exit={{ opacity: 0, scaleY: 0 }}
      className="h-12 w-full"
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ width: "100%", height: "100%" }}
      />
    </motion.div>
  );
}
