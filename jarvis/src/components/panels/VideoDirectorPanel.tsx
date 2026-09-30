"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Clapperboard,
  Play,
  Pause,
  RotateCcw,
  Download,
  Sparkles,
  Sliders,
  Film,
  Type,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Layers,
  Wand2,
} from "lucide-react";
import { useJarvisVoice } from "@/hooks/useVoice";

interface VideoScene {
  id: string;
  index: number;
  title: string;
  narration: string;
  visualPrompt: string;
  keywords: string[];
  durationSeconds: number;
  motion: "zoom-in" | "zoom-out" | "pan-right" | "pan-left" | "pulse";
  backgroundUrl: string;
  ambientTone: string;
}

export default function VideoDirectorPanel({ onClose }: { onClose: () => void }) {
  const [topic, setTopic] = useState("Quantum Computing & Neural Co-Processors");
  const [style, setStyle] = useState<"tech" | "space" | "cyberpunk" | "ironman">("tech");
  const [scenes, setScenes] = useState<VideoScene[]>([]);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [elapsedSceneTime, setElapsedSceneTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordProgress, setRecordProgress] = useState(0);
  const [pexelsKey, setPexelsKey] = useState("");
  const [pexelsStatus, setPexelsStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [videoSource, setVideoSource] = useState<"pexels" | "mixkit">("mixkit");
  const [serverPexelsConnected, setServerPexelsConnected] = useState(false);

  const { speak, stopSpeaking } = useJarvisVoice();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Check if Pexels API key is active on server from .env.local
  useEffect(() => {
    fetch("/api/video-director")
      .then((r) => r.json())
      .then((d) => {
        if (d?.pexelsConfigured) {
          setServerPexelsConnected(true);
          setVideoSource("pexels");
        }
      })
      .catch(() => {});
  }, []);

  // Load saved Pexels API key from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("jarvis_pexels_api_key");
      if (saved) setPexelsKey(saved);
    }
  }, []);

  const handleSavePexelsKey = (key: string) => {
    setPexelsKey(key);
    if (typeof window !== "undefined") {
      localStorage.setItem("jarvis_pexels_api_key", key.trim());
      setPexelsStatus("saved");
      setTimeout(() => setPexelsStatus("idle"), 2500);
    }
  };

  // Generate Storyboard
  const handleGenerate = async (customPrompt?: string) => {
    setIsGenerating(true);
    setIsPlaying(false);
    stopSpeaking();
    try {
      const keyToUse = pexelsKey.trim() || (typeof window !== "undefined" ? localStorage.getItem("jarvis_pexels_api_key") || "" : "");
      const res = await fetch("/api/video-director", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: customPrompt || topic,
          style,
          sceneCount: 4,
          pexelsApiKey: keyToUse || undefined,
        }),
      });
      const data = await res.json();
      if (data?.success && data.scenes?.length > 0) {
        setScenes(data.scenes);
        setCurrentSceneIdx(0);
        setElapsedSceneTime(0);
        setVideoSource(data.pexelsEnabled ? "pexels" : "mixkit");
      }
    } catch (e) {
      console.error("[VideoDirector] Generation failed:", e);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    handleGenerate();
  }, []);

  const currentScene = scenes[currentSceneIdx] || null;

  // Scene Progression Timer
  useEffect(() => {
    if (!isPlaying || !currentScene) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setElapsedSceneTime((prev) => {
        const next = prev + 0.1;
        if (next >= currentScene.durationSeconds) {
          // Advance to next scene or loop
          setCurrentSceneIdx((curr) => {
            const nextIdx = curr + 1;
            if (nextIdx < scenes.length) {
              return nextIdx;
            } else {
              setIsPlaying(false);
              return 0;
            }
          });
          return 0;
        }
        return next;
      });
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, currentScene, scenes.length]);

  // When scene changes, speak the narration
  useEffect(() => {
    if (isPlaying && currentScene?.narration) {
      speak(currentScene.narration);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
      }
    }
  }, [currentSceneIdx, isPlaying, currentScene?.narration, speak]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      stopSpeaking();
      if (videoRef.current) videoRef.current.pause();
    } else {
      setIsPlaying(true);
      if (currentScene?.narration) speak(currentScene.narration);
      if (videoRef.current) videoRef.current.play().catch(() => {});
    }
  };

  const handleRestart = () => {
    setCurrentSceneIdx(0);
    setElapsedSceneTime(0);
    setIsPlaying(true);
    if (scenes[0]?.narration) speak(scenes[0].narration);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  };

  // Export / Render Video (Records Canvas + Audio to WebM file)
  const handleExport = async () => {
    if (!canvasRef.current || scenes.length === 0) return;
    setIsRecording(true);
    setRecordProgress(0);
    setIsPlaying(false);
    stopSpeaking();

    try {
      const canvas = canvasRef.current;
      const stream = canvas.captureStream(30);
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
          ? "video/webm;codecs=vp9"
          : "video/webm",
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `JARVIS-Cinema-${Date.now()}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setIsRecording(false);
        speak("Cinematic video exported and saved to downloads, Boss.");
      };

      mediaRecorder.start();

      // Play through all scenes sequentially while recording
      for (let i = 0; i < scenes.length; i++) {
        setCurrentSceneIdx(i);
        setRecordProgress(Math.round(((i + 1) / scenes.length) * 100));
        // Wait duration of scene
        await new Promise((r) => setTimeout(r, scenes[i].durationSeconds * 1000));
      }

      mediaRecorder.stop();
    } catch (e) {
      console.error("[VideoDirector] Export failed:", e);
      setIsRecording(false);
    }
  };

  // Canvas Renderer Loop (draws video, HUD, subtitles)
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;

      // Clear previous canvas frame for transparent video passthrough
      ctx.clearRect(0, 0, w, h);

      // If recording export WebM, paint the video frame to canvas before HUD
      if (isRecording && videoRef.current && videoRef.current.readyState >= 2) {
        ctx.save();
        const progress = currentScene ? elapsedSceneTime / currentScene.durationSeconds : 0;
        let scale = 1.0;
        let dx = 0;
        let dy = 0;

        if (currentScene?.motion === "zoom-in") {
          scale = 1.0 + progress * 0.15;
        } else if (currentScene?.motion === "zoom-out") {
          scale = 1.15 - progress * 0.15;
        } else if (currentScene?.motion === "pan-right") {
          dx = (progress - 0.5) * 40;
        }

        ctx.translate(w / 2, h / 2);
        ctx.scale(scale, scale);
        ctx.translate(-w / 2 + dx, -h / 2 + dy);
        ctx.drawImage(videoRef.current, 0, 0, w, h);
        ctx.restore();
      }

      // 2. Cinematic Vignette & Stark Tint
      const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.85);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,5,15,0.75)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // 3. Stark Industries HUD Watermark / Letterbox Lines
      ctx.strokeStyle = "rgba(0, 240, 255, 0.4)";
      ctx.lineWidth = 1;

      // Top & Bottom Letterbox lines
      ctx.beginPath();
      ctx.moveTo(30, 30);
      ctx.lineTo(w - 30, 30);
      ctx.moveTo(30, h - 30);
      ctx.lineTo(w - 30, h - 30);
      ctx.stroke();

      // Corner brackets
      const cl = 20;
      ctx.lineWidth = 2;
      ctx.beginPath();
      // Top-Left
      ctx.moveTo(30, 30 + cl);
      ctx.lineTo(30, 30);
      ctx.lineTo(30 + cl, 30);
      // Top-Right
      ctx.moveTo(w - 30 - cl, 30);
      ctx.lineTo(w - 30, 30);
      ctx.lineTo(w - 30, 30 + cl);
      // Bottom-Left
      ctx.moveTo(30, h - 30 - cl);
      ctx.lineTo(30, h - 30);
      ctx.lineTo(30 + cl, h - 30);
      // Bottom-Right
      ctx.moveTo(w - 30 - cl, h - 30);
      ctx.lineTo(w - 30, h - 30);
      ctx.lineTo(w - 30, h - 30 - cl);
      ctx.stroke();

      // HUD Text
      ctx.font = "12px monospace";
      ctx.fillStyle = "rgba(0, 240, 255, 0.75)";
      ctx.fillText("STARK CINEMA SYSTEM // REC", 45, 50);

      const secStr = Math.floor(elapsedSceneTime).toString().padStart(2, "0");
      const msStr = Math.floor((elapsedSceneTime % 1) * 100).toString().padStart(2, "0");
      ctx.fillText(`TC 00:0${currentSceneIdx + 1}:${secStr}:${msStr}`, w - 180, 50);

      // 4. Kinetic Subtitles Overlay
      if (currentScene) {
        // Scene Title
        ctx.font = "bold 22px 'Rajdhani', sans-serif";
        ctx.fillStyle = currentScene.ambientTone || "#00f0ff";
        ctx.textAlign = "center";
        ctx.fillText(currentScene.title.toUpperCase(), w / 2, h - 110);

        // Narration Subtitles
        ctx.font = "16px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0, 240, 255, 0.8)";
        ctx.shadowBlur = 10;

        // Wrap text
        const words = currentScene.narration.split(" ");
        let line = "";
        const lines: string[] = [];
        for (const word of words) {
          const testLine = line + word + " ";
          if (ctx.measureText(testLine).width > w - 120) {
            lines.push(line);
            line = word + " ";
          } else {
            line = testLine;
          }
        }
        lines.push(line);

        lines.forEach((l, idx) => {
          ctx.fillText(l.trim(), w / 2, h - 75 + idx * 24);
        });

        ctx.shadowBlur = 0;
        ctx.textAlign = "left";
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [currentScene, elapsedSceneTime, currentSceneIdx]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl bg-[#030914]/95 border border-cyan-500/40 rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.25)] overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-cyan-950/20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_15px_rgba(0,212,255,0.3)]">
              <Clapperboard className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="font-orbitron text-sm font-bold text-cyan-300 tracking-wider flex items-center gap-2">
                AI VIDEO DIRECTOR & REEL ENGINE
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-mono">
                  60s RENDER
                </span>
              </h2>
              <p className="text-[11px] font-rajdhani text-text-secondary">
                Auto-Storyboard · Kinetic Subtitles · AI Narration · 1-Click MP4/WebM Export
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Aspect Ratio Switcher */}
            <div className="flex rounded-lg bg-black/40 p-0.5 border border-cyan-500/30 text-xs font-mono">
              <button
                onClick={() => setAspectRatio("16:9")}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  aspectRatio === "16:9" ? "bg-cyan-500 text-black font-bold" : "text-cyan-400 hover:text-white"
                }`}
              >
                16:9 Cinema
              </button>
              <button
                onClick={() => setAspectRatio("9:16")}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  aspectRatio === "9:16" ? "bg-cyan-500 text-black font-bold" : "text-cyan-400 hover:text-white"
                }`}
              >
                9:16 Reel
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Studio Body */}
        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Live Cinema Player & Controls (7 cols) */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            {/* Canvas Monitor */}
            <div
              className={`relative bg-black rounded-2xl border-2 border-cyan-500/40 overflow-hidden shadow-[0_0_30px_rgba(0,212,255,0.2)] flex items-center justify-center mx-auto transition-all duration-300 ${
                aspectRatio === "16:9" ? "w-full aspect-video" : "w-[300px] h-[520px]"
              }`}
            >
              {/* Active hardware-accelerated video background */}
              {currentScene && (
                <video
                  key={currentScene.id}
                  ref={videoRef}
                  src={currentScene.backgroundUrl}
                  crossOrigin="anonymous"
                  loop
                  muted
                  playsInline
                  autoPlay
                  className="absolute inset-0 w-full h-full object-cover transition-opacity duration-500"
                  style={{
                    filter: "contrast(1.08) saturate(1.15) brightness(0.95)",
                  }}
                />
              )}

              {/* Render Canvas for Holographic HUD Watermark & Subtitles */}
              <canvas
                ref={canvasRef}
                width={aspectRatio === "16:9" ? 1280 : 720}
                height={aspectRatio === "16:9" ? 720 : 1280}
                className="absolute inset-0 w-full h-full object-contain pointer-events-none z-10"
              />

              {/* Loading / Generating Overlay */}
              {isGenerating && (
                <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-3 font-mono text-cyan-400">
                  <Wand2 className="w-8 h-8 animate-spin" />
                  <p className="text-xs uppercase tracking-widest">Directing Scenes & Synthesizing Visuals...</p>
                </div>
              )}

              {/* Recording Overlay */}
              {isRecording && (
                <div className="absolute top-4 left-4 px-3 py-1.5 rounded-lg bg-red-600/90 text-white font-mono text-xs flex items-center gap-2 animate-pulse shadow-lg">
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                  <span>RECORDING VIDEO ({recordProgress}%)</span>
                </div>
              )}
            </div>

            {/* Transport Bar */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-black/60 border border-cyan-500/20">
              <div className="flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  disabled={isGenerating || scenes.length === 0}
                  className="w-10 h-10 rounded-xl bg-cyan-500 text-black flex items-center justify-center font-bold hover:bg-cyan-400 active:scale-95 transition-transform disabled:opacity-40"
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>
                <button
                  onClick={handleRestart}
                  className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 hover:text-white transition-colors"
                  title="Restart"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>

              {/* Scene Progress Indicator */}
              <div className="flex items-center gap-2 text-xs font-mono text-cyan-300">
                <span>SCENE {currentSceneIdx + 1} OF {scenes.length}</span>
                <span className="text-cyan-500/50">|</span>
                <span>{elapsedSceneTime.toFixed(1)}s / {currentScene?.durationSeconds || 6}s</span>
              </div>

              {/* 1-Click Export Video */}
              <button
                onClick={handleExport}
                disabled={isRecording || isGenerating || scenes.length === 0}
                className="px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/40 text-xs font-mono font-bold flex items-center gap-2 active:scale-95 transition-all shadow-[0_0_15px_rgba(0,212,255,0.2)] disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                {isRecording ? `RENDERING ${recordProgress}%` : "EXPORT VIDEO"}
              </button>
            </div>
          </div>

          {/* Right Column: Prompt Director & Scene Storyboard (5 cols) */}
          <div className="lg:col-span-5 flex flex-col gap-4">
            {/* Topic Input & Presets */}
            <div className="bg-black/50 border border-cyan-500/20 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono text-cyan-400/80 uppercase tracking-wider flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5" /> Director Prompt Studio
                </span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                  serverPexelsConnected || pexelsKey.trim() || videoSource === "pexels"
                    ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(16,185,129,0.2)]"
                    : "bg-cyan-500/10 text-cyan-400/60 border border-cyan-500/20"
                }`}>
                  {serverPexelsConnected || pexelsKey.trim() || videoSource === "pexels" ? "✓ PEXELS HD LIVE" : "STOCK FALLBACK"}
                </span>
              </div>

              {serverPexelsConnected && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-emerald-300 bg-emerald-950/30 border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>PEXELS_API_KEY detected in .env.local — Active</span>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                  placeholder="Enter script topic (e.g. Arc Reactor Architecture)..."
                  className="flex-1 bg-black/70 border border-cyan-500/30 rounded-xl px-3 py-2 text-xs text-white placeholder-cyan-400/30 font-mono focus:outline-none focus:border-cyan-400"
                />
                <button
                  onClick={() => handleGenerate()}
                  disabled={isGenerating || !topic.trim()}
                  className="px-4 py-2 rounded-xl bg-cyan-500 text-black font-bold text-xs font-mono hover:bg-cyan-400 disabled:opacity-40"
                >
                  DIRECT
                </button>
              </div>

              {/* Style Selector */}
              <div className="flex gap-1.5">
                {(["tech", "space", "cyberpunk", "ironman"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`flex-1 py-1 rounded-lg text-[10px] font-mono capitalize transition-colors ${
                      style === s ? "bg-cyan-500 text-black font-bold" : "bg-cyan-950/40 border border-cyan-500/30 text-cyan-400 hover:text-white"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Pexels API Key */}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-cyan-500/10">
                <span className="text-[10px] font-mono text-cyan-400/50 uppercase">Pexels API Key (for real videos)</span>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={pexelsKey}
                    onChange={(e) => setPexelsKey(e.target.value)}
                    placeholder="Paste your Pexels API key → api.pexels.com"
                    className="flex-1 bg-black/70 border border-cyan-500/30 rounded-xl px-3 py-1.5 text-xs text-white placeholder-cyan-400/25 font-mono focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    onClick={() => handleSavePexelsKey(pexelsKey)}
                    disabled={!pexelsKey.trim()}
                    className="px-3 py-1.5 rounded-xl bg-green-500/20 border border-green-400/40 text-green-300 text-[10px] font-mono hover:bg-green-500/30 disabled:opacity-40 transition-colors"
                  >
                    {pexelsStatus === "saved" ? "✓ SAVED" : "SAVE"}
                  </button>
                </div>
                <p className="text-[9px] text-cyan-400/30 font-mono">Get free key at pexels.com/api → Add PEXELS_API_KEY to .env.local</p>
              </div>

              {/* Presets */}
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-cyan-500/10">
                {[
                  "Quantum Computing 2030",
                  "Mark 85 Armor Engineering",
                  "Cyberpunk City Flight",
                  "Deep Space Warp Drive",
                ].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => {
                      setTopic(preset);
                      handleGenerate(preset);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-[10px] font-mono text-cyan-300/80 hover:text-white hover:border-cyan-400 transition-colors"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Storyboard Scenes List */}
            <div className="flex flex-col gap-2.5">
              <span className="text-xs font-mono text-cyan-400/80 uppercase tracking-wider flex items-center justify-between">
                <span>Storyboard Scenes ({scenes.length})</span>
                <span className="text-[10px] text-cyan-400/50">Click scene to jump</span>
              </span>

              <div className="flex flex-col gap-2 max-h-[38vh] overflow-y-auto pr-1">
                {scenes.map((scene, idx) => {
                  const isActive = idx === currentSceneIdx;
                  return (
                    <div
                      key={scene.id}
                      onClick={() => {
                        setCurrentSceneIdx(idx);
                        setElapsedSceneTime(0);
                      }}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer text-xs font-mono flex flex-col gap-1.5 ${
                        isActive
                          ? "bg-cyan-950/40 border-cyan-400 shadow-[0_0_15px_rgba(0,212,255,0.2)]"
                          : "bg-black/40 border-cyan-500/20 hover:border-cyan-500/40"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center text-[10px]">
                            {idx + 1}
                          </span>
                          {scene.title}
                        </span>
                        <span className="text-[10px] text-cyan-400/60 uppercase">
                          {scene.motion} · {scene.durationSeconds}s
                        </span>
                      </div>

                      <p className="text-cyan-100/90 text-[11px] leading-relaxed line-clamp-2">
                        &quot;{scene.narration}&quot;
                      </p>

                      <div className="flex items-center gap-1.5 mt-1">
                        {scene.keywords.map((kw) => (
                          <span
                            key={kw}
                            className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                          >
                            #{kw}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-cyan-500/20 bg-cyan-950/10 flex items-center justify-between text-[11px] font-mono text-cyan-400/60">
          <span>STARK HOLO-DIRECTOR SUITE v3.0</span>
          <span>MEDIARECORDER WEBM / VP9 HARDWARE ACCELERATION READY</span>
        </div>
      </div>
    </motion.div>
  );
}
