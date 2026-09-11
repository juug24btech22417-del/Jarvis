"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Wifi,
  Battery,
  Volume2,
  VolumeX,
  Cpu,
  HardDrive,
  Thermometer,
  Activity,
  X,
  Eye,
  Scan,
  ShieldCheck,
  TrendingUp,
  Clock,
  Zap,
  Sparkles,
  RefreshCw,
  Server,
  Layers,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
  chargingTime: number;
  dischargingTime: number;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

interface NavigatorWithBattery extends Navigator {
  getBattery?(): Promise<BatteryManager>;
  deviceMemory?: number;
}

interface PCStats {
  cpuUsage: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  memoryUsage: number | null;
  battery: number | null;
  temperature: number | null;
  uptime: number | null;
  disks?: Array<{
    caption: string;
    size: number;
    free: number;
    usage: number;
  }>;
}

interface Pattern {
  id: string;
  category: "search" | "panel" | "contact" | "time" | "frequency";
  text: string;
  confidence: number;
  sampleCount: number;
}

interface RunningProcess {
  name: string;
  pid: number;
  memory: number;
}

export default function StatusHUD() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [battery, setBattery] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState(false);
  const [pcStats, setPcStats] = useState<PCStats | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [activeTab, setActiveTab] = useState<"telemetry" | "processes">("telemetry");
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [processes, setProcesses] = useState<RunningProcess[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);
  const [killingPid, setKillingPid] = useState<number | null>(null);

  const { isMuted, setIsMuted, state, sentinelActive, setSentinelActive, biometricActive } = useJarvisStore();

  // Fetch PC stats from API
  const fetchPCStats = useCallback(async () => {
    try {
      const response = await fetch("/api/system/pcstats");
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPcStats(data.stats);
        }
      }
    } catch (error) {
      console.error("Failed to fetch PC stats:", error);
    }
  }, []);

  // Fetch running processes
  const fetchProcesses = useCallback(async () => {
    setLoadingProcesses(true);
    try {
      const res = await fetch("/api/system/pcstats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "processes" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.processes) {
          setProcesses(data.processes);
        }
      }
    } catch (err) {
      console.error("Failed to fetch processes:", err);
    } finally {
      setLoadingProcesses(false);
    }
  }, []);

  const killProcess = async (pid: number) => {
    setKillingPid(pid);
    try {
      const res = await fetch("/api/system/pcstats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", pid }),
      });
      if (res.ok) {
        setProcesses((prev) => prev.filter((p) => p.pid !== pid));
      }
    } catch (err) {
      console.error("Failed to kill process:", err);
    } finally {
      setKillingPid(null);
    }
  };

  // Tier 1C: fetch patterns when the details panel opens.
  const fetchPatterns = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/patterns");
      if (res.ok) {
        const data = await res.json();
        setPatterns(data.patterns || []);
      }
    } catch {
      // Patterns are best-effort.
    }
  }, []);

  useEffect(() => {
    if (showDetails) {
      fetchPatterns();
      if (activeTab === "processes") {
        fetchProcesses();
      }
    }
  }, [showDetails, activeTab, fetchPatterns, fetchProcesses]);

  useEffect(() => {
    // Update time every second
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);

    // Get battery info if available
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      const nav = navigator as NavigatorWithBattery;
      nav.getBattery?.()?.then((bat) => {
        setBattery(bat.level * 100);
        setIsCharging(bat.charging);
        bat.addEventListener("levelchange", () => {
          setBattery(bat.level * 100);
        });
        bat.addEventListener("chargingchange", () => {
          setIsCharging(bat.charging);
        });
      });
    }

    // Fetch PC stats initially and every 5 seconds
    fetchPCStats();
    const statsTimer = setInterval(fetchPCStats, 5000);

    return () => {
      clearInterval(timer);
      clearInterval(statsTimer);
    };
  }, [fetchPCStats]);

  const getStatusColor = () => {
    switch (state) {
      case "idle":
        return "text-text-secondary";
      case "listening":
        return "text-accent-green";
      case "thinking":
        return "text-accent-amber";
      case "speaking":
        return "text-reactor-core";
      case "sleep":
        return "text-text-secondary opacity-50";
      default:
        return "text-text-secondary";
    }
  };

  const getStatusText = () => {
    switch (state) {
      case "idle":
        return "STANDBY";
      case "listening":
        return "LISTENING";
      case "thinking":
        return "PROCESSING";
      case "speaking":
        return "RESPONDING";
      case "sleep":
        return "SLEEP MODE";
      default:
        return "INITIALIZING";
    }
  };

  const getBatteryColor = (level: number) => {
    if (level < 20) return "text-accent-red";
    if (level < 50) return "text-accent-amber";
    return "text-text-secondary";
  };

  const getCpuColor = (usage: number | null) => {
    if (usage === null || usage === undefined) return "text-text-secondary";
    if (usage > 80) return "text-accent-red";
    if (usage > 60) return "text-accent-amber";
    return "text-accent-green";
  };

  const getMemoryColor = (usage: number | null) => {
    if (usage === null || usage === undefined) return "text-text-secondary";
    if (usage > 85) return "text-accent-red";
    if (usage > 70) return "text-accent-amber";
    return "text-accent-green";
  };

  const formatBytes = (bytes: number | null | undefined) => {
    if (!bytes) return "N/A";
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
  };

  const formatUptime = (hours: number | null) => {
    if (!hours && hours !== 0) return "N/A";
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours}h`;
  };

  const hardwareConcurrency = typeof navigator !== "undefined"
    ? (navigator as NavigatorWithBattery).hardwareConcurrency
    : null;
  const deviceMemory = typeof navigator !== "undefined"
    ? (navigator as NavigatorWithBattery).deviceMemory
    : null;

  return (
    <>
      {/* Top Holographic Navigation Bar */}
      <motion.div
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 holographic-panel border-b border-cyan-500/20 bg-[#050b14]/85 backdrop-blur-md"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 4, ease: "easeOut" }}
      >
        {/* Left side - Date/Time */}
        <div className="flex items-center gap-6">
          <div className="font-orbitron text-reactor-core text-lg tracking-wider drop-shadow-[0_0_8px_rgba(0,243,255,0.4)]">
            {currentTime.toLocaleTimeString("en-US", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </div>
          <div className="font-rajdhani text-text-secondary text-sm hidden md:block">
            {currentTime.toLocaleDateString("en-US", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </div>
        </div>

        {/* Center - Status */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className={`w-2 h-2 rounded-full ${getStatusColor()}`}
                animate={
                  state === "thinking"
                    ? {
                        opacity: [0.3, 1, 0.3],
                        scale: [1, 1.2, 1],
                      }
                    : { opacity: 1, scale: 1 }
                }
                transition={{
                  duration: 0.5,
                  delay: i * 0.1,
                  repeat: state === "thinking" ? Infinity : 0,
                }}
              />
            ))}
          </div>
          <span className={`font-orbitron text-xs tracking-widest ${getStatusColor()}`}>
            {getStatusText()}
          </span>
        </div>

        {/* Right side - System indicators */}
        <div className="flex items-center gap-4">
          {/* Quick Stats Preview */}
          <div
            className="flex items-center gap-3 cursor-pointer hover:bg-cyan-500/10 px-2.5 py-1 rounded-lg border border-transparent hover:border-cyan-500/30 transition-all"
            onClick={() => setShowDetails(!showDetails)}
            title="Click for full diagnostics & system monitor"
          >
            {/* CPU */}
            {pcStats?.cpuUsage !== null && pcStats?.cpuUsage !== undefined && (
              <div className="flex items-center gap-1.5">
                <Cpu className={`w-4 h-4 ${getCpuColor(pcStats.cpuUsage)}`} />
                <span className={`font-rajdhani text-xs font-semibold ${getCpuColor(pcStats.cpuUsage)}`}>
                  {Math.round(pcStats.cpuUsage)}%
                </span>
              </div>
            )}

            {/* Memory */}
            {pcStats?.memoryUsage !== null && pcStats?.memoryUsage !== undefined && (
              <div className="flex items-center gap-1.5">
                <HardDrive className={`w-4 h-4 ${getMemoryColor(pcStats.memoryUsage)}`} />
                <span className={`font-rajdhani text-xs font-semibold ${getMemoryColor(pcStats.memoryUsage)}`}>
                  {Math.round(pcStats.memoryUsage)}%
                </span>
              </div>
            )}

            {/* Temperature */}
            {pcStats?.temperature !== null && pcStats?.temperature !== undefined && (
              <div className="flex items-center gap-1.5">
                <Thermometer className={`w-4 h-4 ${
                  pcStats.temperature > 80 ? "text-accent-red" :
                  pcStats.temperature > 60 ? "text-accent-amber" : "text-text-secondary"
                }`} />
                <span className="font-rajdhani text-xs text-text-secondary">
                  {pcStats.temperature}°C
                </span>
              </div>
            )}
          </div>
          
          {/* Autonomous Status Indicators */}
          <div className="flex items-center gap-3 border-l border-panel-border pl-4">
            <button
              onClick={() => setSentinelActive(!sentinelActive)}
              title={sentinelActive ? "Sentinel Eyes: ACTIVE — click to toggle" : "Sentinel Eyes: OFFLINE — click to toggle"}
              className="flex items-center gap-1.5 group cursor-pointer px-2 py-1 rounded-lg transition-all hover:bg-cyan-500/10 border border-transparent hover:border-cyan-500/25"
            >
              <AnimatePresence mode="wait">
                {sentinelActive ? (
                  <motion.div
                    key="on"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="flex items-center gap-1.5"
                  >
                    <motion.div
                      animate={{ opacity: [0.5, 1, 0.5] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                    >
                      <Eye className="w-4 h-4 text-reactor-core glow-icon drop-shadow-[0_0_6px_rgba(0,243,255,0.7)]" />
                    </motion.div>
                    <span className="font-rajdhani text-[11px] font-bold text-reactor-core hidden lg:block uppercase tracking-wider">
                      Sentinel
                    </span>
                  </motion.div>
                ) : (
                  <motion.div
                    key="off"
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="flex items-center gap-1.5"
                  >
                    <Eye className="w-4 h-4 text-text-secondary/30" />
                    <span className="font-rajdhani text-[11px] text-text-secondary/40 hidden lg:block uppercase tracking-wider">
                      Sentinel
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </button>

            <AnimatePresence>
              {biometricActive && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  className="flex items-center gap-1.5 group px-1.5 py-1"
                  title="Biometric Recognition: Scanning for Boss"
                >
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Scan className="w-4 h-4 text-accent-green glow-icon" />
                  </motion.div>
                  <span className="font-rajdhani text-[11px] font-bold text-accent-green hidden lg:block uppercase tracking-wider">
                    Biometric
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Network */}
          <Wifi className="w-4 h-4 text-text-secondary" />

          {/* Battery */}
          {battery !== null && (
            <div className="flex items-center gap-1.5">
              <Battery
                className={`w-4 h-4 ${getBatteryColor(battery)} ${isCharging ? "animate-pulse" : ""}`}
              />
              <span
                className={`font-rajdhani text-xs font-semibold ${getBatteryColor(battery)}`}
              >
                {Math.round(battery)}%
              </span>
            </div>
          )}

          {/* Mute button */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-1.5 hover:bg-panel-glass rounded-lg transition-colors"
            title={isMuted ? "Unmute speech" : "Mute speech"}
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-accent-red" />
            ) : (
              <Volume2 className="w-4 h-4 text-text-secondary" />
            )}
          </button>

          {/* JARVIS Logo */}
          <div className="font-orbitron text-reactor-core text-sm tracking-widest border-l border-panel-border pl-4 flex items-center">
            J.A.R.V.I.S.
            <span className="ml-2 text-[10px] text-accent-amber font-mono font-bold tracking-normal px-1 py-0.2 bg-amber-500/10 border border-amber-500/20 rounded">
              NVIDIA
            </span>
          </div>
        </div>
      </motion.div>

      {/* Redesigned Futuristic System Monitor Modal */}
      <AnimatePresence>
        {showDetails && (
          <>
            {/* Frosted Backdrop to prevent underlapping & clicks passing through */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm"
              onClick={() => setShowDetails(false)}
            />

            {/* Modal Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: -20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: -20 }}
              transition={{ type: "spring", damping: 25, stiffness: 350 }}
              className="fixed top-16 left-1/2 -translate-x-1/2 z-[90] w-[680px] max-w-[94vw] max-h-[calc(100vh-100px)] flex flex-col rounded-2xl border border-cyan-500/30 bg-[#060e19]/95 backdrop-blur-2xl shadow-[0_0_60px_rgba(0,243,255,0.2),0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Futuristic Cyber Corner Accents */}
              <div className="absolute top-0 left-0 w-3.5 h-3.5 border-t-2 border-l-2 border-cyan-400 pointer-events-none" />
              <div className="absolute top-0 right-0 w-3.5 h-3.5 border-t-2 border-r-2 border-cyan-400 pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-3.5 h-3.5 border-b-2 border-l-2 border-cyan-400 pointer-events-none" />
              <div className="absolute bottom-0 right-0 w-3.5 h-3.5 border-b-2 border-r-2 border-cyan-400 pointer-events-none" />

              {/* Panel Header */}
              <div className="px-6 py-4 border-b border-cyan-500/20 bg-gradient-to-r from-cyan-950/40 via-slate-900/60 to-cyan-950/40 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-400/40 shadow-[0_0_15px_rgba(0,243,255,0.3)]">
                    <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
                    <div className="absolute -inset-0.5 rounded-lg border border-cyan-400/30 animate-ping opacity-30 pointer-events-none" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-orbitron text-sm font-bold tracking-wider text-cyan-300 drop-shadow-[0_0_8px_rgba(0,243,255,0.5)]">
                        SYSTEM MONITOR
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-orbitron bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                        DIAGNOSTICS
                      </span>
                    </div>
                    <span className="font-rajdhani text-[11px] text-text-secondary/60 tracking-wider">
                      HARDWARE TELEMETRY & AUTONOMOUS AGENTS
                    </span>
                  </div>
                </div>

                {/* Tab Switcher & Close Button */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center p-1 rounded-lg bg-black/50 border border-cyan-500/25">
                    <button
                      onClick={() => setActiveTab("telemetry")}
                      className={`px-3 py-1 rounded-md text-xs font-orbitron tracking-wider transition-all ${
                        activeTab === "telemetry"
                          ? "bg-cyan-500/25 text-cyan-300 border border-cyan-400/50 shadow-[0_0_12px_rgba(0,243,255,0.35)] font-bold"
                          : "text-text-secondary/60 hover:text-text-secondary"
                      }`}
                    >
                      TELEMETRY
                    </button>
                    <button
                      onClick={() => {
                        setActiveTab("processes");
                        fetchProcesses();
                      }}
                      className={`px-3 py-1 rounded-md text-xs font-orbitron tracking-wider transition-all ${
                        activeTab === "processes"
                          ? "bg-cyan-500/25 text-cyan-300 border border-cyan-400/50 shadow-[0_0_12px_rgba(0,243,255,0.35)] font-bold"
                          : "text-text-secondary/60 hover:text-text-secondary"
                      }`}
                    >
                      TOP APPS
                    </button>
                  </div>

                  <button
                    onClick={() => setShowDetails(false)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary/60 hover:text-accent-red hover:bg-accent-red/15 border border-transparent hover:border-accent-red/40 transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable Content Body */}
              <div className="p-6 overflow-y-auto max-h-[calc(100vh-180px)] space-y-5 custom-scrollbar">
                {activeTab === "telemetry" ? (
                  <>
                    {/* Primary Two-Column Grid: Compute Engine & Storage/Vitals */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Card 1: CPU Processor Matrix */}
                      <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-[#091829]/70 to-[#050e18]/90 relative overflow-hidden">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-orbitron text-xs font-bold tracking-wider text-cyan-400 flex items-center gap-2">
                            <Cpu className="w-4 h-4 text-cyan-400" /> CPU PROCESSOR
                          </span>
                          <span className="text-[10px] font-rajdhani px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                            {hardwareConcurrency ? `${hardwareConcurrency} Threads` : "Active"}
                          </span>
                        </div>

                        {/* Circular Gauge + Core Stats */}
                        <div className="flex items-center gap-4 my-2">
                          <div className="relative w-20 h-20 flex-shrink-0 flex items-center justify-center">
                            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                              <path
                                className="text-white/10"
                                strokeWidth="3.5"
                                stroke="currentColor"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                              <path
                                className={`${
                                  (pcStats?.cpuUsage ?? 0) > 80 ? "text-accent-red" :
                                  (pcStats?.cpuUsage ?? 0) > 60 ? "text-accent-amber" : "text-cyan-400"
                                } transition-all duration-500`}
                                strokeDasharray={`${pcStats?.cpuUsage ?? 0}, 100`}
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                stroke="currentColor"
                                fill="none"
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="font-orbitron font-bold text-base text-cyan-300">
                                {pcStats?.cpuUsage !== null && pcStats?.cpuUsage !== undefined
                                  ? `${Math.round(pcStats.cpuUsage)}%`
                                  : "N/A"}
                              </span>
                              <span className="text-[9px] font-rajdhani text-text-secondary/60 uppercase">LOAD</span>
                            </div>
                          </div>

                          <div className="space-y-1.5 flex-1">
                            <div className="flex justify-between text-xs font-rajdhani">
                              <span className="text-text-secondary/80">Active Frequency</span>
                              <span className="text-cyan-300 font-mono">Real-time</span>
                            </div>
                            <div className="flex justify-between text-xs font-rajdhani">
                              <span className="text-text-secondary/80">Execution State</span>
                              <span className="text-accent-green font-semibold">Nominal</span>
                            </div>
                            <div className="flex justify-between text-xs font-rajdhani">
                              <span className="text-text-secondary/80">Thermals</span>
                              <span className="text-text-secondary">
                                {pcStats?.temperature !== null ? `${pcStats?.temperature}°C` : "Sensor Protected"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="h-1.5 bg-black/40 rounded-full overflow-hidden mt-3">
                          <motion.div
                            className={`h-full rounded-full ${
                              (pcStats?.cpuUsage ?? 0) > 80 ? "bg-accent-red" :
                              (pcStats?.cpuUsage ?? 0) > 60 ? "bg-accent-amber" : "bg-gradient-to-r from-cyan-500 to-teal-400"
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pcStats?.cpuUsage ?? 0}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      </div>

                      {/* Card 2: Memory Matrix */}
                      <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-[#091829]/70 to-[#050e18]/90 relative overflow-hidden">
                        <div className="flex items-center justify-between mb-3">
                          <span className="font-orbitron text-xs font-bold tracking-wider text-cyan-400 flex items-center gap-2">
                            <HardDrive className="w-4 h-4 text-cyan-400" /> SYSTEM RAM
                          </span>
                          <span className={`font-orbitron text-xs font-bold ${getMemoryColor(pcStats?.memoryUsage ?? null)}`}>
                            {pcStats?.memoryUsage !== null && pcStats?.memoryUsage !== undefined
                              ? `${Math.round(pcStats.memoryUsage)}%`
                              : "N/A"}
                          </span>
                        </div>

                        {/* Memory bar */}
                        <div className="h-2.5 bg-black/50 rounded-full overflow-hidden my-3 border border-white/5 relative">
                          <motion.div
                            className={`h-full rounded-full ${
                              (pcStats?.memoryUsage ?? 0) > 85 ? "bg-accent-red" :
                              (pcStats?.memoryUsage ?? 0) > 70 ? "bg-accent-amber" : "bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400"
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pcStats?.memoryUsage ?? 0}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>

                        {/* Granular Memory Stats */}
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <div className="p-2 rounded-lg bg-black/40 border border-white/5">
                            <span className="text-[10px] font-rajdhani text-text-secondary/60 block uppercase">Used Space</span>
                            <span className="font-orbitron text-xs font-bold text-cyan-300">
                              {formatBytes(pcStats?.memoryUsed)}
                            </span>
                          </div>
                          <div className="p-2 rounded-lg bg-black/40 border border-white/5">
                            <span className="text-[10px] font-rajdhani text-text-secondary/60 block uppercase">Total Physical</span>
                            <span className="font-orbitron text-xs font-bold text-text-secondary">
                              {formatBytes(pcStats?.memoryTotal)}
                            </span>
                          </div>
                        </div>

                        {deviceMemory && (
                          <span className="text-[10px] font-rajdhani text-text-secondary/50 mt-2 block text-right">
                            Browser Allocated Heap: ~{deviceMemory} GB
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Vitals Strip: Storage Drives & Power / Uptime */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Storage Disks */}
                      <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-[#091829]/70 to-[#050e18]/90">
                        <span className="font-orbitron text-xs font-bold tracking-wider text-cyan-400 flex items-center gap-2 mb-3">
                          <Layers className="w-4 h-4 text-cyan-400" /> LOGICAL VOLUMES
                        </span>
                        {pcStats?.disks && pcStats.disks.length > 0 ? (
                          <div className="space-y-3">
                            {pcStats.disks.slice(0, 2).map((disk, idx) => (
                              <div key={idx} className="space-y-1">
                                <div className="flex justify-between items-center text-xs font-rajdhani">
                                  <span className="font-semibold text-cyan-200">Drive ({disk.caption})</span>
                                  <span className="text-text-secondary/80">
                                    {formatBytes(disk.free)} free of {formatBytes(disk.size)}
                                  </span>
                                  <span className="font-orbitron text-[11px] text-cyan-400 font-bold">
                                    {disk.usage}%
                                  </span>
                                </div>
                                <div className="h-1.5 bg-black/50 rounded-full overflow-hidden">
                                  <motion.div
                                    className={`h-full rounded-full ${
                                      disk.usage > 90 ? "bg-accent-red" :
                                      disk.usage > 75 ? "bg-accent-amber" : "bg-gradient-to-r from-cyan-500 to-teal-400"
                                    }`}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${disk.usage}%` }}
                                    transition={{ duration: 0.5, delay: idx * 0.1 }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-text-secondary/50 italic font-rajdhani">
                            Checking storage partition states...
                          </p>
                        )}
                      </div>

                      {/* System Vitals: Battery & Uptime */}
                      <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-[#091829]/70 to-[#050e18]/90 flex flex-col justify-between">
                        <span className="font-orbitron text-xs font-bold tracking-wider text-cyan-400 flex items-center gap-2 mb-2">
                          <Zap className="w-4 h-4 text-cyan-400" /> POWER & UPTIME
                        </span>

                        <div className="grid grid-cols-2 gap-3 my-1">
                          {/* Battery Box */}
                          <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col justify-between">
                            <span className="text-[10px] font-rajdhani text-text-secondary/60 uppercase flex items-center gap-1">
                              <Battery className="w-3 h-3 text-cyan-400" /> Battery
                            </span>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-orbitron text-sm font-bold text-cyan-300">
                                {battery !== null ? `${Math.round(battery)}%` : "AC Power"}
                              </span>
                              {isCharging && (
                                <Zap className="w-3 h-3 text-accent-green animate-pulse" />
                              )}
                            </div>
                            <span className="text-[10px] font-rajdhani text-accent-green">
                              {isCharging ? "Charging Active" : "Discharging"}
                            </span>
                          </div>

                          {/* Uptime Box */}
                          <div className="p-2.5 rounded-lg bg-black/40 border border-white/5 flex flex-col justify-between">
                            <span className="text-[10px] font-rajdhani text-text-secondary/60 uppercase flex items-center gap-1">
                              <Clock className="w-3 h-3 text-cyan-400" /> System Uptime
                            </span>
                            <span className="font-orbitron text-sm font-bold text-cyan-300 mt-1">
                              {formatUptime(pcStats?.uptime ?? null)}
                            </span>
                            <span className="text-[10px] font-rajdhani text-cyan-400/80">
                              Continuous Online
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Autonomous Protocols Section */}
                    <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-[#091829]/70 to-[#050e18]/90">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-orbitron text-xs font-bold tracking-wider text-cyan-400 flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-cyan-400" /> AUTONOMOUS PROTOCOLS
                        </span>
                        <span className="text-[10px] font-rajdhani text-text-secondary/50">
                          JARVIS BACKGROUND DAEMONS
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* 1. Sentinel Vision */}
                        <div className="p-3 rounded-lg bg-black/40 border border-cyan-500/20 hover:border-cyan-400/40 transition-all flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Eye className={`w-4 h-4 ${sentinelActive ? "text-cyan-400 animate-pulse drop-shadow-[0_0_6px_rgba(0,243,255,0.7)]" : "text-text-secondary/40"}`} />
                              <span className="font-orbitron text-xs font-semibold text-cyan-200">
                                Sentinel Eyes
                              </span>
                            </div>
                            {/* Toggle Switch */}
                            <button
                              onClick={() => setSentinelActive(!sentinelActive)}
                              className={`relative inline-flex items-center h-5 w-9 rounded-full transition-colors duration-300 focus:outline-none ${
                                sentinelActive
                                  ? "bg-cyan-500 shadow-[0_0_10px_rgba(0,243,255,0.5)]"
                                  : "bg-white/10"
                              }`}
                              title={sentinelActive ? "Click to disable Sentinel Eyes" : "Click to enable Sentinel Eyes"}
                            >
                              <motion.span
                                layout
                                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                className={`inline-block w-3.5 h-3.5 rounded-full bg-white shadow-md ${
                                  sentinelActive ? "translate-x-4" : "translate-x-1"
                                }`}
                              />
                            </button>
                          </div>
                          <span className="text-[10px] font-rajdhani text-text-secondary/60 mt-2 block">
                            Passive desktop vision & proactive suggestions
                          </span>
                        </div>

                        {/* 2. Biometric Link */}
                        <div className="p-3 rounded-lg bg-black/40 border border-cyan-500/20 flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Scan className={`w-4 h-4 ${biometricActive ? "text-accent-green" : "text-text-secondary/40"}`} />
                              <span className="font-orbitron text-xs font-semibold text-cyan-200">
                                Biometric Link
                              </span>
                            </div>
                            <span className={`text-[10px] font-orbitron px-1.5 py-0.5 rounded ${
                              biometricActive
                                ? "bg-emerald-500/20 text-accent-green border border-emerald-500/30"
                                : "bg-white/5 text-text-secondary/40"
                            }`}>
                              {biometricActive ? "ENCRYPTED" : "OFFLINE"}
                            </span>
                          </div>
                          <span className="text-[10px] font-rajdhani text-text-secondary/60 mt-2 block">
                            Camera presence & face-match security lock
                          </span>
                        </div>

                        {/* 3. Always-On Voice */}
                        <div className="p-3 rounded-lg bg-black/40 border border-cyan-500/20 flex flex-col justify-between">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Volume2 className="w-4 h-4 text-cyan-400" />
                              <span className="font-orbitron text-xs font-semibold text-cyan-200">
                                Voice Matrix
                              </span>
                            </div>
                            <span className="text-[10px] font-orbitron px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
                              NOMINAL
                            </span>
                          </div>
                          <span className="text-[10px] font-rajdhani text-text-secondary/60 mt-2 block">
                            Wake word listener & multi-engine neural TTS
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Patterns of Life Observation */}
                    <div className="p-4 rounded-xl border border-cyan-500/20 bg-gradient-to-b from-[#091829]/70 to-[#050e18]/90">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4 text-cyan-400" />
                          <span className="font-orbitron text-xs font-bold tracking-wider text-cyan-400">
                            BEHAVIOR PATTERNS
                          </span>
                        </div>
                        <span className="text-[10px] font-rajdhani text-text-secondary/50">
                          OBSERVED (14 DAYS)
                        </span>
                      </div>

                      {patterns.length === 0 ? (
                        <p className="text-xs text-text-secondary/50 font-rajdhani italic py-1">
                          Continuous observation active. Patterns will populate as JARVIS interacts with your workflows.
                        </p>
                      ) : (
                        <div className="space-y-2 mt-2">
                          {patterns.slice(0, 3).map((p) => (
                            <div
                              key={p.id}
                              className="flex items-center justify-between p-2 rounded-lg bg-black/40 border border-white/5 text-xs font-rajdhani"
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_6px_#00f3ff]" />
                                <span className="text-cyan-100">{p.text}</span>
                              </div>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300">
                                {Math.round(p.confidence * 100)}% conf
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  /* TOP RUNNING APPS TAB */
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="font-orbitron text-xs font-bold text-cyan-400 flex items-center gap-2">
                        <Server className="w-4 h-4" /> ACTIVE PROCESSES BY RAM
                      </span>
                      <button
                        onClick={fetchProcesses}
                        disabled={loadingProcesses}
                        className="px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-rajdhani flex items-center gap-1.5 transition-all"
                      >
                        <RefreshCw className={`w-3 h-3 ${loadingProcesses ? "animate-spin" : ""}`} />
                        Refresh
                      </button>
                    </div>

                    {loadingProcesses && processes.length === 0 ? (
                      <div className="py-12 text-center text-text-secondary/60 font-rajdhani text-sm">
                        Scanning active system processes...
                      </div>
                    ) : (
                      <div className="divide-y divide-white/5 border border-white/10 rounded-xl overflow-hidden bg-black/40">
                        {processes.map((p) => (
                          <div
                            key={p.pid}
                            className="p-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center font-mono text-xs text-cyan-300 font-bold">
                                {p.name.slice(0, 2).toUpperCase()}
                              </div>
                              <div>
                                <span className="font-rajdhani font-semibold text-sm text-cyan-100 block">
                                  {p.name}
                                </span>
                                <span className="font-mono text-[10px] text-text-secondary/60">
                                  PID {p.pid}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <span className="font-orbitron text-xs font-bold text-cyan-300 block">
                                  {p.memory} MB
                                </span>
                                <span className="text-[10px] font-rajdhani text-text-secondary/50">
                                  Memory
                                </span>
                              </div>

                              <button
                                onClick={() => killProcess(p.pid)}
                                disabled={killingPid === p.pid}
                                className="px-2.5 py-1 rounded bg-accent-red/10 hover:bg-accent-red/25 text-accent-red border border-accent-red/30 text-xs font-orbitron transition-all"
                                title="Terminate Process"
                              >
                                {killingPid === p.pid ? "..." : "END"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Panel Footer */}
              <div className="px-6 py-3 border-t border-cyan-500/20 bg-black/40 flex items-center justify-between text-[11px] font-rajdhani text-text-secondary/60">
                <span>All metrics secured • Telemetry refreshed every 5s</span>
                <span className="font-orbitron text-[10px] text-cyan-400">
                  JARVIS MK-IV
                </span>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
