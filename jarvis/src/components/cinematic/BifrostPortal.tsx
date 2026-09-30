"use client";

// ─── BifrostPortal — the centrepiece ─────────────────────────────────────
//
// A full-screen WebGL layer rendered with raw three.js (the R3F runtime in
// this repo is orphaned; raw three gives us exact control over blend state
// and lets the effect run at a capped pixel ratio).
//
// The look is a single fragment shader: a polar "tunnel" built from
// fbm nebula, rainbow Bifrost striations, an energy rim, a central core and a
// vertical beam — all ADDITIVELY blended so black contributes nothing and the
// portal glows over the live dashboard instead of replacing it. A storm of
// additive points rushes inward through the tunnel for real depth/parallax.
//
// Everything is driven by one uTime plus uProgress (the opening) and
// uIntensity (master brightness), read once per frame from the store so the
// React tree never re-renders during playback.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useAssembleStore } from "@/lib/cinematic/assembleStore";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uProgress;
  uniform float uIntensity;
  uniform float uAspect;
  uniform vec2  uShake;
  uniform vec3  uCore;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + 17.1;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv - 0.5;
    uv.x *= uAspect;
    uv += uShake;

    float r = length(uv);
    float ang = atan(uv.y, uv.x);

    // Depth into the tunnel. The +0.12 keeps the singularity finite.
    float depth = 1.0 / (r + 0.12);
    float swirl = ang + depth * 0.32 + uTime * 0.55;

    // Nebula stretched along the tunnel axis.
    vec2 np = vec2(swirl * 1.15, depth * 0.75 - uTime * 1.25);
    float n = fbm(np * 1.7);
    float n2 = fbm(np * 4.3 - uTime * 0.6);

    // Rainbow Bifrost bands.
    float band = sin(swirl * 3.0 + depth * 1.4) * 0.5 + 0.5;
    vec3 rainbow = 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + band * 0.85 + uTime * 0.07));

    // The portal mouth: a hard-ish disc that opens with uProgress.
    float openR = mix(0.015, 0.52, clamp(uProgress, 0.0, 1.0));
    float inside = smoothstep(openR, openR * 0.35, r);
    float rim = exp(-pow((r - openR) * 13.0, 2.0));

    // Central singularity.
    float core = exp(-r * 6.5);

    // Vertical beam slamming down into the portal.
    float beamMask = exp(-pow(uv.x * 9.0, 2.0));
    float beam = beamMask * smoothstep(-0.62, 0.75, uv.y) * smoothstep(0.05, 0.55, uProgress);

    // Energy filaments crawling along the tunnel wall.
    float fil = pow(max(0.0, sin(depth * 3.0 + uTime * 2.2) * 0.5 + 0.5), 6.0);

    vec3 col = vec3(0.0);
    col += rainbow * n * 1.35 * inside;
    col += rainbow * (n2 * 0.6 + 0.35) * rim * 2.0;
    col += uCore * core * 3.2 * uProgress;
    col += uCore * beam * 1.5;
    col += rainbow * fil * inside * 0.55;

    // Breathing energy pulse.
    col *= 0.82 + 0.18 * sin(uTime * 3.4);

    // Master brightness + vignette so edges never wash the UI.
    col *= clamp(uIntensity * 1.5, 0.0, 1.6);
    col *= smoothstep(1.35, 0.15, r);

    gl_FragColor = vec4(col, 1.0);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  varying vec3 vColor;
  void main() {
    vColor = aColor;
    gl_PointSize = aSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a);
  }
`;

export default function BifrostPortal() {
  const mountRef = useRef<HTMLDivElement>(null);
  const active = useAssembleStore((s) => s.active);
  const runId = useAssembleStore((s) => s.runId);

  useEffect(() => {
    if (!active) return;
    const mount = mountRef.current;
    if (!mount) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    } catch {
      // No WebGL — the rest of the sequence (windows, AR, grade) still runs.
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.z = 1;

    const uniforms = {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uIntensity: { value: 0 },
      uAspect: { value: window.innerWidth / Math.max(1, window.innerHeight) },
      uShake: { value: new THREE.Vector2(0, 0) },
      uCore: { value: new THREE.Color("#cfefff") },
    };

    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    scene.add(quad);

    // ── Particle storm rushing into the portal ──────────────────────────
    const COUNT = reduced ? 400 : 2200;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const radii = new Float32Array(COUNT);
    const angles = new Float32Array(COUNT);
    const speeds = new Float32Array(COUNT);
    const col = new THREE.Color();
    const aspect = () => window.innerWidth / Math.max(1, window.innerHeight);

    for (let i = 0; i < COUNT; i++) {
      radii[i] = 0.12 + Math.random() * 1.1;
      angles[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.1 + Math.random() * 0.5;
      sizes[i] = 1.5 + Math.random() * 4.5;
      col.setHSL((0.5 + Math.random() * 0.35) % 1, 0.9, 0.68);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    const points = new THREE.Points(
      pGeo,
      new THREE.ShaderMaterial({
        vertexShader: PARTICLE_VERT,
        fragmentShader: PARTICLE_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    scene.add(points);

    let raf = 0;
    const clock = new THREE.Clock();
    let shakeAmt = 0;

    const onResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uAspect.value = aspect();
    };
    window.addEventListener("resize", onResize);

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const st = useAssembleStore.getState();
      if (!st.active) return;

      const elapsed =
        (performance.now() - st.startedAt) / 1000;
      const t = clock.getElapsedTime();

      // Portal opens across 0.65s → 1.5s, matching the impact beat.
      const p = Math.min(1, Math.max(0, (elapsed - 0.65) / 0.85));
      const eased = p * p * (3 - 2 * p);

      // Shake: a sharp spike on the impact, decaying over ~0.9s.
      const sinceImpact = elapsed - 1.5;
      const impactShake = sinceImpact > 0 && sinceImpact < 0.9 ? 1 - sinceImpact / 0.9 : 0;
      shakeAmt += (impactShake - shakeAmt) * 0.3;
      const s = reduced ? 0 : shakeAmt * 0.012;
      uniforms.uShake.value.set(
        (Math.sin(t * 61.0) + Math.sin(t * 41.0)) * s,
        (Math.cos(t * 57.0) + Math.sin(t * 37.0)) * s
      );

      uniforms.uTime.value = t;
      uniforms.uProgress.value = eased;
      uniforms.uIntensity.value = st.intensity;

      // Advance the storm inward; recycle particles at the rim.
      const pos = pGeo.getAttribute("position") as THREE.BufferAttribute;
      const asp = uniforms.uAspect.value;
      for (let i = 0; i < COUNT; i++) {
        radii[i] -= (speeds[i] * (0.5 + st.intensity)) * 0.016;
        if (radii[i] < 0.05) {
          radii[i] = 0.9 + Math.random() * 0.5;
          angles[i] = Math.random() * Math.PI * 2;
        }
        const a = angles[i] + t * 0.5;
        const rr = radii[i];
        pos.setXYZ(i, Math.cos(a) * rr * asp, Math.sin(a) * rr, 0);
      }
      pos.needsUpdate = true;
      const sizeAttr = pGeo.getAttribute("aSize") as THREE.BufferAttribute;
      const sizeArr = sizeAttr.array as Float32Array;
      const flick = 0.75 + 0.25 * st.intensity;
      for (let i = 0; i < COUNT; i++) {
        sizeArr[i] = sizes[i] * flick * (0.7 + 0.3 * ((i * 7) % 5) / 5);
      }
      sizeAttr.needsUpdate = true;
      points.visible = st.intensity * eased > 0.02;

      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      pGeo.dispose();
      (points.material as THREE.Material).dispose();
      (quad.material as THREE.Material).dispose();
      quad.geometry.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [active, runId]);

  if (!active) return null;

  return (
    <div
      ref={mountRef}
      className="fixed inset-0 z-[200] pointer-events-none"
      aria-hidden
    />
  );
}
