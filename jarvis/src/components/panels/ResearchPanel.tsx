"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, FileSearch, Loader2, CheckCircle2, AlertCircle, Globe,
  ExternalLink, Play, Square, Terminal, Cpu, Layers, Compass, BookOpen, Copy,
  History, ChevronRight, Mic, MessageSquarePlus, X, RotateCw, Library
} from "lucide-react";
import { useTextToSpeech } from "@/hooks/useVoice";
import StructuredReportView from "./StructuredReportView";
import {
  ALL_REPORT_TYPES,
  REPORT_TYPE_LABELS,
  type ReportType,
  type ResearchStatus,
} from "@/services/ResearchTypes";

interface LibraryReport {
  id: string;
  query: string;
  reportType: ReportType;
  status: string;
  notionUrl: string | null;
  createdAt: string;
  completedAt: string | null;
  factsCount: number;
  sourcesCount: number;
}

const TYPE_BADGE_COLOR: Record<ReportType, string> = {
  comparison: "border-amber-500/40 text-amber-300 bg-amber-500/10",
  deep_research: "border-violet-500/40 text-violet-300 bg-violet-500/10",
  news_roundup: "border-cyan-500/40 text-cyan-300 bg-cyan-500/10",
  briefing_memo: "border-emerald-500/40 text-emerald-300 bg-emerald-500/10",
  how_to: "border-fuchsia-500/40 text-fuchsia-300 bg-fuchsia-500/10",
  market_scan: "border-orange-500/40 text-orange-300 bg-orange-500/10",
};

export default function ResearchPanel() {
  const [query, setQuery] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskState, setTaskState] = useState<ResearchStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"report" | "sources" | "queries" | "tracks">("report");
  const [copied, setCopied] = useState(false);
  const [copiedBrief, setCopiedBrief] = useState(false);

  // Type classification
  const [inferredType, setInferredType] = useState<ReportType | null>(null);
  const [inferredSubjects, setInferredSubjects] = useState<string[]>([]);
  const [typeReasoning, setTypeReasoning] = useState<string>("");
  const [userOverrodeType, setUserOverrodeType] = useState(false);
  const [classifying, setClassifying] = useState(false);

  // Follow-up
  const [followupText, setFollowupText] = useState("");
  const [followupSending, setFollowupSending] = useState(false);

  // History sidebar
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<LibraryReport[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Parent report (when this panel run is a follow-up)
  const [parentReportId, setParentReportId] = useState<string | null>(null);
  const [parentQuery, setParentQuery] = useState<string | null>(null);

  const { speak, stop, isSpeaking } = useTextToSpeech();
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Debounced type classification as the user types.
  useEffect(() => {
    if (!query.trim() || userOverrodeType) {
      setInferredType(null);
      setInferredSubjects([]);
      setTypeReasoning("");
      return;
    }
    const t = setTimeout(() => classifyQuery(query), 600);
    return () => clearTimeout(t);
  }, [query, userOverrodeType]);

  async function classifyQuery(q: string) {
    setClassifying(true);
    try {
      const res = await fetch("/api/research/type", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setInferredType(data.type as ReportType);
          setInferredSubjects(data.subjects || []);
          setTypeReasoning(data.reasoning || "");
        }
      }
    } catch {
      // Best-effort. Don't surface a toast — the user can still pick a type.
    } finally {
      setClassifying(false);
    }
  }

  // Poll status endpoint when a task is running.
  useEffect(() => {
    if (!activeTaskId) return;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/research/status?id=${activeTaskId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.success && data.task) {
          setTaskState(data.task);
          if (data.task.status === "completed" || data.task.status === "failed") {
            if (intervalId) clearInterval(intervalId);
            setActiveTaskId(null);
            setLoading(false);
            // Refresh history so the new entry shows up.
            loadHistory();
          }
        }
      } catch (err) {
        console.error("Error polling research status:", err);
      }
    };

    fetchStatus();
    intervalId = setInterval(fetchStatus, 1500);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [activeTaskId]);

  // Auto-scroll terminal console.
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [taskState?.logs]);

  // History loader (lazy).
  async function loadHistory() {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/reports?limit=20");
      if (res.ok) {
        const data = await res.json();
        if (data.success) setHistory(data.reports || []);
      }
    } catch (e) {
      console.error("Failed to load history:", e);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (showHistory) loadHistory();
  }, [showHistory]);

  const handleResearch = async () => {
    if (!query) return;
    setLoading(true);
    setErrorMsg(null);
    setTaskState(null);
    setFollowupText("");

    const type = userOverrodeType && inferredType ? inferredType : (inferredType || "deep_research");

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          reportType: type,
          parentReportId: parentReportId || undefined,
        }),
      });

      const data = await res.json();
      if (data.success && data.researchId) {
        setActiveTaskId(data.researchId);
      } else {
        setErrorMsg(data.error || "Failed to start research task");
        setLoading(false);
      }
    } catch (err) {
      setErrorMsg("Network error starting research agent");
      setLoading(false);
    }
  };

  const handleVoiceBriefing = () => {
    if (isSpeaking) {
      stop();
      return;
    }
    if (!taskState) return;

    // Prefer the structured summary (it's tuned for 30s voice briefs);
    // fall back to the first 450 chars of the markdown if not available.
    const summary =
      taskState.structuredReport?.summary ||
      (taskState.reportMarkdown || "").replace(/[#*`_-]/g, "").substring(0, 450);

    const opener =
      taskState.reportType === "comparison"
        ? `Boss, here is the comparison brief for "${taskState.query}".`
        : taskState.reportType === "news_roundup"
        ? `Boss, here is the news roundup on "${taskState.query}".`
        : taskState.reportType === "briefing_memo"
        ? `Boss, here is the executive briefing on "${taskState.query}".`
        : taskState.reportType === "how_to"
        ? `Boss, here is a how-to for "${taskState.query}".`
        : taskState.reportType === "market_scan"
        ? `Boss, here is the market scan on "${taskState.query}".`
        : `Boss, here is the executive brief for "${taskState.query}".`;

    const tail = taskState.notionUrl?.startsWith("http")
      ? " The full report has been synced to your Notion."
      : " The full report is in the panel.";

    speak(`${opener} ${summary}.${tail}`);
  };

  const handleCopyReport = () => {
    if (!taskState?.reportMarkdown) return;
    navigator.clipboard.writeText(taskState.reportMarkdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyBrief = () => {
    if (!taskState?.structuredReport) return;
    navigator.clipboard.writeText(taskState.structuredReport.summary);
    setCopiedBrief(true);
    setTimeout(() => setCopiedBrief(false), 2000);
  };

  const handleFollowup = async () => {
    if (!followupText.trim() || !taskState) return;
    const reportId = taskState.id;
    setFollowupSending(true);
    try {
      const res = await fetch("/api/research/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parentReportId: reportId,
          followup: followupText.trim(),
        }),
      });
      const data = await res.json();
      if (data.success && data.researchId) {
        // Stash parent context so the next run can show it.
        setParentReportId(reportId);
        setParentQuery(taskState.query);
        setActiveTaskId(data.researchId);
        setLoading(true);
        setTaskState(null);
        setFollowupText("");
        setErrorMsg(null);
      } else {
        setErrorMsg(data.error || "Failed to start follow-up");
      }
    } catch (e) {
      setErrorMsg("Network error starting follow-up");
    } finally {
      setFollowupSending(false);
    }
  };

  const openHistoricalReport = (r: LibraryReport) => {
    // We don't re-hydrate the full task — just navigate to Notion if
    // available, otherwise fetch the stored structured blocks.
    if (r.notionUrl) {
      window.open(r.notionUrl, "_blank");
      return;
    }
    setShowHistory(false);
  };

  const resetAll = () => {
    setTaskState(null);
    setQuery("");
    setActiveTaskId(null);
    setLoading(false);
    setErrorMsg(null);
    setFollowupText("");
    setInferredType(null);
    setInferredSubjects([]);
    setTypeReasoning("");
    setUserOverrodeType(false);
    setParentReportId(null);
    setParentQuery(null);
  };

  const isRunning =
    loading ||
    (taskState !== null &&
      taskState.status !== "completed" &&
      taskState.status !== "failed");
  const isFinished =
    taskState !== null &&
    (taskState.status === "completed" || taskState.status === "failed");
  const showInput = !isRunning && !isFinished;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 space-y-6 text-white relative"
    >
      {/* History side panel */}
      <AnimatePresence>
        {showHistory && (
          <motion.aside
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: "tween", duration: 0.2 }}
            className="absolute right-0 top-0 bottom-0 w-80 z-20 bg-black/60 backdrop-blur-xl border-l border-white/10 rounded-r-3xl p-4 overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Library className="w-4 h-4 text-violet-400" /> Report Library
              </h3>
              <button
                onClick={() => setShowHistory(false)}
                className="p-1 rounded hover:bg-white/10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {historyLoading ? (
              <div className="text-xs text-white/40 flex items-center gap-2 py-4">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading...
              </div>
            ) : history.length === 0 ? (
              <div className="text-xs text-white/40 py-4">No past reports yet.</div>
            ) : (
              <div className="space-y-2">
                {history.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openHistoricalReport(r)}
                    className="w-full text-left p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                          TYPE_BADGE_COLOR[r.reportType] || TYPE_BADGE_COLOR.deep_research
                        }`}
                      >
                        {REPORT_TYPE_LABELS[r.reportType] || r.reportType}
                      </span>
                      {r.status !== "completed" && (
                        <span className="text-[9px] text-white/40">{r.status}</span>
                      )}
                    </div>
                    <p className="text-xs text-white/85 line-clamp-2 font-medium">
                      {r.query}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-white/40">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-white/40">
                        {r.sourcesCount > 0 && <span>{r.sourcesCount} sources</span>}
                        {r.notionUrl && (
                          <ExternalLink className="w-3 h-3 text-violet-400" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/20 border border-violet-500/30">
            <Globe className="w-5 h-5 text-violet-400 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white/80">Oracle Research Engine</span>
            <span className="text-[10px] text-white/40 uppercase tracking-wider">
              Multi-Agent Intelligence Network
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {taskState && (
            <div className="flex items-center gap-2">
              <div
                className={`px-2 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider ${
                  taskState.status === "completed"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : taskState.status === "failed"
                    ? "bg-red-500/10 border-red-500/30 text-red-400"
                    : "bg-violet-500/10 border-violet-500/30 text-violet-400 animate-pulse"
                }`}
              >
                {REPORT_TYPE_LABELS[taskState.reportType] || taskState.reportType} ·{" "}
                {taskState.status}
              </div>
              {taskState.progress < 100 && (
                <span className="text-xs font-mono text-white/60">{taskState.progress}%</span>
              )}
            </div>
          )}
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
            title="Report library"
          >
            <History className="w-4 h-4 text-white/60" />
          </button>
        </div>
      </div>

      {/* Main input (idle state) */}
      {showInput && (
        <div className="space-y-4">
          {parentQuery && (
            <div className="p-2 px-3 rounded-lg bg-violet-500/10 border border-violet-500/30 text-xs text-white/70 flex items-center gap-2">
              <ChevronRight className="w-3 h-3 text-violet-400" />
              <span>
                Follow-up to: <span className="text-white/90 italic">"{parentQuery}"</span>
              </span>
              <button
                onClick={() => {
                  setParentReportId(null);
                  setParentQuery(null);
                }}
                className="ml-auto text-white/40 hover:text-white/80"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-4 w-4 h-4 text-white/30" />
            <textarea
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (userOverrodeType) setUserOverrodeType(false);
              }}
              placeholder='What should Oracle research? Try "compare iPhone 17 Pro Max and Samsung Z Fold 7 with features and price"'
              className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none text-sm transition-all resize-none h-24"
            />
          </div>

          {/* Inferred type chip + override picker */}
          <div className="flex items-center gap-2 flex-wrap">
            {classifying ? (
              <span className="text-[10px] text-white/40 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> classifying...
              </span>
            ) : inferredType ? (
              <>
                <span className="text-[10px] text-white/40 uppercase tracking-wider">Inferred:</span>
                <span
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                    TYPE_BADGE_COLOR[inferredType]
                  }`}
                >
                  {REPORT_TYPE_LABELS[inferredType]}
                </span>
                {inferredSubjects.length > 0 && (
                  <span className="text-[10px] text-white/50">
                    · {inferredSubjects.join(" vs ")}
                  </span>
                )}
                {typeReasoning && (
                  <span
                    className="text-[10px] text-white/30 italic"
                    title={typeReasoning}
                  >
                    · {typeReasoning.slice(0, 50)}
                    {typeReasoning.length > 50 ? "..." : ""}
                  </span>
                )}
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-white/40 uppercase tracking-wider">
              Or pick:
            </span>
            {ALL_REPORT_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setInferredType(t);
                  setUserOverrodeType(true);
                }}
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border transition-colors ${
                  inferredType === t && userOverrodeType
                    ? TYPE_BADGE_COLOR[t]
                    : "border-white/10 text-white/40 hover:text-white/80"
                }`}
              >
                {REPORT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          <button
            onClick={handleResearch}
            disabled={!query}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-400 hover:to-fuchsia-500 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/25"
          >
            <FileSearch className="w-4 h-4" />
            Launch {REPORT_TYPE_LABELS[inferredType || "deep_research"]}
          </button>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {errorMsg}
            </div>
          )}
        </div>
      )}

      {/* Live progress HUD */}
      {isRunning && taskState && (
        <div className="space-y-4">
          {/* Progress bar */}
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500"
              style={{ width: `${taskState.progress}%` }}
            />
          </div>

          {/* Top metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col gap-1 items-center justify-center text-center">
              <Cpu className="w-4 h-4 text-violet-400 mb-1" />
              <span className="text-[10px] text-white/40 uppercase">Subqueries</span>
              <span className="text-sm font-semibold font-mono">
                {taskState.subQueries.length}
              </span>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col gap-1 items-center justify-center text-center">
              <Compass className="w-4 h-4 text-fuchsia-400 mb-1" />
              <span className="text-[10px] text-white/40 uppercase">Crawled Sites</span>
              <span className="text-sm font-semibold font-mono">
                {taskState.visitedUrls.length}
              </span>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col gap-1 items-center justify-center text-center">
              <Layers className="w-4 h-4 text-emerald-400 mb-1" />
              <span className="text-[10px] text-white/40 uppercase">Extracted Facts</span>
              <span className="text-sm font-semibold font-mono">
                {taskState.extractedFactsCount}
              </span>
            </div>
          </div>

          {/* Multi-track display (for comparisons) */}
          {taskState.tracks.length > 0 && (
            <div className="space-y-2">
              <span className="text-[10px] text-white/30 uppercase tracking-widest flex items-center gap-1 font-mono">
                <Layers className="w-3 h-3" /> Parallel Tracks
              </span>
              <div className="space-y-1.5">
                {taskState.tracks.map((track, i) => (
                  <div
                    key={i}
                    className="p-2 px-3 rounded-lg bg-white/5 border border-white/5 flex items-center gap-3"
                  >
                    <span className="text-[10px] font-mono text-violet-300 w-6">
                      #{i + 1}
                    </span>
                    <span className="text-xs text-white/85 font-medium flex-1 truncate">
                      {track.subject}
                    </span>
                    <div className="h-1 w-20 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${
                          track.status === "completed"
                            ? "bg-emerald-400"
                            : track.status === "failed"
                            ? "bg-red-400"
                            : "bg-violet-400"
                        } transition-all duration-500`}
                        style={{ width: `${track.progress}%` }}
                      />
                    </div>
                    <span
                      className={`text-[9px] font-mono uppercase w-16 text-right ${
                        track.status === "completed"
                          ? "text-emerald-400"
                          : track.status === "failed"
                          ? "text-red-400"
                          : "text-violet-300 animate-pulse"
                      }`}
                    >
                      {track.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live console */}
          <div className="space-y-1">
            <span className="text-[10px] text-white/30 uppercase tracking-widest flex items-center gap-1 font-mono">
              <Terminal className="w-3 h-3" /> Live Agent Feed
            </span>
            <div className="h-44 p-3 bg-black/40 border border-white/5 rounded-xl overflow-y-auto font-mono text-[11px] text-violet-300/80 space-y-1.5 scrollbar-thin">
              {taskState.logs.map((log, index) => (
                <div key={index} className="leading-relaxed">
                  {log}
                </div>
              ))}
              <div ref={consoleEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* Finished: tabs + actions */}
      {isFinished && taskState && (
        <div className="space-y-4">
          <div className="flex gap-2 border-b border-white/5 pb-2 text-xs overflow-x-auto">
            <button
              onClick={() => setActiveTab("report")}
              className={`pb-1 px-1 transition-all border-b-2 whitespace-nowrap ${
                activeTab === "report"
                  ? "border-violet-500 text-white font-medium"
                  : "border-transparent text-white/40"
              }`}
            >
              📄 Report
            </button>
            {taskState.tracks.length > 0 && (
              <button
                onClick={() => setActiveTab("tracks")}
                className={`pb-1 px-1 transition-all border-b-2 whitespace-nowrap ${
                  activeTab === "tracks"
                    ? "border-violet-500 text-white font-medium"
                    : "border-transparent text-white/40"
                }`}
              >
                ⚖️ Tracks ({taskState.tracks.length})
              </button>
            )}
            <button
              onClick={() => setActiveTab("sources")}
              className={`pb-1 px-1 transition-all border-b-2 whitespace-nowrap ${
                activeTab === "sources"
                  ? "border-violet-500 text-white font-medium"
                  : "border-transparent text-white/40"
              }`}
            >
              🌐 Sources ({taskState.visitedUrls.length})
            </button>
            <button
              onClick={() => setActiveTab("queries")}
              className={`pb-1 px-1 transition-all border-b-2 whitespace-nowrap ${
                activeTab === "queries"
                  ? "border-violet-500 text-white font-medium"
                  : "border-transparent text-white/40"
              }`}
            >
              🧠 Plan ({taskState.subQueries.length})
            </button>
          </div>

          {/* Tab body */}
          <div className="min-h-56 max-h-[28rem] overflow-y-auto p-4 bg-black/20 border border-white/5 rounded-xl scrollbar-thin text-sm leading-relaxed">
            {activeTab === "report" && (
              <div className="space-y-3">
                {taskState.structuredReport ? (
                  <>
                    {/* Executive summary callout — separately copyable for briefings. */}
                    <div className="rounded-xl p-3 bg-violet-500/10 border border-violet-500/30 flex items-start gap-2">
                      <span className="text-base flex-shrink-0">🧠</span>
                      <div className="flex-1">
                        <p className="text-white/90 italic leading-relaxed">
                          {taskState.structuredReport.summary}
                        </p>
                        <button
                          onClick={handleCopyBrief}
                          className="text-[10px] text-violet-300 hover:text-violet-200 mt-1 flex items-center gap-1"
                        >
                          {copiedBrief ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" /> copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> copy brief
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                    <StructuredReportView report={taskState.structuredReport} />
                  </>
                ) : taskState.reportMarkdown ? (
                  <div className="whitespace-pre-wrap font-sans text-white/90 space-y-3">
                    {taskState.reportMarkdown}
                  </div>
                ) : (
                  <div className="text-white/40 text-center py-8">
                    {taskState.status === "failed"
                      ? "❌ Oracle research task failed to compile findings."
                      : "No report generated."}
                  </div>
                )}
              </div>
            )}

            {activeTab === "tracks" && taskState.tracks.length > 0 && (
              <div className="space-y-3">
                {taskState.tracks.map((track, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-white/5 border border-white/5 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-violet-300">
                        #{i + 1} {track.subject}
                      </span>
                      <span
                        className={`text-[10px] font-mono uppercase ${
                          track.status === "completed"
                            ? "text-emerald-400"
                            : track.status === "failed"
                            ? "text-red-400"
                            : "text-white/40"
                        }`}
                      >
                        {track.status} · {track.factsCount} facts · {track.visitedUrls.length} sources
                      </span>
                    </div>
                    {track.subQueries.length > 0 && (
                      <ul className="text-[11px] text-white/60 list-disc list-inside space-y-0.5">
                        {track.subQueries.slice(0, 3).map((sq, j) => (
                          <li key={j}>{sq.query}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === "sources" && (
              <div className="space-y-2 font-mono text-xs">
                {taskState.visitedUrls.length > 0 ? (
                  taskState.visitedUrls.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between p-2 rounded bg-white/5 hover:bg-white/10 text-violet-300 hover:text-violet-200 transition-all"
                    >
                      <span className="truncate max-w-[90%]">{url}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  ))
                ) : (
                  <div className="text-white/40 text-center py-8">No sites scraped.</div>
                )}
              </div>
            )}

            {activeTab === "queries" && (
              <div className="space-y-3">
                {taskState.subQueries.length > 0 ? (
                  taskState.subQueries.map((sub, i) => (
                    <div key={i} className="p-3 rounded-lg bg-white/5 border border-white/5 space-y-1">
                      <div className="text-xs font-semibold text-violet-400">
                        Search: "{sub.query}"
                      </div>
                      <div className="text-[11px] text-white/50">Goal: {sub.goal}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-white/40 text-center py-8 font-mono text-xs">
                    No vector queries structured.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Voice brief + copy + open Notion + follow-up + reset */}
          <div className="flex gap-2 flex-wrap">
            {taskState.reportMarkdown && (
              <>
                <button
                  onClick={handleVoiceBriefing}
                  className={`flex-1 min-w-[140px] py-2.5 rounded-xl border flex items-center justify-center gap-2 font-medium text-xs transition-all ${
                    isSpeaking
                      ? "bg-red-500/10 border-red-500/30 hover:bg-red-500/20 text-red-400"
                      : "bg-violet-500/10 border-violet-500/20 hover:bg-violet-500/20 text-violet-300"
                  }`}
                >
                  {isSpeaking ? (
                    <>
                      <Square className="w-3.5 h-3.5" /> Stop Briefing
                    </>
                  ) : (
                    <>
                      <Mic className="w-3.5 h-3.5" /> Voice Brief
                    </>
                  )}
                </button>

                <button
                  onClick={handleCopyReport}
                  className="px-3.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white flex items-center justify-center transition-all"
                  title="Copy full report"
                >
                  {copied ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4 text-white/80" />
                  )}
                </button>
              </>
            )}

            {taskState.notionUrl && taskState.notionUrl.startsWith("http") && (
              <a
                href={taskState.notionUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 font-semibold flex items-center justify-center gap-1.5 text-xs hover:bg-emerald-500/20 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Auto-saved to Notion <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <button
              onClick={resetAll}
              className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs text-white font-medium flex items-center gap-1"
            >
              <RotateCw className="w-3 h-3" /> New
            </button>
          </div>

          {/* Follow-up input */}
          {taskState.status === "completed" && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
              <div className="flex items-center gap-2 text-[10px] text-white/40 uppercase tracking-wider">
                <MessageSquarePlus className="w-3 h-3" /> Ask follow-up
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={followupText}
                  onChange={(e) => setFollowupText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFollowup()}
                  placeholder='e.g. "tell me more about the cameras"'
                  className="flex-1 px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:border-violet-500/50 focus:outline-none"
                />
                <button
                  onClick={handleFollowup}
                  disabled={!followupText.trim() || followupSending}
                  className="px-4 py-2 rounded-lg bg-violet-500/20 border border-violet-500/40 text-violet-200 text-xs font-semibold hover:bg-violet-500/30 disabled:opacity-50 flex items-center gap-1"
                >
                  {followupSending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  Ask
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer hint */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-[10px] text-white/40 leading-relaxed">
        {isRunning ? (
          <span>
            Oracle is currently parsing search matrices and performing content audits. Closing
            this panel won't stop the background agent.
          </span>
        ) : isFinished && taskState?.status === "completed" ? (
          <span>
            Report delivered to Notion. Click <strong>Voice Brief</strong> to hear a 30-second
            summary, or <strong>Ask follow-up</strong> to dig deeper.
          </span>
        ) : (
          <span>
            Oracle decomposes your request into autonomous search plans, parses multi-domain
            details, builds structural facts, and saves the final result to Notion. Comparisons
            and follow-ups are first-class.
          </span>
        )}
      </div>
    </motion.div>
  );
}
