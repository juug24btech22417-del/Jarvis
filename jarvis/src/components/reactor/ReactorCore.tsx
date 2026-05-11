"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Sphere, Torus } from "@react-three/drei";
import * as THREE from "three";
import { useJarvisStore } from "@/store/jarvis.store";
import { getThemeConfig, syncThemeToCSS } from "@/lib/theme";

// === ICONIC BATMAN SYMBOL ===
// Classic oval bat - unmistakable silhouette
function createBatmanSymbolShape() {
  const shape = new THREE.Shape();

  // Classic bat shape with smooth curves
  // Start at bottom center of bat
  shape.moveTo(0, -0.7);

  // Right tail sweeping out
  shape.bezierCurveTo(0.2, -0.6, 0.4, -0.4, 0.6, -0.2);

  // Right wing scallop 1 (upward curve)
  shape.bezierCurveTo(0.8, 0, 0.9, 0.1, 1.0, 0.2);

  // Right wing tip to scallop 2
  shape.bezierCurveTo(0.85, 0.15, 0.75, 0.2, 0.65, 0.3);

  // To ear base
  shape.bezierCurveTo(0.5, 0.4, 0.45, 0.5, 0.4, 0.6);

  // Right ear (pointy)
  shape.lineTo(0.35, 0.9);
  shape.lineTo(0.25, 0.65);

  // Top of head curve
  shape.bezierCurveTo(0.15, 0.55, 0.08, 0.5, 0, 0.55);

  // Left ear (pointy)
  shape.lineTo(-0.25, 0.65);
  shape.lineTo(-0.35, 0.9);
  shape.lineTo(-0.4, 0.6);

  // Left side down
  shape.bezierCurveTo(-0.45, 0.5, -0.5, 0.4, -0.65, 0.3);

  // Left wing scallop 2
  shape.bezierCurveTo(-0.75, 0.2, -0.85, 0.15, -1.0, 0.2);

  // Left wing scallop 1
  shape.bezierCurveTo(-0.9, 0.1, -0.8, 0, -0.6, -0.2);

  // Left tail sweeping in
  shape.bezierCurveTo(-0.4, -0.4, -0.2, -0.6, 0, -0.7);

  return shape;
}

// === PROPER IRON MAN ARC REACTOR ===
// Movie-accurate circular design with 10 wedges and inner core
function createIronManReactorGeometry() {
  // Central bright core (white-blue glowing circle)
  const coreGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 32);

  // Inner blue glow ring
  const innerGlowGeo = new THREE.RingGeometry(0.13, 0.2, 32);

  // 10 triangular wedges - the iconic arc reactor segments
  const wedges: THREE.BufferGeometry[] = [];
  const wedgeCount = 10;
  const wedgeAngle = (Math.PI * 2) / wedgeCount;

  for (let i = 0; i < wedgeCount; i++) {
    const angle = i * wedgeAngle;
    const wedgeShape = new THREE.Shape();

    // Each wedge is a long triangle pointing to center
    // Narrow at center, wider at outer edge
    const innerRadius = 0.22;
    const outerRadius = 0.42;
    const halfWidthInner = 0.03;
    const halfWidthOuter = 0.08;

    // Points of the wedge
    wedgeShape.moveTo(
      Math.cos(angle - halfWidthInner / innerRadius) * innerRadius,
      Math.sin(angle - halfWidthInner / innerRadius) * innerRadius
    );
    wedgeShape.lineTo(
      Math.cos(angle - halfWidthOuter / outerRadius) * outerRadius,
      Math.sin(angle - halfWidthOuter / outerRadius) * outerRadius
    );
    wedgeShape.lineTo(
      Math.cos(angle + halfWidthOuter / outerRadius) * outerRadius,
      Math.sin(angle + halfWidthOuter / outerRadius) * outerRadius
    );
    wedgeShape.lineTo(
      Math.cos(angle + halfWidthInner / innerRadius) * innerRadius,
      Math.sin(angle + halfWidthInner / innerRadius) * innerRadius
    );
    wedgeShape.closePath();

    const geo = new THREE.ExtrudeGeometry(wedgeShape, {
      depth: 0.06,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.005,
      bevelSegments: 2,
    });

    wedges.push(geo);
  }

  // Gold circuit ring between wedges and outer housing
  const circuitRing = new THREE.TorusGeometry(0.48, 0.025, 16, 64);

  // Outer housing ring
  const outerRing = new THREE.TorusGeometry(0.52, 0.04, 16, 64);

  // Copper coil details
  const coils: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const coilGeo = new THREE.TorusGeometry(0.58 + i * 0.03, 0.008, 8, 48);
    coils.push(coilGeo);
  }

  return {
    coreGeo,
    innerGlowGeo,
    wedges,
    circuitRing,
    outerRing,
    coils,
  };
}

// === QUANTUM ORB ===
// Ethereal floating icosahedron with energy tendrils
function createQuantumOrbGeometry() {
  const geometry = new THREE.IcosahedronGeometry(0.35, 2);

  // Add vertex displacement for organic look
  const positions = geometry.attributes.position.array as Float32Array;
  const vertexCount = positions.length / 3;

  for (let i = 0; i < vertexCount; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];

    // Noise displacement
    const noise = Math.sin(x * 4) * Math.cos(y * 4) * 0.03 +
                 Math.sin(z * 6) * 0.02;

    positions[idx] += x * noise * 0.5;
    positions[idx + 1] += y * noise * 0.5;
    positions[idx + 2] += z * noise * 0.5;
  }

  geometry.computeVertexNormals();
  return geometry;
}

// === CLASSIC ARC REACTOR ===
// Standard 6 triangular segments
function createClassicArcGeometry() {
  const segments: THREE.BufferGeometry[] = [];
  const count = 6;

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const shape = new THREE.Shape();

    // Sleek triangle
    shape.moveTo(0, 0.12);
    shape.lineTo(-0.05, -0.2);
    shape.lineTo(0.05, -0.2);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.02,
      bevelSize: 0.01,
      bevelSegments: 3,
    });

    geo.translate(0, 0.32, 0);
    geo.rotateZ(angle);
    segments.push(geo);
  }

  return segments;
}

// Inner reactor component
function InnerReactor({ geometryType, themeConfig, state }: {
  geometryType: string;
  themeConfig: ReturnType<typeof getThemeConfig>;
  state: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const [time, setTime] = useState(0);

  useFrame((_, delta) => {
    setTime(t => t + delta);
    if (groupRef.current) {
      const speed = themeConfig.effects.pulseSpeed;
      groupRef.current.rotation.y += delta * 0.2 * speed;
      groupRef.current.rotation.z = Math.sin(time * speed * 0.5) * 0.03;
    }
  });

  const emissiveIntensity = state === "sleep" ? 0.3 : state === "thinking" ? 1.5 : 0.8;

  // Materials
  const coreMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: themeConfig.reactor.core,
    emissive: themeConfig.reactor.coreEmissive,
    emissiveIntensity: emissiveIntensity * themeConfig.typography.intensity,
    roughness: 0.05,
    metalness: 0.98,
  }), [themeConfig, emissiveIntensity]);

  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#FFD700",
    emissive: "#B8860B",
    emissiveIntensity: emissiveIntensity * 0.4,
    roughness: 0.15,
    metalness: 1,
  }), [emissiveIntensity]);

  const copperMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#B87333",
    emissive: "#8B4513",
    emissiveIntensity: emissiveIntensity * 0.2,
    roughness: 0.4,
    metalness: 0.9,
  }), [emissiveIntensity]);

  const whiteHotMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#FFFFFF",
  }), []);

  const brightBlueMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: "#00D4FF",
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  }), []);

  // Iron Man specific materials
  const ironRedMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: "#FF4444",
    emissive: "#FF0000",
    emissiveIntensity: emissiveIntensity * 2.0,
    roughness: 0.1,
    metalness: 0.95,
  }), [emissiveIntensity]);

  // Pre-generate all geometries
  const batShape = useMemo(() => createBatmanSymbolShape(), []);
  const batGeo = useMemo(() => new THREE.ExtrudeGeometry(batShape, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.01,
    bevelSegments: 4,
  }), [batShape]);

  const ironGeos = useMemo(() => createIronManReactorGeometry(), []);
  const orbGeo = useMemo(() => createQuantumOrbGeometry(), []);
  const segmentGeos = useMemo(() => createClassicArcGeometry(), []);

  // === BATMAN THEME ===
  if (geometryType === "bat-symbol") {
    return (
      <group ref={groupRef}>
        {/* Dark oval background behind the bat */}
        <mesh position={[0, 0, -0.05]} rotation={[0, 0, Math.PI]} scale={[1.2, 1, 1]}>
          <circleGeometry args={[0.95, 32]} />
          <meshStandardMaterial
            color="#1a1a1a"
            roughness={0.3}
            metalness={0.8}
          />
        </mesh>

        {/* The iconic BATMAN symbol - golden and LARGE */}
        <mesh geometry={batGeo} material={coreMaterial} rotation={[0, 0, Math.PI]} scale={1.2}>
        </mesh>

                {/* Glow aura behind the bat */}
        <mesh position={[0, 0, -0.02]} rotation={[0, 0, Math.PI]} scale={[1.1, 0.9, 1]}>
          <circleGeometry args={[0.9, 32]} />
          <meshBasicMaterial
            color="#FFD700"
            transparent
            opacity={0.15}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Pulsing dark rings for atmosphere */}
        <Torus args={[1.3, 0.015, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshBasicMaterial color="#FFD700" transparent opacity={0.2} />
        </Torus>
      </group>
    );
  }

  // === IRON MAN THEME ===
  if (geometryType === "iron-arc") {
    return (
      <group ref={groupRef}>
        {/* Central bright white core - the heart of the arc reactor */}
        <mesh geometry={ironGeos.coreGeo} material={whiteHotMaterial} position={[0, 0, 0.06]} scale={1.5}>
        </mesh>

        {/* Intense blue glow immediately around core - LARGER & BRIGHTER */}
        <mesh geometry={ironGeos.innerGlowGeo} material={brightBlueMaterial} position={[0, 0, 0.05]} rotation={[0, 0, time * 0.5]} scale={1.5}>
        </mesh>

        {/* The 10 glowing red wedges */}
        {ironGeos.wedges.map((geo, i) => (
          <mesh key={i} geometry={geo} material={ironRedMaterial} position={[0, 0, 0]} />
        ))}

        {/* Gold circuit ring */}
        <mesh geometry={ironGeos.circuitRing} material={goldMaterial} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.02]}>
        </mesh>

        {/* Outer gold housing */}
        <mesh geometry={ironGeos.outerRing} material={goldMaterial} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.03]}>
        </mesh>

        {/* Copper coils */}
        {ironGeos.coils.map((geo, i) => (
          <mesh key={i} geometry={geo} material={copperMaterial} rotation={[Math.PI / 2, 0, i * 0.3]} position={[0, 0, -0.05 - i * 0.01]}>
          </mesh>
        ))}

        {/* Intense glow sphere */}
        <Sphere args={[0.7, 32, 32]} position={[0, 0, 0]}>
          <meshBasicMaterial color="#00D4FF" transparent opacity={0.1} side={THREE.BackSide} />
        </Sphere>
      </group>
    );
  }

  // === QUANTUM THEME ===
  if (geometryType === "quantum-orb") {
    return (
      <group ref={groupRef}>
        {/* Main shifting orb */}
        <mesh geometry={orbGeo} material={coreMaterial} scale={1.1}>
        </mesh>

        {/* Inner bright crystalline core */}
        <mesh scale={0.5} rotation={[time * 0.3, time * 0.2, 0]}>
          <octahedronGeometry args={[0.25, 0]} />
          <meshStandardMaterial
            color="#FFFFFF"
            emissive="#FFFFFF"
            emissiveIntensity={3}
            transparent
            opacity={0.9}
          />
        </mesh>

        {/* Orbiting energy particles */}
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i / 8) * Math.PI * 2 + time * (0.5 + i * 0.1);
          const radius = 0.45 + Math.sin(time + i) * 0.05;
          return (
            <mesh key={i} position={[Math.cos(angle) * radius, Math.sin(angle) * radius, 0]}>
              <sphereGeometry args={[0.04, 16, 16]} />
              <meshBasicMaterial color={i % 2 === 0 ? themeConfig.colors.primary : themeConfig.colors.secondary} />
            </mesh>
          );
        })}

        {/* Energy rings */}
        {Array.from({ length: 4 }).map((_, i) => (
          <Torus
            key={i}
            args={[0.55 + i * 0.12, 0.008, 8, 32]}
            rotation={[Math.PI / 2, time * (i + 1) * 0.15, i * Math.PI / 4]}
          >
            <meshBasicMaterial
              color={i % 2 === 0 ? themeConfig.colors.glow : themeConfig.colors.primary}
              transparent
              opacity={0.25 - i * 0.05}
            />
          </Torus>
        ))}
      </group>
    );
  }

  // === CLASSIC ARC (Default) ===
  return (
    <group ref={groupRef}>
      {/* Central sphere */}
      <Sphere args={[0.2, 32, 32]} material={coreMaterial} />

      {/* 6 triangular segments */}
      {segmentGeos.map((geo, i) => (
        <mesh key={i} geometry={geo} material={coreMaterial} />
      ))}

      {/* Outer glow ring */}
      <Torus args={[0.5, 0.025, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={themeConfig.colors.glow} transparent opacity={0.4} />
      </Torus>
    </group>
  );
}

export default function ReactorCore() {
  const coreRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const { state, theme } = useJarvisStore();
  const [themeConfig, setThemeConfig] = useState(getThemeConfig(theme));

  useEffect(() => {
    setThemeConfig(getThemeConfig(theme));
    syncThemeToCSS(theme);
  }, [theme]);

  useFrame(() => {
    if (!coreRef.current || !glowRef.current || !lightRef.current) return;

    const time = Date.now() * 0.001 * themeConfig.effects.pulseSpeed;

    switch (state) {
      case "idle":
        const idlePulse = 0.85 + Math.sin(time * 2) * 0.15;
        coreRef.current.scale.setScalar(idlePulse);
        glowRef.current.scale.setScalar(0.9 + idlePulse * 0.15);
        lightRef.current.intensity = (0.6 + idlePulse * 0.4) * themeConfig.typography.intensity;
        break;
      case "listening":
        const listenPulse = 0.92 + Math.sin(time * 5) * 0.08;
        coreRef.current.scale.setScalar(listenPulse);
        glowRef.current.scale.setScalar(1.05 + listenPulse * 0.1);
        lightRef.current.intensity = (1.3 + listenPulse * 0.3) * themeConfig.typography.intensity;
        break;
      case "thinking":
        const flicker = 0.88 + Math.random() * 0.24;
        coreRef.current.scale.setScalar(flicker);
        glowRef.current.scale.setScalar(1.08 + flicker * 0.12);
        lightRef.current.intensity = (1.6 + flicker * 0.4) * themeConfig.typography.intensity;
        break;
      case "speaking":
        const voicePulse = 0.92 + Math.sin(time * 10) * 0.12;
        coreRef.current.scale.setScalar(voicePulse);
        glowRef.current.scale.setScalar(0.95 + voicePulse * 0.12);
        lightRef.current.intensity = (1.2 + voicePulse * 0.4) * themeConfig.typography.intensity;
        break;
      case "sleep":
        coreRef.current.scale.setScalar(0.65);
        glowRef.current.scale.setScalar(0.75);
        lightRef.current.intensity = 0.15;
        break;
    }
  });

  const glowMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(themeConfig.colors.glow),
    transparent: true,
    opacity: themeConfig.background.particleOpacity * 0.6,
    side: THREE.BackSide,
  }), [themeConfig]);

  const brightness = useMemo(() => {
    const base = state === "sleep" ? 0.3 : state === "idle" ? 0.8 : state === "listening" ? 1.2 : state === "thinking" ? 1.5 : 1;
    return base * themeConfig.typography.intensity;
  }, [state, themeConfig]);

  return (
    <group>
      <group ref={coreRef}>
        <InnerReactor geometryType={themeConfig.reactor.geometry} themeConfig={themeConfig} state={state} />
      </group>
      <Sphere ref={glowRef} args={[0.85, 32, 32]} position={[0, 0, 0]} material={glowMaterial} />
      <pointLight ref={lightRef} position={[0, 0, 0]} color={themeConfig.reactor.core} intensity={brightness} distance={25} decay={2} />
      <pointLight position={[0, 0, 0.5]} color={themeConfig.colors.accent} intensity={brightness * 0.6} distance={20} decay={1.5} />
    </group>
  );
}
