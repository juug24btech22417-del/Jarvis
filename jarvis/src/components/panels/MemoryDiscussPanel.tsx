"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Brain, Send, X, Pin, PinOff } from "lucide-react";
import { useJarvisVoice } from "@/hooks/useVoice";
import { strengthToOpacity, decayLabel } from "@/lib/memory/decay";

interface DiscussTurn {
  id: string;
  role: "user" | "jarvis";
  content: string;
  citedIds?: string[];
}

interface DiscussPanelProps {
  isOpen: boolean;
  onClose: () => void;
  entity: {
    id: string;
    name: string;
    type: string;
    description: string | null;
    strength: number;
    pinned: boolean;
  } | null;
}

export default function MemoryDiscussPanel({ isOpen, onClose, entity }: DiscussPanelProps) {
  const [turns, setTurns] = useState<DiscussTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [currentStrength, setCurrentStrength] = useState<number>(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // When the entity changes, reset the thread.
  useEffect(() => {
    if (entity) {
      setTurns([]);
      setQuestion("");
      setError(null);
      setIsPinned(entity.pinned);
      setCurrentStrength(entity.strength);
    }
  }, [entity?.id, entity?.pinned, entity?.strength]);

  // Auto-scroll on new turn.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns, isLoading]);

  // Auto-focus input when opened.
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 250);
    }
  }, [isOpen]);

  // Esc to close.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const { speak, isSpeaking } = useJarvisVoice();

  const ask = async () => {
    const trimmed = question.trim();
    if (!trimmed || !entity || isLoading) return;

    setError(null);
    const userTurn: DiscussTurn = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
    };
    setTurns((prev) => [...prev, userTurn]);
    setQuestion("");
    setIsLoading(true);

    try {
      const res = await fetch("/api/memory/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryId: entity.id, question: trimmed }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const jarvisTurn: DiscussTurn = {
        id: `j-${Date.now()}`,
        role: "jarvis",
        content: data.answer,
        citedIds: data.citedMemoryIds,
      };
      setTurns((prev) => [...prev, jarvisTurn]);

      // Speak the answer if TTS is idle.
      if (!isSpeaking) {
        speak(data.answer);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to reach the memory module");
    } finally {
      setIsLoading(false);
    }
  };

  const togglePin = async () => {
    if (!entity) return;
    const next = !isPinned;
    setIsPinned(next);
    try {
      await fetch("/api/memory/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pin", id: entity.id, pinned: next }),
      });
    } catch (err) {
      // Revert on failure.
      setIsPinned(!next);
    }
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && entity && (
        <>
          {/* Backdrop — very subtle, click to close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-[2px]"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
            className="fixed right-0 top-0 bottom-0 z-[56] w-full max-w-[480px] bg-deep-space/95 border-l border-reactor-core/30 shadow-[-20px_0_60px_rgba(0,243,255,0.15)] flex flex-col"
          >
            {/* Header */}
            <div className="flex-shrink-0 border-b border-panel-border/40 px-5 py-4 bg-panel-glass/20">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={onClose}
                  className="flex items-center gap-1.5 text-text-secondary/70 hover:text-text-primary text-xs font-orbitron tracking-wider transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  BACK
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={togglePin}
                    title={isPinned ? "Unpin" : "Pin so it never decays"}
                    className="p-1.5 text-text-secondary/70 hover:text-reactor-core transition-colors"
                  >
                    {isPinned ? <Pin className="w-4 h-4 fill-reactor-core text-reactor-core" /> : <PinOff className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={onClose}
                    className="p-1.5 text-text-secondary/70 hover:text-text-primary transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-reactor-core/15 border border-reactor-core/30 flex items-center justify-center">
                  <Brain className="w-5 h-5 text-reactor-core" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-orbitron text-base text-text-primary tracking-wide truncate">
                      {entity.name}
                    </h2>
                    <span className="text-[10px] font-rajdhani uppercase tracking-widest text-reactor-core bg-reactor-core/10 px-1.5 py-0.5 rounded">
                      {entity.type}
                    </span>
                  </div>
                  {entity.description && (
                    <p className="text-xs text-text-secondary/80 font-rajdhani mt-1 line-clamp-2">
                      {entity.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-[10px] text-text-secondary/50 font-rajdhani">
                    <span className="uppercase tracking-wider">
                      {decayLabel(currentStrength)} · {Math.round(currentStrength * 100)}%
                    </span>
                    {isPinned && <span className="text-reactor-core">· PINNED</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* Thread */}
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto px-5 py-4 space-y-3 scroll-smooth"
            >
              {turns.length === 0 && !isLoading && (
                <div className="text-center py-12">
                  <div className="text-text-secondary/40 text-xs font-rajdhani mb-2">
                    Ask anything about this memory.
                  </div>
                  <div className="text-text-secondary/30 text-[10px] font-rajdhani">
                    e.g. &quot;Why did I decide this?&quot; or &quot;What was the context?&quot;
                  </div>
                </div>
              )}

              {turns.map((turn) => (
                <TurnBubble key={turn.id} turn={turn} />
              ))}

              {isLoading && (
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-reactor-core/15 border border-reactor-core/30 flex items-center justify-center flex-shrink-0">
                    <Brain className="w-3 h-3 text-reactor-core animate-pulse" />
                  </div>
                  <div className="bg-panel-glass/30 border-l-2 border-reactor-core/40 rounded-r-lg px-3 py-2 text-xs font-rajdhani text-text-secondary/60">
                    <span className="inline-block animate-pulse">reasoning...</span>
                  </div>
                </div>
              )}

              {error && (
                <div className="text-xs text-red-400/80 font-rajdhani border-l-2 border-red-400/40 pl-2">
                  {error}
                </div>
              )}
            </div>

            {/* Input */}
            <div className="flex-shrink-0 border-t border-panel-border/40 px-4 py-3 bg-panel-glass/10">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Ask about this memory..."
                  rows={2}
                  className="flex-1 bg-deep-space/60 border border-panel-border/60 focus:border-reactor-core/60 rounded-md px-3 py-2 text-xs font-rajdhani text-text-primary placeholder:text-text-secondary/30 resize-none outline-none transition-colors"
                />
                <button
                  onClick={ask}
                  disabled={!question.trim() || isLoading}
                  className="flex-shrink-0 p-2.5 rounded-md bg-reactor-core/20 border border-reactor-core/50 text-reactor-core hover:bg-reactor-core/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              <div className="text-[10px] text-text-secondary/30 font-rajdhani mt-1.5 px-1">
                Enter to send · Shift+Enter for newline · Esc to close
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function TurnBubble({ turn }: { turn: DiscussTurn }) {
  const isUser = turn.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex items-start gap-2 ${isUser ? "flex-row-reverse" : ""}`}
    >
      <div
        className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
          isUser
            ? "bg-reactor-core/20 border border-reactor-core/40"
            : "bg-accent-green/10 border border-accent-green/30"
        }`}
      >
        <span
          className={`text-[9px] font-orbitron ${
            isUser ? "text-reactor-core" : "text-accent-green"
          }`}
        >
          {isUser ? "U" : "J"}
        </span>
      </div>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-xs font-rajdhani whitespace-pre-wrap break-words ${
          isUser
            ? "bg-reactor-core/10 border-l-2 border-reactor-core text-text-primary"
            : "bg-panel-glass/30 border-l-2 border-accent-green text-text-secondary"
        }`}
        style={{ opacity: strengthToOpacity(1, false) }}
      >
        {turn.content}
      </div>
    </motion.div>
  );
}