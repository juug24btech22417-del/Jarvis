"use client";

import { useEffect, useState, useRef, useLayoutEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, MessageSquare, X } from "lucide-react";
import HolographicPanel from "../ui/HolographicPanel";
import { useJarvisStore } from "@/store/jarvis.store";
import { animateStagger, addHoverScale, fadeUp, scaleIn } from "@/lib/animations/gsap";

interface MemoryItem {
  id: string;
  content: string;
  category: string;
  createdAt: Date;
}

export default function MemoryPanel() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const { messages } = useJarvisStore();
  const panelRef = useRef<HTMLDivElement>(null);
  const memoriesRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HTMLDivElement>(null);

  // Load memories from API
  useEffect(() => {
    const loadMemories = async () => {
      try {
        const response = await fetch("/api/memories");
        if (response.ok) {
          const data = await response.json();
          setMemories(data);
        }
      } catch (error) {
        console.error("Error loading memories:", error);
      }
    };
    loadMemories();
  }, []);

  // GSAP animations
  useLayoutEffect(() => {
    // Animate context section
    if (contextRef.current) {
      fadeUp(contextRef.current, 0.2);
    }

    // Stagger animate memory items
    if (memoriesRef.current) {
      const items = memoriesRef.current.querySelectorAll('.memory-item');
      animateStagger(items, 0.08);
    }
  }, [memories]);

  // Add hover effects to memory items
  useEffect(() => {
    if (memoriesRef.current) {
      const items = memoriesRef.current.querySelectorAll('.memory-card');
      items.forEach((item) => {
        addHoverScale(item as HTMLElement, 1.02);
      });
    }
  }, [memories]);

  // Auto-scroll to latest message
  useEffect(() => {
    const chatArea = document.getElementById("chat-scroll-area");
    if (chatArea) {
      chatArea.scrollTop = chatArea.scrollHeight;
    }
  }, [messages]);

  return (
    <div ref={panelRef} className="fixed left-6 top-24 bottom-32 w-80 z-40">
      <HolographicPanel
        title="MEMORY BANK"
        direction="left"
        delay={0.3}
        className="h-full flex flex-col"
      >
        <div ref={memoriesRef} className="flex-1 overflow-hidden flex flex-col space-y-3 min-h-0">
          {/* Recent conversation context */}
          <div ref={contextRef} className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2 text-text-secondary text-xs font-orbitron tracking-wider flex-shrink-0">
              <MessageSquare className="w-3 h-3" />
              CURRENT CONVERSATION
            </div>
            <div className="space-y-2 overflow-y-auto scroll-smooth flex-1 min-h-0" id="chat-scroll-area">
              {messages.length === 0 ? (
                <div className="bg-panel-glass/30 rounded-lg p-3 text-xs text-text-secondary/50 font-rajdhani border-l-2 border-reactor-core/30">
                  No messages yet. Say &quot;Hey JARVIS&quot; to start.
                </div>
              ) : (
                messages.slice(-20).map((msg, idx) => (
                  <div
                    key={msg.id}
                    className={`rounded-lg p-2 text-xs font-rajdhani border-l-2 ${
                      msg.role === "user"
                        ? "bg-reactor-core/10 border-reactor-core text-text-primary"
                        : "bg-panel-glass/30 border-accent-green text-text-secondary"
                    }`}
                  >
                    <div className="flex items-center gap-1 mb-1">
                      <span className={`text-[10px] font-bold ${msg.role === "user" ? "text-reactor-core" : "text-accent-green"}`}>
                        {msg.role === "user" ? "YOU" : "JARVIS"}
                      </span>
                      <span className="text-[9px] text-text-secondary/30">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className={`text-text-primary/90 break-words whitespace-pre-wrap ${msg.role === "user" ? "line-clamp-3" : ""}`}>
                      {msg.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Stored memories */}
          <div className="flex-shrink-0 max-h-[30%] overflow-y-auto space-y-2 mt-3 pt-3 border-t border-panel-border/30">
            <div className="flex items-center gap-2 mb-2 text-text-secondary text-xs font-orbitron tracking-wider">
              <Brain className="w-3 h-3" />
              STORED MEMORIES
            </div>

            {memories.length === 0 ? (
              <div className="text-text-secondary/50 text-xs font-rajdhani text-center py-4">
                No memories stored yet
              </div>
            ) : (
              memories.map((memory, index) => (
                <div
                  key={memory.id}
                  className="memory-item memory-card bg-panel-glass/20 rounded-lg p-3 border border-panel-border hover:border-reactor-core/50 transition-colors cursor-pointer"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-text-primary font-rajdhani line-clamp-3">
                      {memory.content}
                    </p>
                    <span className="text-[10px] text-reactor-core bg-reactor-core/10 px-2 py-0.5 rounded whitespace-nowrap">
                      {memory.category}
                    </span>
                  </div>
                  <p className="text-[10px] text-text-secondary/50 mt-2">
                    {new Date(memory.createdAt).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </HolographicPanel>
    </div>
  );
}
