"use client";

// ─── HeroAssault — the multi-window invasion ────────────────────────────
//
// Six holographic HUD windows launch in from beyond the viewport edges, slam
// into an orbital formation around the reactor, then hard-link to the core
// with animated energy tethers. Built with framer-motion so the physics read
// as real weight (spring entry, slight overshoot, settle).
//
// Below them sits the ENGAGE DESKTOP button — a real user gesture that opens
// always-on-top Document-PiP hero windows so the sequence spills out of the
// browser and across the OS (see lib/cinematic/desktopInvasion).
//
// The whole layer is pointer-events:none except that button, so the dashboard
// stays untouched.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAssembleStore } from "@/lib/cinematic/assembleStore";
import {
  openAssaultWindows,
  assaultPiPSupported,
  type AssaultHero,
} from "@/lib/cinematic/desktopInvasion";

const HEROES: AssaultHero[] = [
  { id: "stark", name: "STARK", tag: "MARK LXXXV · NANITE", color: "#FF4D3D" },
  { id: "rogers", name: "ROGERS", tag: "VIBRANIUM SHIELD", color: "#3D7BFF" },
  { id: "romanoff", name: "ROMANOFF", tag: "GHOST PROTOCOL", color: "#FF2D55" },
  { id: "banner", name: "BANNER", tag: "HULK CONTINGENCY", color: "#38FF9C" },
  { id: "thor", name: "ODINSON", tag: "BIFROST LOCK", color: "#63D6FF" },
  { id: "barton", name: "BARTON", tag: "OVERWATCH", color: "#B26BFF" },
];

interface Dock {
  x: number; // percent
  y: number; // percent
  cos: number;
  sin: number;
}

function buildDocks(n: number): Dock[] {
  const docks: Dock[] = [];
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + Math.PI / n;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    docks.push({
      x: 50 + cos * 34,
      y: 50 + sin * 32,
      cos,
      sin,
    });
  }
  return docks;
}

export default function HeroAssault() {
  const active = useAssembleStore((s) => s.active);
  const phase = useAssembleStore((s) => s.phase);
  const runId = useAssembleStore((s) => s.runId);
  const reduced = useAssembleStore((s) => s.reduced);
  const [pipCount, setPipCount] = useState<number | null>(null);

  const docks = useMemo(() => buildDocks(HEROES.length), []);
  const docked = phase === "assault" || phase === "suitup" || phase === "finale";

  const engage = async () => {
    const n = await openAssaultWindows(HEROES, 3);
    setPipCount(n);
  };

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={`assault-${runId}`}
          className="fixed inset-0 z-[205] pointer-events-none overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.6 } }}
        >
          {/* Energy tethers from the core to each dock */}
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            {docks.map((d, i) => (
              <motion.path
                key={`${runId}-line-${i}`}
                d={`M 50 50 L ${d.x.toFixed(2)} ${d.y.toFixed(2)}`}
                stroke={HEROES[i].color}
                strokeWidth={0.12}
                vectorEffect="non-scaling-stroke"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={
                  docked
                    ? { pathLength: 1, opacity: [0, 0.9, 0.4] }
                    : { pathLength: 0, opacity: 0 }
                }
                transition={{
                  delay: reduced ? 0 : 0.35 + i * 0.06,
                  duration: 0.55,
                  opacity: { duration: 0.9, repeat: Infinity, repeatType: "reverse" },
                }}
                style={{ filter: `drop-shadow(0 0 4px ${HEROES[i].color})` }}
              />
            ))}
          </svg>

          {/* Centre core hub */}
          <motion.div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{ scale: docked ? 1 : 0.4, opacity: docked ? 1 : 0.2 }}
            transition={{ type: "spring", stiffness: 180, damping: 18 }}
          >
            <div className="relative flex h-40 w-40 items-center justify-center">
              <motion.div
                className="absolute inset-0 rounded-full border border-reactor-core/60"
                animate={{ rotate: 360 }}
                transition={{ duration: 9, repeat: Infinity, ease: "linear" }}
                style={{
                  borderTopColor: "#7DF9FF",
                  borderRightColor: "rgba(125,249,255,0.15)",
                }}
              />
              <motion.div
                className="absolute inset-4 rounded-full border border-dashed border-reactor-glow/50"
                animate={{ rotate: -360 }}
                transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
              />
              <div
                className="h-16 w-16 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle, #ffffff 0%, #7DF9FF 35%, rgba(0,212,255,0.15) 70%, transparent 100%)",
                  boxShadow: "0 0 40px rgba(125,249,255,0.8)",
                }}
              />
            </div>
          </motion.div>

          {/* The six hero windows */}
          {HEROES.map((h, i) => {
            const d = docks[i];
            const fromX = reduced ? 0 : d.cos * 90;
            const fromY = reduced ? 0 : d.sin * 80;
            return (
              <div
                key={`${runId}-${h.id}`}
                className="absolute"
                style={{
                  left: `${d.x}%`,
                  top: `${d.y}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <motion.div
                  initial={{
                    x: `${fromX}vw`,
                    y: `${fromY}vh`,
                    opacity: 0,
                    scale: 0.6,
                    rotate: reduced ? 0 : d.cos * 14,
                  }}
                  animate={
                    phase === "finale"
                      ? { opacity: 0, scale: 1.15, filter: "brightness(2.4)" }
                      : { x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }
                  }
                  transition={{
                    delay: phase === "finale" ? 0 : 0.05 + i * 0.08,
                    type: "spring",
                    stiffness: 210,
                    damping: 20,
                  }}
                  className="relative w-[190px] rounded-md border backdrop-blur-md"
                  style={{
                    borderColor: `${h.color}88`,
                    background:
                      "linear-gradient(160deg, rgba(6,18,34,0.92), rgba(3,8,16,0.85))",
                    boxShadow: `0 0 24px ${h.color}44, inset 0 0 22px ${h.color}22`,
                  }}
                >
                  {/* title bar */}
                  <div
                    className="flex items-center justify-between rounded-t-md px-2 py-1"
                    style={{
                      background: `linear-gradient(90deg, ${h.color}33, transparent)`,
                    }}
                  >
                    <span
                      className="font-rajdhani text-[9px] tracking-[0.22em]"
                      style={{ color: h.color }}
                    >
                      ASSAULT LINK
                    </span>
                    <span className="flex gap-1">
                      <i className="h-1.5 w-1.5 rounded-full bg-white/40" />
                      <i
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: h.color, boxShadow: `0 0 6px ${h.color}` }}
                      />
                    </span>
                  </div>

                  <div className="px-3 py-2">
                    <div
                      className="font-orbitron text-lg font-extrabold tracking-widest text-white"
                      style={{ textShadow: `0 0 12px ${h.color}` }}
                    >
                      {h.name}
                    </div>
                    <div className="font-rajdhani text-[9px] tracking-[0.24em] text-text-secondary">
                      {h.tag}
                    </div>

                    {/* live fake telemetry bars */}
                    <div className="mt-2 flex h-5 items-end gap-[3px]">
                      {Array.from({ length: 12 }).map((_, b) => (
                        <motion.i
                          key={b}
                          className="w-[4px] rounded-sm"
                          style={{
                            background: h.color,
                            boxShadow: `0 0 6px ${h.color}`,
                          }}
                          animate={{ height: ["18%", "95%", "40%", "75%", "22%"] }}
                          transition={{
                            duration: 1.1 + (b % 3) * 0.35,
                            repeat: Infinity,
                            delay: b * 0.06,
                            ease: "easeInOut",
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* scanline sweep */}
                  <motion.div
                    className="pointer-events-none absolute inset-x-0 h-[2px]"
                    style={{
                      background: `linear-gradient(90deg, transparent, ${h.color}, transparent)`,
                    }}
                    animate={{ top: ["6%", "92%", "6%"] }}
                    transition={{ duration: 2.6, repeat: Infinity, ease: "linear" }}
                  />
                </motion.div>
              </div>
            );
          })}

          {/* Desktop invasion control — the one interactive element */}
          {phase === "assault" && assaultPiPSupported() && (
            <motion.button
              onClick={engage}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 }}
              className="pointer-events-auto absolute bottom-[12vh] left-1/2 -translate-x-1/2 rounded-full border border-reactor-core/60 bg-black/70 px-6 py-2.5 font-orbitron text-xs tracking-[0.3em] text-reactor-glow backdrop-blur-md hover:bg-reactor-core/15"
              style={{ boxShadow: "0 0 30px rgba(0,212,255,0.5)" }}
            >
              {pipCount === null
                ? "⚡ ENGAGE DESKTOP"
                : pipCount > 0
                  ? `⚡ ${pipCount} WINDOWS DEPLOYED`
                  : "⚡ DESKTOP BLOCKED"}
            </motion.button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
