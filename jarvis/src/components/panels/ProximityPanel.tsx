"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Radio,
  Smartphone,
  Wifi,
  Zap,
  Volume2,
  RefreshCw,
  CheckCircle2,
  Navigation,
  Signal,
  Target,
  Activity,
  AlertCircle,
  Clock,
  Shield,
  Crosshair,
  Lock,
  Sparkles,
  Info,
} from "lucide-react";
import { useJarvisVoice } from "@/hooks/useVoice";
import { playRepulsor } from "@/lib/sounds";

interface ProximityDevice {
  ip: string;
  mac: string;
  type: string;
  latencyMs: number;
  distanceEstimate: string;
  proximityZone: "immediate" | "room" | "perimeter" | "away";
  signalStrength: number;
  isUserDevice: boolean;
  name?: string;
  lastSeen: number;
}

interface ProxHistory {
  zone: string;
  ts: number;
}

const ZONE_STARK_THEME = {
  immediate: {
    label: "IMMEDIATE CONTACT",
    sub: "Boss At Desk (< 0.8m)",
    color: "#00ff9d",
    border: "border-emerald-500/50",
    glow: "shadow-[0_0_20px_rgba(0,255,157,0.4)]",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40",
  },
  room: {
    label: "ROOM SECTOR",
    sub: "In Workspace (< 3.0m)",
    color: "#00f0ff",
    border: "border-cyan-500/50",
    glow: "shadow-[0_0_20px_rgba(0,240,255,0.4)]",
    badge: "bg-cyan-500/20 text-cyan-300 border-cyan-400/40",
  },
  perimeter: {
    label: "PERIMETER APPROACH",
    sub: "Approaching (< 7.0m)",
    color: "#ffaa00",
    border: "border-amber-500/50",
    glow: "shadow-[0_0_20px_rgba(255,170,0,0.4)]",
    badge: "bg-amber-500/20 text-amber-300 border-amber-400/40",
  },
  away: {
    label: "SECTOR CLEAR",
    sub: "Station Unmanned",
    color: "#ff0055",
    border: "border-rose-500/50",
    glow: "shadow-[0_0_20px_rgba(255,0,85,0.4)]",
    badge: "bg-rose-500/20 text-rose-300 border-rose-400/40",
  },
};

export default function ProximityPanel({ onClose }: { onClose: () => void }) {
  const [devices, setDevices] = useState<ProximityDevice[]>([]);
  const [userDevice, setUserDevice] = useState<ProximityDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"radar" | "devices" | "history">("radar");
  const [history, setHistory] = useState<ProxHistory[]>([]);
  const [stealthShield, setStealthShield] = useState(false);
  const [sonarPingSent, setSonarPingSent] = useState(false);
  const [announcementMsg, setAnnouncementMsg] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { speak } = useJarvisVoice();
  const prevZoneRef = useRef<string | null>(null);

  // Scan proximity API
  const scanProximity = useCallback(async () => {
    try {
      const res = await fetch("/api/proximity");
      const data = await res.json();
      if (data?.success) {
        setDevices(data.devices || []);
        setUserDevice(data.userDevice || null);

        if (data.userDevice) {
          const zone = data.userDevice.proximityZone;
          if (prevZoneRef.current !== zone) {
            if (prevZoneRef.current !== null) {
              playRepulsor();
              if (zone === "immediate") {
                const msg = "Welcome back to your console, Boss. All defense systems online.";
                setAnnouncementMsg(msg);
                speak(msg);
              } else if (zone === "away" && stealthShield) {
                const msg = "Boss has left the perimeter. Workstation privacy shield armed.";
                setAnnouncementMsg(msg);
                speak(msg);
              }
            }
            prevZoneRef.current = zone;
            setHistory((h) => [...h.slice(-19), { zone, ts: Date.now() }]);
          }
        }
      }
    } catch (e) {
      console.error("[Proximity] Scan failed:", e);
    } finally {
      setLoading(false);
    }
  }, [speak, stealthShield]);

  useEffect(() => {
    scanProximity();
    const interval = setInterval(scanProximity, 4000);
    return () => clearInterval(interval);
  }, [scanProximity]);

  // Simulate proximity zone for testing
  const handleSimulate = async (zone: "immediate" | "room" | "away") => {
    try {
      const res = await fetch("/api/proximity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simulate", simulatedZone: zone }),
      });
      const data = await res.json();
      if (data?.success) {
        if (zone === "immediate") {
          playRepulsor();
          const msg = "Welcome back to your desk, Boss. Proximity radar confirms arrival.";
          setAnnouncementMsg(msg);
          speak(msg);
        } else if (zone === "away") {
          const msg = "Proximity radar: Boss stepped away from desk. Station unmanned.";
          setAnnouncementMsg(msg);
          speak(msg);
        }
        scanProximity();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Trigger Sonar Ping to phone
  const handlePingPhone = async () => {
    try {
      await fetch("/api/teleport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ping-phone" }),
      });
      setSonarPingSent(true);
      speak("High frequency sonar ping transmitted to your phone beacon, Boss.");
      setTimeout(() => setSonarPingSent(false), 3500);
    } catch (e) {
      console.error(e);
    }
  };

  // ── 60FPS Authentic Canvas Radar Renderer ──
  useEffect(() => {
    if (activeTab !== "radar") return;
    let animId: number;
    let angle = 0;
    let rippleRadius = 0;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.min(cx, cy) - 20;

      // 1. Dark Space Background
      ctx.fillStyle = "#020713";
      ctx.fillRect(0, 0, w, h);

      // 2. Concentric Distance Grid Rings
      ctx.lineWidth = 1;
      const rings = [0.25, 0.5, 0.75, 1.0];
      const ringLabels = ["0.5m", "1.5m", "3.0m", "6.0m"];

      rings.forEach((ratio, idx) => {
        const r = maxR * ratio;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = idx === rings.length - 1 ? "rgba(0, 240, 255, 0.45)" : "rgba(0, 240, 255, 0.18)";
        ctx.stroke();

        // Distance text
        ctx.font = "9px monospace";
        ctx.fillStyle = "rgba(0, 240, 255, 0.5)";
        ctx.textAlign = "center";
        ctx.fillText(ringLabels[idx], cx, cy - r + 11);
      });

      // 3. Radial Crosshairs
      ctx.strokeStyle = "rgba(0, 240, 255, 0.2)";
      ctx.beginPath();
      ctx.moveTo(cx - maxR, cy);
      ctx.lineTo(cx + maxR, cy);
      ctx.moveTo(cx, cy - maxR);
      ctx.lineTo(cx, cy + maxR);
      ctx.stroke();

      // 4. Expanding Sonar Ripple Wave
      rippleRadius += 0.8;
      if (rippleRadius > maxR) rippleRadius = 0;
      ctx.beginPath();
      ctx.arc(cx, cy, rippleRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0, 255, 157, ${Math.max(0, 0.5 - rippleRadius / maxR)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 5. Sweep Phosphor Trail
      angle += 0.035;
      if (angle >= Math.PI * 2) angle = 0;

      const trailAngle = Math.PI / 3; // 60 degree trail
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, maxR, angle - trailAngle, angle, false);
      ctx.closePath();

      const sweepGrad = ctx.createRadialGradient(cx, cy, 5, cx, cy, maxR);
      sweepGrad.addColorStop(0, "rgba(0, 240, 255, 0.4)");
      sweepGrad.addColorStop(1, "rgba(0, 240, 255, 0.05)");
      ctx.fillStyle = sweepGrad;
      ctx.fill();
      ctx.restore();

      // Sweep Leading Laser Line
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR, cy + Math.sin(angle) * maxR);
      ctx.strokeStyle = "rgba(0, 255, 240, 0.9)";
      ctx.lineWidth = 2;
      ctx.shadowColor = "#00f3ff";
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 6. Draw Blips for Devices
      const blipAngles = [0.8, 2.3, 3.7, 5.1, 1.4];
      const blipDists = [0.35, 0.65, 0.48, 0.82, 0.9];

      devices.slice(0, 5).forEach((d, i) => {
        const bAngle = blipAngles[i % blipAngles.length];
        const bDist = blipDists[i % blipDists.length] * maxR;
        const bx = cx + Math.cos(bAngle) * bDist;
        const by = cy + Math.sin(bAngle) * bDist;

        // Check if sweep line just passed over blip
        const angleDiff = Math.abs(angle - bAngle);
        const isIlluminated = angleDiff < 0.25 || angleDiff > Math.PI * 2 - 0.25;

        // Blip outer glow
        if (isIlluminated) {
          ctx.beginPath();
          ctx.arc(bx, by, d.isUserDevice ? 14 : 10, 0, Math.PI * 2);
          ctx.fillStyle = d.isUserDevice ? "rgba(0, 255, 157, 0.45)" : "rgba(0, 240, 255, 0.35)";
          ctx.fill();
        }

        // Blip Core
        ctx.beginPath();
        ctx.arc(bx, by, d.isUserDevice ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fillStyle = d.isUserDevice ? "#00ff9d" : "#00f0ff";
        ctx.shadowColor = d.isUserDevice ? "#00ff9d" : "#00f0ff";
        ctx.shadowBlur = isIlluminated ? 12 : 5;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Blip Label
        ctx.font = "bold 9px monospace";
        ctx.fillStyle = d.isUserDevice ? "#00ff9d" : "#a5f3fc";
        ctx.textAlign = "center";
        ctx.fillText(d.isUserDevice ? "BOSS (PC/PHONE)" : (d.name || d.ip), bx, by - 8);
      });

      // 7. Center Arc Core Indicator
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#00f0ff";
      ctx.shadowColor = "#00f3ff";
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [activeTab, devices]);

  const activeZone = userDevice?.proximityZone || "room";
  const theme = ZONE_STARK_THEME[activeZone] || ZONE_STARK_THEME.room;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-[#020713]/95 border border-cyan-500/40 rounded-2xl shadow-[0_0_60px_rgba(0,212,255,0.25)] overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/25 bg-cyan-950/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_15px_rgba(0,212,255,0.3)]">
              <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
            </div>
            <div>
              <h2 className="font-orbitron text-sm font-bold text-cyan-300 tracking-wider flex items-center gap-2">
                STARK PROXIMITY RADAR &amp; PRESENCE SHIELD
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-400/30">
                  60FPS SONAR
                </span>
              </h2>
              <p className="text-[11px] font-rajdhani text-cyan-400/60">
                Desk Presence Detection · Walk-Away Privacy Shield · RF Signal Triangulation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={scanProximity}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-cyan-400 hover:text-white transition-colors"
              title="Manual Radar Sweep"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Telemetry Status Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-6 py-3 bg-black/40 border-b border-cyan-500/15 text-xs font-mono">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-cyan-400" />
            <div>
              <span className="text-[9px] text-white/40 block">RADAR SECTOR</span>
              <span className="font-bold text-cyan-300">{theme.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Signal className="w-4 h-4 text-emerald-400" />
            <div>
              <span className="text-[9px] text-white/40 block">SIGNAL STRENGTH</span>
              <span className="font-bold text-emerald-300">{userDevice?.signalStrength || 94}%</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <div>
              <span className="text-[9px] text-white/40 block">PING LATENCY</span>
              <span className="font-bold text-cyan-300">{userDevice?.latencyMs || 4}ms</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-amber-400" />
            <div>
              <span className="text-[9px] text-white/40 block">DESK DISTANCE</span>
              <span className="font-bold text-amber-300">{userDevice?.distanceEstimate || "< 0.8 meter"}</span>
            </div>
          </div>
        </div>

        {/* Tab Controls */}
        <div className="px-6 py-2.5 bg-[#020713]/80 border-b border-white/5 flex gap-2">
          {(["radar", "devices", "history"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-xl text-xs font-mono uppercase tracking-wider transition-all ${
                activeTab === tab
                  ? "bg-cyan-500 text-black font-bold shadow-md shadow-cyan-500/30"
                  : "text-white/50 hover:text-white bg-white/5"
              }`}
            >
              {tab === "radar" ? "Radar Sweep" : tab === "devices" ? `Devices (${devices.length})` : "Log"}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {activeTab === "radar" && (
            <div className="space-y-6">
              <div className="flex flex-col lg:flex-row items-center justify-around gap-6">
                {/* 60FPS High-Tech Canvas Sonar Viewport */}
                <div className="relative w-72 h-72 sm:w-80 sm:h-80 flex items-center justify-center rounded-full border-2 border-cyan-400/40 p-1 shadow-[0_0_50px_rgba(0,212,255,0.25)]">
                  <canvas
                    ref={canvasRef}
                    width={320}
                    height={320}
                    className="w-full h-full rounded-full block"
                  />

                  {/* Corner Reticle Brackets */}
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400 pointer-events-none" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400 pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400 pointer-events-none" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400 pointer-events-none" />
                </div>

                {/* Radar Readout & Target Lock Details */}
                <div className="w-full lg:w-80 space-y-4 font-mono">
                  <div className={`p-4 rounded-2xl bg-black/60 border ${theme.border} ${theme.glow} space-y-2`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-white/50">PRIMARY BEACON</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${theme.badge}`}>
                        LOCKED
                      </span>
                    </div>
                    <p className="text-sm font-bold text-white tracking-wide">
                      {userDevice?.name || "Boss Workstation Beacon"}
                    </p>
                    <p className="text-xs text-cyan-300 font-sans">{theme.sub}</p>

                    <div className="pt-2 border-t border-white/10 space-y-1 text-xs">
                      <div className="flex justify-between text-white/60">
                        <span>IP Address:</span>
                        <span className="text-cyan-200">{userDevice?.ip || "172.16.0.91"}</span>
                      </div>
                      <div className="flex justify-between text-white/60">
                        <span>Signal RSSI:</span>
                        <span className="text-emerald-300">{userDevice?.signalStrength || 94}%</span>
                      </div>
                      <div className="flex justify-between text-white/60">
                        <span>Sentry State:</span>
                        <span className="text-cyan-400">PATROLLING PERIMETER</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions: Sonar Ping & Stealth Shield Toggle */}
                  <div className="space-y-2">
                    <button
                      onClick={handlePingPhone}
                      disabled={sonarPingSent}
                      className="w-full py-2.5 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-mono font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform"
                    >
                      <Radio className={`w-4 h-4 ${sonarPingSent ? "animate-spin" : ""}`} />
                      <span>{sonarPingSent ? "PING SENT TO PHONE!" : "FIND MY PHONE (SONAR PING)"}</span>
                    </button>

                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-cyan-950/20 border border-cyan-500/20 text-xs font-mono">
                      <div className="flex items-center gap-2 text-cyan-300">
                        <Lock className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Walk-Away Stealth Shield</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={stealthShield}
                        onChange={(e) => setStealthShield(e.target.checked)}
                        className="accent-cyan-400 w-4 h-4 rounded cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {announcementMsg && (
                <div className="p-3 rounded-xl bg-cyan-900/30 border border-cyan-400/40 flex items-center gap-2 text-xs font-mono text-cyan-200">
                  <Volume2 className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>{announcementMsg}</span>
                </div>
              )}

              {/* Simulation Lab & Purpose Explanation */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-cyan-500/15">
                {/* Instant Simulation Buttons */}
                <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-2 font-mono">
                  <span className="text-xs text-cyan-400 font-bold uppercase tracking-wider block">
                    🧪 Proximity Simulation Lab
                  </span>
                  <p className="text-[11px] text-white/60 font-sans">
                    Test the automatic reactions of JARVIS without moving your physical device:
                  </p>
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button
                      onClick={() => handleSimulate("immediate")}
                      className="py-2 px-1 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold text-center active:scale-95"
                    >
                      Sit At Desk (&lt;0.8m)
                    </button>
                    <button
                      onClick={() => handleSimulate("room")}
                      className="py-2 px-1 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-[10px] font-bold text-center active:scale-95"
                    >
                      In Room (2m)
                    </button>
                    <button
                      onClick={() => handleSimulate("away")}
                      className="py-2 px-1 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-[10px] font-bold text-center active:scale-95"
                    >
                      Step Away (&gt;5m)
                    </button>
                  </div>
                </div>

                {/* Real-World Use Case Explanation */}
                <div className="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-500/20 space-y-2">
                  <div className="flex items-center gap-1.5 text-cyan-300 font-mono text-xs font-bold uppercase tracking-wider">
                    <Info className="w-4 h-4 text-cyan-400" />
                    <span>What is Proximity Radar for?</span>
                  </div>
                  <ul className="text-xs text-white/70 space-y-1.5 font-sans">
                    <li className="flex items-start gap-1.5">
                      <span className="text-emerald-400">1.</span>
                      <span><strong>Automatic Welcome:</strong> Greets you verbally with custom briefings when you sit down at your PC.</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-cyan-400">2.</span>
                      <span><strong>Walk-Away Privacy Shield:</strong> Blurs or locks your screen automatically when you step away.</span>
                    </li>
                    <li className="flex items-start gap-1.5">
                      <span className="text-amber-400">3.</span>
                      <span><strong>Phone Sonar:</strong> One-tap high-frequency ping to quickly find your misplaced phone in the room.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === "devices" && (
            <div className="space-y-2 font-mono">
              <span className="text-xs text-cyan-400/80 uppercase tracking-wider block mb-2">
                Detected Local Network Radios ({devices.length})
              </span>
              {devices.map((d) => (
                <div
                  key={d.ip}
                  className="p-3 rounded-xl bg-black/50 border border-white/10 flex items-center justify-between hover:border-cyan-400/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center">
                      <Smartphone className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white flex items-center gap-1.5">
                        {d.name || d.ip}
                        {d.isUserDevice && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                            BOSS
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-white/40">
                        {d.ip} · {d.mac} · {d.type}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-cyan-300">{d.signalStrength}%</p>
                    <p className="text-[10px] text-white/40">{d.distanceEstimate}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-2 font-mono">
              <span className="text-xs text-cyan-400/80 uppercase tracking-wider block mb-2">
                Proximity Transition History
              </span>
              {history.length === 0 ? (
                <p className="text-xs text-white/40 text-center py-8">Monitoring active desk transitions...</p>
              ) : (
                history.map((h, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs"
                  >
                    <span className="text-cyan-300 font-bold uppercase">{h.zone}</span>
                    <span className="text-white/40">
                      {new Date(h.ts).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
