"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  FileText,
  Camera,
  Sparkles,
  Copy,
  Check,
  Plus,
  RefreshCw,
  GitBranch,
  CheckSquare,
  Sliders,
  Save,
  Layers,
  Wand2,
} from "lucide-react";
import { useJarvisVoice } from "@/hooks/useVoice";
import { useJarvisStore } from "@/store/jarvis.store";

type FilterMode = "normal" | "clean-ink" | "blueprint" | "monochrome";

export default function WhiteboardOCRPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<"notes" | "diagram" | "tasks">("notes");
  const [filterMode, setFilterMode] = useState<FilterMode>("clean-ink");
  const [isScanning, setIsScanning] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [scanLaserPos, setScanLaserPos] = useState(0);

  const [summary, setSummary] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState<string>("");
  const [rawText, setRawText] = useState<string>("");
  const [mermaidCode, setMermaidCode] = useState<string>("");
  const [actionItems, setActionItems] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [savedNotes, setSavedNotes] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { speak } = useJarvisVoice();
  const addTask = useJarvisStore((s) => s.addTask);

  // Initialize Camera
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (active && videoRef.current) {
          videoRef.current.srcObject = stream;
          streamRef.current = stream;
        }
      } catch (err) {
        console.warn("[WhiteboardOCR] Camera unavailable:", err);
        setCameraActive(false);
      }
    })();

    return () => {
      active = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Filter CSS styles
  const getFilterStyle = (): string => {
    switch (filterMode) {
      case "clean-ink":
        return "contrast(180%) brightness(120%) grayscale(40%)";
      case "blueprint":
        return "invert(100%) hue-rotate(180deg) saturate(250%) contrast(150%)";
      case "monochrome":
        return "grayscale(100%) contrast(220%)";
      default:
        return "none";
    }
  };

  // Capture frame and send to OCR API
  const handleCaptureAndTranscribe = async () => {
    setIsScanning(true);
    setScanLaserPos(0);
    setOcrError(null);
    speak("Scanning document. Enhancing contrast and digitizing text.");

    // Animate laser
    const start = Date.now();
    const laserInterval = setInterval(() => {
      const elapsed = Date.now() - start;
      const progress = Math.min(100, (elapsed / 1500) * 100);
      setScanLaserPos(progress);
      if (progress >= 100) clearInterval(laserInterval);
    }, 30);

    try {
      if (!videoRef.current || !canvasRef.current) {
        setOcrError("Camera not available. Please allow camera access and try again.");
        setIsScanning(false);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Wait for video to have valid dimensions
      if (!video.videoWidth || !video.videoHeight) {
        setOcrError("Camera feed not ready. Wait a moment and try again.");
        setIsScanning(false);
        return;
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setOcrError("Canvas context unavailable.");
        setIsScanning(false);
        return;
      }

      // Draw without filter for best OCR accuracy
      ctx.filter = "none";
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      // Send as PNG for lossless text clarity
      const base64Image = canvas.toDataURL("image/png", 1.0);

      const res = await fetch("/api/whiteboard-ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Image, mode: filterMode === "normal" ? "full" : filterMode === "blueprint" ? "diagram" : "full" }),
      });

      const data = await res.json();
      if (data?.success) {
        setSummary(data.summary || null);
        setRawText(data.rawText || "");
        setMarkdown(data.markdown || data.rawText || "");
        setMermaidCode(data.mermaidCode || "");
        setActionItems(data.actionItems || []);
        setOcrError(null);
        const itemCount = data.actionItems?.length || 0;
        speak(`Document digitized. ${itemCount > 0 ? `Found ${itemCount} action items.` : "Notes ready, Boss."}`);
      } else {
        const errMsg = data?.error || "OCR failed. Try better lighting or hold document closer.";
        setOcrError(errMsg);
        speak("Scan failed, Boss. " + errMsg);
      }
    } catch (e) {
      console.error("[WhiteboardOCR] Transcription failed:", e);
      setOcrError("Network error. Check your connection and try again.");
    } finally {
      setIsScanning(false);
      setScanLaserPos(100);
    }
  };

  const handleCopyMarkdown = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddTasks = () => {
    actionItems.forEach((title) => {
      addTask({
        title,
        completed: false,
        priority: "high",
      });
    });
    speak(`Added ${actionItems.length} action items to your JARVIS tasks list, Boss.`);
  };

  const handleSaveToNotes = async () => {
    try {
      await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: summary || "Whiteboard Capture",
          content: markdown,
          category: "Whiteboard",
        }),
      });
      setSavedNotes(true);
      setTimeout(() => setSavedNotes(false), 2500);
      speak("Saved whiteboard transcription to your permanent notes.");
    } catch (e) {
      console.error(e);
    }
  };

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
              <FileText className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="font-orbitron text-sm font-bold text-cyan-300 tracking-wider flex items-center gap-2">
                WHITEBOARD OCR & SCHEMATIC DIGITIZER
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-mono">
                  LIVE AI
                </span>
              </h2>
              <p className="text-[11px] font-rajdhani text-text-secondary">
                Handwriting Transcription · Flowchart Vectorizer · Task Checklist Extraction
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-secondary hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Studio Body */}
        <div className="p-6 overflow-y-auto flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Camera Viewport with Filter Controls (6 cols) */}
          <div className="lg:col-span-6 flex flex-col gap-3">
            {/* Viewport Frame */}
            <div className="relative w-full aspect-video bg-[#02050f] rounded-2xl border-2 border-cyan-500/40 overflow-hidden shadow-[0_0_30px_rgba(0,212,255,0.2)]">
              {cameraActive ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ filter: getFilterStyle() }}
                  className="w-full h-full object-cover transition-all duration-300"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center font-mono text-xs text-red-400/80 p-6 text-center">
                  <Camera className="w-8 h-8 mb-2 text-red-400" />
                  Camera access denied or unavailable. Please allow camera permissions to use OCR.
                </div>
              )}

              {/* Hidden capture canvas */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Laser Scanning Line */}
              {isScanning && (
                <div
                  className="absolute left-0 right-0 h-1 bg-cyan-400 shadow-[0_0_15px_#00f0ff] pointer-events-none transition-all duration-75"
                  style={{ top: `${scanLaserPos}%` }}
                />
              )}

              {/* HUD Frame Lines */}
              <div className="absolute inset-2 border border-cyan-400/25 pointer-events-none rounded-xl" />
              <div className="absolute top-3 left-3 text-[10px] font-mono text-cyan-400/80 bg-black/60 px-2 py-0.5 rounded">
                MODE: {filterMode.toUpperCase()}
              </div>
            </div>

            {/* Filter Selector & Scan Action */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-black/60 border border-cyan-500/20">
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className="text-cyan-400/70 mr-1 text-[11px]">FILTER:</span>
                {[
                  { id: "clean-ink", label: "Clean Ink" },
                  { id: "blueprint", label: "Blueprint" },
                  { id: "monochrome", label: "Mono" },
                  { id: "normal", label: "Raw" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilterMode(f.id as FilterMode)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-mono transition-colors ${
                      filterMode === f.id
                        ? "bg-cyan-500 text-black font-bold"
                        : "bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                onClick={handleCaptureAndTranscribe}
                disabled={isScanning}
                className="px-4 py-2 rounded-xl bg-cyan-500 text-black font-mono font-bold text-xs flex items-center gap-2 hover:bg-cyan-400 active:scale-95 transition-all shadow-[0_0_20px_rgba(0,212,255,0.3)] disabled:opacity-50"
              >
                {isScanning ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {isScanning ? "DIGITIZING..." : "CAPTURE & OCR"}
              </button>
            </div>

            {/* OCR Error Display */}
            {ocrError && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-red-950/30 border border-red-500/40 text-xs font-mono text-red-300">
                <span className="text-red-400 shrink-0">⚠</span>
                <span>{ocrError}</span>
              </div>
            )}

            {/* Tips */}
            <div className="text-[10px] font-mono text-cyan-400/40 text-center">
              Tip: Hold document flat, 20–40cm from camera. Use good lighting for best results.
            </div>
          </div>

          {/* Right Column: Digitized Results (6 cols) */}
          <div className="lg:col-span-6 flex flex-col gap-3">
            {/* Tab Header */}
            <div className="flex items-center justify-between border-b border-cyan-500/20 pb-2">
              <div className="flex rounded-lg bg-black/50 p-0.5 border border-cyan-500/30 text-xs font-mono">
                <button
                  onClick={() => setActiveTab("notes")}
                  className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                    activeTab === "notes" ? "bg-cyan-500 text-black font-bold" : "text-cyan-400 hover:text-white"
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" /> MARKDOWN
                </button>
                <button
                  onClick={() => setActiveTab("diagram")}
                  className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                    activeTab === "diagram" ? "bg-cyan-500 text-black font-bold" : "text-cyan-400 hover:text-white"
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5" /> DIAGRAM
                </button>
                <button
                  onClick={() => setActiveTab("tasks")}
                  className={`px-3 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
                    activeTab === "tasks" ? "bg-cyan-500 text-black font-bold" : "text-cyan-400 hover:text-white"
                  }`}
                >
                  <CheckSquare className="w-3.5 h-3.5" /> TASKS ({actionItems.length})
                </button>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {activeTab === "notes" && markdown && (
                  <>
                    <button
                      onClick={handleCopyMarkdown}
                      className="p-1.5 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 hover:text-white text-xs font-mono flex items-center gap-1"
                      title="Copy Markdown"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={handleSaveToNotes}
                      className="p-1.5 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-cyan-300 hover:text-white text-xs font-mono flex items-center gap-1"
                      title="Save to JARVIS Notes"
                    >
                      {savedNotes ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Save className="w-3.5 h-3.5" />}
                    </button>
                  </>
                )}
                {activeTab === "tasks" && actionItems.length > 0 && (
                  <button
                    onClick={handleAddTasks}
                    className="px-2.5 py-1 rounded-lg bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 text-xs font-mono flex items-center gap-1 hover:bg-cyan-500/40"
                  >
                    <Plus className="w-3.5 h-3.5" /> Sync to Tasks
                  </button>
                )}
              </div>
            </div>

            {/* Tab Body */}
            <div className="bg-black/60 border border-cyan-500/20 rounded-2xl p-4 min-h-[380px] max-h-[55vh] overflow-y-auto">
              {activeTab === "notes" ? (
                markdown ? (
                  <textarea
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                    className="w-full h-full min-h-[340px] bg-transparent text-xs font-mono text-cyan-100 focus:outline-none resize-none leading-relaxed"
                  />
                ) : (
                  <div className="h-full flex flex-col items-center justify-center py-20 text-center text-xs font-mono text-cyan-400/40">
                    <FileText className="w-8 h-8 mb-2 opacity-50 text-cyan-400" />
                    Point your camera at a whiteboard or paper note and click &quot;CAPTURE & OCR&quot;.
                  </div>
                )
              ) : activeTab === "diagram" ? (
                mermaidCode ? (
                  <div className="flex flex-col gap-3">
                    <div className="text-[11px] font-mono text-cyan-400/80 uppercase">
                      Detected Schematic Topology (Mermaid.js):
                    </div>
                    <pre className="p-3 rounded-xl bg-black/80 border border-cyan-500/20 text-xs font-mono text-cyan-300 whitespace-pre-wrap">
                      {mermaidCode}
                    </pre>
                    <div className="p-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 flex flex-col gap-2">
                      <span className="text-[11px] font-mono text-cyan-400 font-bold">SCHEMATIC FLOW:</span>
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                        <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">Camera Input</span>
                        <span>➔</span>
                        <span className="px-2 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">Edge Contrast Filter</span>
                        <span>➔</span>
                        <span className="px-2 py-1 rounded bg-green-500/20 text-green-300 border border-green-400/30">Markdown & Mermaid Graph</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center py-20 text-center text-xs font-mono text-cyan-400/40">
                    <GitBranch className="w-8 h-8 mb-2 opacity-50 text-cyan-400" />
                    Draw boxes, arrows, or mindmaps on your whiteboard to automatically generate Mermaid diagrams!
                  </div>
                )
              ) : (
                /* Action Items Tab */
                <div className="flex flex-col gap-2.5">
                  <div className="text-[11px] font-mono text-cyan-400/80 uppercase">
                    Extracted Whiteboard Directives:
                  </div>
                  {actionItems.length === 0 ? (
                    <div className="py-16 text-center text-xs font-mono text-cyan-400/40">
                      No actionable checklist items detected.
                    </div>
                  ) : (
                    actionItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl bg-[#040c1a] border border-cyan-500/20 flex items-center justify-between gap-2 text-xs font-mono"
                      >
                        <div className="flex items-center gap-2">
                          <CheckSquare className="w-4 h-4 text-cyan-400 shrink-0" />
                          <span className="text-white">{item}</span>
                        </div>
                        <button
                          onClick={() => {
                            addTask({ title: item, completed: false, priority: "high" });
                            speak(`Task added: ${item}`);
                          }}
                          className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/30 text-cyan-300 text-[10px] hover:bg-cyan-500/40"
                        >
                          + Add
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-cyan-500/20 bg-cyan-950/10 flex items-center justify-between text-[11px] font-mono text-cyan-400/60">
          <span>STARK WHITEBOARD VECTOR SCANNER v2.0</span>
          <span>IMAGE PRE-FILTER: {filterMode.toUpperCase()} · AI EXTRACTION ENGINE READY</span>
        </div>
      </div>
    </motion.div>
  );
}
