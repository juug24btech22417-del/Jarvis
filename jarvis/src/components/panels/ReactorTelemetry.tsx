"use client";

/**
 * ReactorTelemetry — holographic data clusters floating beside the MARK II
 * reactor curve (modeled on the Rainmeter reference: telemetry hugging the
 * ring's right edge, conversation floating on its left) plus the live
 * conversation "in the air".
 *
 * Replaces the Memory Bank panel:
 *   - JARVIS ↔ user messages type themselves into empty space on the LEFT,
 *     hugging the reactor's curve (floaty drift, typewriter reveal)
 *   - Right cluster: weather, CPU/RAM, uptime — positioned against the ring
 *   - Bottom-left: session block (time, date, active, boss)
 *
 * Pure CSS fade/drift — no panel chrome, no borders, just text in the dark.
 */

import { useState, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useJarvisStore } from "@/store/jarvis.store";

/* ─── Shared tiny hooks (poll same endpoints as DiagnosticsPanel) ─────── */

interface PCStats {
  cpuUsage: number | null;
  memoryUsed: number | null;
  memoryTotal: number | null;
  memoryUsage: number | null;
  temperature: number | null;
  uptime: number | null;
}

function usePCStats() {
  const [stats, setStats] = useState<PCStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/system/pcstats");
        if (!res.ok || cancelled) return;
        setStats(await res.json());
      } catch {}
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return stats;
}

function useWeather() {
  const [desc, setDesc] = useState<string | null>(null);
  const [temp, setTemp] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const res = await fetch("/api/weather?city=Bangalore");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && data?.description) {
          setDesc(data.description);
          setTemp(data.temperature ?? null);
        }
      } catch {}
    };
    fetchWeather();
    const t = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);
  return { desc, temp };
}

/* ─── Typewriter text (fast — feels like live transcription) ──────────── */

function Typewriter({ text, speed = 8, className = "" }: { text: string; speed?: number; className?: string }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
    if (!text) return;
    const t = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(t);
          return n;
        }
        return n + 1;
      });
    }, speed);
    return () => clearInterval(t);
  }, [text, speed]);

  return (
    <span className={className}>
      {text.slice(0, shown)}
      {shown < text.length && (
        <span className="inline-block w-[7px] animate-pulse text-cyan-300">▍</span>
      )}
    </span>
  );
}

/* ─── Conversation-in-the-air ─────────────────────────────────────────── */

function FloatingConversation() {
  const messages = useJarvisStore((s) => s.messages);
  const visible = useMemo(() => messages.slice(-3), [messages]);

  return (
    <div className="w-full pointer-events-none">
      <AnimatePresence mode="popLayout">
        {visible.map((m) => (
          <motion.div
            key={m.id}
            layout
            initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="mb-5"
          >
            <div
              className={`font-orbitron text-[9px] tracking-[0.25em] mb-1 ${
                m.role === "assistant" ? "text-cyan-300/80" : "text-emerald-300/70"
              }`}
            >
              {m.role === "assistant" ? "J.A.R.V.I.S" : "YOU"}
            </div>
            <div
              className={`font-rajdhani text-[15px] leading-relaxed ${
                m.role === "assistant"
                  ? "text-cyan-50/95 drop-shadow-[0_0_12px_rgba(0,212,255,0.35)]"
                  : "text-emerald-50/85 drop-shadow-[0_0_10px_rgba(0,255,157,0.2)]"
              }`}
            >
              {m.role === "assistant" ? (
                <Typewriter text={m.content} />
              ) : (
                <span className="opacity-90">{m.content}</span>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ─── Floating data cluster ───────────────────────────────────────────── */

function TelemetryRow({ label, value, accent = "text-cyan-300" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="font-orbitron text-[9px] tracking-[0.2em] text-cyan-200/50">{label}</span>
      <span className={`font-rajdhani text-[15px] font-semibold tabular-nums ${accent} drop-shadow-[0_0_8px_rgba(0,212,255,0.3)]`}>
        {value}
      </span>
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────────── */

function fmtUptime(seconds: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function sessionUptime(bootedAt: number) {
  const s = Math.floor((Date.now() - bootedAt) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/* ─── Curve-hugging positioning ───────────────────────────────────────── */
/* The reactor is a centered 66vmin square (radius ≈ 33vmin). Clusters are
   placed just outside the curve: left block's right edge and right block's
   left edge both sit at 50% ± 36vmin. On smaller screens they fall back to
   stacked layouts below the reactor. */

const CURVE_GAP = "36vmin";

export default function ReactorTelemetry() {
  const stats = usePCStats();
  const { desc, temp } = useWeather();
  const tasks = useJarvisStore((s) => s.tasks);
  const memories = useJarvisStore((s) => s.memories);
  const userName = useJarvisStore((s) => s.userName);
  const bootComplete = useJarvisStore((s) => s.bootComplete);

  const [now, setNow] = useState<Date | null>(null);
  const [bootedAt, setBootedAt] = useState<number | null>(null);
  useEffect(() => {
    setNow(new Date());
    setBootedAt(Date.now());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const openTasks = tasks.filter((t) => !t.completed).length;

  const fmt = (n: number | null | undefined, suffix = "%", digits = 0) =>
    n === null || n === undefined ? "—" : `${n.toFixed(digits)}${suffix}`;

  return (
    <div
      className={`fixed inset-0 z-20 pointer-events-none transition-opacity duration-1000 ${
        bootComplete ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* ── Conversation floating LEFT of the curve (like the old Memory Bank spot) ── */}
      <div
        className="absolute top-1/2 -translate-y-1/2 hidden lg:flex w-[26rem] flex-col"
        style={{ right: `calc(50% + ${CURVE_GAP})` }}
      >
        <motion.div
          animate={{ y: [0, -7, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          <FloatingConversation />
        </motion.div>
      </div>

      {/* Mobile fallback: convo floats below reactor, centered */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[13rem] w-full px-6 flex justify-center lg:hidden">
        <FloatingConversation />
      </div>

      {/* ── Right telemetry cluster hugging the curve (like the reference) ── */}
      <div
        className="absolute top-1/2 -translate-y-1/2 hidden lg:block w-64 space-y-5"
        style={{ left: `calc(50% + ${CURVE_GAP})` }}
      >
        <motion.div
          animate={{ y: [0, 6, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          className="space-y-5"
        >
          <div className="space-y-1.5">
            <div className="font-orbitron text-[9px] tracking-[0.3em] text-cyan-400/70 mb-2">
              ATMOSPHERE
            </div>
            <TelemetryRow label="COND" value={desc ?? "—"} accent="text-cyan-100" />
            <TelemetryRow label="TEMP" value={fmt(temp, "°C")} />
          </div>

          <div className="space-y-1.5">
            <div className="font-orbitron text-[9px] tracking-[0.3em] text-cyan-400/70 mb-2">
              SYSTEMS
            </div>
            <TelemetryRow
              label="CPU"
              value={fmt(stats?.cpuUsage)}
              accent={(stats?.cpuUsage ?? 0) > 80 ? "text-rose-400" : "text-cyan-300"}
            />
            <TelemetryRow
              label="RAM"
              value={fmt(stats?.memoryUsage)}
              accent={(stats?.memoryUsage ?? 0) > 85 ? "text-rose-400" : "text-cyan-300"}
            />
            <TelemetryRow label="TEMP" value={fmt(stats?.temperature, "°C")} />
            <TelemetryRow label="UPTIME" value={fmtUptime(stats?.uptime ?? null)} accent="text-cyan-100" />
          </div>

          <div className="space-y-1.5">
            <div className="font-orbitron text-[9px] tracking-[0.3em] text-cyan-400/70 mb-2">
              DIRECTIVES
            </div>
            <TelemetryRow label="TASKS" value={String(openTasks)} accent="text-amber-300" />
            <TelemetryRow label="MEMORIES" value={String(memories.length)} accent="text-cyan-100" />
          </div>
        </motion.div>
      </div>

      {/* ── Session block — quiet corner, bottom-left ──────────────────── */}
      <div className="absolute left-6 bottom-16 hidden lg:block w-56 space-y-1.5">
        <div className="font-orbitron text-[9px] tracking-[0.3em] text-cyan-400/70 mb-2">
          SESSION
        </div>
        <TelemetryRow
          label="TIME"
          value={now ? now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—"}
        />
        <TelemetryRow
          label="DATE"
          value={now ? now.toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }).toUpperCase() : "—"}
          accent="text-cyan-100"
        />
        <TelemetryRow label="ACTIVE" value={bootedAt ? sessionUptime(bootedAt) : "—"} />
        <TelemetryRow label="BOSS" value={userName || "SIR"} accent="text-emerald-300" />
      </div>
    </div>
  );
}
