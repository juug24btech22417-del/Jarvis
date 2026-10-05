"use client";

import React, { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bot,
  Play,
  Square,
  CheckCircle2,
  Terminal,
  Sparkles,
  MapPin,
  Globe,
  GitBranch,
  MessageSquare,
  MousePointerClick,
  Loader2,
  AlertTriangle,
  Lightbulb,
  Navigation,
} from "lucide-react";

interface TrailItem {
  id: number;
  kind: "action" | "observation" | "thought" | "status" | "error";
  tool?: string;
  text: string;
  ok?: boolean;
}

interface FinalState {
  summary: string;
  ok: boolean;
}

interface Coords {
  lat: number;
  lng: number;
}

/** Ask the browser for the device's live location (fast, cached for 60s). */
function requestLocation(): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
    );
  });
}

const glassCard =
  "rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]";

const toolIcon: Record<string, React.ReactNode> = {
  "maps.search": <MapPin className="h-4 w-4 text-cyan-300" />,
  "maps.directions": <MapPin className="h-4 w-4 text-cyan-300" />,
  "web.search": <Globe className="h-4 w-4 text-sky-300" />,
  github: <GitBranch className="h-4 w-4 text-violet-300" />,
  "whatsapp.send": <MessageSquare className="h-4 w-4 text-emerald-300" />,
  "browser.act": <MousePointerClick className="h-4 w-4 text-amber-300" />,
};

const PRESETS = [
  "Find the nearest EV charging station to me, get driving directions, and open its details page in a real browser",
  "Plan my morning: best-rated cafe near me, walking directions, and a WhatsApp draft inviting my friend there",
  "Compare the price of the RTX 5070 on 2 Indian stores and tell me which is cheaper and by how much",
  "Look up the latest commits on github.com/vercel/next.js and tell me in one line if it is shipping faster than last month",
  "On swiggy.com find a highly-rated biryani place within 4 km, add its top dish to the cart, and stop before checkout",
  "Find tonight's cheapest flight from my city to Delhi, open the booking page, and stop at the passenger form",
  "Order a margherita pizza and a Coke to my location on Swiggy, keep it under ₹500, and stop before payment",
  "Book me a plumber near me for tomorrow morning and stop at the payment step",
  "Check the latest commits and open issues on github.com/facebook/react",
];

export default function AutonomousTaskAgentPanel() {
  const [goal, setGoal] = useState("");
  const [running, setRunning] = useState(false);
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const [final, setFinal] = useState<FinalState | null>(null);
  const [loc, setLoc] = useState<Coords | null>(null);
  const locRef = useRef<Coords | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const trailEndRef = useRef<HTMLDivElement | null>(null);

  const push = (item: Omit<TrailItem, "id">) => {
    idRef.current += 1;
    setTrail((t) => [...t, { ...item, id: idRef.current }]);
    requestAnimationFrame(() => trailEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const run = async (customGoal?: string) => {
    const target = (customGoal ?? goal).trim();
    if (!target || running) return;

    setGoal(target);
    setTrail([]);
    setFinal(null);
    setRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    // Grab live location up-front so "near me" / "my location" are real.
    if (!locRef.current) {
      push({ kind: "status", text: "Checking your live location…" });
      const c = await requestLocation();
      if (c) {
        locRef.current = c;
        setLoc(c);
      }
    }

    try {
      const res = await fetch("/api/task-agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: target, location: locRef.current || undefined }),
        signal: controller.signal,
      });

      if (!res.body) throw new Error("No stream from agent");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;
          let evt: any;
          try {
            evt = JSON.parse(payload);
          } catch {
            continue;
          }
          if (evt.type === "final") {
            setFinal({ summary: evt.summary, ok: !!evt.ok });
          } else if (evt.type === "observation") {
            push({ kind: "observation", tool: evt.tool, text: evt.output, ok: evt.ok });
          } else if (evt.type === "action") {
            push({ kind: "action", tool: evt.tool, text: evt.detail });
          } else if (evt.type === "thought") {
            push({ kind: "thought", text: evt.text });
          } else if (evt.type === "error") {
            push({ kind: "error", text: evt.message });
          } else if (evt.type === "status") {
            push({ kind: "status", text: evt.message });
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        push({ kind: "error", text: e?.message || "Execution failed" });
        setFinal({ summary: e?.message || "Execution failed", ok: false });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 text-white md:p-6">
      {/* Header */}
      <div className={`${glassCard} p-6`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400/30 to-blue-600/10 ring-1 ring-cyan-400/30">
              <Bot className="h-6 w-6 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Autonomous Task Agent</h1>
              <p className="text-sm text-white/45">Describe a goal in plain language — JARVIS picks real tools and acts.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                loc ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/[0.03] text-white/45"
              }`}
              title={loc ? `${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}` : "Location not shared yet"}
            >
              <Navigation className="h-3.5 w-3.5" />
              {loc ? "Live location on" : "Location off"}
            </span>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200">
              <span className={`h-1.5 w-1.5 rounded-full bg-cyan-300 ${running ? "animate-pulse" : ""}`} />
              {running ? "Working" : "Ready"}
            </div>
          </div>
        </div>
      </div>

      {/* Input */}
      <div className={`${glassCard} space-y-3 p-5`}>
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/45">
          <Sparkles className="h-3.5 w-3.5 text-cyan-300" /> Your goal
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. book me a haircut Saturday afternoon near Indiranagar under ₹500"
            className="flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
          />
          {running ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/15 px-5 py-3 text-sm font-medium text-rose-200 transition hover:bg-rose-500/25"
            >
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => run()}
              disabled={!goal.trim()}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-500/90 px-5 py-3 text-sm font-medium text-white shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)] transition hover:bg-cyan-400 disabled:opacity-40"
            >
              <Play className="h-4 w-4" /> Run
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-white/35">Try:</span>
          {PRESETS.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => run(p)}
              disabled={running}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] text-white/60 transition hover:border-cyan-400/40 hover:text-white disabled:opacity-40"
            >
              {p.length > 52 ? p.slice(0, 52) + "…" : p}
            </button>
          ))}
        </div>
      </div>

      {/* Live trail */}
      {(trail.length > 0 || running || final) && (
        <div className={`${glassCard} p-5`}>
          <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white/80">
            <Terminal className="h-4 w-4 text-cyan-300" /> Live activity
            {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />}
          </div>

          <div className="max-h-[26rem] space-y-2.5 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {trail.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={
                    item.kind === "thought"
                      ? "flex items-start gap-2.5 rounded-2xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5"
                      : item.kind === "action"
                      ? "flex items-start gap-2.5 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.06] px-3.5 py-2.5"
                      : item.kind === "observation"
                      ? `flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 ${item.ok ? "border-emerald-400/20 bg-emerald-500/[0.06]" : "border-amber-400/20 bg-amber-500/[0.06]"}`
                      : item.kind === "error"
                      ? "flex items-start gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-500/[0.08] px-3.5 py-2.5"
                      : "flex items-start gap-2.5 px-1 py-1"
                  }
                >
                  <span className="mt-0.5 shrink-0">
                    {item.kind === "action" ? (
                      toolIcon[item.tool || ""] || <MousePointerClick className="h-4 w-4 text-cyan-300" />
                    ) : item.kind === "observation" ? (
                      item.ok ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-amber-300" />
                      )
                    ) : item.kind === "thought" ? (
                      <Lightbulb className="h-4 w-4 text-yellow-200/80" />
                    ) : item.kind === "error" ? (
                      <AlertTriangle className="h-4 w-4 text-rose-300" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-cyan-300" />
                    )}
                  </span>
                  <div className="min-w-0">
                    {item.kind === "action" && (
                      <div className="text-[11px] font-medium uppercase tracking-wide text-cyan-200/80">{item.tool}</div>
                    )}
                    <div className={`whitespace-pre-wrap break-words text-sm ${item.kind === "thought" ? "italic text-white/55" : "text-white/80"}`}>
                      {item.text}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={trailEndRef} />
          </div>

          {final && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 rounded-2xl border px-4 py-4 ${
                final.ok ? "border-emerald-400/30 bg-emerald-500/10" : "border-amber-400/30 bg-amber-500/10"
              }`}
            >
              <div className={`mb-1 inline-flex items-center gap-2 text-xs font-medium ${final.ok ? "text-emerald-300" : "text-amber-300"}`}>
                {final.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                {final.ok ? "Reported complete" : "Needs your attention"}
              </div>
              <p className="text-sm text-white/85">{final.summary}</p>
            </motion.div>
          )}
        </div>
      )}

      {trail.length === 0 && !running && !final && (
        <div className={`${glassCard} flex flex-col items-center gap-3 p-10 text-center`}>
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/[0.03]">
            <Bot className="h-7 w-7 text-white/25" />
          </div>
          <p className="text-sm text-white/60">No task running yet</p>
          <p className="max-w-md text-xs text-white/35">
            JARVIS will call real tools — Maps, web search, GitHub, WhatsApp, and a visible browser — and show you every action and result. Nothing is simulated.
          </p>
        </div>
      )}
    </div>
  );
}
