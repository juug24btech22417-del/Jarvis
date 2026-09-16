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
 *   - Conversation is scrollable (hidden scrollbar) with a floating
 *     "↓ LATEST" pill that appears when you scroll up
 *   - Right cluster: weather, CPU/RAM, uptime — positioned against the ring
 *   - Bottom-left: session block (time, date, active, boss)
 *
 * No panel chrome, no borders — just text in the dark.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useJarvisStore } from "@/store/jarvis.store";

/* ─── Weather data (polls /api/weather for the active telemetry city) ─── */

interface WeatherData {
  city: string | null;
  description: string | null;
  temperature: number | null;
  feelsLike: number | null;
  humidity: number | null;
  precipMm: number | null;
  visibility: number | null;
  windSpeed: number | null;
  windDir: string | null;
  pressureMb: number | null;
  cloudCover: number | null;
  sunrise: string | null;
  sunset: string | null;
  moonPhase: string | null;
  moonIllumination: number | null;
}

function useWeather(city: string) {
  const [data, setData] = useState<WeatherData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const fetchWeather = async () => {
      try {
        const res = await fetch(`/api/weather?city=${encodeURIComponent(city)}`);
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled && json?.description) setData(json);
      } catch {}
    };
    fetchWeather();
    const t = setInterval(fetchWeather, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [city]);
  return data;
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

/* ─── Conversation-in-the-air (scrollable, invisible scrollbar) ───────── */

function FloatingConversation() {
  const messages = useJarvisStore((s) => s.messages);
  const visible = useMemo(() => messages.slice(-30), [messages]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 32);
  }, []);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Stick to bottom on new messages (unless the user scrolled up to read).
  useEffect(() => {
    if (atBottom) scrollToBottom(false);
    else scrollToBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Jump to bottom once mounted with history.
  useEffect(() => {
    scrollToBottom(false);
  }, [scrollToBottom]);

  return (
    <div className="relative w-full">
      <div
        ref={scrollRef}
        onScroll={measure}
        className="no-scrollbar overflow-y-auto overscroll-contain pointer-events-auto pr-2"
        style={{ maxHeight: "52vh", maskImage: "linear-gradient(to bottom, transparent, black 7%, black 90%, transparent)", WebkitMaskImage: "linear-gradient(to bottom, transparent, black 7%, black 90%, transparent)" }}
      >
        <div className="pointer-events-none">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((m) => (
              <motion.div
                key={m.id}
                layout="position"
                initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="mb-5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={`font-orbitron text-[9px] tracking-[0.25em] ${
                      m.role === "assistant" ? "text-cyan-300/80" : "text-emerald-300/70"
                    }`}
                  >
                    {m.role === "assistant" ? "J.A.R.V.I.S" : "YOU"}
                  </span>
                  {/* floating timestamp — quiet, offset to the right */}
                  <span className="font-rajdhani text-[9px] tracking-wider text-cyan-200/35 tabular-nums">
                    {new Date(m.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </div>
                <div
                  className={`font-rajdhani text-[13px] leading-relaxed ${
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
      </div>

      {/* Floating "latest" pill — only when scrolled away from the bottom */}
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            key="latest-pill"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 26 }}
            onClick={() => scrollToBottom(true)}
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 pointer-events-auto flex items-center gap-1.5 px-3 py-1 rounded-full font-orbitron text-[9px] tracking-[0.2em] text-cyan-200 bg-cyan-500/10 hover:bg-cyan-400/20 border border-cyan-400/40 backdrop-blur-md shadow-[0_0_16px_rgba(0,212,255,0.35)] transition-colors"
          >
            <span className="text-[10px] leading-none">↓</span> LATEST
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Click-to-edit city header ───────────────────────────────────────── */

function CityHeader({ city, onCommit }: { city: string; onCommit: (c: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(city);

  const commit = () => {
    const next = draft.trim();
    if (next && next.toLowerCase() !== city.toLowerCase()) onCommit(next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        onFocus={(e) => e.currentTarget.select()}
        className="font-orbitron text-[9px] tracking-[0.3em] uppercase text-cyan-200 bg-transparent border-b border-cyan-400/40 focus:border-cyan-300 outline-none w-28 pointer-events-auto"
        placeholder={city}
        aria-label="Telemetry city — type a city name and press Enter"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft("");
        setEditing(true);
      }}
      title="Click to change city"
      className="font-orbitron text-[9px] tracking-[0.3em] text-cyan-400/70 hover:text-cyan-300 hover:drop-shadow-[0_0_6px_rgba(0,212,255,0.5)] transition-all cursor-text pointer-events-auto"
    >
      {city.toUpperCase()}
    </button>
  );
}

/* ─── Curve-hugging positioning ───────────────────────────────────────── */
/* The reactor is a centered 66vmin square (radius ≈ 33vmin; outer ring
   ≈ 30vmin). Telemetry rows are placed individually along a circular ARC
   around the ring's right edge — middle rows bulge outward, edge rows tuck
   in — so the text block hugs the curve like the reference HUD. The convo
   stays a floaty column just outside the curve on the left. */

const ARC_RADIUS = 31; // vmin from screen center — flush against the outer ring boundary
const ARC_SPAN = 18; // degrees of arc covered (−SPAN … +SPAN, 0° = 3 o'clock) — fully packed

interface ArcNode {
  kind: "header" | "row";
  label: string;
  value?: string;
  accent?: string;
}

export default function ReactorTelemetry() {
  const weatherCity = useJarvisStore((s) => s.weatherCity);
  const weather = useWeather(weatherCity);
  const bootComplete = useJarvisStore((s) => s.bootComplete);

  const fmt = (n: number | null | undefined, suffix = "%", digits = 0) =>
    n === null || n === undefined ? "—" : `${n.toFixed(digits)}${suffix}`;

  // Weather telemetry laid out along the reactor's right arc, top to bottom.
  // Values stay small and quiet — the reactor is the hero.
  const arcNodes: ArcNode[] = [
    { kind: "header", label: (weather?.city ?? weatherCity).toUpperCase() },
    { kind: "row", label: "COND", value: weather?.description ?? "—" },
    { kind: "row", label: "TEMP", value: fmt(weather?.temperature, "°C") },
    { kind: "row", label: "FEELS", value: fmt(weather?.feelsLike, "°C") },
    { kind: "row", label: "HUMIDITY", value: fmt(weather?.humidity) },
    { kind: "row", label: "PRECIP", value: fmt(weather?.precipMm, " mm", 1) },
    { kind: "row", label: "WIND", value: weather ? `${fmt(weather.windSpeed, " kph")} ${weather.windDir ?? ""}`.trim() : "—" },
    { kind: "row", label: "VISIBILITY", value: fmt(weather?.visibility, " km", 1) },
    { kind: "row", label: "PRESSURE", value: fmt(weather?.pressureMb, " mb") },
    { kind: "row", label: "CLOUD", value: fmt(weather?.cloudCover) },
    { kind: "row", label: "SUNRISE", value: weather?.sunrise ?? "—" },
    { kind: "row", label: "SUNSET", value: weather?.sunset ?? "—" },
    { kind: "row", label: "MOON", value: weather?.moonPhase ?? "—" },
  ];

  return (
    <div
      className={`fixed inset-0 z-20 pointer-events-none transition-opacity duration-1000 ${
        bootComplete ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* ── Conversation pinned to the extreme left edge ── */}
      <div className="absolute left-6 top-1/2 -translate-y-1/2 hidden lg:flex w-[15rem] flex-col">
        <motion.div
          animate={{ y: [0, -6, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        >
          <FloatingConversation />
        </motion.div>
      </div>

      {/* Mobile fallback: convo floats below reactor, centered */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-[13rem] w-full px-6 flex justify-center lg:hidden">
        <FloatingConversation />
      </div>

      {/* ── Right telemetry arced ALONG the reactor curve (reference HUD style) ── */}
      {/* Each node sits at its own angle on a circle of ARC_RADIUS around the
          screen center, so the block's left edge traces the ring's curve. */}
      <div className="hidden lg:block absolute inset-0">
        {arcNodes.map((node, i) => {
          const theta =
            -ARC_SPAN + (i * (2 * ARC_SPAN)) / Math.max(1, arcNodes.length - 1);
          const rad = (theta * Math.PI) / 180;
          const x = Math.cos(rad) * ARC_RADIUS;
          const y = Math.sin(rad) * ARC_RADIUS;
          return (
            <div
              key={`${node.kind}-${node.label}-${i}`}
              className="absolute whitespace-nowrap"
              style={{
                left: `calc(50% + ${x.toFixed(2)}vmin)`,
                top: `calc(50% + ${y.toFixed(2)}vmin)`,
                transform: "translateY(-50%)",
                lineHeight: 1.25,
              }}
            >
              {node.kind === "header" ? (
                <CityHeader
                  city={weather?.city ?? weatherCity}
                  onCommit={(c) => useJarvisStore.getState().setWeatherCity(c)}
                />
              ) : (
                <div className="flex items-baseline gap-1.5">
                  <span className="font-orbitron text-[7px] tracking-[0.18em] text-cyan-200/50">
                    {node.label}
                  </span>
                  <span className="font-orbitron text-[7px] tracking-[0.18em] tabular-nums text-white/95 drop-shadow-[0_0_6px_rgba(255,255,255,0.25)]">
                    {node.value}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
