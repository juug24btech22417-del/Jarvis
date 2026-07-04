"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, FileSearch, Loader2, CheckCircle2, AlertCircle, Globe, 
  ExternalLink, Play, Square, Terminal, Cpu, Layers, Compass, BookOpen, Copy
} from "lucide-react";
import { useTextToSpeech } from "@/hooks/useVoice";

interface TaskStatus {
  id: string;
  query: string;
  status: "planning" | "searching" | "scraping" | "synthesizing" | "completed" | "failed";
  progress: number;
  logs: string[];
  subQueries: { query: string; goal: string }[];
  visitedUrls: string[];
  extractedFactsCount: number;
  reportMarkdown?: string;
  notionUrl?: string;
}

export default function ResearchPanel() {
  const [query, setQuery] = useState("");
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskState, setTaskState] = useState<TaskStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"report" | "sources" | "queries">("report");
  const [copied, setCopied] = useState(false);
  
  const { speak, stop, isSpeaking } = useTextToSpeech();
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Poll status endpoint when a task is running
  useEffect(() => {
    if (!activeTaskId) return;

    let intervalId: any;
    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/research/status?id=${activeTaskId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && data.task) {
          setTaskState(data.task);
          
          if (data.task.status === "completed" || data.task.status === "failed") {
            clearInterval(intervalId);
            setActiveTaskId(null);
            setLoading(false);
          }
        }
      } catch (err) {
        console.error("Error polling research status:", err);
      }
    };

    fetchStatus();
    intervalId = setInterval(fetchStatus, 1500);

    return () => clearInterval(intervalId);
  }, [activeTaskId]);

  // Scroll to bottom of terminal console
  useEffect(() => {
    if (consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [taskState?.logs]);

  const handleResearch = async () => {
    if (!query) return;
    setLoading(true);
    setErrorMsg(null);
    setTaskState(null);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
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
    } else if (taskState?.reportMarkdown) {
      // Create a clean brief summary from report text
      const cleanSummary = taskState.reportMarkdown
        .replace(/[#*`_-]/g, "") // Strip markdown symbols
        .substring(0, 450);      // Grab first paragraph context
      
      const brief = `Boss, here is the executive brief for "${taskState.query}". ${cleanSummary}... The complete report has been successfully delivered to your Notion database.`;
      speak(brief);
    }
  };

  const handleCopyReport = () => {
    if (taskState?.reportMarkdown) {
      navigator.clipboard.writeText(taskState.reportMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-6 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 space-y-6 text-white"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/20 border border-violet-500/30">
            <Globe className="w-5 h-5 text-violet-400 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white/80">Oracle Research Engine</span>
            <span className="text-[10px] text-white/40 uppercase tracking-wider">Multi-Agent Intelligence Network</span>
          </div>
        </div>

        {taskState && (
          <div className="flex items-center gap-2">
            <div className={`px-2 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider ${
              taskState.status === "completed" 
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : taskState.status === "failed"
                ? "bg-red-500/10 border-red-500/30 text-red-400"
                : "bg-violet-500/10 border-violet-500/30 text-violet-400 animate-pulse"
            }`}>
              {taskState.status}
            </div>
            {taskState.progress < 100 && (
              <span className="text-xs font-mono text-white/60">{taskState.progress}%</span>
            )}
          </div>
        )}
      </div>

      {/* Main input when idle */}
      {!loading && !taskState && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-4 w-4 h-4 text-white/30" />
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="What research topic should Oracle analyze for you? (e.g. 'The latest innovations in solid-state batteries')"
              className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none text-sm transition-all resize-none h-24"
            />
          </div>

          <button
            onClick={handleResearch}
            disabled={!query}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-400 hover:to-fuchsia-500 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/25"
          >
            <FileSearch className="w-4 h-4" /> Launch Deep Research Protocol
          </button>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> {errorMsg}
            </div>
          )}
        </div>
      )}

      {/* Live progress and logs screen */}
      {taskState && taskState.status !== "completed" && taskState.status !== "failed" && (
        <div className="space-y-4">
          {/* Progress Bar */}
          <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-500"
              style={{ width: `${taskState.progress}%` }}
            />
          </div>

          {/* Core Analytics Dashboard metrics */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col gap-1 items-center justify-center text-center">
              <Cpu className="w-4 h-4 text-violet-400 mb-1" />
              <span className="text-[10px] text-white/40 uppercase">Subqueries</span>
              <span className="text-sm font-semibold font-mono">{taskState.subQueries.length}</span>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col gap-1 items-center justify-center text-center">
              <Compass className="w-4 h-4 text-fuchsia-400 mb-1" />
              <span className="text-[10px] text-white/40 uppercase">Crawled Sites</span>
              <span className="text-sm font-semibold font-mono">{taskState.visitedUrls.length}</span>
            </div>
            <div className="p-3 bg-white/5 rounded-xl border border-white/5 flex flex-col gap-1 items-center justify-center text-center">
              <Layers className="w-4 h-4 text-emerald-400 mb-1" />
              <span className="text-[10px] text-white/40 uppercase">Extracted Facts</span>
              <span className="text-sm font-semibold font-mono">{taskState.extractedFactsCount}</span>
            </div>
          </div>

          {/* Terminal Logs View */}
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

      {/* Finished view: Report Display & controls */}
      {taskState && (taskState.status === "completed" || taskState.status === "failed") && (
        <div className="space-y-4">
          {/* Tabs header */}
          <div className="flex gap-2 border-b border-white/5 pb-2 text-xs">
            <button 
              onClick={() => setActiveTab("report")}
              className={`pb-1 px-1 transition-all border-b-2 ${activeTab === "report" ? "border-violet-500 text-white font-medium" : "border-transparent text-white/40"}`}
            >
              📄 Executive Report
            </button>
            <button 
              onClick={() => setActiveTab("sources")}
              className={`pb-1 px-1 transition-all border-b-2 ${activeTab === "sources" ? "border-violet-500 text-white font-medium" : "border-transparent text-white/40"}`}
            >
              🌐 Scraped Links ({taskState.visitedUrls.length})
            </button>
            <button 
              onClick={() => setActiveTab("queries")}
              className={`pb-1 px-1 transition-all border-b-2 ${activeTab === "queries" ? "border-violet-500 text-white font-medium" : "border-transparent text-white/40"}`}
            >
              🧠 Plan Vectors
            </button>
          </div>

          {/* Tabs Body */}
          <div className="min-h-56 max-h-80 overflow-y-auto p-4 bg-black/20 border border-white/5 rounded-xl scrollbar-thin text-sm leading-relaxed">
            {activeTab === "report" && (
              <div className="whitespace-pre-wrap font-sans text-white/90 space-y-3">
                {taskState.reportMarkdown ? (
                  taskState.reportMarkdown
                ) : (
                  <div className="text-white/40 text-center py-8">
                    {taskState.status === "failed" ? "❌ Oracle deep research task failed to compile findings." : "No report markdown generated."}
                  </div>
                )}
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
                      <div className="text-xs font-semibold text-violet-400">Search: "{sub.query}"</div>
                      <div className="text-[11px] text-white/50">Goal: {sub.goal}</div>
                    </div>
                  ))
                ) : (
                  <div className="text-white/40 text-center py-8 font-mono text-xs">No vector queries structured.</div>
                )}
              </div>
            )}
          </div>

          {/* Quick-action Controls */}
          <div className="flex gap-2">
            {taskState.reportMarkdown && (
              <>
                <button
                  onClick={handleVoiceBriefing}
                  className={`flex-1 py-2.5 rounded-xl border flex items-center justify-center gap-2 font-medium text-xs transition-all ${
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
                      <Play className="w-3.5 h-3.5" /> Audio Summary
                    </>
                  )}
                </button>

                <button
                  onClick={handleCopyReport}
                  className="px-3.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white flex items-center justify-center transition-all"
                  title="Copy Report"
                >
                  {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-white/80" />}
                </button>
              </>
            )}

            {taskState.notionUrl && taskState.notionUrl.startsWith("http") && (
              <a
                href={taskState.notionUrl}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 hover:from-violet-400 hover:to-fuchsia-500 text-white font-semibold flex items-center justify-center gap-1.5 text-xs transition-all shadow-lg shadow-violet-500/20"
              >
                <BookOpen className="w-3.5 h-3.5" /> View in Notion <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <button
              onClick={() => {
                setTaskState(null);
                setQuery("");
              }}
              className="px-4 py-2.5 rounded-xl border border-white/10 hover:bg-white/5 text-xs text-white font-medium"
            >
              Reset
            </button>
          </div>
        </div>
      )}

      {/* Footer hint */}
      <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-[10px] text-white/40 leading-relaxed">
        {taskState && taskState.status !== "completed" && taskState.status !== "failed" ? (
          <span>Oracle is currently parsing search matrices and performing content audits. Closing this panel won't stop the background agent.</span>
        ) : (
          <span>Oracle decomposes your request into autonomous search plans, parses multi-domain details, builds structural facts, and saves the final result to Notion.</span>
        )}
      </div>
    </motion.div>
  );
}
