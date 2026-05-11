"use client";

import { useEffect, useRef, useCallback } from "react";
import { useJarvisStore } from "@/store/jarvis.store";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  size: number;
  alpha: number;
  color: string;
  angle: number;
  speed: number;
}

// Smooth interpolation (lerp)
const lerp = (start: number, end: number, factor: number) => {
  return start + (end - start) * factor;
};

export default function ParticleVisualizer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const jarvisStateRef = useRef<string>("idle");
  const { state: jarvisState } = useJarvisStore();

  // Update jarvis state ref (no re-renders)
  useEffect(() => {
    jarvisStateRef.current = jarvisState;
  }, [jarvisState]);

  // Initialize particles
  const initParticles = useCallback((width: number, height: number) => {
    const particles: Particle[] = [];
    const centerX = width / 2;
    const centerY = height / 2;
    const colors = ["#00FFFF", "#00BFFF", "#FFFFFF", "#00CED1", "#40E0D0"];

    for (let i = 0; i < 250; i++) {
      const angle = (Math.random() * Math.PI * 2);
      const radius = 50 + Math.random() * 200;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;

      particles.push({
        x,
        y,
        vx: 0,
        vy: 0,
        targetX: x,
        targetY: y,
        size: 1 + Math.random() * 2,
        alpha: 0.3 + Math.random() * 0.5,
        color: colors[Math.floor(Math.random() * colors.length)],
        angle: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1,
      });
    }

    particlesRef.current = particles;
  }, []);

  // Animation loop - butter smooth
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let lastTime = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles(canvas.width, canvas.height);
    };

    resize();
    window.addEventListener("resize", resize);

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTime;
      lastTime = currentTime;

      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;
      const state = jarvisStateRef.current;

      // Clear with trail effect
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fillRect(0, 0, width, height);

      const particles = particlesRef.current;
      const time = currentTime * 0.001;

      particles.forEach((p, i) => {
        // Calculate target position based on state
        let targetX = p.targetX;
        let targetY = p.targetY;
        let lerpFactor = 0.02; // Base smoothness

        switch (state) {
          case "idle":
            // Gentle floating orbit
            p.angle += 0.002;
            const orbitRadius = 150 + (i % 100);
            targetX = centerX + Math.cos(p.angle + time * 0.5) * orbitRadius;
            targetY = centerY + Math.sin(p.angle + time * 0.5) * orbitRadius;
            lerpFactor = 0.015;
            break;

          case "listening":
            // Spiral inward
            const spiralAngle = time * 2 + (i * 0.1);
            const spiralRadius = Math.max(20, 200 - time * 50 + (i % 50));
            targetX = centerX + Math.cos(spiralAngle) * spiralRadius;
            targetY = centerY + Math.sin(spiralAngle) * spiralRadius;
            lerpFactor = 0.03;
            break;

          case "thinking":
            // Fast chaotic movement
            targetX = centerX + Math.sin(time * 3 + i) * 250;
            targetY = centerY + Math.cos(time * 4 + i * 0.5) * 250;
            lerpFactor = 0.08;
            break;

          case "speaking":
            // Pulse outward
            const pulseAngle = (i / 250) * Math.PI * 2;
            const pulseRadius = 100 + Math.sin(time * 8) * 80 + (i % 50);
            targetX = centerX + Math.cos(pulseAngle + time) * pulseRadius;
            targetY = centerY + Math.sin(pulseAngle + time) * pulseRadius;
            lerpFactor = 0.04;
            break;
        }

        // Smooth lerp to target
        p.x = lerp(p.x, targetX, lerpFactor);
        p.y = lerp(p.y, targetY, lerpFactor);

        // Draw particle with glow
        const glowSize = state === "speaking" ? p.size * 3 : p.size * 2;
        const alpha = state === "speaking"
          ? p.alpha * (0.8 + Math.sin(time * 10) * 0.2)
          : p.alpha;

        // Outer glow
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize * 4);
        const alphaHex = Math.floor(alpha * 255).toString(16).padStart(2, "0");
        gradient.addColorStop(0, p.color + alphaHex);
        gradient.addColorStop(1, "transparent");

        ctx.beginPath();
        ctx.arc(p.x, p.y, glowSize * 4, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Core
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
      });

      // Center glow when speaking
      if (state === "speaking") {
        const centerGlow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, 100);
        centerGlow.addColorStop(0, `rgba(255, 255, 255, ${0.3 + Math.sin(time * 10) * 0.2})`);
        centerGlow.addColorStop(0.5, "rgba(0, 255, 255, 0.1)");
        centerGlow.addColorStop(1, "transparent");
        ctx.fillStyle = centerGlow;
        ctx.fillRect(0, 0, width, height);
      }

      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, [initParticles]);

  return (
    <div className="fixed inset-0 z-10 bg-black">
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
