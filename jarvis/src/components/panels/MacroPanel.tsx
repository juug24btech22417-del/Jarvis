"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Film,
  Play,
  Square,
  Trash2,
  RefreshCw,
  Circle,
  Clock,
  Globe,
  Hash,
  AlertCircle,
  Zap,
  Eye,
  Monitor,
  MousePointer,
  Keyboard,
  Plus,
  Check,
  X,
  ChevronDown,
  ArrowLeft,
  Camera,
  Target,
} from "lucide-react";

interface Macro {
  id: string;
  name: string;
  description?: string;
  steps: Array<{
    id: string;
    action: string;
    target?: string;
    value?: string;
    description?: string;
    success?: boolean;
    error?: string;
    durationMs?: number;
  }>;
  createdAt: string;
  updatedAt: string;
  replayCount: number;
  lastReplayedAt?: string;
  tags: string[];
  isFormFill: boolean;
  targetUrl?: string;
}

interface RecordingStatus {
  sessionId?: string;
  isRecording: boolean;
  stepsRecorded: number;
  durationMs: number;
}

interface ReplayResult {
  success: boolean;
  macroName: string;
  totalSteps: number;
  stepsCompleted: number;
  stepsFailed: number;
  durationMs: number;
  results?: Array<{
    stepId: string;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
}

type RecordingMode = "browser" | "desktop";

export default function MacroPanel({ onClose }: { onClose: () => void }) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingStatus | null>(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ReplayResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("browser");

  // Desktop recording state
  const [desktopRecording, setDesktopRecording] = useState<{
    sessionId: string;
    macroId: string;
    screenshotPath: string;
  } | null>(null);
  const [desktopStep, setDesktopStep] = useState({
    action: "click",
    target: "",
    value: "",
    window: "",
    uia: null as any,
    uiaDesc: "",
  });
  const [desktopSteps, setDesktopSteps] = useState<Array<{
    action: string;
    target: string;
    value: string;
    description: string;
  }>>([]);
  const [screenshotBase64, setScreenshotBase64] = useState<string>("");
  const screenshotImgRef = useRef<HTMLImageElement>(null);

  const fetchMacros = useCallback(async () => {
    try {
      const res = await fetch("/api/ghost/macros");
      const data = await res.json();
      if (data.success) setMacros(data.macros);
    } catch {
      setError("Failed to load macros");
    } finally {
      setLoading(false);
    }
  }, []);

  const checkRecording = useCallback(async () => {
    try {
      // Check browser recording sessions
      const browserRes = await fetch("/api/ghost/macros/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const browserData = await browserRes.json();

      // Check desktop recording sessions
      const desktopRes = await fetch("/api/ghost/macros/desktop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const desktopData = await desktopRes.json();

      const browserSessions = browserData.success ? (browserData.sessions || []) : [];
      const desktopSessions = desktopData.success ? (desktopData.sessions || []) : [];
      const allSessions = [...browserSessions, ...desktopSessions];

      if (allSessions.length > 0) {
        setRecording(allSessions[0]);
      } else {
        setRecording(null);
      }
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    fetchMacros();
    checkRecording();
    const interval = setInterval(checkRecording, 3000);
    return () => clearInterval(interval);
  }, [fetchMacros, checkRecording]);

  // ─── Browser Recording ──────────────────────────────────────────────

  const handleStartRecording = async () => {
    if (!recordingUrl) return;
    setError(null);
    try {
      const res = await fetch("/api/ghost/macros/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", url: recordingUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setRecording({ sessionId: data.sessionId, isRecording: true, stepsRecorded: 0, durationMs: 0 });
        setRecordingUrl("");
      } else {
        setError(data.error || "Failed to start recording");
      }
    } catch (err: any) {
      setError(err?.message || "Recording failed");
    }
  };

  const handleStopRecording = async () => {
    try {
      const res = await fetch("/api/ghost/macros/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: recording?.sessionId }),
      });
      const data = await res.json();
      setRecording(null);
      if (data.success) {
        // Auto-refresh macros immediately
        await fetchMacros();
      } else {
        setError(data.error || "Failed to stop recording");
      }
    } catch (err: any) {
      setError(err?.message || "Stop failed");
      setRecording(null);
    }
  };

  // ─── Desktop Recording ──────────────────────────────────────────────

  const handleStartDesktopRecording = async () => {
    setError(null);
    try {
      const res = await fetch("/api/ghost/macros/desktop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (data.success) {
        setDesktopRecording({
          sessionId: data.sessionId,
          macroId: data.macroId,
          screenshotPath: data.screenshotPath,
        });
        setDesktopSteps([]);
        setScreenshotBase64(data.screenshotBase64 || "");
        setRecording({ sessionId: data.sessionId, isRecording: true, stepsRecorded: 0, durationMs: 0 });
      } else {
        setError(data.error || "Failed to start desktop recording");
      }
    } catch (err: any) {
      setError(err?.message || "Desktop recording failed");
    }
  };

  const handleAddDesktopStep = async () => {
    if (!desktopRecording) return;
    const desc = desktopStep.action === "launch"
      ? `Launch ${desktopStep.target}`
      : desktopStep.action === "click"
      ? `Click at (${desktopStep.target})`
      : desktopStep.action === "type"
      ? `Type "${desktopStep.value}"`
      : desktopStep.action === "press"
      ? `Press ${desktopStep.value}`
      : desktopStep.action === "wait"
      ? `Wait ${desktopStep.value || '1000'}ms`
      : `${desktopStep.action}`;    const stepData: any = {
      action: desktopStep.action,
      target: desktopStep.target,
      value: desktopStep.value,
      description: desc,
    };
    // Attach the semantic UIA target when we resolved one
    if (desktopStep.uia && (desktopStep.action === "click" || desktopStep.action === "type")) {
      stepData.options = { uia: desktopStep.uia };
      // Prefer the element name in the human description
      stepData.description = desktopStep.uiaDesc || stepData.description;
    } else if ((desktopStep.action === "click" || desktopStep.action === "type") && desktopStep.window) {
      stepData.targetWindow = desktopStep.window;
    }

    try {
      const res = await fetch("/api/ghost/macros/desktop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "addStep", sessionId: desktopRecording.sessionId, step: stepData }),
      });
      const data = await res.json();
      if (data.success) {
        setDesktopSteps((prev) => [...prev, stepData]);
        setDesktopStep({ action: desktopStep.action === 'launch' ? 'wait' : desktopStep.action, target: "", value: "", window: desktopStep.window, uia: null, uiaDesc: "" });
        // Auto-refresh screenshot
        if (data.screenshotBase64) {
          setScreenshotBase64(data.screenshotBase64);
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to add step");
    }
  };

  const handleRefreshScreenshot = async () => {
    if (!desktopRecording) return;
    try {
      const res = await fetch("/api/ghost/macros/desktop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refreshScreenshot", sessionId: desktopRecording.sessionId }),
      });
      const data = await res.json();
      if (data.success && data.screenshotBase64) {
        setScreenshotBase64(data.screenshotBase64);
      }
    } catch {
      // non-fatal
    }
  };

  const handleScreenshotClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!screenshotImgRef.current) return;
    const img = screenshotImgRef.current;
    const rect = img.getBoundingClientRect();

    // Guard against degenerate layout (image not laid out yet / collapsed)
    if (rect.width < 2 || rect.height < 2) return;

    // Convert to screenshot-pixel coordinates (image is a virtual-screen capture)
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    if (!isFinite(scaleX) || !isFinite(scaleY) || scaleX > 50 || scaleY > 50) return;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);

    // Reject points outside the captured bitmap (would click on another monitor / nowhere)
    if (x < 0 || y < 0 || x > img.naturalWidth || y > img.naturalHeight) return;

    setDesktopStep((p) => ({ ...p, action: "click", target: `${x},${y}`, uiaDesc: "" }));

    // Resolve the SEMANTIC element under the cursor via UIA
    try {
      const res = await fetch("/api/ghost/macros/desktop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "describePoint", x, y }),
      });
      const data = await res.json();
      if (data.success && data.uia) {
        setDesktopStep((p) => ({ ...p, uia: data.uia, uiaDesc: data.description }));
      } else {
        setDesktopStep((p) => ({ ...p, uia: null, uiaDesc: "" }));
      }
    } catch {
      setDesktopStep((p) => ({ ...p, uia: null, uiaDesc: "" }));
    }
  };

  const handleStopDesktopRecording = async () => {
    if (!desktopRecording) return;
    try {
      const res = await fetch("/api/ghost/macros/desktop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", sessionId: desktopRecording.sessionId }),
      });
      const data = await res.json();
      setDesktopRecording(null);
      setDesktopSteps([]);
      setScreenshotBase64("");
      setRecording(null);
      if (data.success) {
        // Auto-refresh macros immediately
        await fetchMacros();
      } else {
        setError(data.error || "Failed to stop");
      }
    } catch (err: any) {
      setError(err?.message || "Stop failed");
      setDesktopRecording(null);
      setRecording(null);
    }
  };

  // ─── Replay ─────────────────────────────────────────────────────────

  const handleReplay = async (macroId: string, isDesktop = false) => {
    setReplayingId(macroId);
    setLastResult(null);
    setError(null);
    try {
      const url = isDesktop ? "/api/ghost/macros/desktop" : "/api/ghost/macros/replay";
      const body = isDesktop
        ? { action: "replay", macroId }
        : { macroId };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success && data.result) {
        setLastResult(data.result);
        fetchMacros();
      } else {
        setError(data.error || "Replay failed");
      }
    } catch (err: any) {
      setError(err?.message || "Replay failed");
    } finally {
      setReplayingId(null);
    }
  };

  const handleDelete = async (macroId: string) => {
    try {
      await fetch(`/api/ghost/macros?id=${macroId}`, { method: "DELETE" });
      setMacros((prev) => prev.filter((m) => m.id !== macroId));
    } catch {
      setError("Delete failed");
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const isDesktopMacro = (macro: Macro) =>
    macro.tags.includes("desktop") || macro.name.toLowerCase().includes("desktop");

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-violet-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
      </div>

      {/* Header — scrollable during desktop recording so the screenshot + step
          builder (and the Add / Stop buttons) stay reachable on short screens */}
      <div className={
        desktopRecording
          ? "relative flex-1 min-h-0 overflow-y-auto p-6 pb-4 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
          : "relative p-6 pb-4"
      }>          <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/90 to-purple-600/90 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl">
                <Film className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white via-violet-100 to-purple-200 bg-clip-text text-transparent">
                Record & Replay
              </h3>
              <p className="text-xs text-violet-300/60 font-medium tracking-wide uppercase">
                Browser & Desktop Macro System
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-white/5 text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            ✕
          </button>
        </div>

        {/* Recording indicator */}
        <AnimatePresence>
          {recording?.isRecording && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-4 rounded-2xl bg-red-500/10 border border-red-500/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 1, repeat: Infinity }}
                  >
                    <Circle className="w-5 h-5 text-red-500 fill-red-500" />
                  </motion.div>
                  <div>
                    <p className="text-sm font-semibold text-red-300">
                      {desktopRecording ? "Desktop" : "Browser"} Recording Active
                    </p>
                    <p className="text-xs text-red-400/60">
                      {recording.stepsRecorded} steps captured ·{" "}
                      {formatDuration(recording.durationMs)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={desktopRecording ? handleStopDesktopRecording : handleStopRecording}
                  className="px-4 py-2 rounded-xl bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-all flex items-center gap-2 text-sm font-medium"
                >
                  <Square className="w-4 h-4" />
                  Stop & Save
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recording mode toggle — only when NOT recording */}
        {!recording?.isRecording && !desktopRecording && (
          <div className="mt-4 flex gap-2 mb-3">
            <button
              onClick={() => setRecordingMode("browser")}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                recordingMode === "browser"
                  ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                  : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/8"
              }`}
            >
              <Globe className="w-4 h-4" />
              Browser
            </button>
            <button
              onClick={() => setRecordingMode("desktop")}
              className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                recordingMode === "desktop"
                  ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                  : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/8"
              }`}
            >
              <Monitor className="w-4 h-4" />
              Desktop App
            </button>
          </div>
        )}

        {/* Back button — visible during desktop recording */}
        {desktopRecording && !recording?.isRecording && (
          <button
            onClick={() => {
              setDesktopRecording(null);
              setDesktopSteps([]);
              setScreenshotBase64("");
              setRecordingMode("browser");
            }}
            className="mt-3 flex items-center gap-2 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to Browser Mode
          </button>
        )}

        {/* Browser recording form */}
        {!recording?.isRecording && !desktopRecording && recordingMode === "browser" && (
          <>
            <div className="flex gap-2">
              <input
                type="url"
                value={recordingUrl}
                onChange={(e) => setRecordingUrl(e.target.value)}
                placeholder="e.g. https://github.com/login — paste any website URL"
                className="flex-1 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none text-sm transition-all"
                onKeyDown={(e) => e.key === "Enter" && handleStartRecording()}
              />
              <button
                onClick={handleStartRecording}
                disabled={!recordingUrl}
                className="px-6 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-semibold flex items-center gap-2 hover:from-violet-400 hover:to-purple-400 disabled:opacity-50 transition-all"
              >
                <Circle className="w-4 h-4 fill-red-500" />
                Record
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <p className="text-[10px] text-white/30">
                A browser window will open — interact with the page and JARVIS records your actions.
              </p>
              <button
                onClick={() => setRecordingUrl("https://example.com")}
                className="text-[10px] text-violet-400/60 hover:text-violet-300 transition-colors underline underline-offset-2"
              >
                Try with example.com
              </button>
            </div>
          </>
        )}

        {/* Desktop recording form — start button */}
        {!recording?.isRecording && !desktopRecording && recordingMode === "desktop" && (
          <>
            <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20 mb-2">
              <p className="text-sm text-blue-300/80 mb-2">
                <Monitor className="w-4 h-4 inline mr-1" />
                Desktop App Recording
              </p>
              <p className="text-xs text-white/40">
                Click on the screenshot to set click positions. No need to know coordinates —
                just click where you want to interact.
              </p>
            </div>
            <button
              onClick={handleStartDesktopRecording}
              className="w-full px-6 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:from-blue-400 hover:to-cyan-400 transition-all"
            >
              <Circle className="w-4 h-4 fill-red-500" />
              Start Desktop Recording
            </button>
          </>
        )}

        {/* Desktop recording — interactive screenshot + step builder */}
        {desktopRecording && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-4 space-y-3"
          >
            {/* Interactive screenshot */}
            {screenshotBase64 && (
              <div className="rounded-2xl bg-blue-500/10 border border-blue-500/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-blue-300 flex items-center gap-1.5">
                    <Camera className="w-3 h-3" />
                    Click an element on the screenshot — JARVIS identifies it by name
                  </p>
                  <button
                    onClick={handleRefreshScreenshot}
                    className="text-[10px] text-blue-400/60 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                </div>
                <div className="relative rounded-xl overflow-hidden bg-black/30 cursor-crosshair">
                  <img
                    ref={screenshotImgRef}
                    src={screenshotBase64}
                    alt="Desktop screenshot"
                    onClick={handleScreenshotClick}
                    className="w-full h-auto max-h-64 object-contain rounded-xl"
                    draggable={false}
                  />
                  {desktopStep.target && desktopStep.action === "click" && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${(() => {
                          if (!screenshotImgRef.current) return "0%";
                          const [x] = desktopStep.target.split(",").map(Number);
                          const img = screenshotImgRef.current;
                          const rect = img.getBoundingClientRect();
                          return `${(x / img.naturalWidth) * rect.width}px`;
                        })()}`,
                        top: `${(() => {
                          if (!screenshotImgRef.current) return "0%";
                          const [, y] = desktopStep.target.split(",").map(Number);
                          const img = screenshotImgRef.current;
                          const rect = img.getBoundingClientRect();
                          return `${(y / img.naturalHeight) * rect.height}px`;
                        })()}`,
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <Target className="w-5 h-5 text-red-500 drop-shadow-lg" />
                    </div>
                  )}
                </div>
                {desktopStep.target && desktopStep.action === "click" && (
                  <p className="text-[10px] text-white/30 mt-1 text-center">
                    {desktopStep.uiaDesc
                      ? `✓ ${desktopStep.uiaDesc}`
                      : `Raw coords: (${desktopStep.target}) — element not identified`}
                  </p>
                )}
              </div>
            )}

            {/* Step builder */}
            <div className="p-4 rounded-2xl bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm font-semibold text-blue-300 mb-3">Add Action</p>

              {/* Step type selector */}
              <div className="flex gap-2 mb-3 flex-wrap">
                {[
                  { val: "launch", icon: Globe, label: "Launch" },
                  { val: "click", icon: MousePointer, label: "Click" },
                  { val: "type", icon: Keyboard, label: "Type" },
                  { val: "press", icon: Zap, label: "Key" },
                  { val: "wait", icon: Clock, label: "Wait" },
                ].map(({ val, icon: Icon, label }) => (
                  <button
                    key={val}
                    onClick={() => setDesktopStep((p) => ({ ...p, action: val }))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 transition-all ${
                      desktopStep.action === val
                        ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                        : "bg-white/5 text-white/40 border border-white/10 hover:bg-white/8"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Target window — only for click/type actions */}
              {(desktopStep.action === "click" || desktopStep.action === "type") && (
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={desktopStep.window || ""}
                    onChange={(e) => setDesktopStep((p) => ({ ...p, window: e.target.value }))}
                    placeholder="Target window (e.g. Spotify, chrome) — coords will be relative to this window"
                    className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none text-xs"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch("/api/ghost/macros/desktop", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "detectForeground" }),
                        });
                        const data = await res.json();
                        if (data.success && data.processName) {
                          setDesktopStep((p) => ({ ...p, window: data.processName }));
                        }
                      } catch { /* non-fatal */ }
                    }}
                    className="px-3 py-2 rounded-lg bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10 transition-all text-xs flex items-center gap-1 border border-white/10"
                    title="Auto-detect the currently focused window"
                  >
                    <Target className="w-3 h-3" />
                    Detect
                  </button>
                </div>
              )}

              {/* Step inputs based on type */}
              <div className="flex gap-2">
                {desktopStep.action === "click" && (
                  <input
                    type="text"
                    value={desktopStep.target}
                    onChange={(e) => setDesktopStep((p) => ({ ...p, target: e.target.value }))}
                    placeholder="Click on screenshot above, or type x,y"
                    className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none text-xs"
                  />
                )}
                {desktopStep.action === "type" && (
                  <input
                    type="text"
                    value={desktopStep.value}
                    onChange={(e) => setDesktopStep((p) => ({ ...p, value: e.target.value }))}
                    placeholder="Text to type..."
                    className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none text-xs"
                  />
                )}
                {desktopStep.action === "press" && (
                  <select
                    value={desktopStep.value}
                    onChange={(e) => setDesktopStep((p) => ({ ...p, value: e.target.value }))}
                    className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white focus:border-blue-500/50 focus:outline-none text-xs"
                  >
                    <option value="">Select key...</option>
                    {["Enter", "Tab", "Escape", "Backspace", "Delete",
                      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
                      "Home", "End", "PageUp", "PageDown",
                      "F1", "F2", "F3", "F4", "F5", "F6",
                      "F7", "F8", "F9", "F10", "F11", "F12"].map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                )}
                {desktopStep.action === "launch" && (
                  <input
                    type="text"
                    value={desktopStep.target}
                    onChange={(e) => setDesktopStep((p) => ({ ...p, target: e.target.value }))}
                    placeholder="App name (spotify, chrome) or URL (https://...)"
                    className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none text-xs"
                  />
                )}
                {desktopStep.action === "wait" && (
                  <input
                    type="text"
                    value={desktopStep.value || "1000"}
                    onChange={(e) => setDesktopStep((p) => ({ ...p, value: e.target.value }))}
                    placeholder="ms (e.g. 1000)"
                    className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder-white/30 focus:border-blue-500/50 focus:outline-none text-xs"
                  />
                )}
                <button
                  onClick={handleAddDesktopStep}
                  disabled={
                    (desktopStep.action === "click" && !desktopStep.target) ||
                    (desktopStep.action === "launch" && !desktopStep.target)
                  }
                  className="px-4 py-2 rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-all flex items-center gap-1 text-xs font-medium disabled:opacity-40"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </button>
              </div>

              {/* Steps list */}
              {desktopSteps.length > 0 && (
                <div className="mt-3 space-y-1 max-h-32 overflow-auto">
                  {desktopSteps.map((s: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-white/50">
                      <span className="text-white/30 w-5 text-right font-mono">{i + 1}.</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        s.action === "launch" ? "bg-amber-500/20 text-amber-300"
                        : s.action === "click" ? "bg-blue-500/20 text-blue-300"
                        : s.action === "type" ? "bg-green-500/20 text-green-300"
                        : "bg-white/10 text-white/50"
                      }`}>
                        {s.action}
                      </span>
                      <span className="truncate flex-1">
                        {s.description}
                        {s.uiaResolved ? ' ✓ resolved' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 mb-4"
            >
              <p className="text-sm text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
                <button
                  onClick={() => setError(null)}
                  className="ml-auto text-red-400/60 hover:text-red-400"
                >
                  ✕
                </button>
              </p>
            </motion.div>
          )}

          {/* Last replay result — with step-by-step detail */}
          <AnimatePresence>
            {lastResult && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`p-4 rounded-2xl border mb-4 ${
                  lastResult.success
                    ? "bg-emerald-500/10 border-emerald-500/30"
                    : "bg-amber-500/10 border-amber-500/30"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className={`text-sm font-semibold ${
                      lastResult.success ? "text-emerald-300" : "text-amber-300"
                    }`}>
                      {lastResult.success ? "Replay Complete" : "Partial Replay"}
                    </p>
                    <p className="text-xs text-white/50 mt-1">
                      {lastResult.stepsCompleted}/{lastResult.totalSteps} steps ·{" "}
                      {formatDuration(lastResult.durationMs)}
                    </p>
                  </div>
                  <button
                    onClick={() => setLastResult(null)}
                    className="text-white/40 hover:text-white/70"
                  >
                    ✕
                  </button>
                </div>

                {/* Step-by-step breakdown */}
                {lastResult.results && lastResult.results.length > 0 && (
                  <div className="mt-3 space-y-1 max-h-40 overflow-auto">
                    {lastResult.results.map((r, i) => (
                      <div key={r.stepId} className="flex items-center gap-2 text-xs">
                        <span className="text-white/30 w-5 text-right font-mono">{i + 1}.</span>
                        {r.success ? (
                          <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        ) : (
                          <X className="w-3 h-3 text-red-400 flex-shrink-0" />
                        )}
                        <span className={`flex-1 truncate ${
                          r.success ? "text-white/50" : "text-red-400/70"
                        }`}>
                          {r.error || `Step ${i + 1}`}
                        </span>
                        <span className="text-white/20 text-[10px]">
                          {formatDuration(r.durationMs)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Macros list */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-white/40 font-medium uppercase tracking-wide">
              Saved Macros ({macros.length})
            </p>
            <button
              onClick={fetchMacros}
              className="p-1.5 rounded-lg bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10 transition-all"
              title="Refresh macros list"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-3">
            {macros.length === 0 ? (
              <div className="p-8 rounded-3xl bg-white/5 border border-white/10 text-center">
                <Film className="w-12 h-12 text-white/20 mx-auto mb-4" />
                <p className="text-white/60 mb-2">No macros saved yet</p>
                <p className="text-white/40 text-sm">
                  Choose Browser or Desktop mode above, then start recording.
                  <br />
                  <span className="text-violet-400/50">Record clicks, typing, navigation, and key presses.</span>
                </p>
              </div>
            ) : (
              macros.map((macro) => (
                <motion.div
                  key={macro.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/8 transition-all group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-white/80 truncate">
                          {macro.name}
                        </h4>
                        {isDesktopMacro(macro) && (
                          <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300/70 text-[10px]">
                            desktop
                          </span>
                        )}
                        {macro.isFormFill && (
                          <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300/70 text-[10px]">
                            form fill
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-white/40">
                        <span className="flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {macro.steps.length} steps
                        </span>
                        <span className="flex items-center gap-1">
                          <Play className="w-3 h-3" />
                          {macro.replayCount} replays
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(macro.updatedAt).toLocaleDateString("en-IN")}
                        </span>
                      </div>
                      {macro.targetUrl && (
                        <p className="text-xs text-white/30 mt-1 truncate flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {macro.targetUrl}
                        </p>
                      )}
                    </div>

                    <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === macro.id ? null : macro.id)
                        }
                        className="p-2 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 transition-all"
                        title="View steps"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleReplay(macro.id, isDesktopMacro(macro))}
                        disabled={replayingId === macro.id}
                        className="p-2 rounded-lg bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 transition-all disabled:opacity-50"
                        title="Replay macro"
                      >
                        {replayingId === macro.id ? (
                          <RefreshCw className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDelete(macro.id)}
                        className="p-2 rounded-lg bg-red-500/10 text-red-400/60 hover:bg-red-500/20 hover:text-red-400 transition-all"
                        title="Delete macro"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded steps view */}
                  <AnimatePresence>
                    {expandedId === macro.id && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-3 pt-3 border-t border-white/10"
                      >
                        <p className="text-xs text-white/50 mb-2 font-medium">Steps:</p>
                        <div className="space-y-1.5 max-h-40 overflow-auto">
                          {macro.steps.map((step, idx) => (
                            <div key={step.id} className="flex items-center gap-2 text-xs">
                              <span className="text-white/30 w-5 text-right font-mono">
                                {idx + 1}.
                              </span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                step.action === "launch"
                                  ? "bg-amber-500/20 text-amber-300"
                                  : step.action === "click"
                                  ? "bg-blue-500/20 text-blue-300"
                                  : step.action === "type"
                                  ? "bg-green-500/20 text-green-300"
                                  : step.action === "goto"
                                  ? "bg-cyan-500/20 text-cyan-300"
                                  : "bg-white/10 text-white/50"
                              }`}>
                                {step.action}
                              </span>
                              <span className="text-white/50 truncate flex-1">
                                {step.description || step.target || step.value || ""}
                              </span>
                            </div>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
