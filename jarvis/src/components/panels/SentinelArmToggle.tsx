"use client";

/**
 * Sentinel Arm Toggle — home-UI control for the global face watcher.
 *
 * Lives on the home screen (outside the Security panel). Arming here
 * starts the headless watcher (useSentinelWatcher, mounted in page.tsx)
 * AND flips the server-side `enabled` flag so both sides stay in sync.
 * Shows a live status ring: cyan scanning / green verified / red intruder.
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

type Phase = "idle" | "scanning" | "verified" | "intruder" | "pending";

const PHASE_STYLE: Record<
  Exclude<Phase, "pending">,
  { ring: string; text: string; glow: string; label: string }
> = {
  idle: {
    ring: "border-white/15",
    text: "text-white/50",
    glow: "0 0 0 rgba(0,0,0,0)",
    label: "SENTINEL · OFF",
  },
  scanning: {
    ring: "border-cyan-400/60",
    text: "text-cyan-300",
    glow: "0 0 18px rgba(6,182,212,0.45)",
    label: "SENTINEL · SCAN",
  },
  verified: {
    ring: "border-emerald-400/70",
    text: "text-emerald-300",
    glow: "0 0 22px rgba(34,197,94,0.55)",
    label: "SENTINEL · YOU",
  },
  intruder: {
    ring: "border-red-500/80",
    text: "text-red-400",
    glow: "0 0 26px rgba(239,68,68,0.65)",
    label: "⚠ INTRUDER",
  },
};

export default function SentinelArmToggle() {
  const armed = useJarvisStore((s) => s.sentinelArmed);
  const setArmed = useJarvisStore((s) => s.setSentinelArmed);
  const live = useJarvisStore((s) => s.sentinelLiveStatus);
  const [pending, setPending] = useState(false);

  // Hydrate armed state from the server on mount (survives reloads).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/security");
        const data = await res.json();
        if (data.success) {
          useJarvisStore.getState().setSentinelArmed(data.settings.enabled);
        }
      } catch {}
    })();
  }, []);

  const toggle = async () => {
    if (pending) return;
    setPending(true);
    const next = !armed;
    try {
      const res = await fetch("/api/security", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", data: { enabled: next } }),
      });
      const data = await res.json();
      if (data.success) setArmed(next);
    } catch {
      /* stay in current state on failure */
    } finally {
      setPending(false);
    }
  };

  const phase: Phase = pending ? "pending" : armed ? live : "idle";
  const style = phase === "pending" ? null : PHASE_STYLE[phase];
  const fall =
    phase === "pending"
      ? { ring: "border-white/20", text: "text-white/40", glow: "none", label: "…" }
      : style!;

  return (
    <motion.button
      onClick={toggle}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      className={`relative flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-black/50 backdrop-blur-md border ${fall.ring} transition-all duration-300 overflow-hidden group`}
      style={{ boxShadow: fall.glow }}
      title={
        armed
          ? "Sentinel Eyes ARMED — click to disarm"
          : "Sentinel Eyes OFF — click to arm face security"
      }
    >
      {/* scanning sweep line */}
      {armed && phase !== "idle" && (
        <motion.span
          className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
          animate={{ x: ["-120%", "320%"] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "linear" }}
        />
      )}

      {/* core icon */}
      <div className="relative flex items-center justify-center w-7 h-7">
        {phase === "pending" ? (
          <Loader2 className="w-5 h-5 text-white/50 animate-spin" />
        ) : phase === "verified" ? (
          <ShieldCheck className="w-5 h-5 text-emerald-300 drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
        ) : phase === "intruder" ? (
          <motion.div
            animate={{ x: [0, -1.5, 1.5, -1.5, 0] }}
            transition={{ duration: 0.4, repeat: Infinity }}
          >
            <ShieldAlert className="w-5 h-5 text-red-400 drop-shadow-[0_0_10px_rgba(239,68,68,0.9)]" />
          </motion.div>
        ) : (
          <motion.div
            animate={armed ? { opacity: [0.55, 1, 0.55] } : undefined}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <Shield
              className={`w-5 h-5 ${
                phase === "scanning"
                  ? "text-cyan-300 drop-shadow-[0_0_8px_rgba(6,182,212,0.8)]"
                  : "text-white/45"
              }`}
            />
          </motion.div>
        )}

        {/* live ring pulse */}
        {armed && (
          <motion.span
            className={`absolute inset-0 rounded-full border ${
              phase === "intruder" ? "border-red-500" : "border-cyan-400/50"
            }`}
            animate={{ scale: [1, 1.55], opacity: [0.7, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
          />
        )}
      </div>

      {/* label */}
      <div className="flex flex-col items-start leading-none">
        <AnimatePresence mode="wait">
          <motion.span
            key={fall.label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className={`font-orbitron text-[10px] font-bold tracking-[0.18em] ${fall.text}`}
          >
            {fall.label}
          </motion.span>
        </AnimatePresence>
        <span className="font-rajdhani text-[9px] text-white/35 tracking-wider mt-0.5">
          {armed ? "TAP TO DISARM" : "TAP TO ARM"}
        </span>
      </div>
    </motion.button>
  );
}
