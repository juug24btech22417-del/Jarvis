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
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

/* ── Presentation ────────────────────────────────────────────────────────
 * The clipboard surfaces use the system SF stack with Apple's dark palette
 * (#1C1C1E / #2C2C2E / #0A84FF) so the cards feel native next to the OS
 * watcher's own popup, instead of the cyan HUD used elsewhere in JARVIS. */
const SF =
  '"SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
const MONO = '"SF Mono", ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';

type AssistMode = "answer" | "code" | "error" | "task" | "explain";

interface ClipAction {
  id: string;
  label: string;
  /** Handled on the client (open a URL) — never hits a model. */
  local?: boolean;
  /** The result code can be applied over the copied snippet. */
  applies?: boolean;
}

interface Detection {
  kind: string;
  label: string;
  noun?: string;
  language?: string;
  confidence?: number;
  actions: ClipAction[];
}

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
  /** Result-card headline ("Fixed code", "Summary"...). */
  title?: string;
  /** True when `code` is a drop-in replacement for the copied snippet. */
  applies?: boolean;
  actionId?: string;
  actionLabel?: string;
}

const KIND_LABELS: Record<string, string> = {
  question: "Question detected",
  code: "Code detected",
  error: "Error detected",
  url: "Website detected",
  youtube: "Video detected",
  github: "Repository detected",
  article: "Content detected",
  message: "Message detected",
  sql: "SQL detected",
  image: "Image detected",
  json: "Structured data detected",
  cli: "Command detected",
  math: "Equation detected",
  text: "Text detected",
};

/** Kinds whose snippet reads better in a monospace preview. */
const MONO_KINDS = new Set(["code", "error", "sql", "json", "cli"]);

const MODE_META: Record<AssistMode, { verb: string; heading: string; icon: React.ReactNode }> = {
  answer: { verb: "ANSWERED", heading: "Answer", icon: <MessageCircleQuestion className="w-4 h-4" /> },
  code: { verb: "CODE READY", heading: "Code", icon: <Code2 className="w-4 h-4" /> },
  error: { verb: "FIX READY", heading: "Diagnosis", icon: <Wrench className="w-4 h-4" /> },
  task: { verb: "DONE", heading: "Task complete", icon: <ListChecks className="w-4 h-4" /> },
  explain: { verb: "EXPLAINED", heading: "Explanation", icon: <BookOpen className="w-4 h-4" /> },
};

const STATUS_VERB: Record<string, string> = {
  answer: "Answering",
  explain: "Explaining",
  explain_simple: "Simplifying",
  exam_answer: "Writing the exam answer",
  research: "Researching",
  fix: "Fixing",
  optimize: "Optimizing",
  test: "Writing tests",
  diagnose: "Diagnosing",
  summarize: "Summarizing",
  keypoints: "Extracting key points",
  extract: "Extracting information",
  analyze: "Analyzing",
  questions: "Writing questions",
  reply: "Drafting a reply",
  improve: "Improving",
  professional: "Rewriting",
  debug: "Debugging your SQL",
  format: "Formatting",
  convert: "Converting",
  safety: "Auditing the command",
  solve: "Solving",
  visualize: "Plotting",
  extract_text: "Reading the image",
  open: "Opening",
};

const modeOf = (m: unknown): AssistMode =>
  m === "answer" || m === "code" || m === "error" || m === "task" || m === "explain" ? m : "explain";

/** Map a detected kind onto the modal's icon/label mode. */
function modeForKind(kind: string): AssistMode {
  if (kind === "code" || kind === "sql" || kind === "json" || kind === "cli") return "code";
  if (kind === "error") return "error";
  if (kind === "question" || kind === "math") return "answer";
  if (kind === "message") return "task";
  return "explain";
}

function extractUrl(text: string): string {
  const m = text.match(/https?:\/\/[^\s<>"')]+/i);
  return m ? m[0] : "";
}

function normaliseDetection(raw: any): Detection | null {
  if (!raw || typeof raw !== "object") return null;
  const actions: ClipAction[] = Array.isArray(raw.actions)
    ? raw.actions
        .filter((a: any) => a && typeof a.id === "string" && typeof a.label === "string")
        .map((a: any) => ({
          id: String(a.id),
          label: String(a.label),
          local: Boolean(a.local),
          applies: Boolean(a.applies),
        }))
    : [];
  const kind = typeof raw.kind === "string" ? raw.kind : "text";
  if (!actions.length) return null;
  return {
    kind,
    label: typeof raw.label === "string" ? raw.label : KIND_LABELS[kind] ?? "Text detected",
    noun: typeof raw.noun === "string" ? raw.noun : undefined,
    language: typeof raw.language === "string" ? raw.language : undefined,
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    actions,
  };
}

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
  const [pendingAction, setPendingAction] = useState<ClipAction | null>(null);
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [detection, setDetection] = useState<Detection | null>(null);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [saved, setSaved] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const offerRef = useRef<HTMLDivElement>(null);

  // The detection card: what was copied (kind + its buttons) and, when the
  // server already answered it (auto mode), the ready result behind it.
  const [offer, setOffer] = useState<{
    text: string;
    source?: string;
    detection: Detection | null;
    ready?: ExplainResult | null;
  } | null>(null);

  const normalise = useCallback((a: any, rawText: string): ExplainResult => {
    return {
      mode: modeOf(a?.mode),
      category: typeof a?.category === "string" ? a.category : "General",
      urgency: a?.urgency === "critical" || a?.urgency === "caution" ? a.urgency : "safe",
      summary: typeof a?.summary === "string" ? a.summary : "",
      answer: typeof a?.answer === "string" ? a.answer : "",
      code: typeof a?.code === "string" ? a.code : "",
      language: typeof a?.language === "string" ? a.language : "",
      bullets: Array.isArray(a?.bullets) ? a.bullets : [],
      soundbite: typeof a?.soundbite === "string" ? a.soundbite : "",
      originalText: typeof a?.originalText === "string" ? a.originalText : rawText,
    };
  }, []);

  /** Map an action result (/api/clipboard/capture act) onto the shared shape. */
  const normaliseActionResult = useCallback((r: any, rawText: string): ExplainResult => {
    const kind = typeof r?.kind === "string" ? r.kind : "text";
    return {
      mode: modeForKind(kind),
      category: typeof r?.title === "string" ? r.title : "Result",
      urgency: "safe",
      summary: typeof r?.summary === "string" ? r.summary : "",
      answer: typeof r?.answer === "string" ? r.answer : "",
      code: typeof r?.code === "string" ? r.code : "",
      language: typeof r?.language === "string" ? r.language : "",
      bullets: [],
      soundbite: typeof r?.soundbite === "string" ? r.soundbite : "",
      originalText: rawText,
      title: typeof r?.title === "string" ? r.title : undefined,
      applies: Boolean(r?.applies),
      actionId: typeof r?.actionId === "string" ? r.actionId : undefined,
      actionLabel: typeof r?.actionLabel === "string" ? r.actionLabel : undefined,
    };
  }, []);

  const closeOverlay = useCallback(() => {
    setIsOpen(false);
    if (activePanel === "explain-overlay") setActivePanel(null);
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, [activePanel, setActivePanel]);

  /* ── Legacy free-form analysis (selection pill, Ctrl+Shift+E, paste box) ── */
  const runAnalysis = useCallback(
    async (textToAnalyze: string) => {
      if (!textToAnalyze.trim()) return;
      setLoading(true);
      setResult(null);
      setPendingAction(null);
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
          setDetection(normaliseDetection(data.detection));
        }
      } catch (e) {
        console.error("[ExplainOverlay] Fetch error:", e);
      } finally {
        setLoading(false);
      }
    },
    [normalise]
  );

  /* ── Run one detected action (the whole point of the card) ── */
  const runAction = useCallback(
    async (text: string, action: ClipAction, kind: string) => {
      if (!text.trim()) return;
      setLoading(true);
      setResult(null);
      setSaved(false);
      setPendingAction(action);
      setActiveActionId(action.id);
      setSelectedText(text);
      try {
        const res = await fetch("/api/clipboard/capture", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, source: "", action: "act", id: action.id, kind }),
        });
        const data = await res.json();
        if (data?.success && data.result) {
          setResult(normaliseActionResult(data.result, text));
        }
      } catch (e) {
        console.error("[ExplainOverlay] Action error:", e);
      } finally {
        setLoading(false);
        setPendingAction(null);
      }
    },
    [normaliseActionResult]
  );

  /* ── OS-wide clipboard events ──
   * The server detected (and in auto mode already answered) the clip. We never
   * pop the full panel on our own: a compact card names what was copied and
   * offers that kind's buttons. Only a click opens the panel. */
  useEffect(() => {
    if (!clipboardAssist) return;
    const a: any = clipboardAssist.analysis || {};
    const res = normalise(a, clipboardAssist.text);
    const det =
      normaliseDetection(clipboardAssist.detection) ?? normaliseDetection(a.detection);
    setSelectedText(clipboardAssist.text);
    setDetection(det);
    setResult(det ? null : res);
    setActiveActionId(null);
    setLoading(false);
    setFloatingPos(null);
    setOffer({
      text: clipboardAssist.text,
      source: clipboardAssist.source,
      detection: det,
      ready: det ? res : null,
    });
    setClipboardAssist(null);
  }, [clipboardAssist, normalise, setClipboardAssist]);

  // The card gets out of the way: a click anywhere outside dismisses it.
  useEffect(() => {
    if (!offer) return;
    const onDown = (e: MouseEvent) => {
      const el = offerRef.current;
      if (el && !el.contains(e.target as Node)) setOffer(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [offer]);

  // Sync with activePanel if opened via launcher.
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

  // Selection mouseup → floating "Ask JARVIS" pill.
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
          if (!window.getSelection()?.toString().trim()) setFloatingPos(null);
        }, 150);
      }
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isOpen]);

  // Global hotkey: Ctrl+Shift+E or Alt+E.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "e") ||
        (e.altKey && e.key.toLowerCase() === "e")
      ) {
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
      source: "Clipboard assistant",
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  /** One action from the card / the modal's action strip. */
  const chooseAction = (text: string, action: ClipAction, kind: string, det: Detection | null) => {
    if (action.local) {
      const url = extractUrl(text);
      if (url) window.open(url, "_blank", "noopener");
      setOffer(null);
      return;
    }
    setDetection(det);
    setOffer(null);
    setIsOpen(true);
    runAction(text, action, kind);
  };

  const getUrgencyBadge = (urgency: string) => {
    const base =
      "flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border";
    if (urgency === "critical")
      return (
        <span className={`${base} bg-rose-500/15 border-rose-400/40 text-rose-300`}>
          <ShieldAlert className="w-3 h-3" /> Critical
        </span>
      );
    if (urgency === "caution")
      return (
        <span className={`${base} bg-amber-500/15 border-amber-400/40 text-amber-300`}>
          <AlertTriangle className="w-3 h-3" /> Caution
        </span>
      );
    return (
      <span className={`${base} bg-emerald-500/15 border-emerald-400/30 text-emerald-300`}>
        <ShieldCheck className="w-3 h-3" /> Safe
      </span>
    );
  };

  const meta = MODE_META[result ? result.mode : "explain"];
  const isMonoSnippet = detection ? MONO_KINDS.has(detection.kind) : false;
  const snippetPreview =
    selectedText.length > 320 ? `${selectedText.slice(0, 317)}...` : selectedText;
  const fullCopyText = result
    ? [
        result.answer,
        result.code ? "```" + (result.language || "") + "\n" + result.code + "\n```" : "",
        result.summary,
        ...result.bullets.map((b) => `- ${b.title}: ${b.desc}`),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  return (
    <>
      {/* ── Floating selection trigger pill ── */}
      <AnimatePresence>
        {floatingPos && !isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{ left: `${floatingPos.x}px`, top: `${floatingPos.y}px`, fontFamily: SF }}
            className="fixed z-[100] cursor-pointer"
            onClick={() => {
              setIsOpen(true);
              setFloatingPos(null);
              runAnalysis(selectedText);
            }}
          >
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1c1c1e]/90 border border-white/10 shadow-[0_8px_28px_-8px_rgba(0,0,0,0.8)] backdrop-blur-xl text-white/90 hover:bg-[#2c2c2e]/95 transition-all text-[12.5px] font-medium">
              <Sparkles className="w-3.5 h-3.5 text-[#0a84ff]" />
              <span>Ask JARVIS</span>
              <kbd className="px-1.5 py-0.5 rounded-[6px] bg-white/[0.08] text-[10px] text-white/50">
                Ctrl+Shift+E
              </kbd>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Detection card (system-wide copy) ── */}
      <AnimatePresence>
        {offer && !isOpen && (
          <motion.div
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            data-testid="clipboard-offer"
            ref={offerRef}
            style={{ fontFamily: SF }}
            className="fixed bottom-28 right-5 z-[110] w-[14.5rem] max-w-[calc(100vw-2rem)] pointer-events-auto"
          >
            <div className="rounded-[18px] border border-white/[0.08] bg-[#1c1c1e]/90 backdrop-blur-2xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.85)] overflow-hidden">
              {/* Header */}
              <div className="flex items-start justify-between px-3 pt-2.5 pb-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-[6px] h-[6px] rounded-full bg-[#0a84ff] shrink-0" />
                  <span className="text-[9.5px] font-semibold tracking-[0.08em] text-white/40 uppercase">
                    JARVIS
                  </span>
                </div>
                {offer.detection && (
                  <span className="text-[10.5px] font-medium text-[#0a84ff] shrink-0 ml-2">
                    {offer.detection.label}
                  </span>
                )}
              </div>

              <div className="px-3 pb-2">
                <p className="text-[10px] text-white/35 truncate mb-1">
                  {offer.source ? `Copied from ${offer.source}` : "Copied to your clipboard"}
                </p>
                <p
                  style={isMonoSnippet ? { fontFamily: MONO } : undefined}
                  className="text-[11.5px] leading-snug text-white/85 line-clamp-2 break-words"
                >
                  {offer.text.replace(/\s+/g, " ").slice(0, 240)}
                  {offer.text.length > 240 ? "…" : ""}
                </p>
              </div>

              {/* Actions - plain terms, no pill chrome, so the card stays small */}
              <div className="px-2.5 pb-2.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                  {offer.ready && (
                    <button
                      onClick={() => {
                        setResult(offer.ready || null);
                        setOffer(null);
                        setIsOpen(true);
                      }}
                      className="py-0.5 text-[11.5px] font-medium text-[#0a84ff] hover:text-[#409cff] transition-colors"
                    >
                      View answer
                    </button>
                  )}
                  {offer.detection
                    ? offer.detection.actions.map((a) => (
                        <button
                          key={a.id}
                          onClick={() =>
                            chooseAction(offer.text, a, offer.detection!.kind, offer.detection)
                          }
                          className="py-0.5 text-[11.5px] font-medium text-[#0a84ff] hover:text-[#409cff] transition-colors whitespace-nowrap"
                        >
                          {a.label}
                        </button>
                      ))
                    : (
                      <button
                        onClick={() => {
                          setOffer(null);
                          setIsOpen(true);
                          runAnalysis(offer.text);
                        }}
                        className="py-0.5 text-[11.5px] font-medium text-[#0a84ff] hover:text-[#409cff] transition-colors"
                      >
                        Ask JARVIS
                      </button>
                    )}
                  <button
                    onClick={() => setOffer(null)}
                    className="py-0.5 text-[11.5px] font-medium text-white/40 hover:text-white/80 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main panel ── */}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-[6px]">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
              data-testid="explain-overlay"
              style={{ fontFamily: SF }}
              className="relative w-full max-w-xl max-h-[88vh] flex flex-col rounded-[26px] border border-white/[0.08] bg-[#1c1c1e]/95 backdrop-blur-2xl shadow-[0_30px_90px_-20px_rgba(0,0,0,0.9)] overflow-hidden text-white"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3.5 border-b border-white/[0.06]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-[11px] bg-white/[0.06] border border-white/[0.06] flex items-center justify-center text-[#0a84ff] shrink-0">
                    {meta.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-white truncate">
                        {result?.title || (detection ? detection.label : meta.heading)}
                      </h2>
                      {detection && (
                        <span className="px-2 py-[2px] rounded-full text-[10.5px] font-medium bg-white/[0.07] text-white/55 shrink-0">
                          {detection.language
                            ? detection.language.toUpperCase()
                            : statusNoun(detection.kind)}
                        </span>
                      )}
                    </div>
                    <p className="text-[11.5px] text-white/35 truncate">
                      {selectedText
                        ? `${selectedText.replace(/\s+/g, " ").slice(0, 70)}${selectedText.length > 70 ? "…" : ""}`
                        : "Paste or type below"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {result && !loading && getUrgencyBadge(result.urgency)}
                  <button
                    onClick={closeOverlay}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.09] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Action strip — switch actions without re-copying */}
              {detection && detection.actions.length > 0 && (
                <div className="px-5 py-3 border-b border-white/[0.06]">
                  <div className="flex flex-wrap gap-1.5">
                    {detection.actions.map((a) => {
                      const active = activeActionId === a.id;
                      return (
                        <button
                          key={a.id}
                          disabled={loading}
                          onClick={() => chooseAction(selectedText, a, detection.kind, detection)}
                          className={`px-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors disabled:opacity-60 ${
                            active
                              ? "bg-[#0a84ff] text-white"
                              : "bg-white/[0.08] text-white/80 hover:bg-white/[0.16]"
                          }`}
                        >
                          {a.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
                {/* Snippet / custom input */}
                <div className="rounded-[16px] bg-white/[0.04] border border-white/[0.06] p-3">
                  <div className="flex items-center justify-between text-[10.5px] text-white/35 mb-2">
                    <span className="tracking-[0.06em] uppercase">
                      {result?.applies ? "Snippet (replaceable)" : "Snippet"}
                    </span>
                    <span>{selectedText ? `${selectedText.length} chars` : ""}</span>
                  </div>
                  {selectedText ? (
                    <div
                      style={isMonoSnippet ? { fontFamily: MONO } : undefined}
                      className="text-[12.5px] text-white/75 max-h-24 overflow-y-auto whitespace-pre-wrap break-words select-text"
                    >
                      {snippetPreview}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <textarea
                        rows={2}
                        value={customInput}
                        onChange={(e) => setCustomInput(e.target.value)}
                        placeholder="Paste a question, code, error, legal clause, or an instruction…"
                        className="flex-1 bg-black/40 border border-white/[0.08] rounded-[12px] p-2.5 text-[12.5px] text-white/85 focus:outline-none focus:border-[#0a84ff]/70 resize-none placeholder:text-white/25"
                      />
                      <button
                        onClick={() => {
                          setSelectedText(customInput);
                          runAnalysis(customInput);
                        }}
                        disabled={!customInput.trim() || loading}
                        className="px-4 rounded-[12px] bg-[#0a84ff] hover:bg-[#409cff] disabled:opacity-40 text-white font-medium text-[12.5px] flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Search className="w-4 h-4" />
                        Analyze
                      </button>
                    </div>
                  )}
                  {selectedText && (
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => {
                          setSelectedText("");
                          setResult(null);
                        }}
                        className="text-[11.5px] text-[#0a84ff] hover:text-[#409cff]"
                      >
                        Clear and paste something else
                      </button>
                    </div>
                  )}
                </div>

                {/* Loading */}
                {loading && (
                  <div className="py-12 flex flex-col items-center justify-center gap-3">
                    <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-[#0a84ff] animate-spin" />
                    <p className="text-[12.5px] text-white/55">
                      {pendingAction
                        ? `${STATUS_VERB[pendingAction.id] || pendingAction.label}…`
                        : "Working on it…"}
                    </p>
                  </div>
                )}

                {/* Result */}
                {result && !loading && (
                  <div className="space-y-3">
                    {result.summary && (
                      <div className="rounded-[16px] bg-[#0a84ff]/[0.09] border border-[#0a84ff]/20 p-3.5">
                        <p className="text-[13.5px] text-white font-medium leading-relaxed whitespace-pre-wrap">
                          {result.summary}
                        </p>
                      </div>
                    )}

                    {result.answer && (
                      <div className="rounded-[16px] bg-white/[0.04] border border-white/[0.06] p-3.5">
                        <div className="flex items-center justify-between mb-2">
                          <span className="flex items-center gap-1.5 text-[10.5px] tracking-[0.06em] uppercase text-white/40">
                            <Brain className="w-3.5 h-3.5" />
                            {result.mode === "task" ? "Delivered" : "Result"}
                          </span>
                          <button
                            onClick={() => handleCopy(result.answer)}
                            className="p-1 rounded-md text-white/40 hover:text-white hover:bg-white/[0.08] transition-colors"
                            title="Copy answer"
                          >
                            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <p
                          data-testid="assist-answer"
                          className="text-[13px] text-white/85 leading-relaxed whitespace-pre-wrap select-text"
                        >
                          {result.answer}
                        </p>
                      </div>
                    )}

                    {result.code && (
                      <div className="rounded-[16px] overflow-hidden border border-white/[0.08] bg-black/50">
                        <div className="flex items-center justify-between px-3.5 py-2 bg-white/[0.04] border-b border-white/[0.06]">
                          <span className="text-[10.5px] tracking-[0.06em] uppercase text-white/40">
                            {result.applies ? "Ready to apply" : "Code"}
                            {result.language ? ` · ${result.language}` : ""}
                          </span>
                          {/* One button, one meaning: when the result is a drop-in
                              replacement we say so, otherwise it is just code. */}
                          <button
                            onClick={() => handleCopy(result.code, "code")}
                            title={
                              result.applies
                                ? "Copies the fixed code (the clipboard watcher ignores its own output) - paste it over your code with Ctrl+V"
                                : "Copy this code"
                            }
                            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-colors ${
                              result.applies
                                ? "bg-[#0a84ff] hover:bg-[#409cff] text-white"
                                : "bg-white/[0.08] hover:bg-white/[0.16] text-white/85"
                            }`}
                          >
                            {copiedCode ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            {copiedCode ? "Copied" : result.applies ? "Copy fix" : "Copy"}
                          </button>
                        </div>
                        <pre
                          style={{ fontFamily: MONO }}
                          className="p-3.5 text-[12px] leading-relaxed text-[#c9e9ff] overflow-x-auto select-text"
                        >
                          <code>{result.code}</code>
                        </pre>
                      </div>
                    )}

                    {result.soundbite && (
                      <div className="flex items-center justify-between p-3 rounded-[14px] bg-white/[0.04] border border-white/[0.06]">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Volume2 className="w-4 h-4 text-[#0a84ff] shrink-0" />
                          <span className="text-[12px] text-white/65 italic truncate">
                            "{result.soundbite}"
                          </span>
                        </div>
                        <button
                          onClick={() => handleSpeakSoundbite(result.soundbite)}
                          className={`px-2.5 py-1 rounded-full text-[11.5px] font-medium shrink-0 transition-colors ${
                            speaking
                              ? "bg-rose-500/20 text-rose-300 border border-rose-400/30"
                              : "bg-white/[0.08] text-white/80 hover:bg-white/[0.16]"
                          }`}
                        >
                          {speaking ? "Stop" : "Speak"}
                        </button>
                      </div>
                    )}

                    {result.bullets.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                        {result.bullets.map((b, idx) => (
                          <div
                            key={idx}
                            className="p-3 rounded-[14px] bg-white/[0.04] border border-white/[0.06] space-y-1"
                          >
                            <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-white/70">
                              {idx === 0 && <BookOpen className="w-3.5 h-3.5 text-[#0a84ff]" />}
                              {idx === 1 && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                              {idx === 2 && <ArrowRight className="w-3.5 h-3.5 text-emerald-400" />}
                              <span>{b.title}</span>
                            </div>
                            <p className="text-[12px] text-white/60 leading-relaxed">{b.desc}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              {result && !loading && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
                  <div className="text-[11px] text-white/25">Ctrl+Shift+E to open</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveToMemory}
                      disabled={saved}
                      className="px-3 py-1.5 rounded-full bg-white/[0.07] hover:bg-white/[0.14] text-[12px] font-medium text-white/80 flex items-center gap-1.5 transition-colors disabled:opacity-60"
                    >
                      <Brain className="w-3.5 h-3.5 text-[#0a84ff]" />
                      {saved ? "Saved" : "Save to memory"}
                    </button>
                    <button
                      onClick={() => handleCopy(fullCopyText || result.answer || result.summary)}
                      className="px-3 py-1.5 rounded-full bg-[#0a84ff] hover:bg-[#409cff] text-[12px] font-medium text-white flex items-center gap-1.5 transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy all"}
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

/** "code" -> "Code", "youtube" -> "Video"... used for the header pill. */
function statusNoun(kind: string): string {
  const nouns: Record<string, string> = {
    question: "Question",
    code: "Code",
    error: "Error",
    url: "Website",
    youtube: "Video",
    github: "Repository",
    article: "Content",
    message: "Message",
    sql: "SQL",
    image: "Image",
    json: "JSON",
    cli: "Command",
    math: "Equation",
    text: "Text",
  };
  return nouns[kind] ?? "Clip";
}
