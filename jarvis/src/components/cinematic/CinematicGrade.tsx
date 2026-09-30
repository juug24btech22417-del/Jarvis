"use client";

// ─── CinematicGrade — the "film" layer ───────────────────────────────────
//
// Pure DOM overlays stacked above every other cinematic layer. This is what
// separates a "cool CSS effect" from something that reads as a movie frame:
//
//   letterbox bars   — instant cinema framing, slide in on charge
//   film grain       — animated SVG turbulence, screen-blended
//   vignette         — darkens the corners, pulls focus to the portal
//   scanlines        — subtle CRT texture
//   white flash      — full-frame blowout on the impact beat
//   shockwave        — expanding ring from the portal centre
//   speed lines      — radial streaks rushing inward during the portal
//   kinetic title    — AVENGERS ASSEMBLE with per-letter slam + RGB split
//
// All pointer-events:none so the dashboard underneath stays usable the
// instant the sequence ends.

import { AnimatePresence, motion } from "framer-motion";
import { useAssembleStore } from "@/lib/cinematic/assembleStore";

const GRAIN_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)" opacity="0.55"/></svg>`
  );

const TITLE = "AVENGERS ASSEMBLE";

export default function CinematicGrade() {
  const active = useAssembleStore((s) => s.active);
  const phase = useAssembleStore((s) => s.phase);
  const runId = useAssembleStore((s) => s.runId);

  const showTitle = phase === "charge" || phase === "portal";
  const showSpeedlines = phase === "portal" || phase === "assault";

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={`grade-${runId}`}
          className="fixed inset-0 z-[210] pointer-events-none overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.7 } }}
        >
          {/* Grain */}
          <div
            className="absolute inset-[-50%] cine-grain"
            style={{ backgroundImage: `url("${GRAIN_SVG}")`, opacity: 0.1 }}
          />

          {/* Scanlines */}
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "repeating-linear-gradient(0deg, rgba(0,0,0,0.28) 0px, rgba(0,0,0,0.28) 1px, transparent 1px, transparent 3px)",
              opacity: 0.45,
              mixBlendMode: "multiply",
            }}
          />

          {/* Vignette */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 50% 50%, transparent 34%, rgba(0,0,0,0.55) 78%, rgba(0,0,0,0.92) 100%)",
            }}
          />

          {/* Speed lines — radial streaks rushing inward */}
          {showSpeedlines && !useAssembleStore.getState().reduced && (
            <div
              className="absolute inset-0 cine-speedlines"
              style={{
                background:
                  "repeating-conic-gradient(from 0deg at 50% 50%, rgba(150,220,255,0.0) 0deg, rgba(170,230,255,0.22) 0.35deg, rgba(150,220,255,0) 1.2deg)",
                maskImage:
                  "radial-gradient(circle at 50% 50%, transparent 18%, black 62%, transparent 100%)",
                WebkitMaskImage:
                  "radial-gradient(circle at 50% 50%, transparent 18%, black 62%, transparent 100%)",
              }}
            />
          )}

          {/* Shockwave ring at impact */}
          <motion.div
            className="absolute left-1/2 top-1/2 rounded-full"
            style={{
              border: "2px solid rgba(180,235,255,0.9)",
              boxShadow: "0 0 60px rgba(120,210,255,0.7)",
              width: 40,
              height: 40,
              x: "-50%",
              y: "-50%",
            }}
            initial={{ scale: 0.2, opacity: 0 }}
            animate={{
              scale: [0.2, 7],
              opacity: [0, 0.9, 0],
            }}
            transition={{ duration: 1.35, delay: 0.95, ease: "easeOut" }}
          />

          {/* White flash on the impact beat */}
          <motion.div
            className="absolute inset-0 bg-white"
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.95, 0, 0.4, 0] }}
            transition={{ duration: 0.85, delay: 0.9, times: [0, 0.06, 0.3, 0.42, 1] }}
          />

          {/* Kinetic title */}
          <AnimatePresence>
            {showTitle && (
              <motion.div
                className="absolute inset-x-0 top-[18%] flex flex-col items-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -30, transition: { duration: 0.4 } }}
              >
                <div className="flex items-center gap-[0.06em]">
                  {TITLE.split("").map((ch, i) => (
                    <motion.span
                      key={`${runId}-${i}`}
                      className="font-orbitron font-black text-white"
                      style={{
                        fontSize: "clamp(1.4rem, 5.2vw, 4.4rem)",
                        textShadow:
                          "0 0 18px rgba(120,210,255,0.9), 3px 0 rgba(255,40,80,0.55), -3px 0 rgba(0,200,255,0.55)",
                      }}
                      initial={{ opacity: 0, y: -70, scale: 1.7, rotateX: 60 }}
                      animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                      transition={{
                        delay: 0.1 + i * 0.035,
                        type: "spring",
                        stiffness: 320,
                        damping: 18,
                      }}
                    >
                      {ch === " " ? "\u00A0" : ch}
                    </motion.span>
                  ))}
                </div>
                <motion.div
                  className="cine-sublinetext mt-3 h-[2px] w-[min(72vw,720px)]"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, #7DF9FF, #fff, #7DF9FF, transparent)",
                  }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ delay: 0.5, duration: 0.6, ease: "easeOut" }}
                />
                <motion.p
                  className="mt-3 font-rajdhani tracking-[0.5em] text-reactor-glow text-xs sm:text-sm"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.9 }}
                  transition={{ delay: 0.75 }}
                >
                  ALL PROTOCOLS ENGAGED
                </motion.p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Letterbox bars */}
          <motion.div
            className="absolute inset-x-0 top-0 bg-black"
            initial={{ height: 0 }}
            animate={{ height: "9vh" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.div
            className="absolute inset-x-0 bottom-0 bg-black"
            initial={{ height: 0 }}
            animate={{ height: "9vh" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
