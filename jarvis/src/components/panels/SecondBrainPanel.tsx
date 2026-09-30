"use client";

// Second Brain — the memory graph as an explorable 3D constellation.
//
// Every entity is a star, sized by how vivid the memory is and coloured by
// type; edges are relationships, strong ones brighter. Clusters are laid out
// on a golden-angle sphere per entity type, then relaxed so related memories
// orbit each other.
//
// Gestures: drag to orbit · wheel/pinch to zoom · click to focus a star ·
// double-click to PIN · right-click (or long-press) to FORGET · keyboard
// P/F/R/Esc/arrows. An air-mouse or gesture cursor drives the OS pointer, so
// hovering/clicking with gestures works here for free.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Brain, Search, RefreshCw, Loader2, Pin, PinOff, Eraser, Zap, RotateCcw, Eye, EyeOff, Layers,
} from "lucide-react";
import {
  buildConstellation,
  type Constellation,
  type ConstellationNode,
  type GraphLinkInput,
  type GraphNodeInput,
} from "@/lib/memory/layout";

interface GraphResponse {
  nodes: GraphNodeInput[];
  links: GraphLinkInput[];
  stats: { total: number; links: number; pinned: number; archived: number; byType: Record<string, number> };
}

interface SecondBrainPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ─────────────────────────── 3D scene ─────────────────────────── */

function haloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.45)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

const DIM = new THREE.Color("#1c2635");

interface SceneProps {
  constellation: Constellation;
  selected: string | null;
  hovered: string | null;
  query: string;
  showArchived: boolean;
  isolated: string | null;
  autoOrbit: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string | null) => void;
  onPin: (id: string) => void;
  onForget: (id: string) => void;
}

function Constellation({
  constellation,
  selected,
  hovered,
  query,
  showArchived,
  isolated,
  autoOrbit,
  onHover,
  onSelect,
  onPin,
  onForget,
}: SceneProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const { nodes } = constellation;
  const sprite = useMemo(() => haloTexture(), []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return nodes.filter((n) => {
      if (!showArchived && n.archived) return false;
      if (isolated && n.cluster !== isolated) return false;
      return true;
    });
  }, [nodes, query, showArchived, isolated]);

  const matches = useCallback(
    (n: ConstellationNode) => {
      const q = query.trim().toLowerCase();
      return !q || n.name.toLowerCase().includes(q) || (n.description ?? "").toLowerCase().includes(q);
    },
    [query]
  );

  // Lay the instances out once (and whenever the visible set changes).
  useEffect(() => {
    const mesh = meshRef.current;
    const points = pointsRef.current;
    if (!mesh || !points) return;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const positions = new Float32Array(Math.max(1, visible.length) * 3);
    const colors = new Float32Array(Math.max(1, visible.length) * 3);
    const sizes = new Float32Array(Math.max(1, visible.length));

    visible.forEach((n, i) => {
      const isHot = n.id === selected || n.id === hovered;
      const lit = matches(n) || isHot;
      const scale = n.radius * (lit ? 1 : 0.55) * (isHot ? 1.55 : 1);
      dummy.position.set(n.x, n.y, n.z);
      dummy.scale.setScalar(Math.max(0.14, scale));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.set(lit ? n.color : DIM.getHexString());
      if (n.archived) color.multiplyScalar(0.6);
      mesh.setColorAt(i, color);

      positions[i * 3] = n.x;
      positions[i * 3 + 1] = n.y;
      positions[i * 3 + 2] = n.z;
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      sizes[i] = Math.max(0.9, n.radius * (lit ? 2.6 : 1.4));
    });

    mesh.count = visible.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    const geo = points.geometry as THREE.BufferGeometry;
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("psize", new THREE.BufferAttribute(sizes, 1));
    geo.computeBoundingSphere();
  }, [visible, selected, hovered, matches]);

  // Links.
  const linkGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const indexById = new Map(visible.map((n, i) => [n.id, i]));
    const pos: number[] = [];
    const col: number[] = [];
    for (const l of constellation.links) {
      const a = visible[l.a];
      const b = visible[l.b];
      if (!a || !b) continue;
      if (indexById.get(a.id) === undefined || indexById.get(b.id) === undefined) continue;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const alpha = 0.14 + l.strength * 0.5;
      col.push(0.35, 0.72, 0.92, 0.35, 0.72, 0.92);
      void alpha;
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }, [constellation.links, visible]);

  // Gentle living motion: the whole field breathes and drifts.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.rotation.y += autoOrbit ? 0.00085 : 0.00012;
      groupRef.current.rotation.x = Math.sin(t * 0.06) * 0.06;
      const breathe = 1 + Math.sin(t * 0.5) * 0.008;
      groupRef.current.scale.setScalar(breathe);
    }
    if (pointsRef.current) {
      const m = pointsRef.current.material as THREE.PointsMaterial;
      m.opacity = 0.5 + Math.sin(t * 0.9) * 0.08;
    }
    const sel = selected ? visible.find((n) => n.id === selected) : null;
    if (ringRef.current && sel) {
      ringRef.current.position.set(sel.x, sel.y, sel.z);
      const s = 1 + Math.sin(t * 2.2) * 0.08;
      ringRef.current.scale.setScalar(s);
      ringRef.current.lookAt(state.camera.position);
    }
  });

  const selectedNode = selected ? visible.find((n) => n.id === selected) ?? null : null;
  const hoveredNode = hovered ? visible.find((n) => n.id === hovered) ?? null : null;
  // Every memory is named beside its circle. Pinned and selected ones stay
  // loud; the rest stay quiet and only show up when they match a search.
  const labelNodes = [
    ...(selectedNode ? [selectedNode] : []),
    ...visible.filter((n) => n.pinned),
    ...visible.filter((n) => !n.pinned && matches(n)).sort((a, b) => b.strength - a.strength),
  ].slice(0, 40);

  const handlePointer = (e: { instanceId?: number; stopPropagation: () => void }, kind: "move" | "click" | "double" | "context") => {
    const i = e.instanceId;
    if (typeof i !== "number" || !visible[i]) return;
    const node = visible[i];
    e.stopPropagation();
    if (kind === "move") onHover(node.id);
    else if (kind === "click") onSelect(node.id === selected ? null : node.id);
    else if (kind === "double") onPin(node.id);
    else onForget(node.id);
  };

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, Math.max(1, nodes.length)]}
        onPointerMove={(e) => handlePointer(e, "move")}
        onPointerOut={() => onHover(null)}
        onClick={(e) => handlePointer(e, "click")}
        onDoubleClick={(e) => handlePointer(e, "double")}
        onContextMenu={(e) => handlePointer(e, "context")}
      >
        <sphereGeometry args={[1, 14, 14]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <points ref={pointsRef}>
        <bufferGeometry />
        <pointsMaterial
          size={1.5}
          sizeAttenuation
          map={sprite}
          transparent
          depthWrite={false}
          vertexColors
          blending={THREE.AdditiveBlending}
          opacity={0.55}
        />
      </points>

      <lineSegments geometry={linkGeometry}>
        <lineBasicMaterial vertexColors transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>

      <mesh ref={ringRef} visible={!!selectedNode}>
        <torusGeometry args={[1.5, 0.035, 8, 48]} />
        <meshBasicMaterial color="#8be9ff" transparent opacity={0.9} toneMapped={false} />
      </mesh>

      {/* Cluster glows: a soft halo at each constellation centre. */}
      {constellation.clusters.map((c) => (
        <mesh key={c.type} position={c.center}>
          <sphereGeometry args={[c.radius * 0.92, 16, 16]} />
          <meshBasicMaterial color={c.color} transparent opacity={0.035} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}

      {Array.from(new Map(labelNodes.map((n) => [n.id, n])).values()).map((n) => {
        const hero = n.pinned || n.id === selected;
        return (
          <Html key={`lbl-${n.id}`} position={[n.x, n.y + n.radius + 0.9, n.z]} center distanceFactor={38} zIndexRange={[20, 0]}>
            <button
              onClick={() => onSelect(n.id === selected ? null : n.id)}
              title={`Select ${n.name}`}
              className={`pointer-events-auto cursor-pointer px-1.5 py-0.5 rounded-full font-rajdhani whitespace-nowrap border transition-all hover:scale-105 ${
                hero ? "text-[10px]" : "text-[9px] opacity-60 hover:opacity-100"
              }`}
              style={{
                color: n.color,
                borderColor: `${n.color}${hero ? "55" : "2e"}`,
                background: "rgba(4,8,16,0.6)",
                boxShadow: hero ? `0 0 18px ${n.color}33` : "none",
              }}
            >
              {n.pinned ? "📌 " : ""}
              {n.name.slice(0, 26)}
            </button>
          </Html>
        );
      })}
    </group>
  );
}

/** Frames the camera to the graph extent once nodes arrive. */
function CameraRig({ extent }: { extent: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const dist = Math.min(320, Math.max(26, extent * 2.1));
    camera.position.set(dist * 0.35, dist * 0.22, dist);
    camera.lookAt(0, 0, 0);
  }, [camera, extent]);
  return null;
}

/* ─────────────────────────── panel ─────────────────────────── */

export default function SecondBrainPanel({ isOpen, onClose }: SecondBrainPanelProps) {
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [isolated, setIsolated] = useState<string | null>(null);
  const [autoOrbit, setAutoOrbit] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [confirmForget, setConfirmForget] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setMounted(true), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/memory/graph?includeArchived=${showArchived ? 1 : 0}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setGraph(data as GraphResponse);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const constellation = useMemo(
    () => (graph ? buildConstellation(graph.nodes, graph.links) : null),
    [graph]
  );

  const act = useCallback(
    async (action: string, id: string, extra?: Record<string, unknown>) => {
      setBusy(true);
      try {
        await fetch("/api/memory/graph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, id, ...extra }),
        });
        await load();
      } catch {
        // ignore — reload shows the truth
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const node = useMemo(
    () => (selected ? constellation?.nodes.find((n) => n.id === selected) ?? null : null),
    [selected, constellation]
  );

  const connectionCount = useMemo(() => {
    if (!graph || !selected) return 0;
    return graph.links.filter((l) => l.source === selected || l.target === selected).length;
  }, [graph, selected]);

  const forget = useCallback(
    (id: string) => {
      if (confirmForget === id) {
        setConfirmForget(null);
        setSelected(null);
        void act("forget", id);
      } else {
        setConfirmForget(id);
      }
    },
    [confirmForget, act]
  );

  // Keyboard gestures.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selected) setSelected(null);
        else onClose();
      }
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (!selected) return;
      if (e.key === "p" || e.key === "P") void act(node?.pinned ? "unpin" : "pin", selected);
      if (e.key === "f" || e.key === "F") forget(selected);
      if (e.key === "r" || e.key === "R") void act("reinforce", selected);
    };    // Capture phase so the command bar's global Escape (emergency stop) can
    // never swallow the panel's own shortcuts.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);


  }, [isOpen, selected, node, act, forget, onClose]);

  const stats = graph?.stats;
  const clusters = constellation?.clusters ?? [];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.7 }}
          className="fixed inset-0 z-50 bg-black"
        >
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(0,243,255,0.10),transparent_60%),radial-gradient(45%_45%_at_85%_90%,rgba(124,92,255,0.14),transparent_65%),radial-gradient(120%_90%_at_50%_50%,#050a16_0%,#02040a_70%)]" />
          <div className="absolute inset-0 pointer-events-none opacity-[0.07] bg-[linear-gradient(rgba(0,243,255,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(0,243,255,0.5)_1px,transparent_1px)] bg-[size:64px_64px]" />

          {/* canvas layer */}
          <div
            className="absolute inset-0"
            onContextMenu={(e) => e.preventDefault()}
          >
            {mounted && constellation && constellation.nodes.length > 0 && (
              <Canvas
                dpr={[1, 2]}
                camera={{ fov: 45, near: 0.1, far: 4000 }}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
              >
                <CameraRig extent={constellation.extent} />
                <Constellation
                  constellation={constellation}
                  selected={selected}
                  hovered={hovered}
                  query={query}
                  showArchived={showArchived}
                  isolated={isolated}
                  autoOrbit={autoOrbit}
                  onHover={setHovered}
                  onSelect={setSelected}
                  onPin={(id) => {
                    const n = constellation.nodes.find((x) => x.id === id);
                    void act(n?.pinned ? "unpin" : "pin", id);
                  }}
                  onForget={forget}
                />
                <OrbitControls
                  enableDamping
                  dampingFactor={0.06}
                  rotateSpeed={0.6}
                  zoomSpeed={0.8}
                  minDistance={5}
                  maxDistance={Math.max(80, constellation.extent * 4)}
                  autoRotate={autoOrbit}
                  autoRotateSpeed={0.35}
                />
              </Canvas>
            )}
          </div>

          {/* header */}
          <header className="absolute top-0 inset-x-0 flex items-center gap-3 px-5 py-4 bg-gradient-to-b from-black/80 to-transparent">
            <div className="w-9 h-9 rounded-xl bg-reactor-core/10 border border-reactor-core/40 flex items-center justify-center">
              <Brain className="w-4 h-4 text-reactor-core" />
            </div>
            <div className="min-w-0">
              <h2 className="font-orbitron text-sm tracking-[0.2em] uppercase text-reactor-core">Second Brain</h2>
              <p className="text-[10px] font-rajdhani text-text-secondary/60 tracking-wider uppercase">
                {stats ? `${stats.total} memories · ${stats.links} links · ${stats.pinned} pinned` : "loading your memories…"}
              </p>
            </div>

            <div className="relative ml-3">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary/50" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search memories  /"
                className="w-52 sm:w-64 bg-white/[0.05] border border-white/[0.09] rounded-full pl-8 pr-3 py-1.5 text-[11px] font-rajdhani text-text-primary placeholder:text-text-secondary/45 focus:outline-none focus:border-reactor-core/45"
              />
            </div>

            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => setAutoOrbit((v) => !v)}
                className={`p-2 rounded-lg border transition-colors ${autoOrbit ? "border-reactor-core/45 bg-reactor-core/10 text-reactor-core" : "border-white/10 text-text-secondary/60"}`}
                title={autoOrbit ? "Pause auto-orbit" : "Resume auto-orbit"}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowArchived((v) => !v)}
                className={`p-2 rounded-lg border transition-colors ${showArchived ? "border-accent-amber/45 bg-accent-amber/10 text-accent-amber" : "border-white/10 text-text-secondary/60"}`}
                title={showArchived ? "Hide forgotten memories" : "Show forgotten memories"}
              >
                {showArchived ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={() => void load()}
                className="p-2 rounded-lg border border-white/10 text-text-secondary/60 hover:text-text-primary"
                title="Reload the graph"
              >
                {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              </button>
              <button onClick={onClose} className="p-2 rounded-lg hover:bg-accent-red/20 text-text-secondary/70" title="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* legend / cluster filter */}
          {clusters.length > 0 && (
            <div className="absolute left-5 top-24 flex flex-col gap-1.5 max-w-[190px]">
              <div className="flex items-center gap-1.5 text-[9px] font-orbitron uppercase tracking-widest text-text-secondary/50">
                <Layers className="w-3 h-3" /> constellations
              </div>
              <button
                onClick={() => setIsolated(null)}
                className={`text-left px-2 py-1 rounded-lg border text-[10px] font-rajdhani transition-colors ${
                  isolated === null ? "border-reactor-core/45 bg-reactor-core/10 text-reactor-core" : "border-white/[0.07] text-text-secondary/70 hover:text-text-primary"
                }`}
              >
                all memories ({constellation?.nodes.length ?? 0})
              </button>
              {clusters.map((c) => (
                <button
                  key={c.type}
                  onClick={() => setIsolated(isolated === c.type ? null : c.type)}
                  className={`flex items-center gap-2 px-2 py-1 rounded-lg border text-[10px] font-rajdhani transition-colors ${
                    isolated === c.type ? "border-white/25 bg-white/10 text-text-primary" : "border-white/[0.07] text-text-secondary/70 hover:text-text-primary"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
                  <span className="truncate">{c.type.toLowerCase()}</span>
                  <span className="ml-auto text-text-secondary/45">{c.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* hint / empty state */}
          {!loading && graph && graph.nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-6">
              <Brain className="w-8 h-8 text-reactor-core/50" />
              <p className="text-sm font-rajdhani text-text-primary/80 max-w-md">
                Your second brain is empty. Run a mission, chat with JARVIS, or tell it something about yourself —
                memories appear here as stars.
              </p>
            </div>
          )}

          {error && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 text-[11px] font-rajdhani text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg px-3 py-1.5">
              {error}
            </div>
          )}

          {/* selected memory card */}
          <AnimatePresence>
            {node && (
              <motion.aside
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
                className="absolute right-5 top-24 w-[300px] rounded-2xl border border-white/10 bg-black/55 backdrop-blur-xl p-4 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)]"
              >
                <div className="w-full h-px mb-3 -mt-1" style={{ background: `linear-gradient(90deg, transparent, ${node.color}, transparent)` }} />
                <div className="flex items-start gap-2">
                  <span className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ background: node.color, boxShadow: `0 0 12px ${node.color}` }} />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-orbitron text-text-primary leading-snug break-words">{node.name}</h3>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-[9px] font-rajdhani uppercase tracking-widest px-1.5 py-0.5 rounded-full border" style={{ borderColor: `${node.color}55`, color: node.color }}>
                        {node.cluster.toLowerCase()}
                      </span>
                      {node.pinned && <span className="text-[9px] font-rajdhani uppercase tracking-widest text-accent-amber">📌 pinned</span>}
                      {node.archived && <span className="text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/60">forgotten</span>}
                    </div>
                  </div>
                </div>

                {node.description && (
                  <p className="mt-2.5 text-[11px] font-rajdhani text-text-secondary/80 leading-relaxed max-h-28 overflow-y-auto">
                    {node.description}
                  </p>
                )}

                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/55">
                    <span>memory strength</span>
                    <span>{Math.round(Math.min(1, node.strength) * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.round(Math.min(1, node.strength) * 100)}%`, background: `linear-gradient(90deg, ${node.color}, rgba(255,255,255,0.7))` }} />
                  </div>
                  <div className="flex items-center gap-3 text-[9px] font-rajdhani text-text-secondary/50 uppercase tracking-widest">
                    <span>{connectionCount} links</span>
                    <span>{node.accessCount ?? 0} recalls</span>
                  </div>
                </div>

                <div className="mt-3.5 grid grid-cols-2 gap-1.5">
                  <button
                    onClick={() => void act(node.pinned ? "unpin" : "pin", node.id)}
                    disabled={busy}
                    className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl border text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-40 transition-colors ${
                      node.pinned ? "border-accent-amber/45 bg-accent-amber/10 text-accent-amber" : "border-white/12 text-text-secondary/80 hover:text-text-primary"
                    }`}
                  >
                    {node.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />} {node.pinned ? "unpin" : "pin"}
                  </button>
                  <button
                    onClick={() => void act("reinforce", node.id)}
                    disabled={busy}
                    className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl border border-reactor-core/40 bg-reactor-core/10 text-reactor-core text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-40"
                    title="Strengthen this memory"
                  >
                    <Zap className="w-3 h-3" /> reinforce
                  </button>
                  {node.archived ? (
                    <button
                      onClick={() => void act("restore", node.id)}
                      disabled={busy}
                      className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl border border-accent-green/40 bg-accent-green/10 text-accent-green text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-40"
                    >
                      restore memory
                    </button>
                  ) : (
                    <button
                      onClick={() => forget(node.id)}
                      disabled={busy}
                      className={`col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-xl border text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-40 transition-colors ${
                        confirmForget === node.id
                          ? "border-accent-red bg-accent-red/20 text-accent-red"
                          : "border-white/12 text-text-secondary/80 hover:text-accent-red hover:border-accent-red/40"
                      }`}
                    >
                      <Eraser className="w-3 h-3" /> {confirmForget === node.id ? "tap again to forget" : "forget"}
                    </button>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>

          {/* gesture help */}
          <footer className="absolute bottom-0 inset-x-0 px-5 py-3 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-4 text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/45">
            <span>drag orbit</span>
            <span>scroll zoom</span>
            <span>click focus</span>
            <span>double-click pin</span>
            <span>right-click forget</span>
            <span className="hidden sm:inline">p pin · f forget · r reinforce · / search · esc back</span>
            <span className="ml-auto flex items-center gap-1.5">
              {hovered && graph ? `hovering: ${graph.nodes.find((n) => n.id === hovered)?.name ?? ""}` : ""}
            </span>
          </footer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
