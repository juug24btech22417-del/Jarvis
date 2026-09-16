"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  HardDrive,
  Thermometer,
  Activity,
  Zap,
  TrendingUp,
  Clock,
  Cloud,
  Sun,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Target,
  Radio,
  Shield,
  Eye,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Layers,
  BarChart3,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

/**
 * Iron Man Diagnostics Panel — persistent right-side console.
 * Live CPU/RAM graphs, weather, tasks, agent activity, sentinel status.
 */

interface PCStats {
  cpuUsage: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  memoryUsage: number | null;
  temperature: number | null;
  uptime: number | null;
  disks?: Array<{ caption: string; size: number; free: number; usage: number }>;
}

// ─── Mini Sparkline Graph ───────────────────────────────────────────
function Sparkline({ data, color, height = 32, maxVal = 100 }: {
  data: number[];
  color: string;
  height?: number;
  maxVal?: number;
}) {
  const points = useMemo(() => {
    if (data.length < 2) return "";
    const w = 100;
    const h = height;
    const step = w / (data.length - 1);
    return data
      .map((v, i) => {
        const x = i * step;
        const y = h - (Math.min(v, maxVal) / maxVal) * h;
        return `${x},${y}`;
      })
      .join(" ");
  }, [data, height, maxVal]);

  const fillPoints = useMemo(() => {
    if (data.length < 2) return "";
    const w = 100;
    const h = height;
    const step = w / (data.length - 1);
    const pts = data.map((v, i) => {
      const x = i * step;
      const y = h - (Math.min(v, maxVal) / maxVal) * h;
      return `${x},${y}`;
    });
    return `0,${h} ${pts.join(" ")} ${100},${h}`;
  }, [data, height, maxVal]);

  return (
    <svg viewBox={`0 0 100 ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <defs>
        <linearGradient id={`fill-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {fillPoints && (
        <polygon points={fillPoints} fill={`url(#fill-${color.replace("#", "")})`} />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Ring Gauge ─────────────────────────────────────────────────────
function RingGauge({ value, size = 56, stroke = 4, color, label, sub }: {
  value: number;
  size?: number;
  stroke?: number;
  color: string;
  label: string;
  sub?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(value, 100) / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-orbitron text-xs font-bold" style={{ color }}>
            {Math.round(value)}%
          </span>
        </div>
      </div>
      <span className="font-rajdhani text-[10px] text-text-secondary/70 tracking-wider uppercase">{label}</span>
      {sub && <span className="font-rajdhani text-[9px] text-text-secondary/50">{sub}</span>}
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────
export default function DiagnosticsPanel() {
  const [pcStats, setPcStats] = useState<PCStats | null>(null);
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(30).fill(0));
  const [ramHistory, setRamHistory] = useState<number[]>(Array(30).fill(0));
  const [tempHistory, setTempHistory] = useState<number[]>(Array(30).fill(0));
  const [weatherDesc, setWeatherDesc] = useState("—");
  const [weatherTemp, setWeatherTemp] = useState<number | null>(null);
  const [time, setTime] = useState(new Date());
  const [expanded, setExpanded] = useState(true);
  // Closed state persists across reloads so the console stays out of the way.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem("jarvis:diagnostics-hidden") === "1") {
        setVisible(false);
      }
    } catch {
      // ignore
    }
  }, []);
  const closePanel = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem("jarvis:diagnostics-hidden", "1");
    } catch {
      // ignore
    }
  }, []);
  const openPanel = useCallback(() => {
    setVisible(true);
    try {
      window.localStorage.removeItem("jarvis:diagnostics-hidden");
    } catch {
      // ignore
    }
  }, []);

  const state = useJarvisStore((s) => s.state);
  const sentinelArmed = useJarvisStore((s) => s.sentinelArmed);
  const sentinelActive = useJarvisStore((s) => s.sentinelActive);
  const biometricActive = useJarvisStore((s) => s.biometricActive);
  const activeAlerts = useJarvisStore((s) => s.activeAlerts);
  const tasks = useJarvisStore((s) => s.tasks);
  const messages = useJarvisStore((s) => s.messages);
  const persona = useJarvisStore((s) => s.persona);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch PC stats + push to history
  const fetchPCStats = useCallback(async () => {
    try {
      const res = await fetch("/api/system/pcstats");
      if (!res.ok) return;
      const data = await res.json();
      if (!data.success) return;
      const s = data.stats as PCStats;
      setPcStats(s);

      setCpuHistory((prev) => [...prev.slice(1), s.cpuUsage ?? 0]);
      setRamHistory((prev) => [...prev.slice(1), s.memoryUsage ?? 0]);
      setTempHistory((prev) => [...prev.slice(1), s.temperature ?? 0]);
    } catch {}
  }, []);

  useEffect(() => {
    fetchPCStats();
    const t = setInterval(fetchPCStats, 4000);
    return () => clearInterval(t);
  }, [fetchPCStats]);

  // Weather
  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const res = await fetch("/api/weather?city=Bangalore");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data?.description) {
          setWeatherDesc(data.description);
          setWeatherTemp(data.temperature);
        }
      } catch {}
    };
    fetchWeather();
    const t = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const getHeatColor = (val: number | null) => {
    if (val === null) return "#7EB8D4";
    if (val > 80) return "#FF2D55";
    if (val > 60) return "#FF6B2B";
    return "#00D4FF";
  };

  const recentMessages = messages.slice(-5).reverse();
  const completedTasks = tasks.filter((t) => t.completed).length;
  const pendingTasks = tasks.filter((t) => !t.completed).length;
  const criticalTasks = tasks.filter((t) => t.priority === "critical" && !t.completed);

  const getWeatherIcon = () => {
    const d = weatherDesc.toLowerCase();
    if (d.includes("rain") || d.includes("drizzle")) return <CloudRain className="w-4 h-4 text-cyan-400" />;
    if (d.includes("cloud")) return <Cloud className="w-4 h-4 text-text-secondary" />;
    if (d.includes("snow")) return <CloudSnow className="w-4 h-4 text-blue-300" />;
    if (d.includes("thunder")) return <CloudLightning className="w-4 h-4 text-accent-amber" />;
    return <Sun className="w-4 h-4 text-accent-amber" />;
  };

  const getStateLabel = () => {
    switch (state) {
      case "idle": return { text: "STANDBY", color: "#7EB8D4" };
      case "listening": return { text: "LISTENING", color: "#00FF9D" };
      case "thinking": return { text: "PROCESSING", color: "#FF6B2B" };
      case "speaking": return { text: "RESPONDING", color: "#00D4FF" };
      case "sleep": return { text: "DORMANT", color: "#4A5568" };
      default: return { text: "INIT", color: "#7EB8D4" };
    }
  };

  const sLabel = getStateLabel();

  // ─── Closed state: minimal reopen tab ───
  if (!visible) {
    return (
      <motion.button
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 200, delay: 4.5 }}
        onClick={openPanel}
        title="Open diagnostics console"
        aria-label="Open diagnostics console"
        className="fixed top-14 right-0 z-[35] px-1.5 py-3 rounded-l-lg border border-r-0 border-cyan-500/20 bg-[#030a14]/92 backdrop-blur-xl text-cyan-400/60 hover:text-cyan-300 hover:bg-[#030a14] transition-colors"
      >
        <Activity className="w-3.5 h-3.5" />
      </motion.button>
    );
  }

  return (
    <motion.div
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", damping: 25, stiffness: 200, delay: 4.5 }}
      className="fixed top-14 right-5 bottom-10 z-[35] w-[280px] flex flex-col pointer-events-none"
    >
      {/* Floating minimal controls */}
      <div className="absolute -top-7 right-0 flex items-center gap-1 pointer-events-auto">
        <span className="font-orbitron text-[8px] text-cyan-400/50 tracking-[0.2em] mr-auto">DIAGNOSTICS</span>
        <button
          onClick={() => setExpanded(!expanded)}
          title={expanded ? "Collapse" : "Expand"}
          aria-label={expanded ? "Collapse diagnostics" : "Expand diagnostics"}
          className="text-text-secondary/40 hover:text-cyan-400 transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <button
          onClick={closePanel}
          title="Close diagnostics console"
          aria-label="Close diagnostics console"
          className="text-text-secondary/40 hover:text-accent-red transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-1 min-h-0 overflow-hidden"
          >
            <div className="h-full overflow-y-auto overflow-x-hidden custom-scrollbar no-scrollbar-mask" style={{ maxHeight: "calc(100vh - 80px)" }}>
              <div className="p-1 space-y-4">
                {/* ─── CLOCK ─── */}
                <div className="text-center py-1">
                  <div className="font-orbitron text-lg text-white/95 tracking-widest drop-shadow-[0_0_6px_rgba(255,255,255,0.25)]">
                    {time.toLocaleTimeString("en-US", { hour12: false })}
                  </div>
                  <div className="font-rajdhani text-[9px] text-text-secondary/50 tracking-wider">
                    {time.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase()}
                  </div>
                </div>

                {/* ─── RING GAUGES ─── */}
                <div className="flex justify-around py-1">
                  <RingGauge
                    value={pcStats?.cpuUsage ?? 0}
                    color={getHeatColor(pcStats?.cpuUsage ?? null)}
                    label="CPU"
                    sub="LOAD"
                  />
                  <RingGauge
                    value={pcStats?.memoryUsage ?? 0}
                    color={getHeatColor(pcStats?.memoryUsage ?? null)}
                    label="RAM"
                    sub="USAGE"
                  />
                </div>

                {/* ─── CPU SPARKLINE ─── */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">CPU TREND</span>
                    <span className="font-orbitron text-[9px] text-white/95">{Math.round(pcStats?.cpuUsage ?? 0)}%</span>
                  </div>
                  <Sparkline data={cpuHistory} color="#C4A5FF" height={28} />
                </div>

                {/* ─── RAM SPARKLINE ─── */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">RAM TREND</span>
                    <span className="font-orbitron text-[9px] text-white/95">{Math.round(pcStats?.memoryUsage ?? 0)}%</span>
                  </div>
                  <Sparkline data={ramHistory} color="#C4A5FF" height={28} />
                </div>

                {/* ─── THERMALS ─── */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">THERMALS</span>
                    <Thermometer className="w-3 h-3" style={{ color: getHeatColor(pcStats?.temperature ?? null) }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-black/40 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: getHeatColor(pcStats?.temperature ?? null) }}
                        animate={{ width: `${Math.min((pcStats?.temperature ?? 0) / 100 * 100, 100)}%` }}
                        transition={{ duration: 0.8 }}
                      />
                    </div>
                    <span className="font-orbitron text-[10px]" style={{ color: getHeatColor(pcStats?.temperature ?? null) }}>
                      {pcStats?.temperature ?? 0}°
                    </span>
                  </div>
                  <Sparkline data={tempHistory} color={getHeatColor(pcStats?.temperature ?? null)} height={20} maxVal={100} />
                </div>

                {/* ─── SYSTEM STATE ─── */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">SYSTEM STATE</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <Radio className="w-2.5 h-2.5" style={{ color: sLabel.color }} />
                      <span className="font-rajdhani text-[9px]" style={{ color: sLabel.color }}>{sLabel.text}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-2.5 h-2.5" style={{ color: sentinelArmed ? "#00FF9D" : "#4A5568" }} />
                      <span className="font-rajdhani text-[9px]" style={{ color: sentinelArmed ? "#00FF9D" : "#4A5568" }}>
                        {sentinelArmed ? "ARMED" : "SAFE"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Eye className="w-2.5 h-2.5" style={{ color: biometricActive ? "#00FF9D" : "#4A5568" }} />
                      <span className="font-rajdhani text-[9px]" style={{ color: biometricActive ? "#00FF9D" : "#4A5568" }}>
                        BIO {biometricActive ? "ON" : "OFF"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-2.5 h-2.5" style={{ color: activeAlerts > 0 ? "#FF2D55" : "#4A5568" }} />
                      <span className="font-rajdhani text-[9px]" style={{ color: activeAlerts > 0 ? "#FF2D55" : "#4A5568" }}>
                        {activeAlerts} ALERT{activeAlerts !== 1 ? "S" : ""}
                      </span>
                    </div>
                  </div>
                </div>

                {/* ─── WEATHER ─── */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">WEATHER</span>
                    {getWeatherIcon()}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-rajdhani text-[10px] text-text-secondary/80">{weatherDesc}</span>
                    {weatherTemp !== null && (
                      <span className="font-orbitron text-[11px] text-cyan-400">{weatherTemp}°C</span>
                    )}
                  </div>
                </div>

                {/* ─── TASKS ─── */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">TASKS</span>
                    <Target className="w-3 h-3 text-cyan-400/50" />
                  </div>
                  <div className="flex items-center gap-3 mb-1">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-2.5 h-2.5 text-accent-green" />
                      <span className="font-rajdhani text-[9px] text-accent-green">{completedTasks}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5 text-accent-amber" />
                      <span className="font-rajdhani text-[9px] text-accent-amber">{pendingTasks}</span>
                    </div>
                    {criticalTasks.length > 0 && (
                      <div className="flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5 text-accent-red animate-pulse" />
                        <span className="font-rajdhani text-[9px] text-accent-red">{criticalTasks.length}</span>
                      </div>
                    )}
                  </div>
                  {/* Progress bar */}
                  <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-accent-green transition-all duration-500"
                      style={{ width: `${tasks.length > 0 ? (completedTasks / tasks.length) * 100 : 0}%` }}
                    />
                  </div>
                  {criticalTasks.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {criticalTasks.slice(0, 2).map((t) => (
                        <div key={t.id} className="flex items-center gap-1">
                          <XCircle className="w-2 h-2 text-accent-red flex-shrink-0" />
                          <span className="font-rajdhani text-[8px] text-accent-red/80 truncate">{t.title}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ─── AGENT ACTIVITY ─── */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">LIVE FEED</span>
                    <BarChart3 className="w-3 h-3 text-cyan-400/50" />
                  </div>
                  <div className="space-y-1">
                    {recentMessages.length === 0 ? (
                      <span className="font-rajdhani text-[9px] text-text-secondary/40 italic">No recent activity</span>
                    ) : (
                      recentMessages.map((m, i) => (
                        <div key={m.id} className="flex items-start gap-1.5 py-0.5">
                          <div className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${
                            m.role === "user" ? "bg-reactor-core" : "bg-accent-green"
                          }`} />
                          <div className="min-w-0 flex-1">
                            <span className="font-rajdhani text-[8px] text-text-secondary/40 block">
                              {m.role === "user" ? "YOU" : "JARVIS"} · {new Date(m.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            <span className="font-rajdhani text-[9px] text-text-secondary/70 block truncate">
                              {m.content.slice(0, 60)}{m.content.length > 60 ? "…" : ""}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* ─── DISKS ─── */}
                {pcStats?.disks && pcStats.disks.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-orbitron text-[8px] text-cyan-400/60 tracking-wider">STORAGE</span>
                      <Layers className="w-3 h-3 text-cyan-400/50" />
                    </div>
                    <div className="space-y-1.5">
                      {pcStats.disks.slice(0, 2).map((d, i) => (
                        <div key={i}>
                          <div className="flex justify-between mb-0.5">
                            <span className="font-rajdhani text-[9px] text-text-secondary/60">{d.caption}</span>
                            <span className="font-orbitron text-[9px]" style={{ color: getHeatColor(d.usage) }}>
                              {d.usage}%
                            </span>
                          </div>
                          <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{
                                width: `${d.usage}%`,
                                background: getHeatColor(d.usage),
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ─── FOOTER ─── */}
                <div className="text-center py-1">
                  <span className="font-orbitron text-[7px] text-cyan-500/30 tracking-[0.2em]">J.A.R.V.I.S. MK-IV</span>
                </div>
              </div>
            </div>
            </motion.div>
          )}
        </AnimatePresence>
    </motion.div>
  );
}
