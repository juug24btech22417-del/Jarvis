"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, MessageSquare, Pin, PinOff, Network, List, Sparkles } from "lucide-react";
import KnowledgeGraph from "./KnowledgeGraph";
import HolographicPanel from "../ui/HolographicPanel";
import { useJarvisStore } from "@/store/jarvis.store";
import { strengthToOpacity, decayLabel } from "@/lib/memory/decay";

interface GraphEntity {
  id: string;
  name: string;
  type: string;
  description: string | null;
  strength: number;
  pinned: boolean;
  archived: boolean;
}

interface MemoryPanelProps {
  onDiscuss?: (entity: GraphEntity) => void;
}

// ─── Shared spring — the panel's signature feel ──────────────────────
const spring = { type: "spring" as const, stiffness: 320, damping: 30 };
const softSpring = { type: "spring" as const, stiffness: 180, damping: 24 };

// Smooth text reveal: rises 8px, fades, and de-blurs — never snaps.
const textReveal = {
  initial: { opacity: 0, y: 8, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6, filter: "blur(3px)" },
  transition: { duration: 0.35, ease: [0.25, 0.1, 0.25, 1] as const },
};

export default function MemoryPanel({ onDiscuss }: MemoryPanelProps) {
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<"graph" | "list">("graph");
  const { messages } = useJarvisStore();
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Load graph entities (flat Memory rows are hidden in the panel — they live
  // in the database for the LLM retriever but aren't surfaced here).
  useEffect(() => {
    const load = async () => {
      try {
        const eRes = await fetch(`/api/memory/graph?action=search&q=&limit=50`);
        if (eRes.ok) {
          const data = await eRes.json();
          setEntities(data.results || []);
        }
      } catch (error) {
        console.error("Error loading memory panel data:", error);
      }
    };
    load();

    // Refresh every 30s so newly extracted memories show up.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Manual scroll: respect the user's position. Only auto-scroll to the
  // bottom when a new message arrives AND the user is already near the
  // bottom. If they've scrolled up to read older messages, leave them
  // there and surface a "jump to latest" button instead.
  useEffect(() => {
    const chatArea = document.getElementById("chat-scroll-area");
    if (!chatArea || messages.length === 0) return;

    const isNearBottom =
      chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 80;

    if (isNearBottom) {
      chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: "smooth" });
      setUserScrolledUp(false);
    } else {
      setUserScrolledUp(true);
    }
  }, [messages]);

  const visibleEntities = useMemo(
    () => entities.filter((e) => showArchived || !e.archived),
    [entities, showArchived]
  );

  const archivedCount = useMemo(
    () => entities.filter((e) => e.archived).length,
    [entities]
  );

  const pinnedCount = useMemo(
    () => entities.filter((e) => e.pinned && !e.archived).length,
    [entities]
  );

  return (
    <div className="fixed left-6 top-24 bottom-32 w-80 z-40 flex flex-col">
      <HolographicPanel
        title="MEMORY BANK"
        direction="left"
        delay={0.3}
        className="h-full flex flex-col overflow-hidden"
      >
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* ─── Section: Current Conversation ─── */}
          <div className="flex items-center justify-between mb-2 flex-shrink-0 px-0.5">
            <div className="flex items-center gap-1.5 text-text-secondary/80 text-[10px] font-orbitron tracking-[0.18em]">
              <MessageSquare className="w-3 h-3 text-reactor-core/70" />
              CONVERSATION
              <span className="text-text-secondary/30 tracking-normal">
                {messages.length > 0 && `· ${messages.length}`}
              </span>
            </div>
          </div>

          <div className="relative flex-shrink-0" style={{ height: "300px" }}>
            <div
              className="space-y-1.5 overflow-y-auto overscroll-contain pr-1 w-full h-full min-w-0 custom-scrollbar"
              id="chat-scroll-area"
              style={{ scrollbarGutter: "stable" }}
              onScroll={(e) => {
                const el = e.currentTarget;
                const nearBottom =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                setUserScrolledUp(!nearBottom);
              }}
            >
              {messages.length === 0 ? (
                <motion.div
                  {...textReveal}
                  className="rounded-2xl rounded-tl-md bg-panel-glass/25 border border-panel-border/50 p-3.5 text-xs text-text-secondary/50 font-rajdhani leading-relaxed"
                >
                  <div className="flex items-center gap-1.5 text-text-secondary/60 mb-0.5">
                    <Sparkles className="w-3 h-3 text-reactor-core/50" />
                    <span className="text-[10px] font-orbitron tracking-wider uppercase">
                      Awaiting contact
                    </span>
                  </div>
                  Say &quot;Hey JARVIS&quot; to begin. Everything we discuss is
                  remembered here.
                </motion.div>
              ) : (
                <AnimatePresence initial={false}>
                  {messages.map((msg) => {
                    const isUser = msg.role === "user";
                    return (
                      <motion.div
                        key={msg.id}
                        layout
                        initial={{ opacity: 0, y: 12, scale: 0.97, filter: "blur(3px)" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={spring}
                        className={`min-w-0 max-w-full overflow-hidden px-3 py-2 text-xs font-rajdhani break-words ${
                          isUser
                            ? "rounded-2xl rounded-tl-md bg-reactor-core/[0.08] border border-reactor-core/20 text-text-primary shadow-[0_0_12px_rgba(0,212,255,0.06)]"
                            : "rounded-2xl rounded-tl-md bg-panel-glass/30 border border-accent-green/15 text-text-secondary"
                        }`}
                      >
                        <div className="flex items-baseline gap-1.5 mb-0.5">
                          <motion.span
                            className={`text-[9px] font-orbitron font-bold tracking-[0.15em] ${
                              isUser ? "text-reactor-core" : "text-accent-green"
                            }`}
                          >
                            {isUser ? "YOU" : "JARVIS"}
                          </motion.span>
                          <span className="text-[8px] text-text-secondary/25 font-rajdhani">
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p
                          className={`text-text-primary/90 break-words [overflow-wrap:anywhere] whitespace-pre-wrap leading-relaxed ${
                            isUser ? "line-clamp-3" : ""
                          }`}
                        >
                          {msg.content}
                        </p>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              )}
            </div>

            {/* Jump-to-latest pill */}
            <AnimatePresence>
              {userScrolledUp && messages.length > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.9 }}
                  transition={spring}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    const chatArea = document.getElementById("chat-scroll-area");
                    if (chatArea) {
                      chatArea.scrollTo({
                        top: chatArea.scrollHeight,
                        behavior: "smooth",
                      });
                      setUserScrolledUp(false);
                    }
                  }}
                  className="absolute bottom-2 right-3 z-10 px-2.5 py-1 text-[9px] font-orbitron tracking-wider text-reactor-core bg-deep-space/90 hover:bg-reactor-core/15 border border-reactor-core/40 rounded-full shadow-glow backdrop-blur-md transition-colors"
                  title="Jump to latest message"
                >
                  ↓ LATEST
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* ─── Section: Knowledge Graph ─── */}
          <div className="flex-1 min-h-0 overflow-y-auto mt-3 pt-3 border-t border-panel-border/30 min-w-0 custom-scrollbar">
            {/* Header + Apple-style segmented control */}
            <div className="flex items-center justify-between mb-2.5 px-0.5">
              <div className="flex items-center gap-1.5 text-text-secondary/80 text-[10px] font-orbitron tracking-[0.18em]">
                <Brain className="w-3 h-3 text-reactor-core/70" />
                KNOWLEDGE
                {pinnedCount > 0 && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={spring}
                    className="text-reactor-core/60 tracking-normal"
                  >
                    · {pinnedCount}★
                  </motion.span>
                )}
              </div>

              {/* Segmented view switcher */}
              <div className="flex items-center p-0.5 rounded-full bg-black/30 border border-panel-border/40">
                {(["graph", "list"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className="relative px-2 py-0.5 rounded-full"
                    title={v === "graph" ? "Graph view" : "List view"}
                  >
                    {view === v && (
                      <motion.span
                        layoutId="memory-view-pill"
                        className="absolute inset-0 rounded-full bg-reactor-core/15 border border-reactor-core/30"
                        transition={softSpring}
                      />
                    )}
                    <span
                      className={`relative z-10 flex items-center transition-colors duration-200 ${
                        view === v ? "text-reactor-core" : "text-text-secondary/40 hover:text-text-secondary/70"
                      }`}
                    >
                      {v === "graph" ? (
                        <Network className="w-3 h-3" />
                      ) : (
                        <List className="w-3 h-3" />
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Archived toggle — whisper-quiet */}
            {archivedCount > 0 && (
              <div className="mb-2 px-0.5">
                <button
                  onClick={() => setShowArchived((s) => !s)}
                  className="text-[9px] text-text-secondary/35 hover:text-reactor-core/80 font-rajdhani tracking-wide transition-colors duration-200"
                >
                  {showArchived ? "Hiding" : "Showing"} {archivedCount} archived
                  {showArchived ? " — click to hide" : ""}
                </button>
              </div>
            )}

            <div className="relative">
              <AnimatePresence mode="wait" initial={false}>
                {visibleEntities.length === 0 ? (
                  <motion.div
                    key="empty"
                    {...textReveal}
                    className="text-text-secondary/40 text-xs font-rajdhani text-center py-6 leading-relaxed"
                  >
                    <Brain className="w-5 h-5 mx-auto mb-2 text-text-secondary/20" />
                    No memories stored yet.
                    <br />
                    They form as we talk, Boss.
                  </motion.div>
                ) : view === "graph" ? (
                  <motion.div
                    key="graph"
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.28, ease: "easeOut" }}
                    className="rounded-2xl border border-panel-border/30 bg-black/20 overflow-hidden"
                  >
                    <KnowledgeGraph
                      entities={visibleEntities}
                      width={280}
                      height={280}
                      onNodeClick={onDiscuss}
                    />
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-1.5"
                  >
                    {visibleEntities.map((entity, i) => (
                      <EntityCard
                        key={entity.id}
                        entity={entity}
                        index={i}
                        onDiscuss={onDiscuss}
                      />
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </HolographicPanel>
    </div>
  );
}

// ─── Entity Card ─────────────────────────────────────────────────────
function EntityCard({
  entity,
  index,
  onDiscuss,
}: {
  entity: GraphEntity;
  index: number;
  onDiscuss?: (entity: GraphEntity) => void;
}) {
  const [pinned, setPinned] = useState(entity.pinned);

  const togglePin = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !pinned;
    setPinned(next);
    try {
      await fetch("/api/memory/graph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pin", id: entity.id, pinned: next }),
      });
    } catch {
      setPinned(!next);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
      animate={{ opacity: strengthToOpacity(entity.strength, entity.archived), y: 0, filter: "blur(0px)" }}
      transition={{ ...spring, delay: Math.min(index * 0.04, 0.3) }}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.99 }}
      onClick={() => onDiscuss?.(entity)}
      className="memory-item group rounded-xl bg-panel-glass/20 hover:bg-panel-glass/40 border border-panel-border/50 hover:border-reactor-core/40 px-2.5 py-2 cursor-pointer transition-colors duration-300 relative overflow-hidden"
      title={`${decayLabel(entity.strength)} · ${Math.round(entity.strength * 100)}% strength`}
    >
      {/* Hover sheen */}
      <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-reactor-core/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs text-text-primary font-rajdhani font-semibold truncate">
              {entity.name}
            </p>
            <span className="text-[8px] text-reactor-core/80 bg-reactor-core/10 border border-reactor-core/15 px-1.5 py-px rounded-full uppercase tracking-[0.12em] whitespace-nowrap">
              {entity.type}
            </span>
            <AnimatePresence>
              {pinned && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.5, rotate: -30 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={spring}
                >
                  <Pin className="w-2.5 h-2.5 fill-reactor-core text-reactor-core flex-shrink-0" />
                </motion.span>
              )}
            </AnimatePresence>
          </div>
          {entity.description && (
            <p className="text-[10px] text-text-secondary/55 font-rajdhani mt-0.5 line-clamp-2 leading-relaxed">
              {entity.description}
            </p>
          )}
          {/* Strength hairline */}
          <div className="mt-1.5 h-px bg-panel-border/30 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${Math.round(entity.strength * 100)}%` }}
              transition={{ ...softSpring, delay: 0.2 + Math.min(index * 0.04, 0.3) }}
              className="h-full bg-gradient-to-r from-reactor-core/50 to-reactor-core/20"
            />
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-300">
          <motion.button
            whileTap={{ scale: 0.8 }}
            onClick={togglePin}
            title={pinned ? "Unpin" : "Pin"}
            className="p-1 text-text-secondary/50 hover:text-reactor-core transition-colors"
          >
            {pinned ? (
              <Pin className="w-3 h-3 fill-reactor-core text-reactor-core" />
            ) : (
              <PinOff className="w-3 h-3" />
            )}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
