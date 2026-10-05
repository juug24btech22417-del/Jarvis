"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Volume2,
  Copy,
  Check,
  X,
  Search,
  BookOpen,
  ArrowRight,
  Brain,
  Code2,
  MessageCircleQuestion,
  Wrench,
  ListChecks,
  Minus,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

type AssistMode = "answer" | "code" | "error" | "task" | "explain";

interface ExplainResult {
  mode: AssistMode;
  category: string;
  urgency: "safe" | "caution" | "critical";
  summary: string;
  answer: string;
  code: string;
  language: string;
  bullets: Array<{ title: string; desc: string }>;
  soundbite: string;
  originalText: string;
}

/** Per-mode presentation: verb, icon, and the modal headline. */
const MODE_META: Record<
  AssistMode,
  { verb: string; heading: string; icon: React.ReactNode }
> = {
  answer: {
    verb: "ANSWERED",
    heading: "TACTICAL OVERLAY · ANSWERED",
    icon: <MessageCircleQuestion className="w-4 h-4" />,
  },
  code: {
    verb: "CODE READY",
    heading: "TACTICAL OVERLAY · CODE FORGED",
    icon: <Code2 className="w-4 h-4" />,
  },
  error: {
    verb: "FIX READY",
    heading: "TACTICAL OVERLAY · DIAGNOSIS",
    icon: <Wrench className="w-4 h-4" />,
  },
  task: {
    verb: "DONE",
    heading: "TACTICAL OVERLAY · TASK COMPLETE",
    icon: <ListChecks className="w-4 h-4" />,
  },
  explain: {
    verb: "EXPLAINED",
    heading: "TACTICAL OVERLAY · EXPLAIN THIS",
    icon: <BookOpen className="w-4 h-4" />,
  },
};

const modeOf = (m: unknown): AssistMode =>
  m === "answer" || m === "code" || m === "error" || m === "task" || m === "explain"
    ? m
    : "explain";

/** Tell the server to ignore a clipboard write we made ourselves. */
function suppressClipboard(text: string) {
  if (!text) return;
  fetch("/api/clipboard/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "suppress", text }),
  }).catch(() => {});
}

export default function ExplainOverlay() {
  const activePanel = useJarvisStore((s) => s.activePanel);
  const setActivePanel = useJarvisStore((s) => s.setActivePanel);
  const addMemory = useJarvisStore((s) => s.addMemory);
  const clipboardAssist = useJarvisStore((s) => s.clipboardAssist);
  const setClipboardAssist = useJarvisStore((s) => s.setClipboardAssist);

  const [isOpen, setIsOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  const [floatingPos, setFloatingPos] = useState<{ x: number; y: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [saved, setSaved] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const offerRef = useRef<HTMLDivElement>(null);
  // Compact, non-modal offer shown for a system-wide clip. Nothing is opened
  // automatically any more — the answer is already computed, but we ASK first
  // and only open the full breakdown when the user clicks "Ask JARVIS".
  const [offer, setOffer] = useState<{
    text: string;
    mode: AssistMode;
    summary: string;
    source?: string;
  } | null>(null);

  const normalise = useCallback((a: any, rawText: string): ExplainResult => {
    return {
      mode: modeOf(a?.mode),
      category: typeof a?.category === "string" ? a.category : "General",
      urgency:
        a?.urgency === "critical" || a?.urgency === "caution" ? a.urgency : "safe",
      summary: typeof a?.summary === "string" ? a.summary : "",
      answer: typeof a?.answer === "string" ? a.answer : "",
      code: typeof a?.code === "string" ? a.code : "",
      language: typeof a?.language === "string" ? a.language : "",
      bullets: Array.isArray(a?.bullets) ? a.bullets : [],
      soundbite: typeof a?.soundbite === "string" ? a.soundbite : "",
      originalText: typeof a?.originalText === "string" ? a.originalText : rawText,
    };
  }, []);

  const closeOverlay = useCallback(() => {
    setIsOpen(false);
    if (activePanel === "explain-overlay") {
      setActivePanel(null);
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, [activePanel, setActivePanel]);

  const runAnalysis = useCallback(async (textToAnalyze: string) => {
    if (!textToAnalyze.trim()) return;
    setLoading(true);
    setResult(null);
    setSaved(false);

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToAnalyze }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(normalise(data, textToAnalyze));
      }
    } catch (e) {
      console.error("[ExplainOverlay] Fetch error:", e);
    } finally {
      setLoading(false);
    }
  }, [normalise]);

  /* ── OS-wide clipboard events ──
   * The server already answered the clip, but we never pop the full overlay on
   * our own — "whenever I copy it opens that panel" was the complaint. Instead
   * we surface a compact "Ask JARVIS?" card (with where it was copied from)
   * and let the user decide. The full breakdown opens on click. */
  useEffect(() => {
    if (!clipboardAssist) return;
    const a: any = clipboardAssist.analysis || {};
    const res = normalise(a, clipboardAssist.text);
    setSelectedText(clipboardAssist.text);
    setResult(res);
    setLoading(false);
    setFloatingPos(null);
    setOffer({
      text: clipboardAssist.text,
      mode: res.mode,
      summary: res.summary,
      source: clipboardAssist.source,
    });
    // Consume the event so it can't fire twice.
    setClipboardAssist(null);
  }, [clipboardAssist, normalise, setClipboardAssist]);

  // The clipboard card asks first and gets out of the way: a click anywhere
  // outside it dismisses the offer.
  useEffect(() => {
    if (!offer) return;
    const onDown = (e: MouseEvent) => {
      const el = offerRef.current;
      if (el && !el.contains(e.target as Node)) setOffer(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [offer]);

  // Sync with activePanel if opened via launcher
  useEffect(() => {
    if (activePanel === "explain-overlay") {
      setIsOpen(true);
      setOffer(null);
      if (!selectedText) {
        const sel = window.getSelection()?.toString().trim();
        if (sel) {
          setSelectedText(sel);
          runAnalysis(sel);
        }
      }
    }
  }, [activePanel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for selection mouseups to show floating prompt
  useEffect(() => {
    const handleMouseUp = (e: MouseEvent) => {
      if (isOpen) return;

      const sel = window.getSelection()?.toString().trim();
      if (sel && sel.length > 5) {
        setSelectedText(sel);
        setFloatingPos({
          x: Math.min(e.clientX + 10, window.innerWidth - 220),
          y: Math.max(e.clientY - 45, 20),
        });
      } else {
        setTimeout(() => {
          if (!window.getSelection()?.toString().trim()) {
            setFloatingPos(null);
          }
        }, 150);
      }
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isOpen]);

  // Global hotkey: Ctrl+Shift+E or Alt+E
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") || (e.altKey && e.key.toLowerCase() === "e")) {
        e.preventDefault();
        const sel = window.getSelection()?.toString().trim() || selectedText;
        setIsOpen(true);
        setOffer(null);
        setFloatingPos(null);
        if (sel) {
          setSelectedText(sel);
          runAnalysis(sel);
        }
      } else if (e.key === "Escape" && isOpen) {
        closeOverlay();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, selectedText, closeOverlay, runAnalysis]);

  const handleSpeakSoundbite = (text: string) => {
    if (!window.speechSynthesis) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 0.95;
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utter);
  };

  const handleCopy = (text: string, which: "full" | "code" = "full") => {
    // Suppress BEFORE writing: the OS watcher polls every ~700ms, so telling
    // the server first guarantees it never analyses our own output back.
    suppressClipboard(text);
    navigator.clipboard.writeText(text);
    if (which === "code") {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSaveToMemory = () => {
    if (!result) return;
    addMemory({
      content: `[${result.category}] ${result.summary} (Soundbite: ${result.soundbite})`,
      category: "dossier",
      source: "Instant Explain Overlay",
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const getUrgencyBadge = (urgency: string) => {
    if (urgency === "critical") {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-950/70 border border-rose-500/50 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)] animate-pulse">
          <ShieldAlert className="w-3.5 h-3.5" /> CRITICAL ALERT
        </span>
      );
    }
    if (urgency === "caution") {
      return (
        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/70 border border-amber-500/50 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]">
          <AlertTriangle className="w-3.5 h-3.5" /> CAUTION REQUIRED
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
        <ShieldCheck className="w-3.5 h-3.5" /> VERIFIED SAFE
      </span>
    );
  };

  const meta = MODE_META[result ? result.mode : "explain"];

  return (
    <>
      {/* ── Floating selection trigger pill ── */}
      <AnimatePresence>
        {floatingPos && !isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85 }}
            style={{ left: `${floatingPos.x}px`, top: `${floatingPos.y}px` }}
            className="fixed z-[100] cursor-pointer"
            onClick={() => {
              setIsOpen(true);
              setFloatingPos(null);
              runAnalysis(selectedText);
            }}
          >
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-black/90 border border-cyan-400/80 shadow-[0_0_20px_rgba(6,182,212,0.5)] backdrop-blur-md text-cyan-300 hover:text-white hover:border-cyan-300 transition-all font-rajdhani text-xs tracking-wider font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400 animate-spin" style={{ animationDuration: "4s" }} />
              <span>ASK JARVIS</span>
              <kbd className="px-1.5 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-[10px] text-cyan-200">
                Ctrl+Shift+E
              </kbd>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Compact "answer ready" offer (system-wide clipboard) ── */}
      <AnimatePresence>
        {offer && !isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 30, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 30, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            data-testid="clipboard-offer"
            ref={offerRef}
            className="fixed bottom-28 right-5 z-[110] w-[17.5rem] max-w-[calc(100vw-2rem)] pointer-events-auto"
          >
            <div className="rounded-2xl border border-cyan-500/40 bg-zinc-950/95 backdrop-blur-xl shadow-[0_0_30px_rgba(6,182,212,0.35)] overflow-hidden font-rajdhani text-white">
              <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
              <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-cyan-500/20 bg-zinc-900/60">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="p-1.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-cyan-300">
                    {MODE_META[offer.mode].icon}
                  </span>
                  <div className="min-w-0">
                    <div className="font-orbitron text-[11px] font-bold tracking-wider text-cyan-300">
                      JARVIS · ASK FIRST
                    </div>
                    <div className="text-[10px] text-zinc-400 truncate">
                      {offer.source ? `Copied from ${offer.source}` : "Copied to clipboard"}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setOffer(null)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
                  title="Dismiss"
                >
                  <Minus className="w-4 h-4" />
                </button>
              </div>
              <div className="px-3.5 py-3 space-y-3">
                <p className="text-[12.5px] leading-snug text-zinc-300 line-clamp-3 break-words">
                  "{offer.text.slice(0, 180)}{offer.text.length > 180 ? "…" : ""}"
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setOffer(null);
                      setIsOpen(true);
                    }}
                    className="flex-1 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-all"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Ask JARVIS
                  </button>
                  <button
                    onClick={() => setOffer(null)}
                    className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700 transition-all"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main HUD Explain Modal ── */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.2 }}
              data-testid="explain-overlay"
              className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-cyan-500/40 bg-zinc-950/95 shadow-[0_0_50px_rgba(6,182,212,0.25)] overflow-hidden text-white font-rajdhani"
            >
              {/* Top scanner beam effect */}
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-pulse" />

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/20 bg-zinc-900/60">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="font-orbitron text-lg font-bold text-cyan-300 tracking-wider">
                        {meta.heading}
                      </h2>
                      {result && (
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono tracking-widest bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                          {result.category.toUpperCase()}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 tracking-wide">
                      Auto-detects questions, code, errors &amp; tasks — then actually does the work
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {result && getUrgencyBadge(result.urgency)}
                  <button
                    onClick={closeOverlay}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
                {/* Highlighted text preview / Input box */}
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs text-zinc-400 font-mono">
                    <span className="flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
                      SNIPPET
                    </span>
                    <span>{selectedText ? `${selectedText.length} chars` : "Paste or type below"}</span>
                  </div>

                  {selectedText ? (
                    <div className="text-sm text-zinc-200 font-mono max-h-24 overflow-y-auto pr-2 bg-black/40 p-2.5 rounded border border-zinc-800/80 select-text">
                      "{selectedText}"
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <textarea
                        rows={2}
                        value={customInput}
                        onChange={(e) => setCustomInput(e.target.value)}
                        placeholder="Paste a question, code, error, legal clause, or an instruction…"
                        className="flex-1 bg-black/60 border border-zinc-700/80 rounded-lg p-2.5 text-sm text-zinc-200 focus:outline-none focus:border-cyan-400 font-mono resize-none placeholder:text-zinc-600"
                      />
                      <button
                        onClick={() => {
                          setSelectedText(customInput);
                          runAnalysis(customInput);
                        }}
                        disabled={!customInput.trim() || loading}
                        className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-semibold flex items-center justify-center gap-1.5 text-sm transition-all"
                      >
                        <Search className="w-4 h-4" />
                        Analyze
                      </button>
                    </div>
                  )}

                  {selectedText && (
                    <div className="flex justify-end">
                      <button
                        onClick={() => {
                          setSelectedText("");
                          setResult(null);
                        }}
                        className="text-xs text-cyan-400/80 hover:text-cyan-300 underline underline-offset-2"
                      >
                        Clear snippet &amp; paste custom text
                      </button>
                    </div>
                  )}
                </div>

                {/* Loading state */}
                {loading && (
                  <div className="py-12 flex flex-col items-center justify-center gap-3">
                    <div className="w-10 h-10 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                    <p className="font-orbitron text-xs text-cyan-300 tracking-widest animate-pulse">
                      JARVIS NEURAL DECOMPILER RUNNING...
                    </p>
                  </div>
                )}

                {/* Analysis Results */}
                {result && !loading && (
                  <div className="space-y-4">
                    {/* Summary callout */}
                    <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-950/20 shadow-[0_0_20px_rgba(6,182,212,0.1)]">
                      <div className="flex items-center gap-1.5 text-xs text-cyan-400 font-mono tracking-wider uppercase mb-1">
                        {meta.icon}
                        {result.mode === "answer"
                          ? "Answer"
                          : result.mode === "error"
                          ? "Root Cause"
                          : result.mode === "code"
                          ? "What this code does"
                          : result.mode === "task"
                          ? "Result"
                          : "Plain English Summary"}
                      </div>
                      <p className="text-base text-zinc-100 font-sans leading-relaxed font-medium whitespace-pre-wrap">
                        {result.summary}
                      </p>
                    </div>

                    {/* The actual answer / finished work product */}
                    {result.answer && (
                      <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/10">
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono tracking-wider uppercase">
                            <Brain className="w-3.5 h-3.5" />
                            {result.mode === "task" ? "Delivered" : "Jarvis Response"}
                          </div>
                          <button
                            onClick={() => handleCopy(result.answer)}
                            className="p-1 rounded text-emerald-300/70 hover:text-emerald-200 hover:bg-emerald-900/30 transition-colors"
                            title="Copy answer"
                          >
                            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>                          <p data-testid="assist-answer" className="text-sm text-zinc-100 font-sans leading-relaxed whitespace-pre-wrap select-text">
                          {result.answer}
                        </p>
                      </div>
                    )}

                    {/* Code block */}
                    {result.code && (
                      <div className="rounded-xl border border-violet-500/30 bg-black/50 overflow-hidden">
                        <div className="flex items-center justify-between px-3.5 py-2 border-b border-violet-500/20 bg-violet-950/20">
                          <span className="flex items-center gap-1.5 text-xs font-mono tracking-wider text-violet-300 uppercase">
                            <Code2 className="w-3.5 h-3.5" />
                            {result.mode === "error" ? "Suggested Fix" : "Generated Code"}
                            {result.language ? ` · ${result.language}` : ""}
                          </span>
                          <button
                            onClick={() => handleCopy(result.code, "code")}
                            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-violet-600/30 hover:bg-violet-600/50 text-violet-100 border border-violet-500/40 transition-colors"
                          >
                            {copiedCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            {copiedCode ? "Copied" : "Copy"}
                          </button>
                        </div>
                        <pre className="p-3.5 text-[12.5px] leading-relaxed text-zinc-100 font-mono overflow-x-auto select-text">
                          <code>{result.code}</code>
                        </pre>
                      </div>
                    )}

                    {/* Soundbite / Earpiece line */}
                    {result.soundbite && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
                        <div className="flex items-center gap-2.5">
                          <Volume2 className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                          <span className="text-xs text-zinc-300 italic font-sans">
                            "{result.soundbite}"
                          </span>
                        </div>
                        <button
                          onClick={() => handleSpeakSoundbite(result.soundbite)}
                          className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                            speaking
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                              : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 hover:bg-cyan-500/30"
                          }`}
                        >
                          <Volume2 className="w-3 h-3" />
                          {speaking ? "Stop Voice" : "Whisper into Ear"}
                        </button>
                      </div>
                    )}

                    {/* 3 Tactical Breakdown Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {result.bullets.map((b, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:border-cyan-500/40 transition-colors space-y-1.5"
                        >
                          <div className="flex items-center gap-1.5 text-xs font-orbitron font-semibold text-cyan-300">
                            {idx === 0 && <BookOpen className="w-3.5 h-3.5 text-blue-400" />}
                            {idx === 1 && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                            {idx === 2 && <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />}
                            <span>{b.title}</span>
                          </div>
                          <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                            {b.desc}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer actions */}
              {result && !loading && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-cyan-500/20 bg-zinc-900/80">
                  <div className="text-xs text-zinc-500 font-mono">
                    Hotkey: <kbd className="text-zinc-400">Ctrl+Shift+E</kbd>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveToMemory}
                      disabled={saved}
                      className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700 flex items-center gap-1.5 transition-all"
                    >
                      <Brain className="w-3.5 h-3.5 text-cyan-400" />
                      {saved ? "Saved to Memory!" : "Save to Memory"}
                    </button>
                    <button
                      onClick={() =>
                        handleCopy(
                          [
                            result.answer,
                            result.code ? "```" + (result.language || "") + "\n" + result.code + "\n```" : "",
                            result.summary,
                            ...result.bullets.map((b) => `• ${b.title}: ${b.desc}`),
                          ]
                            .filter(Boolean)
                            .join("\n\n")
                        )
                      }
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold text-white flex items-center gap-1.5 transition-all"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied!" : "Copy All"}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
