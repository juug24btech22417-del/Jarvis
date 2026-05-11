"use client";

import { useRef, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { motion } from "framer-motion";
import ReactorCore from "./ReactorCore";
import EnergyRings from "./EnergyRings";
import ReactorParticles from "./ReactorParticles";
import { useJarvisStore } from "@/store/jarvis.store";
import { getThemeConfig, ThemeConfig } from "@/lib/theme";

// Camera controller for subtle mouse tracking
function CameraController() {
  const { camera } = useThree();
  const mouseRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = (e.clientX / window.innerWidth - 0.5) * 0.5;
      mouseRef.current.y = (e.clientY / window.innerHeight - 0.5) * 0.5;
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useFrame(() => {
    camera.position.x += (mouseRef.current.x - camera.position.x) * 0.02;
    camera.position.y += (-mouseRef.current.y - camera.position.y) * 0.02;
    camera.lookAt(0, 0, 0);
  });

  return null;
}

// Theme fog effect
function ThemeFog({ themeConfig }: { themeConfig: ThemeConfig }) {
  const { scene } = useThree();

  useEffect(() => {
    scene.fog = new THREE.FogExp2(
      new THREE.Color(themeConfig.background.gradientVia),
      themeConfig.effects.fogDensity
    );

    return () => {
      scene.fog = null;
    };
  }, [scene, themeConfig]);

  return null;
}

// Inner reactor scene
function ReactorScene() {
  const groupRef = useRef<THREE.Group>(null);
  const { state, bootProgress, theme } = useJarvisStore();
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(getThemeConfig(theme));

  useEffect(() => {
    setThemeConfig(getThemeConfig(theme));
  }, [theme]);

  useFrame(() => {
    if (!groupRef.current) return;

    // Subtle rotation of the entire reactor - varies by theme
    const time = Date.now() * 0.0005 * themeConfig.effects.pulseSpeed;
    const speed = state === "sleep" ? 0.1 : 0.5;
    groupRef.current.rotation.y = time * speed;
    groupRef.current.rotation.x = Math.sin(time * 0.5) * 0.1;

    // Scale based on boot progress
    const bootScale = Math.min(1, bootProgress / 100);
    groupRef.current.scale.setScalar(bootScale);
  });

  return (
    <group ref={groupRef}>
      {/* Ambient lighting - theme colored */}
      <ambientLight intensity={0.2} color={themeConfig.reactor.ambient} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={0.4 * themeConfig.typography.intensity}
        color={themeConfig.reactor.core}
      />
      <directionalLight
        position={[-10, -10, -5]}
        intensity={0.2}
        color={themeConfig.reactor.ambient}
      />

      {/* Fog effect */}
      <ThemeFog themeConfig={themeConfig} />

      {/* Core reactor components */}
      <ReactorCore />
      <EnergyRings />
      <ReactorParticles />

      {/* Spotlight from above */}
      <spotLight
        position={[0, 10, 0]}
        angle={Math.PI / 6}
        penumbra={1}
        intensity={0.4 * themeConfig.typography.intensity}
        color={themeConfig.reactor.core}
        distance={30}
        decay={2}
        castShadow
      />

      {/* Secondary accent light */}
      <pointLight
        position={[5, 5, 5]}
        color={themeConfig.colors.accent}
        intensity={0.3}
        distance={20}
        decay={2}
      />
    </group>
  );
}

export default function ArcReactor() {
  const { setState, setBootProgress, bootComplete, setBootComplete } =
    useJarvisStore();
  const [isClient, setIsClient] = useState(false);
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(getThemeConfig("arc-blue"));

  useEffect(() => {
    setIsClient(true);

    // Initial theme
    setThemeConfig(getThemeConfig());

    // Boot sequence
    const bootSequence = async () => {
      const steps = [
        { progress: 0, delay: 0 },
        { progress: 10, delay: 500 },
        { progress: 30, delay: 1000 },
        { progress: 50, delay: 1800 },
        { progress: 70, delay: 2500 },
        { progress: 85, delay: 3000 },
        { progress: 100, delay: 3500 },
      ];

      for (const step of steps) {
        await new Promise((resolve) =>
          setTimeout(resolve, step.delay - (steps[steps.indexOf(step) - 1]?.delay || 0))
        );
        setBootProgress(step.progress);
      }

      setBootComplete(true);
      setState("idle");
    };

    bootSequence();
  }, [setBootProgress, setBootComplete, setState]);

  if (!isClient) return null;

  return (
    <motion.div
      className="absolute inset-0 z-10 cursor-pointer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 1 }}
      onClick={() => {
        if (!bootComplete) return;
        const currentState = useJarvisStore.getState().state;
        setState(currentState === "sleep" ? "idle" : "sleep");
      }}
    >
      <Canvas
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        style={{
          background: "transparent",
        }}
      >
        <PerspectiveCamera makeDefault position={[0, 0, 8]} fov={45} />
        <CameraController />
        <ReactorScene />
      </Canvas>

      {/* Click hint - theme colored */}
      {bootComplete && (
        <motion.div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs font-rajdhani tracking-widest opacity-50"
          style={{ color: themeConfig.panels.textSecondary }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.5 }}
          transition={{ delay: 6 }}
        >
          CLICK TO WAKE
        </motion.div>
      )}
    </motion.div>
  );
}
