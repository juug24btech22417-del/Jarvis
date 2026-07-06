"use client";

import { useEffect, useState, useRef, useLayoutEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, MessageSquare, MessageCircle, Pin, PinOff } from "lucide-react";
import HolographicPanel from "../ui/HolographicPanel";
import { useJarvisStore } from "@/store/jarvis.store";
import { animateStagger, addHoverScale, fadeUp, scaleIn } from "@/lib/animations/gsap";
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

export default function MemoryPanel({ onDiscuss }: MemoryPanelProps) {
  const [entities, setEntities] = useState<GraphEntity[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const { messages } = useJarvisStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Load graph entities (flat Memory rows are hidden in the panel — they live
  // in the database for the LLM retriever but aren't surfaced here).
  useEffect(() => {
    const load = async () => {
      try {
        const eRes = await fetch(`/api/memory/graph?action=search&q=&limit=50`);
        if (eRes.ok) {
          const data = await eRes.json();
          // searchEntities returns { id, name, type, description, strength, pinned }
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

  // GSAP animations
  useLayoutEffect(() => {
    if (contextRef.current) {
      fadeUp(contextRef.current, 0.2);
    }
  }, [entities]);

  // Add hover effects to entity cards
  useEffect(() => {
    if (!panelRef.current) return;
    const items = panelRef.current.querySelectorAll(".memory-card");
    items.forEach((item) => {
      addHoverScale(item as HTMLElement, 1.02);
    });
  }, [entities]);

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
      chatArea.scrollTop = chatArea.scrollHeight;
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

  return (
    <div
      ref={panelRef}
      className="fixed left-6 top-24 bottom-32 w-80 z-40 flex flex-col"
    >
      <HolographicPanel
        title="MEMORY BANK"
        direction="left"
        delay={0.3}
        className="h-full flex flex-col overflow-hidden"
      >
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Recent conversation context — explicit pixel height on the
              scroll container itself so scrolling works regardless of
              the flex chain above. */}
          <div className="flex items-center gap-2 mb-2 text-text-secondary text-xs font-orbitron tracking-wider flex-shrink-0">
            <MessageSquare className="w-3 h-3" />
            CURRENT CONVERSATION
          </div>
          <div
            ref={contextRef}
            className="relative flex-shrink-0"
            style={{ height: "320px" }}
          >
            <div
              className="space-y-2 overflow-y-auto overscroll-contain pr-1 w-full h-full min-w-0"
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
                <div className="bg-panel-glass/30 rounded-lg p-3 text-xs text-text-secondary/50 font-rajdhani border-l-2 border-reactor-core/30 break-words">
                  No messages yet. Say &quot;Hey JARVIS&quot; to start.
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`min-w-0 max-w-full overflow-hidden rounded-lg p-2 text-xs font-rajdhani border-l-2 break-words ${
                      msg.role === "user"
                        ? "bg-reactor-core/10 border-reactor-core text-text-primary"
                        : "bg-panel-glass/30 border-accent-green text-text-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1 flex-wrap">
                      <span
                        className={`text-[10px] font-bold ${
                          msg.role === "user"
                            ? "text-reactor-core"
                            : "text-accent-green"
                        }`}
                      >
                        {msg.role === "user" ? "YOU" : "JARVIS"}
                      </span>
                      <span className="text-[9px] text-text-secondary/30">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p
                      className={`text-text-primary/90 break-words [overflow-wrap:anywhere] whitespace-pre-wrap ${
                        msg.role === "user" ? "line-clamp-3" : ""
                      }`}
                    >
                      {msg.content}
                    </p>
                  </div>
                ))
              )}
            </div>
            {userScrolledUp && messages.length > 0 && (
              <button
                onClick={() => {
                  const chatArea = document.getElementById("chat-scroll-area");
                  if (chatArea) {
                    chatArea.scrollTop = chatArea.scrollHeight;
                    setUserScrolledUp(false);
                  }
                }}
                className="absolute bottom-2 right-3 z-10 px-2 py-1 text-[10px] font-orbitron tracking-wider text-reactor-core bg-panel-glass/80 hover:bg-reactor-core/20 border border-reactor-core/40 rounded shadow-glow transition-colors"
                title="Jump to latest message"
              >
                ↓ LATEST
              </button>
            )}
          </div>

          {/* Tier 1A: Graph entities — strength-aware, discussable */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 mt-3 pt-3 border-t border-panel-border/30 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-text-secondary text-xs font-orbitron tracking-wider">
                <Brain className="w-3 h-3" />
                KNOWLEDGE GRAPH
              </div>
              {archivedCount > 0 && (
                <button
                  onClick={() => setShowArchived((s) => !s)}
                  className="text-[10px] text-text-secondary/50 hover:text-reactor-core font-rajdhani transition-colors"
                >
                  {showArchived ? "hide" : "show"} {archivedCount} archived
                </button>
              )}
            </div>

            {visibleEntities.length === 0 ? (
              <div className="text-text-secondary/50 text-xs font-rajdhani text-center py-4">
                No memories stored yet
              </div>
            ) : (
              visibleEntities.map((entity) => (
                <EntityCard
                  key={entity.id}
                  entity={entity}
                  onDiscuss={onDiscuss}
                />
              ))
            )}
          </div>
        </div>
      </HolographicPanel>
    </div>
  );
}

function EntityCard({
  entity,
  onDiscuss,
}: {
  entity: GraphEntity;
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
    <div
      onClick={() => onDiscuss?.(entity)}
      className="memory-item memory-card bg-panel-glass/20 rounded-lg p-2.5 border border-panel-border hover:border-reactor-core/50 transition-colors cursor-pointer"
      style={{ opacity: strengthToOpacity(entity.strength, entity.archived) }}
      title={`${decayLabel(entity.strength)} · ${Math.round(entity.strength * 100)}% strength`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="text-xs text-text-primary font-rajdhani font-semibold truncate">
              {entity.name}
            </p>
            <span className="text-[9px] text-reactor-core bg-reactor-core/10 px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap">
              {entity.type}
            </span>
            {pinned && (
              <Pin className="w-2.5 h-2.5 fill-reactor-core text-reactor-core flex-shrink-0" />
            )}
          </div>
          {entity.description && (
            <p className="text-[10px] text-text-secondary/60 font-rajdhani mt-0.5 line-clamp-2">
              {entity.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={togglePin}
            title={pinned ? "Unpin" : "Pin"}
            className="p-0.5 text-text-secondary/40 hover:text-reactor-core transition-colors"
          >
            {pinned ? (
              <Pin className="w-3 h-3 fill-reactor-core text-reactor-core" />
            ) : (
              <PinOff className="w-3 h-3" />
            )}
          </button>
          {onDiscuss && (
            <span className="p-0.5 text-text-secondary/40">
              <MessageCircle className="w-3 h-3" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}