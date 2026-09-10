"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Play,
  Loader2,
  CheckCircle,
  AlertCircle,
  Plane,
  ShoppingCart,
  FileText,
  Newspaper,
  ExternalLink,
  X,
  Bot,
  Eye,
  EyeOff,
  Trash2,
  Bell,
  History,
  Terminal,
  Sparkles,
  Crosshair,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────

interface WorkflowResult {
  action: string;
  success: boolean;
  data?: string;
  error?: string;
  text?: string | null;
  texts?: string[];
  selector?: string;
  url?: string;
}

interface AgentTrace {
  turn: number;
  decision: string;
  detail?: string;
}

interface WatchJob {
  id: string;
  name: string;
  workflow: string;
  condition: string;
  threshold: number | null;
  expectedText: string | null;
  intervalMin: number;
  active: boolean;
  lastValue: string | null;
  lastCheckedAt: string | null;
  checkCount: number;
}

interface BrowserRunRow {
  id: string;
  workflow: string;
  goal: string | null;
  success: boolean;
  summary: string | null;
  durationMs: number;
  screenshotPath: string | null;
  createdAt: string;
}

const WORKFLOWS = [
  { id: "search_flight", name: "Search Flight", icon: Plane, description: "Google Flights, any origin → destination", vars: ["origin", "destination"] },
  { id: "check_price", name: "Check Price", icon: ShoppingCart, description: "Top 3 Amazon results with prices", vars: ["product"] },
  { id: "form_fill", name: "Fill Form", icon: FileText, description: "Any contact form, auto-detected fields", vars: ["url", "name", "email", "message"] },
  { id: "news_headlines", name: "News Headlines", icon: Newspaper, description: "Top BBC world headlines", vars: [] },
];

type Tab = "workflows" | "agent" | "watchers" | "history";

// ─── Small HUD atoms ────────────────────────────────────────────────

function HudCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative rounded-lg border border-cyan-500/15 bg-slate-950/60 backdrop-blur-sm ${className}`}>
      {/* corner brackets */}
      <span className="absolute -top-px -left-px w-3 h-3 border-t border-l border-cyan-400/50 rounded-tl-lg" />
      <span className="absolute -top-px -right-px w-3 h-3 border-t border-r border-cyan-400/50 rounded-tr-lg" />
      <span className="absolute -bottom-px -left-px w-3 h-3 border-b border-l border-cyan-400/50 rounded-bl-lg" />
      <span className="absolute -bottom-px -right-px w-3 h-3 border-b border-r border-cyan-400/50 rounded-br-lg" />
      {children}
    </div>
  );
}

function StatusDot({ ok, pulse = false }: { ok: boolean; pulse?: boolean }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-400" : "bg-red-400"} ${pulse ? "animate-pulse" : ""}`} />
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="text-[10px] text-cyan-500/40 font-mono">— no trend yet</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / range) * 24}`)
    .join(" ");
  const down = values[values.length - 1] < values[0];
  return (
    <svg viewBox="0 0 100 30" className="w-full h-8" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={down ? "#34d399" : "#22d3ee"} strokeWidth="1.5" />
    </svg>
  );
}

// ─── Main panel ─────────────────────────────────────────────────────

export default function BrowserAutomationPanel() {
  const [tab, setTab] = useState<Tab>("workflows");

  return (
    <div className="h-full flex flex-col rounded-2xl border border-cyan-500/20 overflow-hidden bg-slate-950 relative">
      {/* ambient glows + scanline */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(34,211,238,0.08),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(16,185,129,0.05),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.15] bg-[repeating-linear-gradient(0deg,transparent_0px,transparent_2px,rgba(34,211,238,0.4)_3px)] bg-[length:100%_3px]" />

      {/* header */}
      <div className="relative p-4 border-b border-cyan-500/15 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center shadow-[0_0_12px_rgba(34,211,238,0.3)]">
            <Globe className="w-5 h-5 text-cyan-300" />
          </div>
          <div>
            <h3 className="text-base font-bold text-cyan-100 tracking-wide">BROWSER OPS</h3>
            <p className="text-[10px] text-cyan-500/70 font-mono uppercase tracking-widest">Stealth Playwright · AI Agent · Watchers</p>
          </div>
        </div>
        <StatusDot ok pulse />
      </div>

      {/* tabs */}
      <div className="relative flex border-b border-cyan-500/15 font-mono text-[11px] uppercase tracking-widest">
        {(
          [
            ["workflows", "Workflows", Crosshair],
            ["agent", "AI Agent", Bot],
            ["watchers", "Watchers", Bell],
            ["history", "History", History],
          ] as [Tab, string, typeof Globe][]
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 py-2.5 flex items-center justify-center gap-1.5 transition-all relative ${
              tab === id ? "text-cyan-300" : "text-cyan-600/50 hover:text-cyan-400/70"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {tab === id && (
              <motion.span layoutId="tabglow" className="absolute bottom-0 left-1/4 right-1/4 h-px bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            )}
          </button>
        ))}
      </div>

      <div className="relative flex-1 overflow-auto p-4 space-y-4">
        {tab === "workflows" && <WorkflowsTab />}
        {tab === "agent" && <AgentTab />}
        {tab === "watchers" && <WatchersTab />}
        {tab === "history" && <HistoryTab />}
      </div>
    </div>
  );
}

// ─── Tab 1: Workflows ───────────────────────────────────────────────

function WorkflowsTab() {
  const [selected, setSelected] = useState(WORKFLOWS[0].id);
  const [variables, setVariables] = useState<Record<string, string>>({ origin: "Delhi", destination: "Mumbai" });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<WorkflowResult[] | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [headed, setHeaded] = useState(false);

  const current = WORKFLOWS.find((w) => w.id === selected);

  const run = async () => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setResults(null);
    setScreenshot(null);
    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflow: selected, variables, headed }),
      });
      const data = await res.json();
      if (data.success) {
        setResults(data.results);
        setScreenshot(data.screenshot || null);
        setSummary(data.summary || null);
        setFinalUrl(data.finalUrl || null);
        setCaptcha(!!data.captcha);
      } else {
        setError(data.error || `Request failed (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  // Presets in localStorage per workflow.
  const savePreset = () => {
    localStorage.setItem(`jv-preset-${selected}`, JSON.stringify(variables));
    setPresetSaved(true);
    setTimeout(() => setPresetSaved(false), 1500);
  };
  const loadPreset = () => {
    const raw = localStorage.getItem(`jv-preset-${selected}`);
    if (raw) setVariables(JSON.parse(raw));
  };
  const [presetSaved, setPresetSaved] = useState(false);

  return (
    <div className="space-y-4">
      {/* workflow picker */}
      <div className="grid grid-cols-2 gap-2">
        {WORKFLOWS.map((w) => (
          <button
            key={w.id}
            onClick={() => {
              setSelected(w.id);
              setResults(null);
              setScreenshot(null);
              setError(null);
              setVariables(w.id === "search_flight" ? { origin: "Delhi", destination: "Mumbai" } : {});
            }}
            className={`p-3 rounded-lg text-left border transition-all ${
              selected === w.id
                ? "bg-cyan-500/10 border-cyan-400/50 shadow-[0_0_12px_rgba(34,211,238,0.15)]"
                : "bg-slate-900/40 border-white/5 hover:border-cyan-500/30"
            }`}
          >
            <w.icon className={`w-4 h-4 mb-1.5 ${selected === w.id ? "text-cyan-300" : "text-cyan-600"}`} />
            <p className="text-xs font-semibold text-white/90">{w.name}</p>
            <p className="text-[10px] text-cyan-500/60 leading-tight mt-0.5">{w.description}</p>
          </button>
        ))}
      </div>

      {/* variables */}
      {current && current.vars.length > 0 && (
        <HudCard className="p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-500/70">Parameters</span>
            <div className="flex gap-2">
              <button onClick={loadPreset} className="text-[10px] font-mono text-cyan-600 hover:text-cyan-300">load preset</button>
              <button onClick={savePreset} className="text-[10px] font-mono text-cyan-600 hover:text-cyan-300">
                {presetSaved ? "✓ saved" : "save preset"}
              </button>
            </div>
          </div>
          {current.vars.map((v) => (
            <div key={v}>
              <label className="text-[10px] text-cyan-500/60 font-mono mb-0.5 block uppercase">{v}</label>
              <input
                type="text"
                value={variables[v] || ""}
                onChange={(e) => setVariables({ ...variables, [v]: e.target.value })}
                placeholder={`enter ${v}…`}
                className="w-full px-3 py-1.5 bg-slate-900/60 border border-cyan-500/20 rounded text-sm text-cyan-50 placeholder-cyan-700/50 focus:border-cyan-400/60 focus:outline-none font-mono"
              />
            </div>
          ))}
        </HudCard>
      )}

      {/* run controls */}
      <div className="flex items-center gap-3">
        <button
          onClick={run}
          disabled={loading}
          className="flex-1 py-2.5 rounded-lg bg-gradient-to-r from-cyan-600 to-teal-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:from-cyan-500 hover:to-teal-400 disabled:opacity-40 transition-all shadow-[0_0_16px_rgba(34,211,238,0.25)]"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {loading ? "Executing…" : "Execute"}
        </button>
        <button
          onClick={() => setHeaded(!headed)}
          title={headed ? "Headed mode ON — the browser will be visible" : "Headless mode"}
          className={`p-2.5 rounded-lg border transition-all ${headed ? "border-amber-400/50 bg-amber-500/10 text-amber-300" : "border-cyan-500/20 text-cyan-600 hover:text-cyan-300"}`}
        >
          {headed ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
        </button>
      </div>

      {/* captcha warning */}
      {captcha && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-300" />
          <p className="text-xs text-amber-200">Bot wall detected — the site is asking for a captcha. Try headed mode or a session.</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs text-red-300 font-mono break-words">{error}</p>
        </div>
      )}

      {/* screenshot */}
      <AnimatePresence>
        {screenshot && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <HudCard className="overflow-hidden">
              <div className="px-3 py-2 border-b border-cyan-500/10 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-500/70">Capture</span>
                <div className="flex items-center gap-3">
                  {finalUrl && (
                    <a href={finalUrl} target="_blank" rel="noreferrer" className="text-[10px] font-mono text-cyan-600 hover:text-cyan-300 flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> source
                    </a>
                  )}
                  <button onClick={() => setFullscreen(true)} className="text-[10px] font-mono text-cyan-600 hover:text-cyan-300">expand</button>
                </div>
              </div>
              <img src={screenshot} alt="result" className="w-full cursor-zoom-in" onClick={() => setFullscreen(true)} />
            </HudCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* action log */}
      {results && (
        <HudCard className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-500/70 flex items-center gap-1.5">
              <Terminal className="w-3 h-3" /> Action Log
            </span>
            {summary && <span className="text-[10px] font-mono text-cyan-400">{summary}</span>}
          </div>
          <div className="space-y-1 font-mono text-[11px]">
            {results.map((r, i) => (
              <div key={i} className="flex items-start gap-2 py-1 px-2 rounded bg-white/[0.02]">
                {r.success ? <CheckCircle className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" /> : <AlertCircle className="w-3 h-3 text-red-400 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <span className="text-cyan-100/90">{r.action}</span>
                  {r.selector && <span className="text-cyan-600/70"> · {r.selector.slice(0, 50)}</span>}
                  {!r.success && r.error && <p className="text-red-300/70">{r.error}</p>}
                  {r.texts && r.texts.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {r.texts.slice(0, 5).map((t, j) => (
                        <p key={j} className="text-emerald-200/80">→ {t.slice(0, 90)}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </HudCard>
      )}

      {/* fullscreen viewer */}
      <AnimatePresence>
        {fullscreen && screenshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
            onClick={() => setFullscreen(false)}
          >
            <img src={screenshot} alt="full" className="max-w-full max-h-full rounded-lg border border-cyan-500/30" />
            <button className="absolute top-6 right-6 p-2 rounded-lg bg-white/5 text-white/70 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Tab 2: AI Agent ────────────────────────────────────────────────

function AgentTab() {
  const [goal, setGoal] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [trace, setTrace] = useState<AgentTrace[] | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (!goal.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setTrace(null);
    setScreenshot(null);
    try {
      const res = await fetch("/api/browser/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, startUrl: startUrl || undefined }),
      });
      const data = await res.json();
      if (res.ok) {
        setAnswer(data.answer);
        setTrace(data.trace);
        setScreenshot(data.screenshot || null);
      } else {
        setError(data.details || data.error || "Agent failed");
        if (data.trace) setTrace(data.trace);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <HudCard className="p-3 space-y-2.5">
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-cyan-500/70">
          <Sparkles className="w-3 h-3 text-cyan-400" /> Goal-driven automation — JARVIS reads the page and decides each step
        </div>
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="e.g. search wireless keyboard on amazon and tell me the cheapest price…"
          rows={2}
          className="w-full px-3 py-2 bg-slate-900/60 border border-cyan-500/20 rounded text-sm text-cyan-50 placeholder-cyan-700/50 focus:border-cyan-400/60 focus:outline-none resize-none"
        />
        <input
          type="text"
          value={startUrl}
          onChange={(e) => setStartUrl(e.target.value)}
          placeholder="start URL (optional — defaults to google.com)"
          className="w-full px-3 py-1.5 bg-slate-900/60 border border-cyan-500/20 rounded text-xs text-cyan-50 placeholder-cyan-700/50 focus:border-cyan-400/60 focus:outline-none font-mono"
        />
        <button
          onClick={run}
          disabled={loading || !goal.trim()}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-500 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:from-violet-500 hover:to-cyan-400 disabled:opacity-40 transition-all shadow-[0_0_16px_rgba(139,92,246,0.25)]"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
          {loading ? "Agent working…" : "Deploy Agent"}
        </button>
      </HudCard>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-xs text-red-300 font-mono break-words">{error}</p>
        </div>
      )}

      {answer && (
        <HudCard className="p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-cyan-500/70 mb-1.5">Agent Answer</div>
          <p className="text-sm text-cyan-50 whitespace-pre-wrap">{answer}</p>
        </HudCard>
      )}

      {screenshot && <img src={screenshot} alt="agent final" className="rounded-lg border border-cyan-500/20 w-full" />}

      {trace && (
        <HudCard className="p-3">
          <div className="text-[10px] font-mono uppercase tracking-widest text-cyan-500/70 mb-2 flex items-center gap-1.5">
            <Terminal className="w-3 h-3" /> Decision Trace
          </div>
          <div className="space-y-1 font-mono text-[11px]">
            {trace.map((t, i) => (
              <div key={i} className="flex gap-2 py-0.5">
                <span className="text-cyan-700">t{t.turn}</span>
                <span className={t.decision === "done" ? "text-emerald-300" : t.decision === "fail" ? "text-red-300" : "text-cyan-200"}>{t.decision}</span>
                {t.detail && <span className="text-cyan-600/60 truncate">{t.detail}</span>}
              </div>
            ))}
          </div>
        </HudCard>
      )}
    </div>
  );
}

// ─── Tab 3: Watchers ────────────────────────────────────────────────

function WatchersTab() {
  const [watches, setWatches] = useState<WatchJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", workflow: "check_price", product: "", threshold: "", condition: "lt", intervalMin: "60" });
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/browser/watch");
      const data = await res.json();
      setWatches(data.watches ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = async () => {
    if (!form.name.trim() || !form.product.trim()) return;
    setCreating(true);
    setMsg(null);
    try {
      const res = await fetch("/api/browser/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          workflow: "check_price",
          variables: { product: form.product },
          extract: "price",
          condition: form.condition,
          threshold: form.threshold ? parseFloat(form.threshold) : null,
          intervalMin: parseInt(form.intervalMin, 10) || 60,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMsg("Watcher armed.");
        setForm({ ...form, name: "", product: "", threshold: "" });
        load();
      } else {
        setMsg(data.error || "Failed");
      }
    } finally {
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/browser/watch?id=${id}`, { method: "DELETE" });
    load();
  };

  const checkNow = async () => {
    setMsg("Checking all due watchers…");
    const res = await fetch("/api/browser/watch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check" }),
    });
    const data = await res.json();
    setMsg(`Checked ${data.checked} watcher(s).`);
    load();
  };

  return (
    <div className="space-y-4">
      <HudCard className="p-3 space-y-2.5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-cyan-500/70 flex items-center gap-1.5">
          <Bell className="w-3 h-3" /> New watcher — alerts go to Telegram
        </div>
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="watcher name — e.g. mouse under 900"
          className="w-full px-3 py-1.5 bg-slate-900/60 border border-cyan-500/20 rounded text-sm text-cyan-50 placeholder-cyan-700/50 focus:border-cyan-400/60 focus:outline-none" />
        <input type="text" value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="product to watch on Amazon"
          className="w-full px-3 py-1.5 bg-slate-900/60 border border-cyan-500/20 rounded text-sm text-cyan-50 placeholder-cyan-700/50 focus:border-cyan-400/60 focus:outline-none" />
        <div className="flex gap-2">
          <select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}
            className="px-2 py-1.5 bg-slate-900/60 border border-cyan-500/20 rounded text-xs text-cyan-50 focus:outline-none font-mono">
            <option value="lt">price &lt;</option>
            <option value="gt">price &gt;</option>
          </select>
          <input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} placeholder="threshold"
            className="flex-1 px-3 py-1.5 bg-slate-900/60 border border-cyan-500/20 rounded text-sm text-cyan-50 placeholder-cyan-700/50 focus:border-cyan-400/60 focus:outline-none font-mono" />
          <select value={form.intervalMin} onChange={(e) => setForm({ ...form, intervalMin: e.target.value })}
            className="px-2 py-1.5 bg-slate-900/60 border border-cyan-500/20 rounded text-xs text-cyan-50 focus:outline-none font-mono">
            <option value="30">30m</option>
            <option value="60">1h</option>
            <option value="180">3h</option>
            <option value="720">12h</option>
          </select>
        </div>
        <button onClick={create} disabled={creating || !form.name.trim() || !form.product.trim()}
          className="w-full py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-cyan-500 text-white text-sm font-semibold hover:from-emerald-500 hover:to-cyan-400 disabled:opacity-40 transition-all">
          {creating ? "Arming…" : "Arm Watcher"}
        </button>
      </HudCard>

      {msg && <p className="text-[11px] font-mono text-cyan-400">{msg}</p>}

      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-500/70">Active watchers</span>
        <button onClick={checkNow} className="text-[10px] font-mono text-cyan-600 hover:text-cyan-300">check now</button>
      </div>

      {loading ? (
        <p className="text-xs text-cyan-600 font-mono">loading…</p>
      ) : watches.length === 0 ? (
        <p className="text-xs text-cyan-700/70 font-mono">no watchers yet — arm one above</p>
      ) : (
        <div className="space-y-2">
          {watches.map((w) => (
            <HudCard key={w.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <StatusDot ok={w.active} pulse={w.active} />
                    <p className="text-sm text-white/90 font-medium truncate">{w.name}</p>
                  </div>
                  <p className="text-[10px] font-mono text-cyan-500/70 mt-0.5">
                    {w.condition === "lt" ? "<" : w.condition === "gt" ? ">" : ""} {w.threshold ?? w.expectedText} · every {w.intervalMin}m · {w.checkCount} checks
                  </p>
                  {w.lastValue && <p className="text-[11px] text-cyan-200/80 mt-1 truncate">last: {w.lastValue}</p>}
                </div>
                <button onClick={() => remove(w.id)} className="p-1.5 text-red-400/50 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </HudCard>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab 4: History ─────────────────────────────────────────────────

function HistoryTab() {
  const [runs, setRuns] = useState<BrowserRunRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/browser?history=1")
      .then((r) => r.json())
      .then((d) => setRuns(d.runs ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-xs text-cyan-600 font-mono">loading…</p>;
  if (runs.length === 0) return <p className="text-xs text-cyan-700/70 font-mono">no runs logged yet</p>;

  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <HudCard key={r.id} className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {r.success ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                <span className="text-sm text-white/90 font-medium">{r.workflow}</span>
                <span className="text-[10px] font-mono text-cyan-600">{(r.durationMs / 1000).toFixed(1)}s</span>
              </div>
              {r.goal && <p className="text-[11px] text-cyan-200/70 mt-0.5 truncate">goal: {r.goal}</p>}
              {r.summary && <p className="text-[10px] font-mono text-cyan-600/70 mt-0.5">{r.summary}</p>}
              <p className="text-[10px] font-mono text-cyan-800 mt-0.5">{new Date(r.createdAt).toLocaleString()}</p>
            </div>
            {r.screenshotPath && (
              <a href={r.screenshotPath} target="_blank" rel="noreferrer" className="p-1.5 text-cyan-500 hover:text-cyan-300 shrink-0">
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </HudCard>
      ))}
    </div>
  );
}
