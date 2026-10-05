"use client";

// Command Deck — the unified Task + Timer dashboard.
//
// One closable surface for everything JARVIS is tracking for you: missions
// (tasks) on the left, live timers on the right. It polls the real APIs, so a
// task or timer created by voice/chat ("remind me to…", "set a 20-minute
// timer") shows up here on its own. When something new lands while the deck is
// closed, it nudges the launcher so it can surface itself.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ListTodo,
  Timer as TimerIcon,
  Plus,
  CheckCircle2,
  Circle,
  AlertCircle,
  Clock,
  Trash2,
  Play,
  Bell,
  Sparkles,
  Flag,
  Radio,
  CalendarClock,
} from "lucide-react";
import { parseQuickAdd, formatDueAt } from "@/lib/tasks/quickAdd";

interface ApiTask {
  id: string;
  title: string;
  completed: boolean;
  priority: string;
  dueDate?: string | null;
}

interface ApiTimer {
  id: string;
  endTime: number;
  label: string;
  isAlarm: boolean;
  remainingSeconds?: number;
}

interface TaskTimerDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called when a new task/timer appears while the deck is closed. */
  onNudge?: () => void;
}

const PRIORITIES = ["critical", "high", "normal", "someday"] as const;
type Priority = (typeof PRIORITIES)[number];

const PRIORITY_META: Record<string, { ring: string; chip: string; label: string; icon: React.ReactNode }> = {
  critical: {
    ring: "border-accent-red/50",
    chip: "border-accent-red/50 bg-accent-red/10 text-accent-red",
    label: "critical",
    icon: <AlertCircle className="w-4 h-4 text-accent-red" />,
  },
  high: {
    ring: "border-accent-amber/50",
    chip: "border-accent-amber/50 bg-accent-amber/10 text-accent-amber",
    label: "high",
    icon: <AlertCircle className="w-4 h-4 text-accent-amber" />,
  },
  normal: {
    ring: "border-reactor-core/40",
    chip: "border-reactor-core/40 bg-reactor-core/10 text-reactor-core",
    label: "normal",
    icon: <Circle className="w-4 h-4 text-reactor-core/80" />,
  },
  someday: {
    ring: "border-white/10",
    chip: "border-white/15 bg-white/[0.04] text-text-secondary",
    label: "someday",
    icon: <Clock className="w-4 h-4 text-text-secondary" />,
  },
};

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function TaskTimerDashboard({ isOpen, onClose, onNudge }: TaskTimerDashboardProps) {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [timers, setTimers] = useState<ApiTimer[]>([]);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const [newTask, setNewTask] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("normal");
  const [newMinutes, setNewMinutes] = useState("25");

  const knownIds = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  // Keep onNudge in a ref so it is NOT an effect dependency. Callers pass an
  // inline arrow (onNudge={() => setX(true)}), which gets a fresh identity on
  // every parent render; depending on it re-subscribed this effect on each
  // render and fired poll() repeatedly — flooding /api/tasks + /api/timer and
  // exhausting the browser's ~6-connection-per-host pool. That is what made
  // /api/chat fail with "Failed to fetch".
  const onNudgeRef = useRef(onNudge);
  useEffect(() => { onNudgeRef.current = onNudge; }, [onNudge]);

  // One polling loop drives both data and "new item" detection.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const [tRes, timerRes] = await Promise.all([
          fetch("/api/tasks?all=1", { cache: "no-store" }),
          fetch("/api/timer", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        let nextTasks: ApiTask[] = [];
        let nextTimers: ApiTimer[] = [];
        if (tRes.ok) {
          const data = (await tRes.json()) as ApiTask[];
          if (Array.isArray(data)) nextTasks = data;
        }
        if (timerRes.ok) {
          const data = (await timerRes.json()) as { success?: boolean; timers?: ApiTimer[] };
          if (data?.success) nextTimers = data.timers ?? [];
        }
        setTasks(nextTasks);
        setTimers(nextTimers);
        setNow(Date.now());

        const freshIds = new Set<string>([
          ...nextTasks.filter((t) => !t.completed).map((t) => `t:${t.id}`),
          ...nextTimers.map((t) => `m:${t.id}`),
        ]);
        if (!primed.current) {
          // First pass — remember the baseline, never nudge on load.
          knownIds.current = freshIds;
          primed.current = true;
        } else {
          let hasNew = false;
          for (const id of freshIds) {
            if (!knownIds.current.has(id)) {
              hasNew = true;
              break;
            }
          }
          knownIds.current = freshIds;
          if (hasNew) onNudgeRef.current?.();
        }
      } catch {
        // ignore transient errors
      }
    };
    void poll();
    // Modest cadence: 5s open / 10s closed. The old 1.5s/4s (multiplied by the
    // re-subscribe bug) was a constant multi-request-per-second flood.
    const interval = setInterval(poll, isOpen ? 5000 : 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen]);

  // Fast local tick for the countdown without refetching.
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [isOpen]);

  const activeTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => t.completed), [tasks]);

  // Live natural-language preview: "pay bill tomorrow 6pm high" → title + chips.
  const parsedPreview = useMemo(() => (newTask.trim() ? parseQuickAdd(newTask) : null), [newTask]);

  const addTask = useCallback(async () => {
    const parsed = parseQuickAdd(newTask);
    const title = parsed.title.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          // A recognised priority word wins; otherwise honour the dropdown.
          priority: parsed.priority !== "normal" ? parsed.priority : newPriority,
          dueDate: parsed.dueAt ? parsed.dueAt.toISOString() : undefined,
        }),
      });
      if (res.ok) {
        const created = (await res.json()) as ApiTask;
        setNewTask("");
        knownIds.current.add(`t:${created.id}`);
        setTasks((prev) => [...prev, created]);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }, [newTask, newPriority, busy]);

  const toggleTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // ignore
    }
  }, []);

  const removeTask = useCallback(async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // ignore
    }
  }, []);

  const addTimer = useCallback(async () => {
    const minutes = parseFloat(newMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", minutes, label: `${minutes}m focus` }),
      });
      const data = await res.json();
      if (data?.success && data.timer) {
        knownIds.current.add(`m:${data.timer.id}`);
        setTimers((prev) => [...prev, { ...data.timer, remainingSeconds: Math.round(minutes * 60) }]);
      }
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }, [newMinutes, busy]);

  const cancelTimer = useCallback(async (timerId: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== timerId));
    try {
      await fetch("/api/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", timerId }),
      });
    } catch {
      // ignore
    }
  }, []);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 16 }}
          transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-2xl"
        >
          <div className="relative w-full max-w-4xl h-[86vh] rounded-[26px] overflow-hidden border border-white/10 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),0_0_80px_-10px_rgba(0,243,255,0.18)] bg-deep-space/90 backdrop-blur-xl flex flex-col">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-reactor-core to-transparent opacity-70" />
            <div className="absolute -top-16 left-1/4 w-1/2 h-24 bg-reactor-core/10 blur-3xl pointer-events-none" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.045] via-transparent to-transparent" />

            {/* header */}
            <header className="relative flex items-center gap-3 px-5 py-4 border-b border-white/[0.07] flex-shrink-0">
              <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-reactor-core/10 border border-reactor-core/40">
                <ListTodo className="w-5 h-5 text-reactor-core" />
              </div>
              <div className="min-w-0">
                <h2 className="font-orbitron text-sm tracking-[0.2em] uppercase text-reactor-core">Command Deck</h2>
                <p className="text-[10px] font-rajdhani text-text-secondary/60 tracking-wider uppercase">
                  tasks × timers · live from voice &amp; chat
                </p>
              </div>

              <span className="ml-2 flex items-center gap-1 text-[10px] font-rajdhani uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent-amber/40 bg-accent-amber/10 text-accent-amber">
                <Flag className="w-3 h-3" /> {activeTasks.length} open
              </span>
              <span className="flex items-center gap-1 text-[10px] font-rajdhani uppercase tracking-widest px-2 py-0.5 rounded-full border border-reactor-core/40 bg-reactor-core/10 text-reactor-core">
                <TimerIcon className="w-3 h-3" /> {timers.length} running
              </span>

              <button
                onClick={onClose}
                className="ml-auto p-1.5 hover:bg-accent-red/20 rounded-md transition-colors"
                title="Close"
              >
                <X className="w-4 h-4 text-text-secondary/70" />
              </button>
            </header>

            {/* body */}
            <div className="relative flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-0">
              {/* ── missions (tasks) ── */}
              <section className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-white/[0.07]">
                <div className="flex items-center gap-2 px-5 pt-4 pb-3">
                  <Sparkles className="w-3.5 h-3.5 text-reactor-core" />
                  <span className="font-orbitron text-[11px] uppercase tracking-[0.18em] text-text-primary/90">Missions</span>
                  <span className="ml-auto text-[10px] font-rajdhani text-text-secondary/50 uppercase tracking-wider">
                    {doneTasks.length} done
                  </span>
                </div>

                {/* quick add */}
                <div className="px-5 pb-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={newTask}
                      onChange={(e) => setNewTask(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addTask();
                      }}
                      placeholder="e.g. pay bill tomorrow 6pm high"
                      className="flex-1 bg-white/[0.035] border border-white/[0.09] rounded-xl px-3 py-2 text-[12px] font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/50 focus:ring-1 focus:ring-reactor-core/25"
                    />
                    <select
                      value={newPriority}
                      onChange={(e) => setNewPriority(e.target.value as Priority)}
                      className="bg-deep-space/70 border border-white/[0.09] rounded-xl px-2 py-2 text-[11px] font-rajdhani text-text-secondary focus:outline-none focus:border-reactor-core/50 uppercase tracking-wider"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p} className="bg-deep-space">
                          {p}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void addTask()}
                      disabled={!newTask.trim() || busy}
                      className="p-2 rounded-xl bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 text-reactor-core disabled:opacity-30 transition-colors"
                      title="Add mission"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>

                  {/* live parse chips — shows exactly what JARVIS understood */}
                  {parsedPreview && (parsedPreview.matched.priority || parsedPreview.matched.when || parsedPreview.matched.time || parsedPreview.title !== newTask.trim()) && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/40">parsed</span>
                      <span className="text-[11px] font-rajdhani text-text-primary/85 truncate max-w-[180px]">{parsedPreview.title}</span>
                      {parsedPreview.priority !== "normal" && (
                        <span className={`text-[9px] font-rajdhani uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${(PRIORITY_META[parsedPreview.priority] ?? PRIORITY_META.normal).chip}`}>
                          {parsedPreview.priority}
                        </span>
                      )}
                      {parsedPreview.dueAt && (
                        <span className="flex items-center gap-1 text-[9px] font-rajdhani uppercase tracking-widest px-1.5 py-0.5 rounded-full border border-reactor-core/40 bg-reactor-core/10 text-reactor-core">
                          <CalendarClock className="w-2.5 h-2.5" /> {formatDueAt(parsedPreview.dueAt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* list */}
                <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-2">
                  {activeTasks.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <CheckCircle2 className="w-10 h-10 text-accent-green/40 mb-2" />
                      <p className="text-[12px] font-rajdhani text-text-secondary/60">All missions complete, Boss.</p>
                      <p className="text-[10px] font-rajdhani text-text-secondary/35 mt-1">Say “remind me to…” to add one.</p>
                    </div>
                  )}

                  <AnimatePresence initial={false}>
                    {activeTasks.map((task) => {
                      const meta = PRIORITY_META[task.priority] ?? PRIORITY_META.normal;
                      return (
                        <motion.div
                          key={task.id}
                          layout
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: 24 }}
                          className={`group flex items-start gap-3 p-3 rounded-xl border ${meta.ring} bg-white/[0.025] hover:bg-white/[0.05] transition-colors`}
                        >
                          <button
                            onClick={() => void toggleTask(task.id)}
                            className="mt-0.5 hover:scale-110 transition-transform"
                            title="Mark complete"
                          >
                            {meta.icon}
                          </button>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-rajdhani text-text-primary leading-snug break-words">{task.title}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className={`text-[9px] font-rajdhani uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${meta.chip}`}>
                                {meta.label}
                              </span>
                              {task.dueDate && (
                                <span className="text-[10px] font-rajdhani text-text-secondary/55">
                                  {new Date(task.dueDate).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => void removeTask(task.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-accent-red/20 transition-all"
                            title="Delete mission"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-accent-red/80" />
                          </button>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>

                  {doneTasks.length > 0 && (
                    <div className="pt-1">
                      <button
                        onClick={() => setShowDone((v) => !v)}
                        className="text-[10px] font-rajdhani uppercase tracking-widest text-text-secondary/45 hover:text-text-secondary transition-colors"
                      >
                        {showDone ? "hide" : "show"} completed ({doneTasks.length})
                      </button>
                      {showDone && (
                        <div className="mt-2 space-y-1.5">
                          {doneTasks.map((task) => (
                            <div key={task.id} className="group flex items-center gap-3 px-3 py-2 rounded-xl border border-white/[0.06] bg-white/[0.015]">
                              <button onClick={() => void toggleTask(task.id)} className="hover:scale-110 transition-transform" title="Reopen">
                                <CheckCircle2 className="w-4 h-4 text-accent-green/70" />
                              </button>
                              <p className="flex-1 text-[12px] font-rajdhani text-text-secondary line-through truncate">{task.title}</p>
                              <button
                                onClick={() => void removeTask(task.id)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-accent-red/20 transition-all"
                                title="Delete"
                              >
                                <Trash2 className="w-3 h-3 text-accent-red/70" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* ── timers ── */}
              <section className="flex flex-col min-h-0">
                <div className="flex items-center gap-2 px-5 pt-4 pb-3">
                  <TimerIcon className="w-3.5 h-3.5 text-reactor-core" />
                  <span className="font-orbitron text-[11px] uppercase tracking-[0.18em] text-text-primary/90">Timers</span>
                  <span className="ml-auto flex items-center gap-1 text-[10px] font-rajdhani text-accent-red/80 uppercase tracking-wider">
                    {timers.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse" />}
                    live
                  </span>
                </div>

                <div className="px-5 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        value={newMinutes}
                        onChange={(e) => setNewMinutes(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addTimer();
                        }}
                        inputMode="decimal"
                        placeholder="25"
                        className="w-full bg-white/[0.035] border border-white/[0.09] rounded-xl px-3 py-2 pr-12 text-[12px] font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/50 focus:ring-1 focus:ring-reactor-core/25"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-rajdhani text-text-secondary/45 uppercase tracking-wider">
                        min
                      </span>
                    </div>
                    <button
                      onClick={() => void addTimer()}
                      disabled={busy}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 text-reactor-core text-[11px] font-rajdhani uppercase tracking-wider disabled:opacity-30 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" /> Start
                    </button>
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-3">
                  {timers.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <TimerIcon className="w-10 h-10 text-reactor-core/30 mb-2" />
                      <p className="text-[12px] font-rajdhani text-text-secondary/60">No timers running.</p>
                      <p className="text-[10px] font-rajdhani text-text-secondary/35 mt-1">Say “set a 20-minute timer”.</p>
                    </div>
                  )}

                  <AnimatePresence initial={false}>
                    {timers.map((timer) => {
                      const remaining = Math.max(
                        0,
                        Math.round((timer.endTime - now) / 1000) || timer.remainingSeconds || 0
                      );
                      const total = Math.max(remaining, timer.remainingSeconds ?? remaining, 1);
                      const pct = Math.min(100, Math.round((remaining / total) * 100));
                      return (
                        <motion.div
                          key={timer.id}
                          layout
                          initial={{ opacity: 0, y: -6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: 24 }}
                          className="relative rounded-2xl border border-reactor-core/30 bg-gradient-to-br from-reactor-core/[0.10] to-transparent p-4 overflow-hidden"
                        >
                          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-reactor-core/60 to-transparent" />
                          <div className="flex items-start gap-3">
                            <div className="relative w-10 h-10 rounded-full border border-reactor-core/40 flex items-center justify-center">
                              {timer.isAlarm ? (
                                <Bell className="w-4 h-4 text-accent-amber" />
                              ) : (
                                <TimerIcon className="w-4 h-4 text-reactor-core" />
                              )}
                              <span className="absolute inset-0 rounded-full border border-reactor-core/50 animate-ping opacity-30" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline gap-2">
                                <span className="font-orbitron text-2xl text-reactor-core tabular-nums leading-none">
                                  {fmtClock(remaining)}
                                </span>
                                <span className="text-[10px] font-rajdhani uppercase tracking-widest text-text-secondary/50 truncate">
                                  {timer.label}
                                </span>
                              </div>
                              <div className="mt-2.5 h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-reactor-core to-white/70 transition-[width] duration-1000"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                            <button
                              onClick={() => void cancelTimer(timer.id)}
                              className="p-1.5 rounded-lg hover:bg-accent-red/20 transition-colors"
                              title="Cancel timer"
                            >
                              <X className="w-3.5 h-3.5 text-accent-red/80" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </section>
            </div>

            {/* footer */}
            <footer className="relative flex items-center gap-4 px-5 py-3 border-t border-white/[0.07] flex-shrink-0">
              <Radio className="w-3 h-3 text-reactor-core/60" />
              <span className="text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/45">
                say “remind me to…” or “set a timer” — it lands here automatically
              </span>
              <span className="ml-auto text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/35">
                {activeTasks.length} missions · {timers.length} timers
              </span>
            </footer>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
