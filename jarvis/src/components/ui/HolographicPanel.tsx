"use client";

import { motion } from "framer-motion";
import { ReactNode } from "react";

interface HolographicPanelProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: "left" | "right" | "top" | "bottom";
  title?: string;
}

export default function HolographicPanel({
  children,
  className = "",
  delay = 0,
  direction = "left",
  title,
}: HolographicPanelProps) {
  const getInitialPosition = () => {
    switch (direction) {
      case "left":
        return { x: -100, opacity: 0 };
      case "right":
        return { x: 100, opacity: 0 };
      case "top":
        return { y: -100, opacity: 0 };
      case "bottom":
        return { y: 100, opacity: 0 };
      default:
        return { x: -100, opacity: 0 };
    }
  };

  const getFinalPosition = () => {
    switch (direction) {
      case "left":
      case "right":
        return { x: 0, opacity: 1 };
      case "top":
      case "bottom":
        return { y: 0, opacity: 1 };
      default:
        return { x: 0, opacity: 1 };
    }
  };

  return (
    <motion.div
      className={`holographic-panel relative corner-bracket ${className}`}
      initial={getInitialPosition()}
      animate={getFinalPosition()}
      transition={{
        duration: 0.5,
        delay: 4 + delay, // After boot sequence
        ease: "easeOut",
      }}
    >
      {/* Scan lines overlay */}
      <div className="absolute inset-0 scan-lines rounded-lg pointer-events-none" />

      {/* Glow border */}
      <div className="absolute inset-0 rounded-lg pointer-events-none glow-border" />

      {/* Title bar */}
      {title && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-panel-border">
          <span className="font-orbitron text-xs tracking-widest text-reactor-core uppercase">
            {title}
          </span>
          <div className="flex gap-1">
            <div className="w-2 h-2 rounded-full bg-reactor-core animate-pulse" />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="relative z-10 p-4">{children}</div>
    </motion.div>
  );
}
