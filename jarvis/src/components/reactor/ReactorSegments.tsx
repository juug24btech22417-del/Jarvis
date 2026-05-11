"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Cone } from "@react-three/drei";
import * as THREE from "three";
import { useJarvisStore } from "@/store/jarvis.store";
import { getThemeConfig, ThemeConfig } from "@/lib/theme";

interface SegmentProps {
  angle: number;
  index: number;
  themeConfig: ThemeConfig;
  state: string;
}

function ReactorSegment({ angle, index, themeConfig, state }: SegmentProps) {
  const segmentRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!segmentRef.current) return;
    const time = Date.now() * 0.001;
    const baseSpeed = state === "sleep" ? 0.1 : 0.3;
    const speed = state === "thinking" ? baseSpeed * 4 : state === "listening" ? baseSpeed * 2 : baseSpeed;
    segmentRef.current.rotation.z = angle + Math.sin(time * speed + index) * 0.05;
  });

  const radius = 0.55;
  const x = Math.cos(angle) * radius;
  const y = Math.sin(angle) * radius;

  const material = useMemo(() =>
    new THREE.MeshStandardMaterial({
      color: themeConfig.colors.primary,
      emissive: themeConfig.reactor.coreEmissive,
      emissiveIntensity: state === "sleep" ? 0.3 : 0.8 * themeConfig.typography.intensity,
      roughness: 0.2,
      metalness: 0.9,
      transparent: true,
      opacity: 0.95,
    }),
    [themeConfig, state]
  );

  return (
    <Cone
      ref={segmentRef}
      args={[0.12, 0.4, 3]}
      position={[x, y, 0]}
      rotation={[0, 0, angle + Math.PI / 2]}
      material={material}
    />
  );
}

export default function ReactorSegments() {
  const { state, theme } = useJarvisStore();
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(getThemeConfig(theme));

  useEffect(() => {
    setThemeConfig(getThemeConfig(theme));
  }, [theme]);

  // Segments are always computed (hook order rule), but only rendered when needed
  const segments = useMemo(() => {
    const count = 6;
    return Array.from({ length: count }, (_, i) => ({
      angle: (i / count) * Math.PI * 2,
      index: i,
    }));
  }, []);

  // Batman and Iron Man have complete symbols - no segments needed
  if (themeConfig.reactor.geometry === "bat-symbol" || themeConfig.reactor.geometry === "iron-arc") {
    return null;
  }

  return (
    <group>
      {segments.map((segment) => (
        <ReactorSegment
          key={segment.index}
          angle={segment.angle}
          index={segment.index}
          themeConfig={themeConfig}
          state={state}
        />
      ))}
    </group>
  );
}
