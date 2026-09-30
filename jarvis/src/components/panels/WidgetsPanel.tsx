"use client";

// Widgets — natural-language mini-panels that live on the HUD.
//
// Type (or say) "build me a panel that tracks my assignments and crypto" and
// JARVIS generates a JSON widget spec, validates it, and renders it with the
// fixed widget primitives. Same widgets are mirrored to the always-on HUD rail.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles, Loader2, LayoutGrid, Wand2, RefreshCw } from "lucide-react";
import WidgetCard from "@/components/widgets/WidgetCard";
import type { WidgetSpec } from "@/lib/widgets/spec";
import { useJarvisStore } from "@/store/jarvis.store";

const IDEAS = [
  "assignments and deadlines",
  "crypto prices",
  "my tasks",
  "recent notes",
  "water intake counter",
  "project ideas scratchpad",
];

interface WidgetsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WidgetsPanel({ isOpen, onClose }: WidgetsPanelProps) {
  const [widgets, setWidgets] = useState<WidgetSpec[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLInputElement | null>(null);

  const pendingPrompt = useJarvisStore((s) => s.pendingWidgetPrompt);
  const setPendingWidgetPrompt = useJarvisStore((s) => s.setPendingWidgetPrompt);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/widgets", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.widgets)) setWidgets(data.widgets);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  // Auto-refresh live (api/tasks/notes) widgets while the panel is open.
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/widgets?refresh=1", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data?.widgets)) setWidgets(data.widgets);
      } catch {
        // ignore
      }
    }, 120_000);
    return () => clearInterval(t);
  }, [isOpen]);

  const create = useCallback(
    async (text?: string) => {
      const p = (text ?? prompt).trim();
      if (!p || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/widgets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create", prompt: p }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (Array.isArray(data.widgets)) setWidgets(data.widgets);
        setPrompt("");
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [prompt, busy]
  );

  // A prompt handed over from the command bar builds on open.
  useEffect(() => {
    if (!isOpen || !pendingPrompt) return;
    const p = pendingPrompt;
    setPendingWidgetPrompt(null);
    setPrompt(p);
    void create(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingPrompt]);

  useEffect(() => {
    if (isOpen) setTimeout(() => promptRef.current?.focus(), 250);
  }, [isOpen]);

  // Esc always closes the drawer (the command bar stays reachable underneath).
  // Capture phase, so the global "Escape = emergency stop" handler in the
  // command bar can never swallow it first.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [isOpen, onClose]);

  /** A fully manual widget — no LLM, you fill it in. */
  const addBlank = async (kind: string, title: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/widgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "blank", kind, title }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (Array.isArray(data.widgets)) setWidgets(data.widgets);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const update = (w: WidgetSpec) => setWidgets((prev) => prev.map((x) => (x.id === w.id ? w : x)));

  const remove = async (id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
    try {
      await fetch("/api/widgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
    } catch {
      // ignore
    }
  };

  const refreshAll = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/widgets?refresh=1", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data?.widgets)) setWidgets(data.widgets);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 16 }}
          transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
          onClick={onClose}
          className="fixed inset-0 z-40 flex justify-end p-3 sm:p-5 bg-black/55 backdrop-blur-md"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-2xl h-full rounded-[26px] overflow-hidden border border-white/10 bg-deep-space/95 backdrop-blur-xl flex flex-col shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
          >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-reactor-core to-transparent opacity-70" />

            <header className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.07]">
              <div className="w-9 h-9 rounded-xl bg-reactor-core/10 border border-reactor-core/40 flex items-center justify-center">
                <LayoutGrid className="w-4 h-4 text-reactor-core" />
              </div>
              <div className="min-w-0">
                <h2 className="font-orbitron text-sm tracking-[0.2em] uppercase text-reactor-core">Widgets</h2>
                <p className="text-[10px] font-rajdhani text-text-secondary/60 tracking-wider uppercase">
                  describe it in plain language · it renders into your HUD
                </p>
              </div>
              <span className="ml-auto text-[10px] font-rajdhani text-text-secondary/50">{widgets.length} active</span>
              <button onClick={() => void refreshAll()} className="p-1.5 rounded-md hover:bg-white/10 text-text-secondary/70" title="Refresh live widgets">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              </button>
              <button
                onClick={onClose}
                className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-accent-red/20 text-text-secondary/70 hover:text-text-primary"
                title="Close (Esc)"
              >
                <X className="w-4 h-4" />
                <span className="text-[9px] font-rajdhani uppercase tracking-widest">esc</span>
              </button>
            </header>

            <div className="p-5 space-y-4 overflow-y-auto">
              <section className="space-y-2">
                <div className="relative">
                  <input
                    ref={promptRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void create();
                    }}
                    placeholder='e.g. "build me a panel that tracks my assignments and crypto"'
                    className="w-full bg-white/[0.035] border border-white/[0.09] rounded-2xl pl-4 pr-12 py-3.5 text-sm font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/50 focus:ring-1 focus:ring-reactor-core/25"
                  />
                  <button
                    onClick={() => void create()}
                    disabled={!prompt.trim() || busy}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-xl bg-reactor-core/20 border border-reactor-core/40 text-reactor-core disabled:opacity-30"
                    title="Build the widget"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {IDEAS.map((idea) => (
                    <button
                      key={idea}
                      onClick={() => void create(`a widget that tracks ${idea}`)}
                      className="px-2.5 py-1 rounded-full border border-white/[0.08] bg-white/[0.025] text-[10px] font-rajdhani text-text-secondary/75 hover:text-reactor-core hover:border-reactor-core/35 transition-colors"
                    >
                      + {idea}
                    </button>
                  ))}
                  <span className="w-px self-stretch bg-white/10 mx-1" />
                  {([
                    ["checklist", "My checklist"],
                    ["counter", "Daily counter"],
                    ["text", "Scratchpad"],
                  ] as const).map(([kind, title]) => (
                    <button
                      key={kind}
                      onClick={() => void addBlank(kind, title)}
                      disabled={busy}
                      className="px-2.5 py-1 rounded-full border border-dashed border-white/15 bg-transparent text-[10px] font-rajdhani text-text-secondary/70 hover:text-text-primary hover:border-white/35 transition-colors disabled:opacity-40"
                      title={`Add an empty ${kind} widget you fill in yourself`}
                    >
                      blank {kind}
                    </button>
                  ))}
                </div>
                <p className="text-[9px] font-rajdhani text-text-secondary/45">
                  Every widget is yours: hit the ✎ on a card to rename it, change its look, rewrite rows, reorder or
                  delete them.
                </p>
                {error && <div className="text-[11px] font-rajdhani text-accent-red">{error}</div>}
              </section>

              {widgets.length === 0 ? (
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6 text-center space-y-2">
                  <Sparkles className="w-5 h-5 text-reactor-core/60 mx-auto" />
                  <p className="text-xs font-rajdhani text-text-secondary/70">
                    No widgets yet. Describe one above — “make a checklist for my assignments”, “track crypto prices”,
                    “a counter for water”.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {widgets.map((w, i) => (
                    <motion.div
                      key={w.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.04, 0.3) }}
                    >
                      <WidgetCard widget={w} onChange={update} onDelete={remove} />
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            <footer className="px-5 py-3 border-t border-white/[0.07] text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/40">
              Stored in .jarvis-data/widgets.json · mirrored to the HUD rail · esc or click outside to close
            </footer>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
