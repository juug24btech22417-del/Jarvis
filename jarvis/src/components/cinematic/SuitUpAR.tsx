"use client";

// ─── SuitUpAR — armour assembles onto the user's real face ────────────────
//
// The head-turner: the webcam feed appears in a holographic viewport and Iron
// Man–style plates fly in and dock onto the user's actual face, tracking head
// movement live.
//
// It reuses the eye engine's ONE FaceLandmarker (via subscribeFaceLandmarks)
// instead of spawning a second one — see the useEyeControl header for why a
// second landmarker tears down the shared wasm runtime. The same hook already
// hands us a live preview <video> off the shared camera stream, so there is no
// extra getUserMedia either.
//
// Geometry: every stored landmark is converted into a LOCAL space whose origin
// is the eye midpoint, whose unit is the inter-cheek width, and whose rotation
// is undoed by the eye-line roll. The static helmet/faceplate are drawn once in
// that canonical space; the landmark-dependent pieces (visor slits, chest,
// pauldrons) are drawn origin-centred and MOVED by setting a transform
// attribute from the inference callback — zero React re-renders per frame.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useEyeControl, subscribeFaceLandmarks } from "@/hooks/useEyeControl";
import { useAssembleStore } from "@/lib/cinematic/assembleStore";

// MediaPipe FaceMesh landmark indices we anchor to.
const R_EYE_OUT = 33;
const R_EYE_IN = 133;
const L_EYE_OUT = 263;
const L_EYE_IN = 362;
const CHEEK_L = 234;
const CHEEK_R = 454;
const CHIN = 152;

interface Pt {
  x: number;
  y: number;
}

/** Rotate a point around the origin by -roll. */
function rot(p: Pt, cos: number, sin: number): Pt {
  return { x: p.x * cos + p.y * sin, y: -p.x * sin + p.y * cos };
}

export default function SuitUpAR() {
  const active = useAssembleStore((s) => s.active);
  const phase = useAssembleStore((s) => s.phase);
  const runId = useAssembleStore((s) => s.runId);
  const reduced = useAssembleStore((s) => s.reduced);

  const wantCamera =
    active &&
    (phase === "portal" || phase === "assault" || phase === "suitup" || phase === "finale");
  const { videoRef, ready, error } = useEyeControl({ enabled: wantCamera });

  const videoHostRef = useRef<HTMLDivElement>(null);
  const armorRef = useRef<SVGGElement>(null);
  const visorRRef = useRef<SVGGElement>(null);
  const visorLRef = useRef<SVGGElement>(null);
  const chestRef = useRef<SVGGElement>(null);
  const pauldronLRef = useRef<SVGGElement>(null);
  const pauldronRRef = useRef<SVGGElement>(null);
  const [faceFound, setFaceFound] = useState(false);
  const [deployed, setDeployed] = useState(false);

  // Mount the shared preview <video> into our viewport.
  useEffect(() => {
    const host = videoHostRef.current;
    const v = videoRef.current;
    if (!host || !v) return;
    v.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scaleX(-1);filter:contrast(1.08) saturate(1.05) brightness(0.9);";
    host.appendChild(v);
    return () => {
      if (v.parentNode === host) host.removeChild(v);
    };
  }, [ready, videoRef]);

  // Deploy the plates a beat after the suit-up phase begins.
  useEffect(() => {
    if (phase !== "suitup" && phase !== "finale") {
      setDeployed(false);
      return;
    }
    const t = setTimeout(() => setDeployed(true), reduced ? 0 : 120);
    return () => clearTimeout(t);
  }, [phase, reduced, runId]);

  // Landmark → armour transforms, straight to the DOM nodes.
  useEffect(() => {
    if (!wantCamera) return;
    const unsub = subscribeFaceLandmarks(({ landmarks }) => {
      const g = armorRef.current;
      if (!g) return;
      if (!landmarks || landmarks.length < 478) {
        setFaceFound(false);
        g.setAttribute("opacity", "0");
        return;
      }
      setFaceFound(true);
      g.setAttribute("opacity", "1");

      const p = (i: number): Pt => ({ x: landmarks[i].x, y: landmarks[i].y });
      const rMid = {
        x: (p(R_EYE_OUT).x + p(R_EYE_IN).x) / 2,
        y: (p(R_EYE_OUT).y + p(R_EYE_IN).y) / 2,
      };
      const lMid = {
        x: (p(L_EYE_OUT).x + p(L_EYE_IN).x) / 2,
        y: (p(L_EYE_OUT).y + p(L_EYE_IN).y) / 2,
      };

      const cx = (rMid.x + lMid.x) / 2;
      const cy = (rMid.y + lMid.y) / 2;
      const dx = lMid.x - rMid.x;
      const dy = lMid.y - rMid.y;
      const roll = Math.atan2(dy, dx);
      const cos = Math.cos(-roll);
      const sin = Math.sin(-roll);

      const cheekL = p(CHEEK_L);
      const cheekR = p(CHEEK_R);
      const faceW = Math.hypot(cheekL.x - cheekR.x, cheekL.y - cheekR.y) || 0.18;

      // Unit = face width, so local coords are scale-invariant.
      const unit = faceW * 1.35;
      const toLocal = (q: Pt): Pt => {
        const d = { x: (q.x - cx) / unit, y: (q.y - cy) / unit };
        return rot(d, cos, sin);
      };

      const eyeL = toLocal(lMid);
      const eyeR = toLocal(rMid);
      const chin = toLocal(p(CHIN));

      // Group transform into the 0..1 viewBox space (SVG y-down matches landmarks).
      g.setAttribute(
        "transform",
        `translate(${cx.toFixed(5)} ${cy.toFixed(5)}) rotate(${((roll * 180) / Math.PI).toFixed(2)}) scale(${(1 / unit).toFixed(5)})`
      );

      const move = (el: SVGGElement | null, x: number, y: number) => {
        if (el) el.setAttribute("transform", `translate(${x.toFixed(4)} ${y.toFixed(4)})`);
      };
      move(visorRRef.current, eyeR.x, eyeR.y);
      move(visorLRef.current, eyeL.x, eyeL.y);
      move(chestRef.current, 0, chin.y + 0.2);
      move(pauldronLRef.current, -0.52, chin.y + 0.26);
      move(pauldronRRef.current, 0.52, chin.y + 0.26);
    });
    return unsub;
  }, [wantCamera]);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key={`suitup-${runId}`}
          className="fixed inset-0 z-[206] pointer-events-none flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: phase === "finale" ? 0 : 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div
            className="relative overflow-hidden rounded-xl border"
            style={{
              width: "min(46vh, 34vw)",
              height: "min(58vh, 43vw)",
              borderColor: "rgba(125,249,255,0.5)",
              boxShadow:
                "0 0 60px rgba(0,212,255,0.45), inset 0 0 60px rgba(0,212,255,0.18)",
              background: "rgba(2,8,16,0.85)",
            }}
          >
            {/* Camera feed (mirrored) — the shared preview <video> is
                appended here by the effect above. */}
            <div ref={videoHostRef} className="absolute inset-0" />

            {/* Armour overlay — mirrored with the feed so geometry lines up */}
            <div className="absolute inset-0" style={{ transform: "scaleX(-1)" }}>
              <svg
                className="h-full w-full"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden
              >
                <defs>
                  <linearGradient id="suit-gold" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFE08A" />
                    <stop offset="45%" stopColor="#E8A925" />
                    <stop offset="100%" stopColor="#8A5A0B" />
                  </linearGradient>
                  <linearGradient id="suit-red" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FF5A47" />
                    <stop offset="100%" stopColor="#8E0F1E" />
                  </linearGradient>
                  <radialGradient id="suit-core" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="40%" stopColor="#8FE8FF" />
                    <stop offset="100%" stopColor="#00D4FF" stopOpacity="0" />
                  </radialGradient>
                </defs>

                <g ref={armorRef} opacity={0} style={{ transition: "opacity 0.25s linear" }}>
                  {/* Helmet shell (static — tracks via the parent transform) */}
                  <motion.path
                    d="M -0.52 -0.30 C -0.52 -0.72 -0.28 -1.05 0 -1.05 C 0.28 -1.05 0.52 -0.72 0.52 -0.30 L 0.44 0.62 C 0.30 0.95 -0.30 0.95 -0.44 0.62 Z"
                    fill="url(#suit-red)"
                    stroke="#FFD98A"
                    strokeWidth={0.006}
                    vectorEffect="non-scaling-stroke"
                    initial={{ opacity: 0, y: -0.4 }}
                    animate={deployed ? { opacity: 0.92, y: 0 } : { opacity: 0, y: -0.4 }}
                    transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  />

                  {/* Gold faceplate */}
                  <motion.path
                    d="M -0.34 -0.42 C -0.34 -0.66 -0.16 -0.86 0 -0.86 C 0.16 -0.86 0.34 -0.66 0.34 -0.42 L 0.26 0.48 C 0.16 0.72 -0.16 0.72 -0.26 0.48 Z"
                    fill="url(#suit-gold)"
                    stroke="#FFF0C0"
                    strokeWidth={0.004}
                    vectorEffect="non-scaling-stroke"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={deployed ? { opacity: 0.95, scale: 1 } : { opacity: 0, scale: 0.6 }}
                    transition={{ delay: 0.18, duration: 0.55, ease: "backOut" }}
                  />

                  {/* Visor eye slits — moved to the real eyes each frame */}
                  <g ref={visorRRef}>
                    <motion.path
                      d="M -0.16 -0.05 L 0.09 -0.09 L 0.07 0.05 L -0.14 0.07 Z"
                      fill="#7DF9FF"
                      initial={{ opacity: 0, scale: 0.3 }}
                      animate={deployed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.3 }}
                      transition={{ delay: 0.5, duration: 0.3 }}
                    />
                  </g>
                  <g ref={visorLRef}>
                    <motion.path
                      d="M 0.16 -0.05 L -0.09 -0.09 L -0.07 0.05 L 0.14 0.07 Z"
                      fill="#7DF9FF"
                      initial={{ opacity: 0, scale: 0.3 }}
                      animate={deployed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.3 }}
                      transition={{ delay: 0.5, duration: 0.3 }}
                    />
                  </g>

                  {/* Mouth grille (fixed offset from the origin) */}
                  <motion.path
                    transform="translate(0 0.34)"
                    d="M -0.12 -0.07 L 0.12 -0.07 L 0.09 0.07 L -0.09 0.07 Z"
                    fill="#1A0A0A"
                    stroke="#FFD98A"
                    strokeWidth={0.003}
                    vectorEffect="non-scaling-stroke"
                    initial={{ opacity: 0 }}
                    animate={deployed ? { opacity: 0.9 } : { opacity: 0 }}
                    transition={{ delay: 0.62, duration: 0.3 }}
                  />

                  {/* Chest plate + reactor — follows the chin */}
                  <g ref={chestRef}>
                    <motion.path
                      d="M -0.55 0 L 0.55 0 L 0.62 0.85 L -0.62 0.85 Z"
                      fill="url(#suit-red)"
                      stroke="#FFD98A"
                      strokeWidth={0.006}
                      vectorEffect="non-scaling-stroke"
                      initial={{ opacity: 0, y: 0.3 }}
                      animate={deployed ? { opacity: 0.9, y: 0 } : { opacity: 0, y: 0.3 }}
                      transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                    />
                    <motion.circle
                      cx={0}
                      cy={0.56}
                      r={0.2}
                      fill="url(#suit-core)"
                      initial={{ opacity: 0, scale: 0.3 }}
                      animate={deployed ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.3 }}
                      transition={{ delay: 0.8, type: "spring", stiffness: 200, damping: 14 }}
                    />
                    <motion.circle
                      cx={0}
                      cy={0.56}
                      r={0.06}
                      fill="#ffffff"
                      initial={{ opacity: 0 }}
                      animate={deployed ? { opacity: 1 } : { opacity: 0 }}
                      transition={{ delay: 0.85, duration: 0.3 }}
                    />
                  </g>

                  {/* Shoulder pauldrons */}
                  <g ref={pauldronLRef}>
                    <motion.path
                      d="M 0 0.02 L -0.5 -0.08 L -0.46 0.62 L -0.06 0.5 Z"
                      fill="url(#suit-gold)"
                      stroke="#FFF0C0"
                      strokeWidth={0.004}
                      vectorEffect="non-scaling-stroke"
                      initial={{ opacity: 0, x: -0.4 }}
                      animate={deployed ? { opacity: 0.92, x: 0 } : { opacity: 0, x: -0.4 }}
                      transition={{ delay: 0.42, duration: 0.55, ease: "backOut" }}
                    />
                  </g>
                  <g ref={pauldronRRef}>
                    <motion.path
                      d="M 0 0.02 L 0.5 -0.08 L 0.46 0.62 L 0.06 0.5 Z"
                      fill="url(#suit-gold)"
                      stroke="#FFF0C0"
                      strokeWidth={0.004}
                      vectorEffect="non-scaling-stroke"
                      initial={{ opacity: 0, x: 0.4 }}
                      animate={deployed ? { opacity: 0.92, x: 0 } : { opacity: 0, x: 0.4 }}
                      transition={{ delay: 0.42, duration: 0.55, ease: "backOut" }}
                    />
                  </g>
                </g>
              </svg>
            </div>

            {/* HUD frame + status */}
            <div className="pointer-events-none absolute inset-0">
              {[
                "left-2 top-2 border-l-2 border-t-2",
                "right-2 top-2 border-r-2 border-t-2",
                "left-2 bottom-2 border-l-2 border-b-2",
                "right-2 bottom-2 border-r-2 border-b-2",
              ].map((c) => (
                <span key={c} className={`absolute h-5 w-5 border-reactor-core ${c}`} />
              ))}
              <div className="absolute inset-x-0 top-3 text-center font-rajdhani text-[10px] tracking-[0.3em] text-reactor-glow">
                AR SUIT-UP · LIVE MESH
              </div>
              <div className="absolute inset-x-0 bottom-3 text-center">
                <span
                  className="font-orbitron text-xs tracking-[0.3em]"
                  style={{
                    color: faceFound ? "#00FF9D" : "#FFB020",
                    textShadow: `0 0 12px ${faceFound ? "#00FF9D" : "#FFB020"}`,
                  }}
                >
                  {error
                    ? "CAMERA OFFLINE"
                    : faceFound
                      ? "SUIT ONLINE"
                      : ready
                        ? "TARGET NOT FOUND"
                        : "CALIBRATING…"}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
