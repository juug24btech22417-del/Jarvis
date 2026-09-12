"use client";

import { useState, useEffect, useCallback } from "react";
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
}

export default function MacroPanel({ onClose }: { onClose: () => void }) {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingStatus | null>(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ReplayResult | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      const res = await fetch("/api/ghost/macros/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const data = await res.json();
      if (data.success && data.sessions?.length > 0) {
        setRecording(data.sessions[0]);
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
        fetchMacros();
      } else {
        setError(data.error || "Failed to stop recording");
      }
    } catch (err: any) {
      setError(err?.message || "Stop failed");
      setRecording(null);
    }
  };

  const handleReplay = async (macroId: string) => {
    setReplayingId(macroId);
    setLastResult(null);
    setError(null);
    try {
      const res = await fetch("/api/ghost/macros/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ macroId }),
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

      {/* Header */}
      <div className="relative p-6 pb-4">
        <div className="flex items-center justify-between">
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
                Browser Macro System
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
                      Recording Active
                    </p>
                    <p className="text-xs text-red-400/60">
                      {recording.stepsRecorded} steps captured ·{" "}
                      {formatDuration(recording.durationMs)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleStopRecording}
                  className="px-4 py-2 rounded-xl bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-all flex items-center gap-2 text-sm font-medium"
                >
                  <Square className="w-4 h-4" />
                  Stop & Save
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Start recording form */}
        {!recording?.isRecording && (
          <>
            <div className="mt-4 flex gap-2">
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
                A browser window will open — interact with the page and JARVIS records your actions. Say "stop recording" or click Stop & Save when done.
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

          {/* Last replay result */}
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
                <div className="flex items-center justify-between">
                  <div>
                    <p
                      className={`text-sm font-semibold ${
                        lastResult.success
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }`}
                    >
                      {lastResult.success ? "✅ Replay Complete" : "⚠️ Partial Replay"}
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* Macros list */}
          <div className="space-y-3">
            {macros.length === 0 ? (
              <div className="p-8 rounded-3xl bg-white/5 border border-white/10 text-center">
                <Film className="w-12 h-12 text-white/20 mx-auto mb-4" />
                <p className="text-white/60 mb-2">No macros saved yet</p>
                <p className="text-white/40 text-sm">
                  Paste a website URL above and click Record to capture your actions.
                  <br />
                  <span className="text-violet-400/50">e.g. a login page, job application form, or any site you want to automate.</span>
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
                          setExpandedId(
                            expandedId === macro.id ? null : macro.id
                          )
                        }
                        className="p-2 rounded-lg bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 transition-all"
                        title="View steps"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleReplay(macro.id)}
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
                        <p className="text-xs text-white/50 mb-2 font-medium">
                          Steps:
                        </p>
                        <div className="space-y-1.5 max-h-40 overflow-auto">
                          {macro.steps.map((step, idx) => (
                            <div
                              key={step.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              <span className="text-white/30 w-5 text-right font-mono">
                                {idx + 1}.
                              </span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                  step.action === "click"
                                    ? "bg-blue-500/20 text-blue-300"
                                    : step.action === "type"
                                    ? "bg-green-500/20 text-green-300"
                                    : step.action === "goto"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-white/10 text-white/50"
                                }`}
                              >
                                {step.action}
                              </span>
                              <span className="text-white/50 truncate flex-1">
                                {step.description ||
                                  step.target ||
                                  step.value ||
                                  ""}
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
