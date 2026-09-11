"use client";

// Mission Control — Tier 2A v3 hybrid engine UI.
// A live "mission briefing" view for the Firecrawl × Playwright hybrid
// goal engine: natural-language goal → LLM plan → DAG-parallel execution
// with live SSE events, engine badges (firecrawl / playwright), engine
// fallback notices, checkpoint dialogs, and the final report.
//
// Also renders the summary/notify step outputs as a classic agent view.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Send,
  Check,
  Loader2,
  Sparkles,
  RotateCcw,
  Globe,
  Search,
  Brain,
  FileText,
  Save,
  Bell,
  MousePointerClick,
  ExternalLink,
  HelpCircle,
  Activity,
  ChevronDown,
  ChevronUp,
  Radar,
  Zap,
} from "lucide-react";
import { STEP_KIND_LABELS, type AgentJob, type JobStatus } from "@/lib/agent/types";
import type { MissionEvent } from "@/lib/agent/events";
import { useJarvisStore } from "@/store/jarvis.store";
import Markdown from "@/components/panels/Markdown";

interface MissionControlPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = "idle" | "planning" | "preview" | "running" | "done" | "error";

const STATUS_COLOR: Record<JobStatus, string> = {
  planning: "text-text-secondary",
  awaiting_approval: "text-accent-amber",
  running: "text-reactor-core",
  paused_checkpoint: "text-accent-amber",
  done: "text-accent-green",
  failed: "text-accent-red",
  cancelled: "text-text-secondary/60",
};

const STATUS_LABEL: Record<JobStatus, string> = {
  planning: "Planning…",
  awaiting_approval: "Awaiting approval",
  running: "Running",
  paused_checkpoint: "Waiting for you",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const EXAMPLES = [
  "Find the best free React course and open the best one",
  "Find the Odoo documentation for module development, find a good tutorial, open both and summarise the important concepts",
  "Research the top 3 frameworks for building AI agents, open the docs of the winner",
];

// Icon per step kind — gives each step a visual identity in the plan.
const KIND_ICON: Record<string, React.ReactNode> = {
  firecrawl_search: <Search className="w-3 h-3" />,
  web_search: <Search className="w-3 h-3" />,
  web_scrape: <Globe className="w-3 h-3" />,
  firecrawl_extract: <Brain className="w-3 h-3" />,
  change_tracking: <Activity className="w-3 h-3" />,
  llm_decide: <Brain className="w-3 h-3" />,
  llm_summarize: <FileText className="w-3 h-3" />,
  deep_research: <Radar className="w-3 h-3" />,
  memory_store: <Save className="w-3 h-3" />,
  notify: <Bell className="w-3 h-3" />,
  playwright_action: <MousePointerClick className="w-3 h-3" />,
  browser_open: <ExternalLink className="w-3 h-3" />,
  checkpoint: <HelpCircle className="w-3 h-3" />,
};

interface LiveFeedItem {
  seq: number;
  type: MissionEvent["type"];
  message: string;
  at: number;
}

export default function MissionControlPanel({ isOpen, onClose }: MissionControlPanelProps) {
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<AgentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<LiveFeedItem[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [checkpointPick, setCheckpointPick] = useState("");
  const [checkpointQuestion, setCheckpointQuestion] = useState<string | null>(null);
  const [checkpointOptions, setCheckpointOptions] = useState<string[]>([]);
  const [autoOpened, setAutoOpened] = useState<string[]>([]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const autoOpenedRef = useRef<Set<string>>(new Set());

  // Goal handed over from the CommandBar (voice / chat) — auto-run on open.
  const pendingGoal = useJarvisStore((s) => s.pendingMissionGoal);
  const setPendingMissionGoal = useJarvisStore((s) => s.setPendingMissionGoal);

  /* ── live event stream (SSE) ─────────────────────────────────────── */

  const stopStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const startStream = useCallback(
    (jobId: string) => {
      stopStream();
      const es = new EventSource(`/api/agent/events?jobId=${encodeURIComponent(jobId)}`);
      esRef.current = es;
      es.addEventListener("mission", (ev: MessageEvent<string>) => {
        try {
          const e = JSON.parse(ev.data) as MissionEvent;
          if (e.type === "checkpoint") {
            const opts = Array.isArray(e.data?.options) ? (e.data?.options as unknown[]).map(String).slice(0, 5) : [];
            setCheckpointQuestion(e.message);
            setCheckpointOptions(opts);
          }
          setFeed((prev) => {
            // SSE replay + live overlap: dedupe on seq.
            if (prev.some((x) => x.seq === e.seq)) return prev;
            return [...prev, { seq: e.seq, type: e.type, message: e.message, at: e.at }].slice(-120);
          });
          // Client-side opener: browser_open steps queue URLs in the event
          // payload; window.open them on the gesture chain we still have.
          const openUrls = e.data?.openUrls;
          if (e.type === "log" && Array.isArray(openUrls)) {
            const urls = (openUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("http"));
            for (const u of urls) {
              if (!autoOpenedRef.current.has(u)) {
                autoOpenedRef.current.add(u);
                window.open(u, "_blank", "noopener");
              }
            }
            if (urls.length > 0) setAutoOpened((prev) => [...prev, ...urls]);
          }
        } catch {
          // malformed event — skip
        }
      });
      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do — the server replays
        // the buffer on reconnect and we dedupe on seq.
      };
    },
    [stopStream]
  );

  useEffect(() => {
    return () => {
      stopStream();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [stopStream]);

  /* ── status polling (source of truth for job state) ──────────────── */

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/agent?jobId=${encodeURIComponent(jobId)}`);
          if (!res.ok) return;
          const j: AgentJob = await res.json();
          setJob(j);
          if (j.status === "paused_checkpoint") {
            setCheckpointPick(""); // reset the free-text answer field
          } else {
            setCheckpointQuestion(null);
            setCheckpointOptions([]);
          }
          if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
            setPhase(j.status === "done" ? "done" : "error");
            stopPolling();
            stopStream();
          }
        } catch {
          // ignore
        }
      }, 1500);
    },
    [stopPolling, stopStream]
  );

  /* ── actions ─────────────────────────────────────────────────────── */

  const submitGoal = async (g?: string) => {
    const text = (g ?? goal).trim();
    if (!text) return;
    setError(null);
    setPhase("planning");
    setJob(null);
    setFeed([]);
    autoOpenedRef.current = new Set();
    setAutoOpened([]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j: AgentJob = await res.json();
      setJob(j);
      if (j.status === "failed") {
        setError(j.error || "Planning failed");
        setPhase("error");
      } else {
        setPhase("preview");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  const approve = async () => {
    if (!job) return;
    setPhase("running");
    setFeed([]);
    startStream(job.id);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "approve" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: AgentJob = await res.json();
      setJob(j);
      if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
        setPhase(j.status === "done" ? "done" : "error");
        stopStream();
        return;
      }
      startPolling(j.id);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      stopStream();
    }
  };

  const cancel = async () => {
    if (!job) return;
    stopPolling();
    stopStream();
    try {
      await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "cancel" }),
      });
    } catch {
      // ignore
    }
    setPhase("idle");
    setJob(null);
  };

  const resume = async (pick: string) => {
    if (!job || !pick.trim()) return;
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "resume", pick: pick.trim() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j: AgentJob = await res.json();
      setJob(j);
      setCheckpointQuestion(null);
      setCheckpointOptions([]);
      // The status poll from approve() is still running — it keeps tracking
      // until a terminal state. Only stop it if we somehow finished now.
      if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
        setPhase(j.status === "done" ? "done" : "error");
        stopPolling();
        stopStream();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reset = () => {
    stopPolling();
    stopStream();
    setJob(null);
    setPhase("idle");
    setError(null);
    setGoal("");
    setFeed([]);
    setCheckpointQuestion(null);
    setCheckpointOptions([]);
  };

  /* ── derived ─────────────────────────────────────────────────────── */

  // If the CommandBar handed us a goal (voice command or chat), auto-plan it
  // the moment the panel opens. Fires from a clean state or after a finished
  // mission — never mid-flight (planning/preview/running).
  useEffect(() => {
    if (!isOpen) return;
    const g = pendingGoal?.trim();
    if (!g) return;
    if (!(phase === "idle" || phase === "done" || phase === "error")) return;
    setPendingMissionGoal(null);
    setGoal(g);
    void submitGoal(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingGoal]);

  const status = job?.status;
  const doneSteps = job?.results.filter((r) => r.status === "ok").length ?? 0;
  const totalSteps = job?.plan?.steps.length ?? 0;
  const progress = totalSteps > 0 ? doneSteps / totalSteps : 0;

  // Auto-scroll feed.
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  // Latest llm_summarize / notify output — the "report" block.
  const summaryResult = useMemo(() => {
    if (!job) return null;
    for (const r of [...job.results].reverse()) {
      if (r.status !== "ok") continue;
      const out = r.result as Record<string, unknown> | undefined;
      const s = out?.summary;
      if (typeof s === "string" && s.trim()) return { stepId: r.stepId, summary: s };
    }
    return null;
  }, [job]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 20 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
        >
          <div className="relative w-full max-w-3xl h-[88vh] rounded-2xl overflow-hidden border border-reactor-core/30 shadow-[0_0_60px_rgba(0,243,255,0.15)] bg-deep-space/95 flex flex-col">
            {/* animated top beam */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-reactor-core to-transparent opacity-70" />
            <div className="absolute -top-10 left-1/4 w-1/2 h-20 bg-reactor-core/10 blur-3xl pointer-events-none" />

            {/* header */}
            <header className="relative flex items-center gap-3 px-5 py-3.5 border-b border-panel-border/40 flex-shrink-0">
              <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-reactor-core/10 border border-reactor-core/40">
                <Radar className="w-5 h-5 text-reactor-core" />
                {phase === "running" && (
                  <span className="absolute inset-0 rounded-lg border border-reactor-core/60 animate-ping opacity-40" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-orbitron text-sm tracking-[0.2em] uppercase text-reactor-core">
                  Mission Control
                </h2>
                <p className="text-[10px] font-rajdhani text-text-secondary/60 tracking-wider uppercase">
                  Hybrid web engine · firecrawl × playwright
                </p>
              </div>
              {status && (
                <span
                  className={`ml-2 text-[10px] font-rajdhani uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                    status === "running"
                      ? "border-reactor-core/50 bg-reactor-core/10 text-reactor-core"
                      : STATUS_COLOR[status] + " border-current/30 bg-current/5"
                  }`}
                >
                  {STATUS_LABEL[status]}
                </span>
              )}
              <button
                onClick={onClose}
                className="ml-auto p-1.5 hover:bg-accent-red/20 rounded-md transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-text-secondary/70" />
              </button>
            </header>

            {/* progress bar */}
            {phase === "running" && totalSteps > 0 && (
              <div className="h-0.5 w-full bg-panel-border/20 flex-shrink-0">
                <motion.div
                  className="h-full bg-gradient-to-r from-reactor-core to-reactor-glow"
                  animate={{ width: `${Math.round(progress * 100)}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* ── goal input ── */}
              {phase === "idle" || phase === "done" || phase === "error" ? (
                <section className="space-y-3">
                  <div className="relative">
                    <textarea
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          submitGoal();
                        }
                      }}
                      rows={2}
                      placeholder="Tell JARVIS the mission — e.g. “find the best free React course and open the best one”"
                      className="w-full bg-panel-glass/40 border border-panel-border/40 rounded-xl px-4 py-3 text-sm font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60 focus:ring-1 focus:ring-reactor-core/30 resize-none pr-12"
                    />
                    <button
                      onClick={() => submitGoal()}
                      disabled={!goal.trim()}
                      className="absolute right-3 bottom-3 p-2 bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 rounded-lg text-reactor-core disabled:opacity-30 transition-colors"
                      title="Plan the mission"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>

                  {phase === "idle" && (
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLES.map((ex) => (
                        <button
                          key={ex}
                          onClick={() => {
                            setGoal(ex);
                            submitGoal(ex);
                          }}
                          className="text-[10px] font-rajdhani px-2.5 py-1 rounded-full border border-panel-border/40 bg-panel-glass/30 text-text-secondary/80 hover:text-reactor-core hover:border-reactor-core/40 transition-colors truncate max-w-[280px]"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              ) : (
                /* compact goal strip while working */
                <section className="flex items-center gap-2 bg-panel-glass/30 border border-panel-border/30 rounded-lg px-3 py-2">
                  <Sparkles className="w-3.5 h-3.5 text-reactor-core flex-shrink-0" />
                  <span className="text-xs font-rajdhani text-text-primary truncate flex-1">{job?.goal}</span>
                  {phase !== "running" && phase !== "planning" && (
                    <button
                      onClick={cancel}
                      className="text-[10px] font-rajdhani uppercase tracking-wider text-accent-red/80 hover:text-accent-red transition-colors"
                    >
                      abort
                    </button>
                  )}
                </section>
              )}

              {/* ── planning indicator ── */}
              {phase === "planning" && (
                <div className="flex items-center gap-2 text-text-secondary/80 text-xs font-rajdhani">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-reactor-core" />
                  Decomposing the mission into steps…
                </div>
              )}

              {/* ── error ── */}
              {phase === "error" && error && (
                <div className="text-xs font-rajdhani text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg p-3">
                  {error}
                </div>
              )}

              {/* ── plan preview / live step list ── */}
              {job?.plan && phase !== "planning" && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-widest flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" /> {job.plan.summary}
                    </div>
                    {phase === "preview" && (
                      <button
                        onClick={approve}
                        className="px-3 py-1 bg-accent-green/20 hover:bg-accent-green/30 border border-accent-green/40 rounded-md text-accent-green text-[10px] font-rajdhani uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                      >
                        <Check className="w-3 h-3" /> Approve & launch
                      </button>
                    )}
                  </div>

                  <ol className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {job.plan.steps.map((s, i) => {
                      const result = job.results.find((r) => r.stepId === s.id);
                      const state =
                        result?.status === "ok"
                          ? "ok"
                          : result?.status === "error"
                            ? "error"
                            : result?.status === "skipped"
                              ? "skipped"
                              : phase === "running" && isActiveStep(job, s.id)
                                ? "active"
                                : "pending";
                      const hasOutput =
                        result?.status === "ok" &&
                        result.result != null &&
                        Object.keys(result.result as Record<string, unknown>).length > 0;
                      const open = expandedStep === s.id;
                      return (
                        <li
                          key={s.id}
                          className={`relative rounded-lg border px-3 py-2.5 transition-colors ${
                            state === "active"
                              ? "border-reactor-core/60 bg-reactor-core/10"
                              : state === "ok"
                                ? "border-accent-green/30 bg-accent-green/5"
                                : state === "error"
                                  ? "border-accent-red/40 bg-accent-red/10"
                                  : "border-panel-border/30 bg-deep-space/40"
                          }`}
                        >
                          <button
                            onClick={() => hasOutput && setExpandedStep(open ? null : s.id)}
                            className="w-full flex items-start gap-2.5 text-left"
                            disabled={!hasOutput}
                          >
                            <span
                              className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-orbitron ${
                                state === "ok"
                                  ? "bg-accent-green/20 text-accent-green"
                                  : state === "error"
                                    ? "bg-accent-red/20 text-accent-red"
                                    : state === "active"
                                      ? "bg-reactor-core/20 text-reactor-core"
                                      : "bg-panel-border/20 text-text-secondary/50"
                              }`}
                            >
                              {state === "ok" ? "✓" : state === "error" ? "✗" : state === "active" ? <Loader2 className="w-3 h-3 animate-spin" /> : i + 1}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[11px] font-rajdhani text-text-primary leading-snug">
                                {s.title}
                              </span>
                              <span className="mt-0.5 flex items-center gap-1 text-[9px] text-text-secondary/50 uppercase tracking-wider">
                                {KIND_ICON[s.kind]}
                                {STEP_KIND_LABELS[s.kind]}
                                {s.dependsOn?.length ? ` · after ${s.dependsOn.length}` : ""}
                              </span>
                              {result?.error && (
                                <span className="block text-[10px] text-accent-red/80 mt-1">{result.error}</span>
                              )}
                            </span>
                            {hasOutput && (open ? <ChevronUp className="w-3 h-3 text-text-secondary/60 mt-1" /> : <ChevronDown className="w-3 h-3 text-text-secondary/60 mt-1" />)}
                          </button>

                          {/* expandable step output */}
                          {open && hasOutput && (
                            <div className="mt-2 pt-2 border-t border-panel-border/30">
                              <StepOutput result={result!.result} />
                            </div>
                          )}

                          {/* active shimmer */}
                          {state === "active" && (
                            <span className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
                              <span className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-reactor-core/10 to-transparent animate-shimmer" />
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}

              {/* ── live feed ── */}
              {feed.length > 0 && (
                <section className="space-y-1.5">
                  <div className="text-[10px] font-orbitron text-text-secondary/60 uppercase tracking-widest flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-reactor-core/70" /> Live feed
                  </div>
                  <div
                    ref={feedRef}
                    className="max-h-44 overflow-y-auto rounded-lg border border-panel-border/30 bg-black/30 p-2.5 space-y-1 font-mono text-[10px] leading-relaxed"
                  >
                    {feed.map((f) => (
                      <div key={f.seq} className="flex gap-2 items-start">
                        <span className="text-text-secondary/40 flex-shrink-0">
                          {new Date(f.at).toLocaleTimeString([], { hour12: false })}
                        </span>
                        <span
                          className={
                            f.type === "error"
                              ? "text-accent-red"
                              : f.type === "checkpoint"
                                ? "text-accent-amber"
                                : f.type === "step_started"
                                  ? "text-reactor-core"
                                  : f.type === "step_finished"
                                    ? "text-accent-green/80"
                                    : "text-text-secondary/85"
                          }
                        >
                          {f.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── checkpoint dialog ── */}
              {status === "paused_checkpoint" && phase === "running" && (
                <section className="rounded-xl border border-accent-amber/40 bg-accent-amber/5 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-[10px] font-orbitron uppercase tracking-widest text-accent-amber">
                    <HelpCircle className="w-3.5 h-3.5" /> JARVIS needs your input
                  </div>
                  <p className="text-xs font-rajdhani text-text-primary">
                    {checkpointQuestion ?? "How should I proceed?"}
                  </p>
                  {checkpointOptions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {checkpointOptions.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => resume(opt)}
                          className="px-2.5 py-1 bg-accent-amber/10 hover:bg-accent-amber/25 border border-accent-amber/40 rounded-full text-[11px] font-rajdhani text-accent-amber transition-colors"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={checkpointPick}
                      onChange={(e) => setCheckpointPick(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && checkpointPick.trim()) resume(checkpointPick);
                      }}
                      placeholder="…or type your own answer"
                      className="flex-1 bg-deep-space/60 border border-panel-border/40 rounded px-2.5 py-1.5 text-xs font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-accent-amber/60"
                    />
                    <button
                      onClick={() => resume(checkpointPick)}
                      disabled={!checkpointPick.trim()}
                      className="px-3 py-1.5 bg-accent-amber/20 hover:bg-accent-amber/30 border border-accent-amber/40 rounded text-accent-amber text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-30 transition-colors"
                    >
                      Answer
                    </button>
                  </div>
                </section>
              )}

              {/* ── final summary / report ── */}
              {phase === "done" && (
                <section className="space-y-2">
                  {summaryResult && (
                    <div className="rounded-xl border border-reactor-core/30 bg-reactor-core/5 p-4">
                      <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Zap className="w-3 h-3" /> Mission findings
                      </div>
                      <Markdown content={summaryResult.summary} className="text-xs font-rajdhani text-text-primary/90" />
                    </div>
                  )}
                  {autoOpened.length > 0 && (
                    <div className="rounded-xl border border-panel-border/30 bg-panel-glass/30 p-3">
                      <div className="text-[10px] font-orbitron text-text-secondary/70 uppercase tracking-widest mb-1.5">
                        Opened in your browser ({autoOpened.length})
                      </div>
                      <div className="space-y-1">
                        {autoOpened.map((u) => (
                          <a
                            key={u}
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-[11px] font-rajdhani text-cyan-400 hover:text-cyan-300 truncate"
                          >
                            <ExternalLink className="w-3 h-3 flex-shrink-0" /> {u}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 text-xs font-rajdhani text-accent-green">
                      <Check className="w-3.5 h-3.5" /> Mission complete
                      {job?.creditsUsed != null && job.creditsUsed > 0 && (
                        <span className="text-[10px] text-text-secondary/50">· {job.creditsUsed} Firecrawl credits</span>
                      )}
                    </div>
                    <button
                      onClick={reset}
                      className="ml-auto px-2.5 py-1 bg-panel-glass/40 border border-panel-border/40 rounded-md text-text-secondary/80 hover:text-text-primary text-[10px] font-rajdhani uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> New mission
                    </button>
                  </div>
                </section>
              )}
            </div>

            {/* footer hint */}
            <footer className="px-5 py-2 border-t border-panel-border/30 text-[9px] font-rajdhani text-text-secondary/40 uppercase tracking-widest flex items-center gap-2 flex-shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-reactor-core/70 animate-pulse" />
              Say “mission: …” or “find … and open it” anywhere in the command bar — JARVIS routes it here
            </footer>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── helpers ───────────────────────────────────────────────────────── */

/** A step is "active" if it has no result yet while the job is running. */
function isActiveStep(job: AgentJob, stepId: string): boolean {
  return !job.results.some((r) => r.stepId === stepId);
}

/** Renders a step's result JSON in a compact, readable way. */
function StepOutput({ result }: { result: unknown }) {
  const out = result as Record<string, unknown> | undefined;
  if (!out || typeof out !== "object") {
    return <div className="text-[11px] font-rajdhani text-text-secondary/70">{String(result)}</div>;
  }

  // llm_summarize / deep_research / change_tracking summaries
  if (typeof out.summary === "string" && out.summary) {
    return <Markdown content={out.summary.slice(0, 3000)} className="text-[11px] font-rajdhani text-text-primary/85" />;
  }

  // search results
  if (Array.isArray(out.results) && out.results.length > 0) {
    return (
      <div className="space-y-1">
        {(out.results as Array<Record<string, unknown>>).slice(0, 8).map((r, i) => (
          <a
            key={i}
            href={String(r.url ?? "#")}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[11px] font-rajdhani text-cyan-400 hover:text-cyan-300 truncate"
          >
            {String(r.title ?? r.url ?? "result")}
          </a>
        ))}
      </div>
    );
  }

  // opened urls
  if (Array.isArray(out.urls)) {
    return (
      <div className="space-y-1">
        {(out.urls as string[]).map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block text-[11px] font-rajdhani text-cyan-400 hover:text-cyan-300 truncate">
            {u}
          </a>
        ))}
      </div>
    );
  }

  // fallback: pretty JSON, compact
  return (
    <pre className="text-[10px] font-mono text-text-secondary/80 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
      {JSON.stringify(out, null, 2).slice(0, 1500)}
    </pre>
  );
}
