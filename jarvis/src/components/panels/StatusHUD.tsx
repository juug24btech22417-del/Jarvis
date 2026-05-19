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
  ShieldCheck
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";
import gsap from "gsap";

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

export default function StatusHUD() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [battery, setBattery] = useState<number | null>(null);
  const [isCharging, setIsCharging] = useState(false);
  const [pcStats, setPcStats] = useState<PCStats | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { isMuted, setIsMuted, state, sentinelActive, biometricActive } = useJarvisStore();

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

  // Animate details panel
  useEffect(() => {
    if (showDetails) {
      gsap.fromTo(
        ".system-details",
        { opacity: 0, y: -10, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: "power2.out" }
      );
    }
  }, [showDetails]);

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
    if (!usage) return "text-text-secondary";
    if (usage > 80) return "text-accent-red";
    if (usage > 60) return "text-accent-amber";
    return "text-accent-green";
  };

  const getMemoryColor = (usage: number | null) => {
    if (!usage) return "text-text-secondary";
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
    if (!hours) return "N/A";
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
      <motion.div
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-3 holographic-panel"
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.5, delay: 4, ease: "easeOut" }}
      >
        {/* Left side - Date/Time */}
        <div className="flex items-center gap-6">
          <div className="font-orbitron text-reactor-core text-lg tracking-wider">
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
            className="flex items-center gap-3 cursor-pointer hover:bg-panel-glass/50 px-2 py-1 rounded transition-colors"
            onClick={() => setShowDetails(!showDetails)}
            title="Click for system details"
          >
            {/* CPU */}
            {pcStats?.cpuUsage !== null && pcStats?.cpuUsage !== undefined && (
              <div className="flex items-center gap-1">
                <Cpu className={`w-4 h-4 ${getCpuColor(pcStats.cpuUsage)}`} />
                <span className={`font-rajdhani text-xs ${getCpuColor(pcStats.cpuUsage)}`}>
                  {Math.round(pcStats.cpuUsage)}%
                </span>
              </div>
            )}

            {/* Memory */}
            {pcStats?.memoryUsage !== null && pcStats?.memoryUsage !== undefined && (
              <div className="flex items-center gap-1">
                <HardDrive className={`w-4 h-4 ${getMemoryColor(pcStats.memoryUsage)}`} />
                <span className={`font-rajdhani text-xs ${getMemoryColor(pcStats.memoryUsage)}`}>
                  {Math.round(pcStats.memoryUsage)}%
                </span>
              </div>
            )}

            {/* Temperature */}
            {pcStats?.temperature !== null && pcStats?.temperature !== undefined && (
              <div className="flex items-center gap-1">
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
            <AnimatePresence>
              {sentinelActive && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  className="flex items-center gap-1 group"
                  title="Sentinel Eyes: Passively observing screen"
                >
                  <motion.div
                    animate={{ opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  >
                    <Eye className="w-4 h-4 text-reactor-core glow-icon" />
                  </motion.div>
                  <span className="font-rajdhani text-[10px] text-reactor-core hidden lg:block uppercase tracking-tighter">Sentinel</span>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {biometricActive && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  className="flex items-center gap-1 group"
                  title="Biometric Recognition: Scanning for Boss"
                >
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <Scan className="w-4 h-4 text-accent-green glow-icon" />
                  </motion.div>
                  <span className="font-rajdhani text-[10px] text-accent-green hidden lg:block uppercase tracking-tighter">Biometric</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Network */}
          <Wifi className="w-4 h-4 text-text-secondary" />

          {/* Battery */}
          {battery !== null && (
            <div className="flex items-center gap-1">
              <Battery
                className={`w-4 h-4 ${getBatteryColor(battery)} ${isCharging ? "animate-pulse" : ""}`}
              />
              <span
                className={`font-rajdhani text-xs ${getBatteryColor(battery)}`}
              >
                {Math.round(battery)}%
              </span>
            </div>
          )}

          {/* Mute button */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className="p-1 hover:bg-panel-glass rounded transition-colors"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-accent-red" />
            ) : (
              <Volume2 className="w-4 h-4 text-text-secondary" />
            )}
          </button>

          {/* JARVIS Logo */}
          <div className="font-orbitron text-reactor-core text-sm tracking-widest border-l border-panel-border pl-4">
            J.A.R.V.I.S.
            <span className="ml-2 text-[10px] text-accent-amber">NVIDIA</span>
          </div>
        </div>
      </motion.div>

      {/* System Details Panel */}
      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed top-16 left-1/2 transform -translate-x-1/2 z-50 system-details"
          >
            <div className="holographic-panel p-4 w-80">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-reactor-core" />
                  <span className="font-orbitron text-reactor-core font-bold text-sm">
                    SYSTEM MONITOR
                  </span>
                </div>
                <button
                  onClick={() => setShowDetails(false)}
                  className="p-1 hover:bg-accent-red/20 rounded transition-colors"
                >
                  <X className="w-4 h-4 text-accent-red" />
                </button>
              </div>

              {/* CPU Section */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-rajdhani text-text-secondary text-sm flex items-center gap-2">
                    <Cpu className="w-4 h-4" /> CPU Usage
                  </span>
                  <span className={`font-orbitron text-sm ${getCpuColor(pcStats?.cpuUsage ?? null)}`}>
                    {pcStats?.cpuUsage !== null && pcStats?.cpuUsage !== undefined
                      ? `${Math.round(pcStats.cpuUsage)}%`
                      : "N/A"}
                  </span>
                </div>
                <div className="h-2 bg-panel-border/30 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      (pcStats?.cpuUsage ?? 0) > 80 ? "bg-accent-red" :
                      (pcStats?.cpuUsage ?? 0) > 60 ? "bg-accent-amber" : "bg-accent-green"
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${pcStats?.cpuUsage ?? 0}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                {hardwareConcurrency && (
                  <span className="text-xs text-text-secondary/50 mt-1 block">
                    {hardwareConcurrency} Cores Detected
                  </span>
                )}
              </div>

              {/* Memory Section */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-rajdhani text-text-secondary text-sm flex items-center gap-2">
                    <HardDrive className="w-4 h-4" /> Memory
                  </span>
                  <span className={`font-orbitron text-sm ${getMemoryColor(pcStats?.memoryUsage ?? null)}`}>
                    {pcStats?.memoryUsage !== null && pcStats?.memoryUsage !== undefined
                      ? `${Math.round(pcStats.memoryUsage)}%`
                      : "N/A"}
                  </span>
                </div>
                <div className="h-2 bg-panel-border/30 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${
                      (pcStats?.memoryUsage ?? 0) > 85 ? "bg-accent-red" :
                      (pcStats?.memoryUsage ?? 0) > 70 ? "bg-accent-amber" : "bg-accent-green"
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${pcStats?.memoryUsage ?? 0}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-text-secondary/50">
                    Used: {formatBytes(pcStats?.memoryUsed)}
                  </span>
                  <span className="text-xs text-text-secondary/50">
                    Total: {formatBytes(pcStats?.memoryTotal)}
                  </span>
                </div>
                {deviceMemory && (
                  <span className="text-xs text-text-secondary/50 mt-1 block">
                    Browser Detected: ~{deviceMemory} GB
                  </span>
                )}
              </div>

              {/* Battery Section */}
              {battery !== null && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-rajdhani text-text-secondary text-sm flex items-center gap-2">
                      <Battery className="w-4 h-4" /> Battery
                    </span>
                    <span className={`font-orbitron text-sm ${getBatteryColor(battery)}`}>
                      {Math.round(battery)}%{isCharging && " (Charging)"}
                    </span>
                  </div>
                  <div className="h-2 bg-panel-border/30 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${
                        battery < 20 ? "bg-accent-red" :
                        battery < 50 ? "bg-accent-amber" : "bg-accent-green"
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${battery}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                </div>
              )}

              {/* Temperature Section */}
              {pcStats?.temperature !== null && pcStats?.temperature !== undefined && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-rajdhani text-text-secondary text-sm flex items-center gap-2">
                      <Thermometer className="w-4 h-4" /> Temperature
                    </span>
                    <span className={`font-orbitron text-sm ${
                      (pcStats.temperature ?? 0) > 80 ? "text-accent-red" :
                      (pcStats.temperature ?? 0) > 60 ? "text-accent-amber" : "text-text-secondary"
                    }`}>
                      {pcStats.temperature}°C
                    </span>
                  </div>
                </div>
              )}

              {/* Uptime */}
              {pcStats?.uptime !== null && pcStats?.uptime !== undefined && (
                <div className="mb-2">
                  <span className="font-rajdhani text-text-secondary text-sm">
                    Uptime: <span className="text-reactor-core">{formatUptime(pcStats.uptime)}</span>
                  </span>
                </div>
              )}

              {/* Disk Usage */}
              {pcStats?.disks && pcStats.disks.length > 0 && (
                <div className="mt-4 pt-4 border-t border-panel-border">
                  <span className="font-rajdhani text-text-secondary text-sm block mb-2">
                    Disk Usage
                  </span>
                  {pcStats.disks.slice(0, 3).map((disk, index) => (
                    <div key={index} className="mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-text-secondary/70">{disk.caption}</span>
                        <span className={`text-xs ${
                          disk.usage > 90 ? "text-accent-red" :
                          disk.usage > 75 ? "text-accent-amber" : "text-text-secondary"
                        }`}>
                          {disk.usage}%
                        </span>
                      </div>
                      <div className="h-1 bg-panel-border/30 rounded-full overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${
                            disk.usage > 90 ? "bg-accent-red" :
                            disk.usage > 75 ? "bg-accent-amber" : "bg-accent-green"
                          }`}
                          initial={{ width: 0 }}
                          animate={{ width: `${disk.usage}%` }}
                          transition={{ duration: 0.5, delay: index * 0.1 }}
                        />
                      </div>
                      <span className="text-xs text-text-secondary/40">
                        Free: {formatBytes(disk.free)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Autonomous Features Details */}
              <div className="mt-4 pt-4 border-t border-panel-border">
                <span className="font-rajdhani text-text-secondary text-sm block mb-2 uppercase tracking-widest opacity-70">
                  Autonomous Protocols
                </span>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary/70 flex items-center gap-2">
                      <Eye className="w-3 h-3" /> Sentinel Vision
                    </span>
                    <span className={`text-[10px] font-orbitron ${sentinelActive ? "text-reactor-core" : "text-text-secondary/30"}`}>
                      {sentinelActive ? "ACTIVE" : "OFFLINE"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary/70 flex items-center gap-2">
                      <Scan className="w-3 h-3" /> Biometric Link
                    </span>
                    <span className={`text-[10px] font-orbitron ${biometricActive ? "text-accent-green" : "text-text-secondary/30"}`}>
                      {biometricActive ? "ENCRYPTED" : "OFFLINE"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary/70 flex items-center gap-2">
                      <ShieldCheck className="w-3 h-3" /> Always-On Voice
                    </span>
                    <span className="text-[10px] font-orbitron text-reactor-core">
                      NOMINAL
                    </span>
                  </div>
                </div>
              </div>

              {/* Last Updated */}
              <div className="mt-4 pt-2 border-t border-panel-border text-center">
                <span className="text-xs text-text-secondary/40">
                  Updates every 5 seconds
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
