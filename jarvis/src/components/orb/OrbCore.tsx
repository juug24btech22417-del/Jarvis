"use client";

/**
 * OrbCore — a small, quiet sphere.
 *
 * Design rules (deliberately Apple-ish, and the opposite of the first pass):
 *   • ONE object. A glass sphere, a hairline ring, two eyes. Nothing else.
 *   • No permanent text, no tick scales, no 44-dot belt, no bloom that paints
 *     the wallpaper.
 *   • Colour is an accent, not a costume: the sphere stays the same pale glass
 *     in every state and only a thin arc + a soft tint change hue.
 *   • Motion is slow and eased — a ~7s breath, a gently turning hairline, and
 *     a single expanding ripple. Rate of change is the whole trick.
 *
 * Still driven by the real JARVIS state machine, so it reacts to what the
 * assistant is actually doing rather than to a loop of its own.
 *
 *   idle      glass, breathing, blinking, eyes follow your cursor
 *   listening a mint arc appears, the sphere leans in a touch
 *   thinking  the interior comes alive: amber plasma drifts inside the glass,
 *             the ball squishes and turns, the eyes wander, the arc sweeps
 *   speaking  a ripple leaves the sphere on every word
 *   sleep     almost still, eyes to slits, glow almost gone
 */

import { useEffect, useRef } from "react";
import { useJarvisStore, type JarvisState } from "@/store/jarvis.store";
import { useAudioReactivity } from "@/hooks/useAudioReactivity";

export type Gaze = { x: number; y: number };

type Tone = { accent: string };

/**
 * Accents only. The sphere itself is neutral glass in every state — a colour
 * change should read as "something is happening", not as a light show.
 */
export const ORB_TONES: Record<JarvisState, Tone> = {
  booting: { accent: "#7CC7DE" },
  idle: { accent: "#8DE3FF" },
  listening: { accent: "#6EE7A8" },
  thinking: { accent: "#FFAC4D" },
  speaking: { accent: "#B9F1FF" },
  sleep: { accent: "#5B7C8C" },
};

/** Sphere radius in the 100×100 viewBox. */
const R = 34;

// The ball is drawn at 92 px in the orb window; the viewBox keeps the artwork
// resolution-independent.

export default function OrbCore({
  gazeRef,
  active = true,
  isIngesting = false,
}: {
  gazeRef: React.MutableRefObject<Gaze>;
  /** False while the window is hidden — parks the loop entirely. */
  active?: boolean;
  /** True when a file or item is being dragged over the orb for ingestion. */
  isIngesting?: boolean;
}) {
  const state = useJarvisStore((s) => s.state);
  const tone = ORB_TONES[state] ?? ORB_TONES.idle;
  const audioRef = useAudioReactivity();

  const glowRef = useRef<HTMLDivElement>(null);
  const sphereRef = useRef<SVGGElement>(null);
  const plasmaRef = useRef<SVGGElement>(null);
  const blobARef = useRef<SVGCircleElement>(null);
  const blobBRef = useRef<SVGCircleElement>(null);
  const blobCRef = useRef<SVGCircleElement>(null);
  const specRef = useRef<SVGEllipseElement>(null);
  const ringRef = useRef<SVGGElement>(null);
  const arcRef = useRef<SVGGElement>(null);
  const arcDashRef = useRef<SVGCircleElement>(null);
  const rippleRef = useRef<SVGCircleElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const eyeLRef = useRef<SVGEllipseElement>(null);
  const eyeRRef = useRef<SVGEllipseElement>(null);

  // Jaw-dropping capabilities visual hooks
  const satelliteRef = useRef<SVGGElement>(null);
  const intakeRef = useRef<SVGGElement>(null);
  const reticleRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (!active) return;
    const reduced =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let spinSlow = 0;
    let spinFast = 0;
    let gx = 0;
    let gy = 0;
    let sy = 1;
    let blinkStart = -1;
    let nextBlink = performance.now() + 2800;
    let plasmaO = 0.25;

    // ── Expressive AI Micro-Gestures state ──
    let prevState = "idle";
    let eurekaStart = -1;
    let headTilt = 0;
    let lastTargetX = 0;
    let lastTargetY = 0;
    let mouseVelAccum = 0;
    let agitatedUntil = -1;
    let saccadeX = 0;
    let saccadeY = 0;
    let nextSaccade = performance.now() + 1800;
    let satelliteAngle = 0;
    let intakeAngle = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      const st = useJarvisStore.getState();
      const s = st.state;
      const thinking = s === "thinking";
      const listening = s === "listening";
      const speaking = s === "speaking";
      const asleep = s === "sleep";

      // Eureka! moment: when thinking completes and speaking ignites
      if (speaking && prevState === "thinking") {
        eurekaStart = now;
      }
      prevState = s;

      let eurekaBoost = 0;
      if (eurekaStart >= 0) {
        const ep = (now - eurekaStart) / 280;
        if (ep >= 1) {
          eurekaStart = -1;
        } else {
          // Sharp pupil dilation & spark of realization
          eurekaBoost = Math.sin(Math.PI * ep) * 0.38;
        }
      }

      // Time only ever accelerates gently; nothing teleports into a new speed.
      const speed = reduced ? 0.3 : asleep ? 0.35 : thinking ? 1.7 : 1;
      t += dt * speed;

      spinSlow += dt * (asleep ? 1.5 : 5);
      spinFast += dt * (thinking ? 110 : speaking ? 34 : 12);

      ringRef.current?.setAttribute("transform", `rotate(${spinSlow.toFixed(2)})`);
      arcRef.current?.setAttribute("transform", `rotate(${spinFast.toFixed(2)})`);
      arcRef.current?.setAttribute(
        "opacity",
        thinking ? "0.95" : speaking ? "0.5" : listening ? "0.42" : asleep ? "0.08" : "0"
      );

      // The arc grows while JARVIS is working, so the state reads at a glance
      // instead of being a 1px sliver you have to stare at.
      const dash = thinking ? "62 240" : speaking ? "30 240" : "20 240";
      if (arcDashRef.current && arcDashRef.current.getAttribute("stroke-dasharray") !== dash) {
        arcDashRef.current.setAttribute("stroke-dasharray", dash);
      }

      const audio = audioRef.current;
      const music = audio.musicPlaying ? Math.min(1, audio.reactivity) : 0;
      const voice = listening ? Math.max(st.voiceLevel, 0.05) : 0;
      // Thinking has an energy of its own: the sphere breathes faster and the
      // glow warms, so the orb visibly "works" while the answer is being made.
      const energy = Math.min(
        1,
        speaking
          ? 0.45 + 0.3 * Math.sin(t * 7)
          : thinking
            ? 0.42 + 0.22 * Math.sin(t * 3.2)
            : Math.max(voice, music * 0.5)
      );

      // ~7s breath. Small numbers only — the sphere must look like it is
      // resting, not pulsing.
      const breath = Math.sin(t * 0.9);
      const scale = 1 + breath * 0.012 + energy * 0.02;

      // While JARVIS works the whole ball moves: it squishes on a slow cycle and
      // tilts with curious cognitive posture.
      const work = thinking ? 1 : speaking ? 0.7 : listening ? 0.35 : 0;
      const squish = Math.sin(t * 1.25) * work;

      // Cognitive head tilt: inquisitive posture while thinking or listening
      const targetTilt = thinking
        ? -6.5 + Math.sin(t * 0.75) * 3.2
        : listening
          ? -2.8
          : 0;
      headTilt += (targetTilt - headTilt) * Math.min(1, dt * 4.5);

      const totalRotate = (squish * 2.4 + headTilt).toFixed(2);
      sphereRef.current?.setAttribute(
        "transform",
        `translate(0 ${(breath * 0.5).toFixed(2)}) rotate(${totalRotate}) scale(${(
          scale * (1 + squish * 0.024)
        ).toFixed(4)} ${(scale * (1 - squish * 0.02)).toFixed(4)})`
      );

      // Interior plasma — the fluid light inside the glass. Eased in and out, so
      // it swells while thinking instead of snapping on.
      const plasmaTarget = thinking ? 1 : speaking ? 0.8 : listening ? 0.45 : 0.25;
      plasmaO += (plasmaTarget - plasmaO) * Math.min(1, dt * 4.5);
      if (plasmaRef.current) plasmaRef.current.style.opacity = plasmaO.toFixed(3);

      const amp = 0.55 + 0.45 * plasmaO;

      // Gaze & target velocity tracking for impatience/agitation detection
      const target = gazeRef.current ?? { x: 0, y: 0 };
      const dTarget = Math.hypot(target.x - lastTargetX, target.y - lastTargetY);
      lastTargetX = target.x;
      lastTargetY = target.y;
      mouseVelAccum = mouseVelAccum * Math.pow(0.18, dt) + dTarget;

      // If user aggressively jiggles cursor while JARVIS is thinking or speaking
      if (mouseVelAccum > 0.42 && (thinking || speaking)) {
        agitatedUntil = now + 1600;
      }
      const isAgitated = now < agitatedUntil;

      // Faux-3D parallax: interior plasma floats slightly opposite to gaze direction
      const plasmaParallaxX = -gx * 1.6;
      const plasmaParallaxY = -gy * 1.2;

      const drift = (el: SVGCircleElement | null, x: number, y: number, r: number) => {
        if (!el) return;
        el.setAttribute("transform", `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        el.setAttribute("r", r.toFixed(2));
      };
      drift(blobARef.current, Math.sin(t * 1.05) * 12 * amp + plasmaParallaxX, Math.cos(t * 0.82) * 9 * amp + plasmaParallaxY, 20 + Math.sin(t * 0.9) * 2);
      drift(blobBRef.current, -Math.sin(t * 0.74 + 1.2) * 13 * amp + plasmaParallaxX, Math.cos(t * 1.18) * 10 * amp + plasmaParallaxY, 15 + Math.cos(t * 1.1) * 1.6);
      drift(blobCRef.current, Math.cos(t * 1.42 + 0.4) * 8 * amp + plasmaParallaxX, -Math.sin(t * 0.96) * 11 * amp + plasmaParallaxY, 25 + Math.sin(t * 1.3) * 2.4);

      // The specular drifts too, so the light source feels like it moves.
      if (specRef.current) {
        specRef.current.setAttribute("cx", (-12 + Math.sin(t * 0.7) * 3 * work).toFixed(2));
        specRef.current.setAttribute("cy", (-22 + Math.cos(t * 0.9) * 2 * work).toFixed(2));
      }

      if (glowRef.current) {
        glowRef.current.style.opacity = (
          asleep ? 0.05 : 0.1 + energy * 0.14 + (breath + 1) * 0.02
        ).toFixed(3);
        glowRef.current.style.transform = `scale(${(1 + energy * 0.1 + breath * 0.02).toFixed(4)})`;
      }

      // One ripple, leaving the sphere like a breath of light.
      const phase = (t * 0.55) % 1;
      if (rippleRef.current) {
        rippleRef.current.setAttribute("r", (R + phase * 11).toFixed(2));
        rippleRef.current.setAttribute(
          "opacity",
          ((1 - phase) * 0.38 * Math.min(1, energy * 1.6)).toFixed(3)
        );
      }

      // ── Jaw-Dropping Features Visual Drivers ──────────────────────────
      // Feature 1: Ingestion Singularity Vortex
      const ingesting = isIngesting || !!st.orbIngestFeedback?.active;
      if (intakeRef.current) {
        if (ingesting) {
          intakeAngle += dt * 320;
          intakeRef.current.setAttribute("transform", `rotate(${intakeAngle.toFixed(2)})`);
          intakeRef.current.setAttribute("opacity", "0.85");
        } else {
          intakeRef.current.setAttribute("opacity", "0");
        }
      }

      // Feature 2: Screen Reticle HUD
      const reticleActive = !!st.screenReticle?.active;
      if (reticleRef.current) {
        reticleRef.current.setAttribute("opacity", reticleActive ? "0.85" : "0");
        if (reticleActive) {
          reticleRef.current.setAttribute("transform", `rotate(${(now * 0.04).toFixed(2)})`);
        }
      }

      // Feature 4: Ghost Worker Orbital Satellite Mote
      const activeGhost = st.ghostWorkers.find(
        (w) => w.status === "running" || w.status === "waiting_approval"
      );
      if (activeGhost && satelliteRef.current) {
        satelliteAngle += dt * (activeGhost.status === "waiting_approval" ? 1.6 : 3.8);
        const satR = R + 14;
        const sx = Math.cos(satelliteAngle) * satR;
        const sy = Math.sin(satelliteAngle) * satR;
        satelliteRef.current.setAttribute("transform", `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`);
        const isBlinking = activeGhost.status === "waiting_approval" && Math.sin(now * 0.012) > 0;
        satelliteRef.current.setAttribute(
          "opacity",
          activeGhost.status === "waiting_approval" ? (isBlinking ? "1" : "0.2") : "0.9"
        );
      } else if (satelliteRef.current) {
        satelliteRef.current.setAttribute("opacity", "0");
      }

      // ── Eyes (Micro-Gestures & Personality Engine) ────────────────────
      const ease = Math.min(1, dt * (isAgitated ? 14 : 6));
      gx += (target.x - gx) * ease;
      gy += (target.y - gy) * ease;

      // Natural micro-saccades (subtle involuntary eye twitches)
      if (now > nextSaccade) {
        nextSaccade = now + 1400 + Math.random() * 2600;
        saccadeX = (Math.random() - 0.5) * 0.5;
        saccadeY = (Math.random() - 0.5) * 0.35;
      }
      saccadeX *= Math.pow(0.02, dt);
      saccadeY *= Math.pow(0.02, dt);

      // Blinking with organic double-blink variation
      if (now > nextBlink && blinkStart < 0) blinkStart = now;
      if (blinkStart >= 0) {
        const p = (now - blinkStart) / 140;
        if (p >= 1) {
          blinkStart = -1;
          const isDouble = Math.random() < 0.2;
          nextBlink = now + (isDouble ? 190 : 2800 + Math.random() * 4200);
          sy = 1;
        } else {
          sy = 1 - Math.sin(Math.PI * Math.min(1, p)) * 0.92;
        }
      }

      const baseY = asleep ? 0.28 : thinking ? 0.8 : listening ? 1.08 : 1;
      
      // Impatience side-eye squint
      const agitationSquint = isAgitated ? 0.65 : 1;

      // Asymmetrical cognitive aperture: when analyzing, one eye narrows into focus
      const asymmetry = thinking && !isAgitated ? Math.sin(t * 1.7) * 0.18 : 0;
      const eyeYL = Math.max(0.06, baseY * sy * (1 - asymmetry) * agitationSquint + eurekaBoost);
      const eyeYR = Math.max(0.06, baseY * sy * (1 + asymmetry) * agitationSquint + eurekaBoost);

      // Wander while thinking, unless user agitation snaps focus directly to cursor
      const wanderX = thinking && !isAgitated ? Math.sin(t * 1.15) * 2.1 : 0;
      const wanderY = thinking && !isAgitated ? Math.cos(t * 1.62) * 1.4 : 0;

      const eyeGazeX = gx * 2.2 + wanderX + saccadeX;
      const eyeGazeY = gy * 1.8 + wanderY + saccadeY;

      eyesRef.current?.setAttribute(
        "transform",
        `translate(${eyeGazeX.toFixed(2)} ${eyeGazeY.toFixed(2)}) rotate(${(gx * 1.6).toFixed(2)} 0 -1)`
      );

      // Faux-3D spherical curvature foreshortening:
      // Eyes compress horizontally as they look towards the sphere's periphery
      const cosTheta = Math.sqrt(Math.max(0.2, 1 - Math.min(1, Math.pow(gx, 2) * 0.42)));
      const rxScaleL = (gx > 0.1 ? cosTheta : 1) * (1 + eurekaBoost * 0.25);
      const rxScaleR = (gx < -0.1 ? cosTheta : 1) * (1 + eurekaBoost * 0.25);
      const eyeSpacing = 7.5 * (1 - Math.abs(gx) * 0.12);

      const place = (
        el: SVGEllipseElement | null,
        cx: number,
        rxScale: number,
        ryScale: number
      ) => {
        if (!el) return;
        el.setAttribute(
          "transform",
          `translate(${cx.toFixed(2)} 0.5) scale(${rxScale.toFixed(3)} ${ryScale.toFixed(3)}) translate(${-cx.toFixed(2)} -0.5)`
        );
      };
      place(eyeLRef.current, -eyeSpacing, rxScaleL, eyeYL);
      place(eyeRRef.current, eyeSpacing, rxScaleR, eyeYR);
      eyesRef.current?.setAttribute("opacity", asleep ? "0.5" : "1");
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, audioRef, gazeRef]);

  const vars = { "--orb-accent": tone.accent } as unknown as React.CSSProperties;

  return (
    <div className="relative h-full w-full" style={vars}>
      <style>{`
        .orb-svg circle, .orb-svg ellipse { transition: stroke .8s ease, fill .8s ease; }
        .orb-eyes { filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.55)); }
      `}</style>

      {/* The light the sphere rests in — barely there on purpose */}
      <div
        ref={glowRef}
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, var(--orb-accent) 0%, transparent 62%)",
          filter: "blur(16px)",
          opacity: 0.12,
          willChange: "transform, opacity",
        }}
      />

      <svg viewBox="-50 -50 100 100" className="orb-svg relative h-full w-full overflow-visible">
        <defs>
          <radialGradient id="orbFill" cx="38%" cy="30%" r="78%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
            <stop offset="26%" stopColor="#D8F3FF" stopOpacity="0.95" />
            <stop offset="58%" stopColor="#7CC6E2" stopOpacity="0.95" />
            <stop offset="86%" stopColor="#1E5C74" stopOpacity="0.97" />
            <stop offset="100%" stopColor="#08222E" stopOpacity="0.99" />
          </radialGradient>
          <radialGradient id="orbTint" cx="50%" cy="50%" r="50%">
            <stop offset="55%" stopColor="var(--orb-accent)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--orb-accent)" stopOpacity="0.22" />
          </radialGradient>

          {/* Interior light. Radial fades, not filters — soft edges at no cost. */}
          <radialGradient id="orbBlobA" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--orb-accent)" stopOpacity="0.85" />
            <stop offset="50%" stopColor="var(--orb-accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--orb-accent)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orbBlobB" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.62" />
            <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orbBlobC" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--orb-accent)" stopOpacity="0.5" />
            <stop offset="70%" stopColor="var(--orb-accent)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--orb-accent)" stopOpacity="0" />
          </radialGradient>
          <clipPath id="orbClip">
            <circle r={R} />
          </clipPath>
        </defs>

        {/* Hairline ring — the only permanent structure */}
        <g ref={ringRef} data-orb-spin>
          <circle
            r={R + 6}
            fill="none"
            stroke="var(--orb-accent)"
            strokeWidth="0.7"
            strokeDasharray="1.6 4.2"
            opacity="0.34"
          />
        </g>

        {/* State arc — invisible at rest, so colour never becomes decoration.
            It orbits OUTSIDE the hairline so "busy" is never mistaken for the
            static ring, with a wide faint pass underneath it for a soft glow. */}
        <g ref={arcRef} data-orb-spin="fast">
          <circle r={R + 9} fill="none" stroke="var(--orb-accent)" strokeWidth="5" opacity="0.16" />
          <circle
            ref={arcDashRef}
            r={R + 9}
            fill="none"
            stroke="var(--orb-accent)"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray="20 240"
            opacity="0"
          />
        </g>

        {/* The sphere */}
        <g ref={sphereRef} data-orb-sphere>
          <circle r={R} fill="url(#orbFill)" />
          <circle r={R} fill="url(#orbTint)" />

          {/* Plasma, clipped to the glass and screened so it reads as light
              behind the surface rather than paint on top of it. */}
          <g clipPath="url(#orbClip)">
            <g ref={plasmaRef} data-orb-plasma opacity={0.25} style={{ mixBlendMode: "screen" }}>
              <circle ref={blobCRef} r="25" fill="url(#orbBlobC)" />
              <circle ref={blobARef} r="20" fill="url(#orbBlobA)" />
              <circle ref={blobBRef} r="15" fill="url(#orbBlobB)" />
            </g>
          </g>

          <circle r={R} fill="none" stroke="#FFFFFF" strokeOpacity="0.34" strokeWidth="0.7" />
        </g>

        {/* Ripple */}
        <circle ref={rippleRef} r={R} fill="none" stroke="var(--orb-accent)" strokeWidth="0.6" opacity="0" />

        {/* Feature 1: Ingestion Singularity Vortex */}
        <g ref={intakeRef} opacity="0">
          <circle
            r={R + 13}
            fill="none"
            stroke="var(--orb-accent)"
            strokeWidth="1.2"
            strokeDasharray="4 8"
          />
        </g>

        {/* Feature 2: Screen Reticle HUD */}
        <g ref={reticleRef} opacity="0">
          <circle r={R + 2} fill="none" stroke="var(--orb-accent)" strokeWidth="0.8" strokeDasharray="14 18" />
          <line x1="-8" y1="0" x2="8" y2="0" stroke="var(--orb-accent)" strokeWidth="0.8" strokeDasharray="2 2" />
          <line x1="0" y1="-8" x2="0" y2="8" stroke="var(--orb-accent)" strokeWidth="0.8" strokeDasharray="2 2" />
        </g>

        {/* Feature 4: Ghost Worker Satellite Mote */}
        <g ref={satelliteRef} opacity="0">
          <circle r="2.2" fill="var(--orb-accent)" />
          <circle r="4.2" fill="none" stroke="var(--orb-accent)" strokeWidth="0.6" opacity="0.4" />
        </g>

        {/* Eyes */}
        <g ref={eyesRef} className="orb-eyes">
          <ellipse ref={eyeLRef} cx="-7.5" cy="0.5" rx="3.5" ry="5.1" fill="#FFFFFF" />
          <ellipse ref={eyeRRef} cx="7.5" cy="0.5" rx="3.5" ry="5.1" fill="#FFFFFF" />
        </g>

        {/* Specular — what makes it read as glass rather than a dot */}
        <ellipse ref={specRef} cx="-12" cy="-22" rx="7" ry="3.6" fill="#FFFFFF" opacity="0.13" />
      </svg>
    </div>
  );
}
