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
            className="flex items-center gap-3 px-2.5 py-1 rounded-lg"
            title="System diagnostics (see right panel)"
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
    </>
  );
}
