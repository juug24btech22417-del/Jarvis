"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart3,
  Globe,
  Hash,
  Clock,
  CheckCircle,
  XCircle,
  TrendingUp,
  Film,
  Play,
  Trash2,
  RefreshCw,
  AlertCircle,
  Zap,
} from "lucide-react";

interface FormFillRecord {
  id: string;
  url: string;
  domain: string;
  timestamp: string;
  fieldsFilled: Array<{ field: string; selector: string; value: string }>;
  totalFields: number;
  success: boolean;
  error?: string;
  source: string;
  durationMs?: number;
}

interface Macro {
  id: string;
  name: string;
  description?: string;
  steps: any[];
  createdAt: string;
  updatedAt: string;
  replayCount: number;
  lastReplayedAt?: string;
  tags: string[];
  isFormFill: boolean;
  targetUrl?: string;
}

interface Analytics {
  totalFills: number;
  successRate: number;
  fillsToday: number;
  fillsThisWeek: number;
  fillsThisMonth: number;
  topDomains: Array<{ domain: string; count: number }>;
  topFields: Array<{ field: string; count: number }>;
  fillsByDay: Array<{ date: string; count: number }>;
  fillsByHour: Array<{ hour: number; count: number }>;
  avgFieldsPerForm: number;
  unmatchedFieldRate: number;
  recentFills: FormFillRecord[];
  errorRate: number;
}

type Tab = "analytics" | "history" | "macros";

export default function AnalyticsPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("analytics");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [history, setHistory] = useState<FormFillRecord[]>([]);
  const [macros, setMacros] = useState<Macro[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  const fetchAnalytics = useCallback(async () => {
    try {
      const res = await fetch("/api/ghost/history?action=analytics");
      const data = await res.json();
      if (data.success) setAnalytics(data.analytics);
    } catch (err) {
      setError("Failed to load analytics");
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/ghost/history?limit=50");
      const data = await res.json();
      if (data.success) setHistory(data.history);
    } catch (err) {
      setError("Failed to load history");
    }
  }, []);

  const fetchMacros = useCallback(async () => {
    try {
      const res = await fetch("/api/ghost/macros");
      const data = await res.json();
      if (data.success) setMacros(data.macros);
    } catch (err) {
      setError("Failed to load macros");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchAnalytics(), fetchHistory(), fetchMacros()]).finally(() =>
      setLoading(false)
    );
  }, [fetchAnalytics, fetchHistory, fetchMacros]);

  const handleReplay = async (macroId: string) => {
    setReplayingId(macroId);
    try {
      const res = await fetch("/api/ghost/macros/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ macroId }),
      });
      const data = await res.json();
      if (data.success) {
        fetchMacros(); // refresh replay counts
      }
    } catch (err) {
      setError("Replay failed");
    } finally {
      setReplayingId(null);
    }
  };

  const handleDeleteMacro = async (macroId: string) => {
    try {
      await fetch(`/api/ghost/macros?id=${macroId}`, { method: "DELETE" });
      setMacros((prev) => prev.filter((m) => m.id !== macroId));
    } catch (err) {
      setError("Delete failed");
    }
  };

  const handleClearHistory = async () => {
    try {
      await fetch("/api/ghost/history", { method: "DELETE" });
      setHistory([]);
      setAnalytics(null);
      fetchAnalytics();
    } catch (err) {
      setError("Clear failed");
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  const maxDayCount = analytics
    ? Math.max(...analytics.fillsByDay.map((d) => d.count), 1)
    : 1;

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
      </div>

      {/* Header */}
      <div className="relative p-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/90 to-blue-600/90 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl">
                <BarChart3 className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white via-cyan-100 to-blue-200 bg-clip-text text-transparent">
                Ghost Analytics
              </h3>
              <p className="text-xs text-cyan-300/60 font-medium tracking-wide uppercase">
                Form Fill Intelligence
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

        {/* Tabs */}
        <div className="mt-4 flex gap-1 p-1 rounded-xl bg-white/5">
          {(["analytics", "history", "macros"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                  : "text-white/50 hover:text-white/70"
              }`}
            >
              {t === "analytics" && <BarChart3 className="w-4 h-4 inline mr-1" />}
              {t === "history" && <Clock className="w-4 h-4 inline mr-1" />}
              {t === "macros" && <Film className="w-4 h-4 inline mr-1" />}
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
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
              </p>
            </motion.div>
          )}

          {/* ─── Analytics Tab ──────────────────────────────────── */}
          {tab === "analytics" && analytics && (
            <div className="space-y-4">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={<Zap className="w-5 h-5" />}
                  label="Total Fills"
                  value={analytics.totalFills}
                  color="cyan"
                />
                <StatCard
                  icon={<CheckCircle className="w-5 h-5" />}
                  label="Success Rate"
                  value={`${analytics.successRate}%`}
                  color="emerald"
                />
                <StatCard
                  icon={<Clock className="w-5 h-5" />}
                  label="Today"
                  value={analytics.fillsToday}
                  color="blue"
                />
                <StatCard
                  icon={<Hash className="w-5 h-5" />}
                  label="Avg Fields"
                  value={analytics.avgFieldsPerForm}
                  color="purple"
                />
              </div>

              {/* Weekly/Monthly */}
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={<TrendingUp className="w-5 h-5" />}
                  label="This Week"
                  value={analytics.fillsThisWeek}
                  color="amber"
                />
                <StatCard
                  icon={<TrendingUp className="w-5 h-5" />}
                  label="This Month"
                  value={analytics.fillsThisMonth}
                  color="rose"
                />
              </div>

              {/* Activity Chart (last 30 days) */}
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  Activity (Last 30 Days)
                </h4>
                <div className="h-24 flex items-end gap-0.5">
                  {analytics.fillsByDay.map((day, idx) => {
                    const height =
                      maxDayCount > 0
                        ? (day.count / maxDayCount) * 100
                        : 0;
                    return (
                      <div
                        key={idx}
                        className="flex-1 bg-cyan-500/40 rounded-t hover:bg-cyan-400/60 transition-colors min-w-[2px]"
                        style={{ height: `${Math.max(height, 4)}%` }}
                        title={`${day.date}: ${day.count} fills`}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Top Domains */}
              {analytics.topDomains.length > 0 && (
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    Top Domains
                  </h4>
                  <div className="space-y-2">
                    {analytics.topDomains.map((d, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="text-white/40 w-5 text-right">
                          {idx + 1}.
                        </span>
                        <span className="text-white/70 flex-1 truncate">
                          {d.domain}
                        </span>
                        <span className="text-cyan-400 font-mono">
                          {d.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Fields */}
              {analytics.topFields.length > 0 && (
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                  <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                    <Hash className="w-4 h-4 text-cyan-400" />
                    Most Matched Fields
                  </h4>
                  <div className="space-y-2">
                    {analytics.topFields.map((f, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-3 text-sm"
                      >
                        <span className="text-white/40 w-5 text-right">
                          {idx + 1}.
                        </span>
                        <span className="text-white/70 flex-1">{f.field}</span>
                        <span className="text-cyan-400 font-mono">
                          {f.count}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hourly Distribution */}
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-cyan-400" />
                  Fills by Hour
                </h4>
                <div className="h-16 flex items-end gap-px">
                  {analytics.fillsByHour.map((h) => {
                    const maxH = Math.max(
                      ...analytics.fillsByHour.map((x) => x.count),
                      1
                    );
                    const height = (h.count / maxH) * 100;
                    return (
                      <div
                        key={h.hour}
                        className="flex-1 bg-blue-500/40 rounded-t hover:bg-blue-400/60 transition-colors"
                        style={{ height: `${Math.max(height, 4)}%` }}
                        title={`${h.hour}:00 — ${h.count} fills`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between text-[10px] text-white/30 mt-1">
                  <span>0h</span>
                  <span>6h</span>
                  <span>12h</span>
                  <span>18h</span>
                  <span>23h</span>
                </div>
              </div>
            </div>
          )}

          {/* ─── History Tab ──────────────────────────────────── */}
          {tab === "history" && (
            <div className="space-y-3">
              {history.length === 0 ? (
                <div className="p-8 rounded-3xl bg-white/5 border border-white/10 text-center">
                  <Clock className="w-12 h-12 text-white/20 mx-auto mb-4" />
                  <p className="text-white/60 mb-2">No form fills recorded yet</p>
                  <p className="text-white/40 text-sm">
                    Use /fill on Telegram or the Ghost Protocol to start tracking
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-white/40">
                      {history.length} recent fills
                    </span>
                    <button
                      onClick={handleClearHistory}
                      className="text-xs text-red-400/60 hover:text-red-400 flex items-center gap-1 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                      Clear
                    </button>
                  </div>
                  {history.map((record) => (
                    <motion.div
                      key={record.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {record.success ? (
                            <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          )}
                          <div>
                            <p className="text-sm text-white/80 font-medium truncate max-w-[200px]">
                              {record.domain}
                            </p>
                            <p className="text-xs text-white/40">
                              {new Date(record.timestamp).toLocaleDateString(
                                "en-IN"
                              )}{" "}
                              · {record.fieldsFilled.length} fields ·{" "}
                              {record.source}
                            </p>
                          </div>
                        </div>
                        {record.durationMs && (
                          <span className="text-xs text-white/30 font-mono">
                            {Math.round(record.durationMs / 1000)}s
                          </span>
                        )}
                      </div>
                      {record.fieldsFilled.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {record.fieldsFilled.map((f, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300/70 text-[10px]"
                            >
                              {f.field}
                            </span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ─── Macros Tab ──────────────────────────────────── */}
          {tab === "macros" && (
            <div className="space-y-3">
              {macros.length === 0 ? (
                <div className="p-8 rounded-3xl bg-white/5 border border-white/10 text-center">
                  <Film className="w-12 h-12 text-white/20 mx-auto mb-4" />
                  <p className="text-white/60 mb-2">No macros saved yet</p>
                  <p className="text-white/40 text-sm">
                    Use /record on Telegram to start recording browser actions
                  </p>
                </div>
              ) : (
                <>
                  <span className="text-xs text-white/40">
                    {macros.length} saved macros
                  </span>
                  {macros.map((macro) => (
                    <motion.div
                      key={macro.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="text-sm font-semibold text-white/80">
                            {macro.name}
                          </h4>
                          <p className="text-xs text-white/40 mt-1">
                            {macro.steps.length} steps · {macro.replayCount}{" "}
                            replays
                            {macro.lastReplayedAt &&
                              ` · last ${new Date(
                                  macro.lastReplayedAt
                                ).toLocaleDateString("en-IN")}`}
                          </p>
                          {macro.targetUrl && (
                            <p className="text-xs text-white/30 mt-1 truncate max-w-[250px]">
                              🌐 {macro.targetUrl}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleReplay(macro.id)}
                            disabled={replayingId === macro.id}
                            className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 transition-all disabled:opacity-50"
                            title="Replay macro"
                          >
                            {replayingId === macro.id ? (
                              <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => handleDeleteMacro(macro.id)}
                            className="p-1.5 rounded-lg bg-red-500/10 text-red-400/60 hover:bg-red-500/20 hover:text-red-400 transition-all"
                            title="Delete macro"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      {macro.tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {macro.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300/70 text-[10px]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Stat Card Sub-component ──────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
}) {
  const colors: Record<string, string> = {
    cyan: "from-cyan-500/20 to-cyan-600/10 border-cyan-500/20 text-cyan-400",
    emerald:
      "from-emerald-500/20 to-emerald-600/10 border-emerald-500/20 text-emerald-400",
    blue: "from-blue-500/20 to-blue-600/10 border-blue-500/20 text-blue-400",
    purple:
      "from-purple-500/20 to-purple-600/10 border-purple-500/20 text-purple-400",
    amber:
      "from-amber-500/20 to-amber-600/10 border-amber-500/20 text-amber-400",
    rose: "from-rose-500/20 to-rose-600/10 border-rose-500/20 text-rose-400",
  };

  return (
    <div
      className={`p-4 rounded-2xl bg-gradient-to-br ${
        colors[color] || colors.cyan
      } border backdrop-blur-sm`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="opacity-70">{icon}</span>
        <span className="text-xs text-white/50 font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
    </div>
  );
}
