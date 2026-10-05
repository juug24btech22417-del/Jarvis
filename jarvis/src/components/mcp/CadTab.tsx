"use client";

import React, { useState, useEffect, useRef } from "react";
import * as THREE from "three";
import {
  Box,
  Layers,
  Download,
  Copy,
  Check,
  Sparkles,
  Sliders,
  Maximize2,
  Cpu,
  RefreshCw,
} from "lucide-react";

/** Build a distinct 3D mesh for each generated preset so the viewport matches
 *  the model the CAD handler actually produced. Dimensions are in millimetres;
 *  the scene units mirror that. */
function buildPresetMesh(
  preset: string | undefined,
  w: number,
  h: number,
  d: number,
  material: THREE.MeshStandardMaterial
): THREE.Group {
  const group = new THREE.Group();

  switch (preset) {
    case "bearing_gear": {
      const sun = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.25, w * 0.25, h, 48), material);
      group.add(sun);
      const teeth = 18;
      for (let i = 0; i < teeth; i++) {
        const a = (i / teeth) * Math.PI * 2;
        const tooth = new THREE.Mesh(new THREE.BoxGeometry(w * 0.08, h, w * 0.06), material);
        tooth.position.set(Math.cos(a) * w * 0.28, 0, Math.sin(a) * w * 0.28);
        tooth.rotation.y = -a;
        group.add(tooth);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.08, w * 0.08, h + 2, 24), material);
      group.add(hub);
      break;
    }
    case "drone_mount": {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.5, h * 0.35, 6), material);
      group.add(base);
      const boss = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.25, w * 0.25, h * 0.5, 32), material);
      boss.position.y = h * 0.4;
      group.add(boss);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(d * 0.22, 12, d * 0.6), material);
      arm.position.set(0, 6, -d * 0.3);
      group.add(arm);
      break;
    }
    case "cable_clip": {
      const base = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.4, d), material);
      group.add(base);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.5, d * 0.7), material);
      jaw.position.y = h * 0.35;
      group.add(jaw);
      break;
    }
    case "custom_box": {
      const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      group.add(box);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(w, 4, d), material);
      lid.position.y = h / 2 + 1.6;
      group.add(lid);
      break;
    }
    case "hex_case": {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.5, h, 6), material);
      group.add(shell);
      break;
    }
    case "phone_stand":
    default: {
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 0.8, 8, d * 0.8), material);
      group.add(base);
      const back = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75, 8, h * 0.75), material);
      back.position.set(0, 28, 10);
      back.rotation.x = -0.35;
      group.add(back);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(w * 0.75, 16, 8), material);
      lip.position.set(0, 8, -d * 0.35);
      group.add(lip);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 12, 32), material);
      group.add(hole);
      break;
    }
  }

  return group;
}

export default function CadTab() {
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [activeTab, setActiveTab] = useState<"3d" | "scad" | "slice">("3d");
  const [wireframe, setWireframe] = useState(false);
  const [copied, setCopied] = useState(false);
  const genStepLabels = [
    "Parsing design specification...",
    "Generating parametric geometry...",
    "Compiling OpenSCAD code...",
    "Rendering 3D preview...",
  ];

  // No model until the user generates one — the viewport starts empty rather
  // than showing a canned sample.
  const [cadModel, setCadModel] = useState<any>(null);

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const isDraggingRef = useRef(false);
  const prevMouseRef = useRef({ x: 0, y: 0 });

  // Preset prompts
  const presets = [
    "Smartphone desk stand with 20° tilt",
    "Hexagonal drone motor mount",
    "Self-centering planetary gear",
    "Desk cable management clamp",
    "Waterproof capsule case",
  ];

  // Initialize Three.js scene
  useEffect(() => {
    if (!canvasContainerRef.current) return;
    const container = canvasContainerRef.current;
    const width = container.clientWidth || 500;
    const height = container.clientHeight || 350;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060c18);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(100, 110, 130);
    camera.lookAt(0, 20, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x22d3ee, 1.2);
    dirLight1.position.set(80, 120, 80);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xf59e0b, 0.6);
    dirLight2.position.set(-80, -40, -80);
    scene.add(dirLight2);

    // Grid Floor
    const grid = new THREE.GridHelper(160, 20, 0x06b6d4, 0x1e293b);
    grid.position.y = -10;
    scene.add(grid);

    // Object Group
    const group = new THREE.Group();
    scene.add(group);
    meshGroupRef.current = group;

    // Mouse drag rotation
    const onMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !meshGroupRef.current) return;
      const dx = e.clientX - prevMouseRef.current.x;
      const dy = e.clientY - prevMouseRef.current.y;
      meshGroupRef.current.rotation.y += dx * 0.01;
      meshGroupRef.current.rotation.x += dy * 0.01;
      prevMouseRef.current = { x: e.clientX, y: e.clientY };
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camera.position.z = Math.max(50, Math.min(260, camera.position.z + e.deltaY * 0.15));
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });

    // Render loop
    let reqId: number;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      if (!isDraggingRef.current && meshGroupRef.current) {
        meshGroupRef.current.rotation.y += 0.003;
      }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(reqId);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel);
      renderer.dispose();
    };
  }, []);

  // Rebuild 3D Mesh when cadModel changes
  useEffect(() => {
    if (!meshGroupRef.current || !cadModel) return;
    const group = meshGroupRef.current;
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    const material = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      roughness: 0.25,
      metalness: 0.65,
      wireframe: wireframe,
    });

    // Construct 3D Geometry — shaped by the generated preset
    const w = cadModel.dimensions?.widthMm || 70;
    const h = cadModel.dimensions?.heightMm || 90;
    const d = cadModel.dimensions?.depthMm || 75;

    const built = buildPresetMesh(cadModel.meshPreset, w, h, d, material);
    group.add(built);
  }, [cadModel, wireframe]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setGenStep(0);
    // Animate through steps while generating
    const stepTimer = setInterval(() => {
      setGenStep((s) => Math.min(s + 1, 3));
    }, 350);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mcp: "cad",
          action: "generate",
          params: { prompt }
        })
      });
      const data = await res.json();
      if (data.success && data.data) {
        setGenStep(3);
        setCadModel(data.data);
      }
    } catch (e: any) {
      console.error("CAD generation error:", e);
    } finally {
      clearInterval(stepTimer);
      setIsGenerating(false);
      setGenStep(0);
    }
  };

  const handleCopyScad = () => {
    if (cadModel?.openScadCode) {
      navigator.clipboard.writeText(cadModel.openScadCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadStl = () => {
    if (!cadModel) return;
    // Generate valid ASCII STL from current model dimensions
    const w = cadModel.dimensions?.widthMm || 0;
    const h = cadModel.dimensions?.heightMm || 0;
    const d = cadModel.dimensions?.depthMm || 0;

    let stl = `solid ${cadModel.name.replace(/\s+/g, "_")}\n`;
    stl += `  facet normal 0 0 1\n    outer loop\n      vertex 0 0 0\n      vertex ${w} 0 0\n      vertex ${w} ${d} 0\n    endloop\n  endfacet\n`;
    stl += `  facet normal 0 0 1\n    outer loop\n      vertex 0 0 0\n      vertex ${w} ${d} 0\n      vertex 0 ${d} 0\n    endloop\n  endfacet\n`;
    stl += `  facet normal 0 1 0\n    outer loop\n      vertex 0 ${d} 0\n      vertex ${w} ${d} 0\n      vertex ${w} ${d} ${h}\n    endloop\n  endfacet\n`;
    stl += `  facet normal 0 1 0\n    outer loop\n      vertex 0 ${d} 0\n      vertex ${w} ${d} ${h}\n      vertex 0 ${d} ${h}\n    endloop\n  endfacet\n`;
    stl += `endsolid ${cadModel.name.replace(/\s+/g, "_")}\n`;

    const blob = new Blob([stl], { type: "model/stl" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cadModel.name.toLowerCase().replace(/\s+/g, "-")}.stl`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col gap-3 rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-950/40 via-yellow-950/20 to-black/40 p-4 backdrop-blur-xl md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30">
            <Box className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold tracking-wide text-white">MARK PROTOTYPE CAD</h3>
              <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                Parametric Manufacturing
              </span>
            </div>
            <p className="text-xs text-white/50">
              Natural language text-to-CAD · OpenSCAD generator · 3D Slicing & STL Export
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDownloadStl}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 px-4 py-2 text-xs font-semibold text-black shadow-lg shadow-amber-500/20 transition hover:from-amber-400 hover:to-yellow-400"
        >
          <Download className="h-4 w-4" />
          Download .STL File
        </button>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left Column: Prompt Input, Presets, Slicer Specs */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            <label className="text-xs font-medium uppercase tracking-wider text-amber-400">
              Design Specification
            </label>
            <textarea
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe physical part: e.g. Phone stand with 20 deg tilt and cable cutout..."
              className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
            />

            {/* Quick Preset Pills */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {presets.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPrompt(p)}
                  className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/70 transition hover:border-amber-400/40 hover:bg-white/10 hover:text-white"
                >
                  {p}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 py-2.5 text-xs font-semibold text-black shadow-md shadow-amber-500/20 transition hover:from-amber-400 hover:to-yellow-400 disabled:opacity-40"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  {genStepLabels[genStep]}
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate 3D Model
                </>
              )}
            </button>
            {isGenerating && (
              <div className="mt-2 flex gap-1 justify-center">
                {genStepLabels.map((_, i) => (
                  <div
                    key={i}
                    className={`h-1 rounded-full transition-all duration-500 ${
                      i <= genStep ? "bg-amber-400 w-8" : "bg-white/10 w-4"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Manufacturing & Slicer Telemetry */}
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-white/80 mb-3 flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5 text-amber-400" />
              Slicing & Toolpath Estimates
            </h4>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <span className="text-[10px] text-white/40 block">DIMENSIONS</span>
                <span className="text-sm font-bold text-white">
                  {cadModel
                    ? `${cadModel.dimensions?.widthMm} × ${cadModel.dimensions?.heightMm} × ${cadModel.dimensions?.depthMm} mm`
                    : "—"}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <span className="text-[10px] text-white/40 block">PRINT DURATION</span>
                <span className="text-sm font-bold text-amber-300">
                  {cadModel ? `~${cadModel.printEstimates?.printTimeMinutes} mins` : "—"}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <span className="text-[10px] text-white/40 block">FILAMENT WEIGHT</span>
                <span className="text-sm font-bold text-cyan-300">
                  {cadModel ? `${cadModel.printEstimates?.filamentWeightGrams}g (${cadModel.printEstimates?.recommendedMaterial})` : "—"}
                </span>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <span className="text-[10px] text-white/40 block">LAYER COUNT</span>
                <span className="text-sm font-bold text-purple-300">
                  {cadModel ? `${cadModel.printEstimates?.layerCount} layers` : "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: 3D Viewport / OpenSCAD Code */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex h-full min-h-[460px] flex-col rounded-3xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-2xl">
            {/* Viewport Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("3d")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    activeTab === "3d" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-white/60 hover:text-white"
                  }`}
                >
                  Interactive 3D View
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("scad")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                    activeTab === "scad" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-white/60 hover:text-white"
                  }`}
                >
                  OpenSCAD Code
                </button>
              </div>

              {activeTab === "3d" && (
                <button
                  type="button"
                  onClick={() => setWireframe(!wireframe)}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-mono transition ${
                    wireframe ? "border-cyan-400 bg-cyan-400/20 text-cyan-300" : "border-white/10 bg-white/5 text-white/50"
                  }`}
                >
                  Wireframe: {wireframe ? "ON" : "OFF"}
                </button>
              )}

              {activeTab === "scad" && (
                <button
                  type="button"
                  onClick={handleCopyScad}
                  className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-white/70 hover:text-white"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy SCAD"}
                </button>
              )}
            </div>

            {/* 3D WebGL Canvas Container */}
            {activeTab === "3d" ? (
              <div className="relative flex-1 rounded-2xl overflow-hidden bg-[#060c18] border border-white/10 min-h-[360px]">
                <div ref={canvasContainerRef} className="h-full w-full cursor-grab active:cursor-grabbing" />
                {!cadModel && !isGenerating && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-xs text-white/40">
                    Describe a part and press Generate 3D Model.
                  </div>
                )}
                <div className="absolute bottom-3 right-3 rounded-lg bg-black/60 px-2.5 py-1 text-[10px] text-white/40 backdrop-blur-md">
                  Drag to rotate · Scroll to zoom
                </div>
              </div>
            ) : (
              <div className="flex-1 rounded-2xl bg-black/60 p-4 font-mono text-xs text-amber-200/90 overflow-auto border border-white/10 max-h-[380px]">
                <pre>{cadModel ? cadModel.openScadCode : "// Generate a model to view its OpenSCAD source."}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
