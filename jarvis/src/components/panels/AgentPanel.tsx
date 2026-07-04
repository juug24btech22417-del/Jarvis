"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, X, Check, Loader2, Sparkles, RotateCcw, Calendar, Trash2, Power, Inbox } from "lucide-react";
import { STEP_KIND_LABELS, type AgentJob, type JobStatus } from "@/lib/agent/types";

interface AgentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = "idle" | "planning" | "preview" | "running" | "done" | "error";
type Tab = "run" | "second-me" | "scheduled";

interface SecondMeBundle {
  summary: string;
  tasks: { title: string; priority?: string; due?: string }[];
  notes: { title: string; content: string; tags?: string[] }[];
  memoryCues: { name: string; type: string; description: string }[];
  timers: { label: string; minutes: number }[];
}

interface ScheduledJobView {
  id: string;
  name: string;
  cron: string;
  goal: string;
  enabled: boolean;
  lastRun: string | null;
}

const STATUS_COLOR: Record<JobStatus, string> = {
  planning: "text-text-secondary",
  awaiting_approval: "text-accent-amber",
  running: "text-reactor-core",
  done: "text-accent-green",
  failed: "text-accent-red",
  cancelled: "text-text-secondary/60",
};

const STATUS_LABEL: Record<JobStatus, string> = {
  planning: "Planning…",
  awaiting_approval: "Awaiting approval",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function AgentPanel({ isOpen, onClose }: AgentPanelProps) {
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<AgentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tier 2B: scheduled tab
  const [tab, setTab] = useState<Tab>("run");
  const [scheduled, setScheduled] = useState<ScheduledJobView[]>([]);
  const [schedError, setSchedError] = useState<string | null>(null);
  const [schedNew, setSchedNew] = useState({ name: "", cron: "0 8 * * *", goal: "" });
  const [schedBusy, setSchedBusy] = useState(false);

  // Tier 2D: second-me tab
  const [secondInput, setSecondInput] = useState("");
  const [secondBundle, setSecondBundle] = useState<SecondMeBundle | null>(null);
  const [secondBusy, setSecondBusy] = useState(false);
  const [secondError, setSecondError] = useState<string | null>(null);
  const [secondApplied, setSecondApplied] = useState<{ tasks: number; notes: number; memoryCues: number; timers: number } | null>(null);

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
          if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
            setPhase(j.status === "done" ? "done" : "error");
            stopPolling();
          }
        } catch {
          // ignore
        }
      }, 1200);
    },
    [stopPolling]
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  const refreshScheduled = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/schedule");
      if (!res.ok) return;
      const data = await res.json();
      setScheduled(data.jobs ?? []);
    } catch {
      // ignore
    }
  }, []);

  // Tier 2B: refresh scheduled list when the panel opens or tab flips.
  useEffect(() => {
    if (isOpen && tab === "scheduled") refreshScheduled();
  }, [isOpen, tab, refreshScheduled]);

  const createScheduled = async () => {
    if (!schedNew.name.trim() || !schedNew.goal.trim()) return;
    setSchedError(null);
    setSchedBusy(true);
    try {
      const res = await fetch("/api/agent/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(schedNew),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      setSchedNew({ name: "", cron: "0 8 * * *", goal: "" });
      await refreshScheduled();
    } catch (e) {
      setSchedError((e as Error).message);
    } finally {
      setSchedBusy(false);
    }
  };

  const toggleScheduled = async (id: string, enabled: boolean) => {
    try {
      await fetch("/api/agent/schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled }),
      });
      await refreshScheduled();
    } catch {
      // ignore
    }
  };

  const deleteScheduled = async (id: string) => {
    try {
      await fetch(`/api/agent/schedule?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await refreshScheduled();
    } catch {
      // ignore
    }
  };

  // Tier 2D handlers
  const parseSecondMe = async () => {
    if (!secondInput.trim()) return;
    setSecondError(null);
    setSecondApplied(null);
    setSecondBusy(true);
    try {
      const res = await fetch("/api/agent/second-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: secondInput }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSecondBundle(data.bundle);
    } catch (e) {
      setSecondError((e as Error).message);
    } finally {
      setSecondBusy(false);
    }
  };

  const applySecondMe = async () => {
    if (!secondInput.trim()) return;
    setSecondError(null);
    setSecondBusy(true);
    try {
      const res = await fetch("/api/agent/second-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: secondInput, apply: true }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setSecondBundle(data.bundle);
      setSecondApplied(data.applied);
    } catch (e) {
      setSecondError((e as Error).message);
    } finally {
      setSecondBusy(false);
    }
  };

  const submitGoal = async () => {
    const g = goal.trim();
    if (!g) return;
    setError(null);
    setPhase("planning");
    setJob(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: g }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j: AgentJob = await res.json();
      setJob(j);
      if (j.status === "awaiting_approval") setPhase("preview");
      else if (j.status === "failed") {
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
        return;
      }
      startPolling(j.id);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  const cancel = async () => {
    if (!job) return;
    stopPolling();
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

  const reset = () => {
    stopPolling();
    setJob(null);
    setPhase("idle");
    setError(null);
    setGoal("");
  };

  const status = job?.status;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, x: 40, scale: 0.97 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.97 }}
          transition={{ duration: 0.2 }}
          className="fixed top-4 right-4 z-50 w-[460px] max-h-[80vh] bg-deep-space/95 border border-reactor-core/30 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,243,255,0.2)] flex flex-col backdrop-blur-md"
        >
          <div className="flex flex-col h-full gap-3 p-3 overflow-y-auto">
            <header className="flex items-center gap-2 flex-shrink-0">
              <Bot className="w-4 h-4 text-reactor-core" />
              <h2 className="text-sm font-orbitron tracking-wider uppercase text-reactor-core">Agent</h2>
              {status && (
                <span className={`text-[10px] font-rajdhani uppercase tracking-wider ml-2 ${STATUS_COLOR[status]}`}>
                  {STATUS_LABEL[status]}
                </span>
              )}
              <button
                onClick={onClose}
                className="ml-auto p-1 hover:bg-accent-red/20 rounded transition-colors"
                title="Close"
              >
                <X className="w-3.5 h-3.5 text-text-secondary/70" />
              </button>
            </header>

            {/* Tab switcher */}
            <div className="flex gap-1 flex-shrink-0 border-b border-panel-border/40">
              <button
                onClick={() => setTab("run")}
                className={`px-3 py-1 text-[10px] font-rajdhani uppercase tracking-wider rounded-t transition-colors ${
                  tab === "run"
                    ? "bg-reactor-core/15 text-reactor-core border-b border-reactor-core/60"
                    : "text-text-secondary/60 hover:text-text-secondary"
                }`}
              >
                <Sparkles className="w-3 h-3 inline-block mr-1" /> Run
              </button>
              <button
                onClick={() => setTab("second-me")}
                className={`px-3 py-1 text-[10px] font-rajdhani uppercase tracking-wider rounded-t transition-colors ${
                  tab === "second-me"
                    ? "bg-reactor-core/15 text-reactor-core border-b border-reactor-core/60"
                    : "text-text-secondary/60 hover:text-text-secondary"
                }`}
              >
                <Inbox className="w-3 h-3 inline-block mr-1" /> Second me
              </button>
              <button
                onClick={() => setTab("scheduled")}
                className={`px-3 py-1 text-[10px] font-rajdhani uppercase tracking-wider rounded-t transition-colors ${
                  tab === "scheduled"
                    ? "bg-reactor-core/15 text-reactor-core border-b border-reactor-core/60"
                    : "text-text-secondary/60 hover:text-text-secondary"
                }`}
              >
                <Calendar className="w-3 h-3 inline-block mr-1" /> Scheduled
              </button>
            </div>

            {tab === "run" && (
              <>
            {/* Goal input */}
            <div className="flex gap-2 flex-shrink-0">
              <input
                type="text"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (phase === "idle" || phase === "done" || phase === "error") submitGoal();
                  }
                }}
                placeholder="Give JARVIS a goal… (e.g. summarize today's top tech news into 3 bullets and save to memory)"
                disabled={phase === "planning" || phase === "running"}
                className="flex-1 bg-panel-glass/40 border border-panel-border/40 rounded px-3 py-2 text-xs font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60"
              />
              {phase === "idle" || phase === "done" || phase === "error" ? (
                <button
                  onClick={submitGoal}
                  disabled={!goal.trim()}
                  className="px-3 py-2 bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 rounded text-reactor-core disabled:opacity-30 transition-colors"
                  title="Plan a goal"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  onClick={cancel}
                  className="px-3 py-2 bg-accent-red/20 hover:bg-accent-red/30 border border-accent-red/40 rounded text-accent-red transition-colors"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Planning indicator */}
            {phase === "planning" && (
              <div className="flex items-center gap-2 text-text-secondary/70 text-xs font-rajdhani">
                <Loader2 className="w-3 h-3 animate-spin" /> Decomposing goal into steps…
              </div>
            )}

            {/* Error */}
            {phase === "error" && error && (
              <div className="text-xs font-rajdhani text-accent-red bg-accent-red/10 border border-accent-red/30 rounded p-2">
                {error}
              </div>
            )}

            {/* Plan preview */}
            {job?.plan && (phase === "preview" || phase === "running" || phase === "done") && (
              <section className="bg-panel-glass/30 border border-panel-border/40 rounded p-2 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-wider">
                    <Sparkles className="w-3 h-3 inline-block mr-1" />
                    {job.plan.summary}
                  </div>
                  {phase === "preview" && (
                    <button
                      onClick={approve}
                      className="px-2 py-1 bg-accent-green/20 hover:bg-accent-green/30 border border-accent-green/40 rounded text-accent-green text-[10px] font-rajdhani uppercase tracking-wider flex items-center gap-1"
                    >
                      <Check className="w-3 h-3" /> Approve
                    </button>
                  )}
                </div>
                <ol className="space-y-1">
                  {job.plan.steps.map((s, i) => {
                    const result = job.results.find((r) => r.stepId === s.id);
                    const icon =
                      result?.status === "ok" ? "✓" : result?.status === "error" ? "✗" : result?.status === "skipped" ? "—" : `${i + 1}`;
                    const iconColor =
                      result?.status === "ok"
                        ? "text-accent-green"
                        : result?.status === "error"
                          ? "text-accent-red"
                          : result?.status === "skipped"
                            ? "text-text-secondary/40"
                            : "text-reactor-core/60";
                    return (
                      <li
                        key={s.id}
                        className="flex items-start gap-2 text-[11px] font-rajdhani text-text-primary/90 bg-deep-space/40 border border-panel-border/30 rounded px-2 py-1.5"
                      >
                        <span className={`font-orbitron text-xs ${iconColor} flex-shrink-0 w-4`}>{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-text-primary">{s.title}</div>
                          <div className="text-[9px] text-text-secondary/50 uppercase tracking-wider mt-0.5">
                            {STEP_KIND_LABELS[s.kind]}
                            {s.dependsOn?.length ? ` · after: ${s.dependsOn.join(", ")}` : ""}
                          </div>
                          {result?.error && (
                            <div className="text-[10px] text-accent-red/80 mt-1">{result.error}</div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* Final result hint */}
            {phase === "done" && (
              <div className="flex items-center gap-2 text-xs font-rajdhani text-accent-green">
                <Check className="w-3 h-3" /> Plan completed.
                <button
                  onClick={reset}
                  className="ml-auto px-2 py-1 bg-panel-glass/40 border border-panel-border/40 rounded text-text-secondary/80 hover:text-text-primary text-[10px] uppercase tracking-wider flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> New goal
                </button>
              </div>
            )}
              </>
            )}

            {/* Tier 2B: Scheduled tab */}
            {tab === "scheduled" && (
              <div className="flex flex-col gap-3">
                <section className="bg-panel-glass/30 border border-panel-border/40 rounded p-2 space-y-2">
                  <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-wider">
                    New scheduled goal
                  </div>
                  <input
                    type="text"
                    value={schedNew.name}
                    onChange={(e) => setSchedNew({ ...schedNew, name: e.target.value })}
                    placeholder="Name (e.g. Morning news brief)"
                    className="w-full bg-deep-space/40 border border-panel-border/30 rounded px-2 py-1.5 text-xs font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60"
                  />
                  <input
                    type="text"
                    value={schedNew.cron}
                    onChange={(e) => setSchedNew({ ...schedNew, cron: e.target.value })}
                    placeholder="Cron (e.g. 0 8 * * *)"
                    className="w-full bg-deep-space/40 border border-panel-border/30 rounded px-2 py-1.5 text-xs font-mono placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60"
                  />
                  <textarea
                    value={schedNew.goal}
                    onChange={(e) => setSchedNew({ ...schedNew, goal: e.target.value })}
                    placeholder="Goal…"
                    rows={2}
                    className="w-full bg-deep-space/40 border border-panel-border/30 rounded px-2 py-1.5 text-xs font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60 resize-none"
                  />
                  {schedError && (
                    <div className="text-[10px] text-accent-red font-rajdhani">{schedError}</div>
                  )}
                  <button
                    onClick={createScheduled}
                    disabled={schedBusy || !schedNew.name.trim() || !schedNew.goal.trim()}
                    className="w-full px-3 py-1.5 bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 rounded text-reactor-core text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-30 transition-colors"
                  >
                    {schedBusy ? "Scheduling…" : "Schedule"}
                  </button>
                </section>

                <section className="space-y-1">
                  {scheduled.length === 0 ? (
                    <div className="text-[10px] text-text-secondary/50 font-rajdhani text-center py-4">
                      No scheduled jobs yet.
                    </div>
                  ) : (
                    scheduled.map((s) => (
                      <div
                        key={s.id}
                        className="bg-deep-space/40 border border-panel-border/30 rounded px-2 py-1.5 space-y-0.5"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-rajdhani ${s.enabled ? "text-text-primary" : "text-text-secondary/40 line-through"}`}>
                            {s.name}
                          </span>
                          <span className="text-[9px] font-mono text-text-secondary/60 ml-auto">{s.cron}</span>
                          <button
                            onClick={() => toggleScheduled(s.id, !s.enabled)}
                            className={`p-1 rounded transition-colors ${
                              s.enabled ? "text-accent-green hover:bg-accent-green/20" : "text-text-secondary/50 hover:bg-panel-glass/40"
                            }`}
                            title={s.enabled ? "Disable" : "Enable"}
                          >
                            <Power className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => deleteScheduled(s.id)}
                            className="p-1 text-text-secondary/60 hover:text-accent-red hover:bg-accent-red/20 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="text-[10px] text-text-secondary/70 font-rajdhani line-clamp-2">
                          {s.goal}
                        </div>
                        {s.lastRun && (
                          <div className="text-[9px] text-text-secondary/40 font-rajdhani">
                            last run: {new Date(s.lastRun).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </section>
              </div>
            )}

            {/* Tier 2D: Second Me tab */}
            {tab === "second-me" && (
              <div className="flex flex-col gap-3">
                <section className="bg-panel-glass/30 border border-panel-border/40 rounded p-2 space-y-2">
                  <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-wider">
                    Drop a brief
                  </div>
                  <p className="text-[10px] text-text-secondary/60 font-rajdhani">
                    Paste an email, job description, meeting note, or instruction. I'll extract tasks, notes, memory cues, and timers.
                  </p>
                  <textarea
                    value={secondInput}
                    onChange={(e) => setSecondInput(e.target.value)}
                    placeholder="e.g. I need to follow up with Acme Corp by Friday about the Q3 proposal. Also remind me to book a flight to Bangalore for the offsite next Wednesday."
                    rows={5}
                    className="w-full bg-deep-space/40 border border-panel-border/30 rounded px-2 py-1.5 text-xs font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60 resize-none"
                  />
                  {secondError && (
                    <div className="text-[10px] text-accent-red font-rajdhani">{secondError}</div>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={parseSecondMe}
                      disabled={secondBusy || !secondInput.trim()}
                      className="flex-1 px-3 py-1.5 bg-panel-glass/60 hover:bg-panel-glass/80 border border-panel-border/40 rounded text-text-primary text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-30 transition-colors"
                    >
                      {secondBusy ? "Parsing…" : "Preview"}
                    </button>
                    <button
                      onClick={applySecondMe}
                      disabled={secondBusy || !secondInput.trim()}
                      className="flex-1 px-3 py-1.5 bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 rounded text-reactor-core text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-30 transition-colors"
                    >
                      {secondBusy ? "Applying…" : "Apply all"}
                    </button>
                  </div>
                </section>

                {secondApplied && (
                  <div className="text-[10px] font-rajdhani text-accent-green bg-accent-green/10 border border-accent-green/30 rounded p-2">
                    Applied: {secondApplied.tasks} task{secondApplied.tasks !== 1 ? "s" : ""}, {secondApplied.notes} note{secondApplied.notes !== 1 ? "s" : ""}, {secondApplied.memoryCues} memory cue{secondApplied.memoryCues !== 1 ? "s" : ""}, {secondApplied.timers} timer{secondApplied.timers !== 1 ? "s" : ""}.
                  </div>
                )}

                {secondBundle && (
                  <section className="space-y-2">
                    {secondBundle.summary && (
                      <div className="text-[10px] text-text-secondary/80 font-rajdhani italic px-1">
                        {secondBundle.summary}
                      </div>
                    )}

                    {secondBundle.tasks.length > 0 && (
                      <BundleGroup label={`Tasks (${secondBundle.tasks.length})`}>
                        {secondBundle.tasks.map((t, i) => (
                          <BundleRow key={`t-${i}`}>
                            <Check className="w-3 h-3 text-reactor-core flex-shrink-0" />
                            <span className="flex-1">{t.title}</span>
                            {t.priority && (
                              <span className="text-[9px] text-text-secondary/60 uppercase">{t.priority}</span>
                            )}
                            {t.due && (
                              <span className="text-[9px] text-text-secondary/60">{t.due}</span>
                            )}
                          </BundleRow>
                        ))}
                      </BundleGroup>
                    )}

                    {secondBundle.notes.length > 0 && (
                      <BundleGroup label={`Notes (${secondBundle.notes.length})`}>
                        {secondBundle.notes.map((n, i) => (
                          <BundleRow key={`n-${i}`}>
                            <div className="flex-1">
                              <div className="text-text-primary">{n.title}</div>
                              <div className="text-[10px] text-text-secondary/70 line-clamp-2">{n.content}</div>
                            </div>
                          </BundleRow>
                        ))}
                      </BundleGroup>
                    )}

                    {secondBundle.memoryCues.length > 0 && (
                      <BundleGroup label={`Memory cues (${secondBundle.memoryCues.length})`}>
                        {secondBundle.memoryCues.map((m, i) => (
                          <BundleRow key={`m-${i}`}>
                            <span className="text-reactor-core/80 font-mono text-[9px]">{m.type}</span>
                            <span className="font-medium text-text-primary">{m.name}</span>
                            <span className="text-text-secondary/70 truncate flex-1">{m.description}</span>
                          </BundleRow>
                        ))}
                      </BundleGroup>
                    )}

                    {secondBundle.timers.length > 0 && (
                      <BundleGroup label={`Timers (${secondBundle.timers.length})`}>
                        {secondBundle.timers.map((t, i) => (
                          <BundleRow key={`tm-${i}`}>
                            <span className="flex-1">{t.label}</span>
                            <span className="text-text-secondary/60">{t.minutes}m</span>
                          </BundleRow>
                        ))}
                      </BundleGroup>
                    )}

                    {secondBundle.tasks.length + secondBundle.notes.length + secondBundle.memoryCues.length + secondBundle.timers.length === 0 && (
                      <div className="text-[10px] text-text-secondary/50 font-rajdhani text-center py-4">
                        Bundle is empty. The brief didn't yield any artifacts.
                      </div>
                    )}
                  </section>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* --- tiny presentational helpers for the Second Me bundle --- */

function BundleGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel-glass/30 border border-panel-border/40 rounded p-2 space-y-1">
      <div className="text-[10px] font-orbitron text-text-secondary/70 uppercase tracking-wider">
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function BundleRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-rajdhani bg-deep-space/40 border border-panel-border/30 rounded px-2 py-1.5 min-w-0">
      {children}
    </div>
  );
}