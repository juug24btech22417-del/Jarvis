"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Cpu,
  HardDrive,
  Thermometer,
  Wifi,
  Battery,
  Clock,
  Shield,
  Zap,
  Activity,
  Radio,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

interface PCStats {
  cpuUsage: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  memoryUsage: number | null;
  battery: number | null;
  temperature: number | null;
  uptime: number | null;
}

interface TickerItem {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  pulse?: boolean;
}

/**
 * Thin scrolling telemetry HUD at the very bottom of the screen.
 * Shows real system data: CPU, RAM, temp, uptime, time, sentinel status.
 * Scrolls horizontally like a spaceship diagnostic strip.
 */
export default function TelemetryTicker() {
  const [time, setTime] = useState(new Date());
  const [pcStats, setPcStats] = useState<PCStats | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [networkSpeed, setNetworkSpeed] = useState<string>("—");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollPos, setScrollPos] = useState(0);

  const sentinelActive = useJarvisStore((s) => s.sentinelActive);
  const sentinelArmed = useJarvisStore((s) => s.sentinelArmed);
  const state = useJarvisStore((s) => s.state);
  const voiceLevel = useJarvisStore((s) => s.voiceLevel);
  const activeAlerts = useJarvisStore((s) => s.activeAlerts);

  // Tick clock every second
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch PC stats
  const fetchPCStats = useCallback(async () => {
    try {
      const res = await fetch("/api/system/pcstats");
      if (res.ok) {
        const data = await res.json();
        if (data.success) setPcStats(data.stats);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchPCStats();
    const t = setInterval(fetchPCStats, 5000);
    return () => clearInterval(t);
  }, [fetchPCStats]);

  // Battery
  useEffect(() => {
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery?.()?.then((bat: any) => {
        setBattery(bat.level * 100);
        bat.addEventListener("levelchange", () => setBattery(bat.level * 100));
      });
    }
  }, []);

  // Network info
  useEffect(() => {
    if (typeof navigator !== "undefined" && "connection" in navigator) {
      const conn = (navigator as any).connection;
      const update = () => {
        if (conn.downlink) setNetworkSpeed(`${conn.downlink} Mbps`);
      };
      update();
      conn.addEventListener("change", update);
      return () => conn.removeEventListener("change", update);
    }
  }, []);

  // Smooth auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 0) return;

    let pos = 0;
    const speed = 0.5; // px per frame
    let raf: number;

    const animate = () => {
      pos += speed;
      if (pos >= maxScroll) pos = 0;
      el.scrollLeft = pos;
      setScrollPos(pos);
      raf = requestAnimationFrame(animate);
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fmt = (n: number | null, suffix = "") =>
    n !== null && n !== undefined ? `${Math.round(n)}${suffix}` : "—";

  const getHeatColor = (val: number | null) => {
    if (val === null) return "text-text-secondary/60";
    if (val > 80) return "text-accent-red";
    if (val > 60) return "text-accent-amber";
    return "text-cyan-400";
  };

  const items: TickerItem[] = [
    {
      icon: <Clock className="w-3 h-3" />,
      label: "TIME",
      value: time.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      color: "text-reactor-core",
    },
    {
      icon: <Cpu className="w-3 h-3" />,
      label: "CPU",
      value: `${fmt(pcStats?.cpuUsage ?? null, "%")}`,
      color: getHeatColor(pcStats?.cpuUsage ?? null),
    },
    {
      icon: <HardDrive className="w-3 h-3" />,
      label: "RAM",
      value: `${fmt(pcStats?.memoryUsage ?? null, "%")}`,
      color: getHeatColor(pcStats?.memoryUsage ?? null),
    },
    {
      icon: <Thermometer className="w-3 h-3" />,
      label: "TEMP",
      value: pcStats?.temperature !== null ? `${pcStats?.temperature}°C` : "—",
      color: pcStats?.temperature && pcStats.temperature > 75 ? "text-accent-red" : "text-cyan-400",
    },
    {
      icon: <Battery className="w-3 h-3" />,
      label: "BATT",
      value: battery !== null ? `${Math.round(battery)}%` : "AC",
      color: battery !== null && battery < 20 ? "text-accent-red" : "text-cyan-400",
    },
    {
      icon: <Wifi className="w-3 h-3" />,
      label: "NET",
      value: networkSpeed,
      color: "text-cyan-400",
    },
    {
      icon: <Shield className="w-3 h-3" />,
      label: "SENTINEL",
      value: sentinelArmed ? "ARMED" : sentinelActive ? "WATCH" : "OFF",
      color: sentinelArmed ? "text-accent-green" : sentinelActive ? "text-accent-amber" : "text-text-secondary/50",
      pulse: sentinelArmed,
    },
    {
      icon: <Activity className="w-3 h-3" />,
      label: "STATE",
      value: state.toUpperCase(),
      color: state === "thinking" ? "text-accent-amber" : state === "speaking" ? "text-reactor-core" : "text-cyan-400",
    },
    {
      icon: <Radio className="w-3 h-3" />,
      label: "VOICE",
      value: `${Math.round(voiceLevel * 100)}%`,
      color: voiceLevel > 0.3 ? "text-reactor-core" : "text-text-secondary/60",
    },
    {
      icon: <Zap className="w-3 h-3" />,
      label: "ALERTS",
      value: `${activeAlerts}`,
      color: activeAlerts > 0 ? "text-accent-red" : "text-cyan-400",
      pulse: activeAlerts > 0,
    },
    {
      icon: <Clock className="w-3 h-3" />,
      label: "UPTIME",
      value: pcStats?.uptime !== null ? `${Math.round(pcStats?.uptime ?? 0)}h` : "—",
      color: "text-cyan-400",
    },
  ];

  // Duplicate items for seamless loop
  const loopItems = [...items, ...items, ...items];

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[45] h-8 bg-[#030a14]/90 backdrop-blur-md border-t border-cyan-500/15 overflow-hidden">
      {/* Scanline overlay */}
      <div className="absolute inset-0 pointer-events-none bg-repeating-linear-gradient opacity-10"
        style={{
          background: "repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(0,243,255,0.03) 1px, rgba(0,243,255,0.03) 2px)",
        }}
      />

      {/* Left fade */}
      <div className="absolute left-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to right, #030a14, transparent)" }}
      />
      {/* Right fade */}
      <div className="absolute right-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
        style={{ background: "linear-gradient(to left, #030a14, transparent)" }}
      />

      {/* Scrolling content */}
      <div
        ref={scrollRef}
        className="flex items-center h-full gap-0 overflow-hidden whitespace-nowrap"
        style={{ scrollBehavior: "auto" }}
      >
        {/* Start marker */}
        <div className="flex-shrink-0 px-3 h-full flex items-center border-r border-cyan-500/15">
          <span className="font-orbitron text-[9px] text-cyan-500/50 tracking-[0.2em]">SYS</span>
        </div>

        {loopItems.map((item, i) => (
          <div
            key={i}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 h-full border-r border-cyan-500/10 hover:bg-cyan-500/5 transition-colors"
          >
            <span className={`${item.color} opacity-60`}>{item.icon}</span>
            <span className="font-rajdhani text-[9px] text-text-secondary/50 tracking-wider uppercase">
              {item.label}
            </span>
            <span className={`font-orbitron text-[10px] font-bold ${item.color} ${item.pulse ? "animate-pulse" : ""}`}>
              {item.value}
            </span>
          </div>
        ))}

        {/* End marker */}
        <div className="flex-shrink-0 px-3 h-full flex items-center">
          <span className="font-orbitron text-[9px] text-cyan-500/50 tracking-[0.2em]">JARVIS MK-IV</span>
        </div>
      </div>

      {/* Thin glow line on top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-reactor-core/40 to-transparent" />
    </div>
  );
}
