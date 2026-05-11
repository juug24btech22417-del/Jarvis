"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useJarvisStore } from "@/store/jarvis.store";
import { getThemeConfig, ThemeConfig } from "@/lib/theme";

const PARTICLE_COUNT = 800;

export default function ReactorParticles() {
  const pointsRef = useRef<THREE.Points>(null);
  const { state, voiceLevel, theme } = useJarvisStore();
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(getThemeConfig(theme));
  const timeRef = useRef(0);

  useEffect(() => {
    setThemeConfig(getThemeConfig(theme));
  }, [theme]);

  const isBatman = themeConfig.reactor.geometry === "bat-symbol";
  const isIronMan = themeConfig.reactor.geometry === "iron-arc";
  const isQuantum = themeConfig.reactor.geometry === "quantum-orb";

  // Generate particles
  const [positions, velocities] = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let theta, phi, radius;

      if (isBatman) {
        // Batman: Sparse, concentrated, moody particles
        theta = Math.random() * Math.PI * 2;
        phi = Math.acos(2 * Math.random() - 1);
        radius = 2 + Math.random() * 4;
      } else if (isIronMan) {
        // Iron Man: More uniform circular distribution
        theta = Math.random() * Math.PI * 2;
        phi = Math.acos(2 * Math.random() - 1);
        radius = 2.5 + Math.random() * 7;
      } else if (isQuantum) {
        // Quantum: Chaotic, dispersed everywhere
        theta = Math.random() * Math.PI * 4;
        phi = Math.random() * Math.PI;
        radius = 2 + Math.random() * 14;
      } else {
        // Default
        theta = Math.random() * Math.PI * 2;
        phi = Math.acos(2 * Math.random() - 1);
        radius = 3 + Math.random() * 10;
      }

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);

      const speedMult = isQuantum ? 1.5 : isBatman ? 0.6 : 1;
      velocities[i * 3] = (Math.random() - 0.5) * 0.01 * speedMult;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.01 * speedMult;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01 * speedMult;
    }

    return [positions, velocities];
  }, [isBatman, isIronMan, isQuantum, themeConfig]);

  // Theme-specific colors
  const colors = useMemo(() => {
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const baseColor = new THREE.Color(themeConfig.reactor.particle);

    let secondaryColor: THREE.Color;
    if (isIronMan) {
      secondaryColor = new THREE.Color("#FFD700");
    } else if (isQuantum) {
      secondaryColor = new THREE.Color(themeConfig.colors.secondary);
    } else if (isBatman) {
      secondaryColor = new THREE.Color("#444444");
    } else {
      secondaryColor = baseColor;
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const mixRatio = isBatman ? Math.random() * 0.3 : Math.random() * 0.6;
      const r = THREE.MathUtils.lerp(baseColor.r, secondaryColor.r, mixRatio);
      const g = THREE.MathUtils.lerp(baseColor.g, secondaryColor.g, mixRatio);
      const b = THREE.MathUtils.lerp(baseColor.b, secondaryColor.b, mixRatio);

      const variation = (Math.random() - 0.5) * 0.15;
      colors[i * 3] = Math.max(0, Math.min(1, r + variation));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, g + variation));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, b + variation));
    }

    return colors;
  }, [themeConfig, isBatman, isIronMan, isQuantum]);

  // Theme-specific sizes
  const sizes = useMemo(() => {
    const sizes = new Float32Array(PARTICLE_COUNT);
    const baseSize = isBatman ? 0.012 : 0.02;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      sizes[i] = baseSize + Math.random() * (isBatman ? 0.04 : 0.06);
    }
    return sizes;
  }, [isBatman]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;

    timeRef.current += delta * themeConfig.effects.scanSpeed;
    const positions = pointsRef.current.geometry.attributes.position.array as Float32Array;

    const drift = state === "sleep" ? 0.2 : 1;
    const expansion = voiceLevel * 0.5;
    const time = timeRef.current;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;

      let driftX = velocities[i3] * drift;
      let driftY = velocities[i3 + 1] * drift;
      let driftZ = velocities[i3 + 2] * drift;

      if (isQuantum) {
        driftX += Math.sin(time + i * 0.1) * 0.002;
        driftY += Math.cos(time + i * 0.15) * 0.002;
      }

      if (isBatman) {
        driftX *= 0.4;
        driftY *= 0.4;
        driftZ *= 0.4;
      }

      positions[i3] += driftX;
      positions[i3 + 1] += driftY;
      positions[i3 + 2] += driftZ;

      const distance = Math.sqrt(positions[i3] ** 2 + positions[i3 + 1] ** 2 + positions[i3 + 2] ** 2);

      const maxDist = isQuantum ? 20 : 15;
      if (distance < maxDist + expansion) {
        positions[i3] *= 1 + expansion * 0.01;
        positions[i3 + 1] *= 1 + expansion * 0.01;
        positions[i3 + 2] *= 1 + expansion * 0.01;
      }

      if (distance > maxDist) {
        const scale = (isBatman ? 2 : 3) / distance;
        positions[i3] *= scale;
        positions[i3 + 1] *= scale;
        positions[i3 + 2] *= scale;
      }
    }

    pointsRef.current.geometry.attributes.position.needsUpdate = true;
  });

  const opacity = useMemo(() => {
    const baseOpacity = isBatman ? themeConfig.background.particleOpacity * 0.5 : themeConfig.background.particleOpacity;
    return state === "sleep" ? baseOpacity * 0.3 : baseOpacity;
  }, [themeConfig, state, isBatman]);

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={PARTICLE_COUNT} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={PARTICLE_COUNT} array={colors} itemSize={3} />
        <bufferAttribute attach="attributes-size" count={PARTICLE_COUNT} array={sizes} itemSize={1} />
      </bufferGeometry>
      <pointsMaterial
        size={isQuantum ? 0.045 : isBatman ? 0.025 : 0.035}
        vertexColors
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
