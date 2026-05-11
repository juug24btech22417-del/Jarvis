"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Torus } from "@react-three/drei";
import * as THREE from "three";
import { useJarvisStore } from "@/store/jarvis.store";
import { getThemeConfig, ThemeConfig } from "@/lib/theme";

interface RingProps {
  radius: number;
  tube: number;
  rotationSpeed: number;
  rotationAxis: [number, number, number];
  index: number;
  state: string;
  themeConfig: ThemeConfig;
}

function EnergyRing({
  radius,
  tube,
  rotationSpeed,
  rotationAxis,
  index,
  state,
  themeConfig,
}: RingProps) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!ringRef.current) return;
    const speedMultiplier = themeConfig.effects.scanSpeed;
    const baseSpeed = state === "sleep" ? rotationSpeed * 0.1 : rotationSpeed;
    const speed = state === "thinking" ? baseSpeed * 3 : state === "listening" ? baseSpeed * 1.5 : baseSpeed;
    ringRef.current.rotation.x += rotationAxis[0] * speed * speedMultiplier * delta;
    ringRef.current.rotation.y += rotationAxis[1] * speed * speedMultiplier * delta;
    ringRef.current.rotation.z += rotationAxis[2] * speed * speedMultiplier * delta;
  });

  const material = useMemo(() => {
    const colors = [themeConfig.reactor.innerRing, themeConfig.reactor.middleRing, themeConfig.reactor.outerRing];
    const emissive = [themeConfig.colors.secondary, themeConfig.colors.dim, themeConfig.colors.dim];
    return new THREE.MeshStandardMaterial({
      color: colors[index] || themeConfig.colors.primary,
      emissive: emissive[index] || themeConfig.colors.secondary,
      emissiveIntensity: state === "sleep" ? 0.15 : 0.6 * themeConfig.typography.intensity,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0.9,
    });
  }, [index, themeConfig, state]);

  return (
    <Torus ref={ringRef} args={[radius, tube, 16, 100]} rotation={[Math.PI / 2, 0, 0]} material={material} />
  );
}

export default function EnergyRings() {
  const { state, theme } = useJarvisStore();
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(getThemeConfig(theme));

  useEffect(() => {
    setThemeConfig(getThemeConfig(theme));
  }, [theme]);

  const isBatman = themeConfig.reactor.geometry === "bat-symbol";
  const isIronMan = themeConfig.reactor.geometry === "iron-arc";
  const isQuantum = themeConfig.reactor.geometry === "quantum-orb";

  // Ring configurations
  const rings = useMemo(() => {
    // Batman: Minimal, dark, elegant rings
    if (isBatman) {
      return [
        { radius: 0.9, tube: 0.015, rotationSpeed: 0.3, rotationAxis: [0, 1, 0.2] as [number, number, number], index: 0 },
        { radius: 1.4, tube: 0.008, rotationSpeed: 0.15, rotationAxis: [0.3, 0.8, -0.5] as [number, number, number], index: 1 },
      ];
    }

    // Iron Man: More rings, gold accents
    if (isIronMan) {
      return [
        { radius: 0.75, tube: 0.02, rotationSpeed: 0.6, rotationAxis: [0.5, 1, 0.3] as [number, number, number], index: 0 },
        { radius: 1.1, tube: 0.03, rotationSpeed: 0.4, rotationAxis: [-0.3, 0.8, -0.5] as [number, number, number], index: 1 },
        { radius: 1.45, tube: 0.035, rotationSpeed: 0.25, rotationAxis: [0.2, -0.5, 0.8] as [number, number, number], index: 2 },
      ];
    }

    // Quantum: Many floating ethereal rings
    if (isQuantum) {
      return [
        { radius: 0.8, tube: 0.012, rotationSpeed: 0.8, rotationAxis: [1, 0.5, 0.3] as [number, number, number], index: 0 },
        { radius: 1.2, tube: 0.015, rotationSpeed: 0.5, rotationAxis: [-0.5, 1, -0.3] as [number, number, number], index: 1 },
        { radius: 1.6, tube: 0.01, rotationSpeed: 0.35, rotationAxis: [0.3, -0.8, 0.5] as [number, number, number], index: 2 },
      ];
    }

    // Default
    return [
      { radius: 0.75, tube: 0.025, rotationSpeed: 0.5, rotationAxis: [0.5, 1, 0.3] as [number, number, number], index: 0 },
      { radius: 1.0, tube: 0.035, rotationSpeed: 0.3, rotationAxis: [-0.3, 0.8, -0.5] as [number, number, number], index: 1 },
      { radius: 1.3, tube: 0.045, rotationSpeed: 0.15, rotationAxis: [0.2, -0.5, 0.8] as [number, number, number], index: 2 },
    ];
  }, [isBatman, isIronMan, isQuantum]);

  const outerRingMaterial = useMemo(() =>
    new THREE.MeshStandardMaterial({
      color: isBatman ? "#1a1a1a" : themeConfig.panels.bracketColor,
      roughness: 0.3,
      metalness: 0.9,
      emissive: themeConfig.colors.dim,
      emissiveIntensity: state === "sleep" ? 0.05 : 0.2,
    }),
    [isBatman, themeConfig, state]
  );

  // Batman: Very minimal, just one accent ring
  if (isBatman) {
    return (
      <group>
        {rings.map((ring, index) => (
          <EnergyRing key={index} {...ring} state={state} themeConfig={themeConfig} />
        ))}
        {/* Dark accent ring */}
        <Torus args={[1.6, 0.01, 16, 64]} rotation={[Math.PI / 2, 0, 0]} material={outerRingMaterial} />
      </group>
    );
  }

  return (
    <group>
      {rings.map((ring, index) => (
        <EnergyRing key={index} {...ring} state={state} themeConfig={themeConfig} />
      ))}

      {/* Outer decorative ring */}
      <Torus args={[1.55, 0.05, 16, 100]} rotation={[Math.PI / 2, 0, 0]} material={outerRingMaterial} />

      {/* Iron Man: Gold accent ring */}
      {isIronMan && (
        <Torus args={[1.7, 0.015, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#FFD700" emissive="#B8860B" emissiveIntensity={0.4} metalness={1} roughness={0.2} />
        </Torus>
      )}

      {/* Quantum: Floating energy wisps */}
      {isQuantum && (
        <>
          {Array.from({ length: 4 }).map((_, i) => (
            <Torus key={`wisp-${i}`} args={[1.9 + i * 0.08, 0.004, 8, 32]} rotation={[Math.PI / 2 + i * 0.15, 0, i * Math.PI / 3]}>
              <meshBasicMaterial color={i % 2 === 0 ? themeConfig.colors.glow : themeConfig.colors.primary} transparent opacity={0.2 - i * 0.04} />
            </Torus>
          ))}
        </>
      )}
    </group>
  );
}
