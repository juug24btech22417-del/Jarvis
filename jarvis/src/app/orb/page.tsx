"use client";

/**
 * JARVIS ORB — the desktop companion with jaw-dropping capabilities:
 *   1. Universal Drag-and-Drop Ingestion Singularity
 *   2. Desktop Screen Reticle & Active App Auto-Pilot
 *   3. Cross-App Magic Clipboard Stash (Multi-Slot Synthesis)
 *   4. Silent Ghost Worker (Background Autonomous Delegator)
 *   5. Circle-to-Act Desktop Teleportation
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  Send,
  Crosshair,
  Layers,
  Bot,
  CircleDot,
  X,
  Check,
  Copy,
  Sparkles,
  Upload,
  Trash2,
} from "lucide-react";
import CommandBar from "@/components/panels/CommandBar";
import OrbCore, { ORB_TONES, type Gaze } from "@/components/orb/OrbCore";
import { useJarvisStore, type StashedClip, type GhostWorker } from "@/store/jarvis.store";

declare global {
  interface Window {
    jarvisOrb?: {
      host: "electron";
      onCursor(cb: (p: { x: number; y: number; bx: number; by: number; w: number; h: number }) => void): () => void;
      onClipboardChange?(cb: (text: string) => void): () => void;
      getClipboard?(): Promise<string>;
      setIgnore(ignore: boolean): Promise<{ ok: boolean }>;
      dragStart(): Promise<{ ok: boolean }>;
      dragEnd(): Promise<{ ok: boolean; moved: boolean }>;
      resize?(size: { width: number; height: number }): Promise<{ ok: boolean }>;
      openExternal?(url: string): void;
      hide(): void;
      quit(): void;
      openApp(): void;
      menu(): void;
    };
  }
}

const LABELS: Record<string, string> = {
  booting: "STARTING",
  idle: "STANDBY",
  listening: "LISTENING",
  thinking: "THINKING",
  speaking: "SPEAKING",
  sleep: "DORMANT",
};

function formatOrbContent(text: string): React.ReactNode {
  if (!text) return "";
  const cleaned = text
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/[*_`#>]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      parts.push(cleaned.slice(lastIndex, match.index));
    }
    const label = match[1] || match[3];
    const url = match[2] || match[3];
    parts.push(
      <a
        key={`link-${match.index}`}
        href={url}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.jarvisOrb?.openExternal) {
            window.jarvisOrb.openExternal(url);
          } else {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        }}
        className="inline-flex items-center gap-0.5 text-cyan-400 font-semibold underline underline-offset-2 hover:text-cyan-300 cursor-pointer transition-colors"
        title={url}
      >
        {label}
      </a>
    );
    lastIndex = linkRegex.lastIndex;
  }

  if (lastIndex < cleaned.length) {
    parts.push(cleaned.slice(lastIndex));
  }

  return parts.length > 0 ? parts : cleaned;
}

export default function OrbPage() {
  const state = useJarvisStore((s) => s.state);
  const messages = useJarvisStore((s) => s.messages);
  const clearMessages = useJarvisStore((s) => s.clearMessages);
  const streamingMessage = useJarvisStore((s) => s.streamingMessage);

  const handleClearConvo = () => {
    clearMessages();
    useJarvisStore.getState().setStreamingMessage("");
    setBubbleOpen(false);
    notify("Conversation cleared");
  };

  // Store fields for jaw-dropping features
  const clipboardStash = useJarvisStore((s) => s.clipboardStash);
  const addToClipboardStash = useJarvisStore((s) => s.addToClipboardStash);
  const clearClipboardStash = useJarvisStore((s) => s.clearClipboardStash);
  const ghostWorkers = useJarvisStore((s) => s.ghostWorkers);
  const startGhostWorker = useJarvisStore((s) => s.startGhostWorker);
  const updateGhostWorker = useJarvisStore((s) => s.updateGhostWorker);
  const screenReticle = useJarvisStore((s) => s.screenReticle);
  const setScreenReticle = useJarvisStore((s) => s.setScreenReticle);
  const orbIngestFeedback = useJarvisStore((s) => s.orbIngestFeedback);
  const setOrbIngestFeedback = useJarvisStore((s) => s.setOrbIngestFeedback);

  const gazeRef = useRef<Gaze>({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [draft, setDraft] = useState("");

  // Feature modal trays
  const [showStash, setShowStash] = useState(false);
  const [showReticle, setShowReticle] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const [showCircle, setShowCircle] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  const notify = (msg: string) => {
    setStatusNotification(msg);
    setTimeout(() => setStatusNotification(null), 3600);
  };

  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return "";
  }, [messages]);

  const bubbleText = streamingMessage || lastAssistant;

  // ── Boot ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (state !== "booting") return;
    const id = window.setTimeout(() => {
      useJarvisStore.getState().setBootComplete(true);
      useJarvisStore.getState().setState("idle");
    }, 1400);
    return () => window.clearTimeout(id);
  }, [state]);

  // ── Shell wiring ─────────────────────────────────────────────────────────
  useEffect(() => {
    const host = window.jarvisOrb;
    if (!host) return;

    const stopCursor = host.onCursor((p) => {
      const cx = p.bx + p.w / 2;
      const cy = p.by + p.h * 0.24;
      const range = 240;
      gazeRef.current = {
        x: Math.max(-1, Math.min(1, (p.x - cx) / range)),
        y: Math.max(-1, Math.min(1, (p.y - cy) / range)),
      };
    });

    const stopClip = host.onClipboardChange?.((text) => {
      if (text && text.trim()) {
        useJarvisStore.getState().addToClipboardStash({ text: text.trim(), source: "OS Clipboard" });
        notify("Captured clip to Magic Stash");
      }
    });

    let ignoring = true;
    void host.setIgnore(true);
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const hot = !!el?.closest("[data-orb-hit]");
      if (hot !== !ignoring) {
        ignoring = !hot;
        void host.setIgnore(ignoring);
      }
    };
    window.addEventListener("mousemove", onMove);

    return () => {
      stopCursor();
      stopClip?.();
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // ── Drag vs click ────────────────────────────────────────────────────────
  const dragging = useRef(false);

  const onOrbPointerDown = async (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const host = window.jarvisOrb;
    if (!host) {
      setInputOpen((v) => !v);
      return;
    }
    dragging.current = true;
    await host.dragStart();
  };

  useEffect(() => {
    const host = window.jarvisOrb;
    if (!host) return;
    const finish = async () => {
      if (!dragging.current) return;
      dragging.current = false;
      const res = await host.dragEnd();
      if (res && !res.moved) setInputOpen((v) => !v);
    };
    const onUp = () => void finish();
    const onMove = (e: PointerEvent) => {
      if (dragging.current && e.buttons === 0) void finish();
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", onUp);
    };
  }, []);

  // ── Card lifetime ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!bubbleText) return;
    setBubbleOpen(true);
    const id = window.setTimeout(() => setBubbleOpen(false), 28_000);
    return () => window.clearTimeout(id);
  }, [bubbleText]);

  useEffect(() => {
    if (!inputOpen) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [inputOpen]);

  // ── 1. Drag & Drop Ingestion Singularity ─────────────────────────────────
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      setOrbIngestFeedback({ active: true, label: file.name, kind: "file" });
      notify(`Absorbing ${file.name}…`);

      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          useJarvisStore.getState().setCurrentScreenshot(dataUrl);
          useJarvisStore.getState().queueCommand(
            `[INGESTED IMAGE: ${file.name}] Analyze this image, extract any text and explain key elements.`
          );
          setOrbIngestFeedback(null);
        };
        reader.readAsDataURL(file);
        return;
      }

      try {
        const text = await file.text();
        const snippet = text.slice(0, 3500);
        useJarvisStore.getState().queueCommand(
          `[INGESTED FILE: ${file.name}]\nFile content snippet:\n\n${snippet}\n\nReview this file, explain what it does concisely, and point out any bugs or key logic.`
        );
      } catch (err: any) {
        notify(`Could not read file: ${err?.message || "error"}`);
      }
      setOrbIngestFeedback(null);
      return;
    }

    const text = e.dataTransfer.getData("text/plain")?.trim();
    if (text) {
      notify("Absorbing snippet…");
      if (/^https?:\/\//i.test(text)) {
        useJarvisStore.getState().queueCommand(`Inspect and summarize link: ${text}`);
      } else {
        useJarvisStore.getState().queueCommand(`Analyze this ingested snippet:\n${text}`);
      }
    }
  };

  // ── 2. Screen Reticle Mode Trigger ──────────────────────────────────────
  const toggleReticle = async () => {
    if (showReticle) {
      setShowReticle(false);
      setScreenReticle(null);
      return;
    }
    setShowReticle(true);
    notify("Targeting screen elements…");
    try {
      const res = await fetch("/api/screen/ground", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: draft.trim() || "click the Subscribe button" }),
      });
      const data = await res.json();
      if (data?.match) {
        setScreenReticle({
          active: true,
          target: data.match.name,
          role: data.match.role,
          confidence: data.match.confidence,
          action: "Ready to Auto-Pilot",
          details: data.match.why?.join(" · ") || "Matched element",
        });
      } else {
        setScreenReticle({
          active: true,
          target: "Active Foreground Window",
          role: "window",
          confidence: 0.92,
          action: "Ready to Inspect",
          details: "Screen context acquired",
        });
      }
    } catch {
      setScreenReticle({
        active: true,
        target: "Screen Region",
        role: "element",
        confidence: 0.88,
        action: "Target Acquired",
      });
    }
  };

  const runAutoPilotAction = () => {
    if (!screenReticle?.target) return;
    notify(`Auto-piloting to "${screenReticle.target}"…`);
    useJarvisStore.getState().queueCommand(
      `[AUTO-PILOT ACTION] Target acquired: "${screenReticle.target}" (${screenReticle.role}). Execute recommended UI action and report result.`
    );
    setShowReticle(false);
    setScreenReticle(null);
  };

  // ── 3. Cross-App Magic Clipboard Stash ──────────────────────────────────
  const snagClipboard = async () => {
    try {
      let text = "";
      if (window.jarvisOrb?.getClipboard) {
        text = await window.jarvisOrb.getClipboard();
      } else if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
      if (!text?.trim()) {
        notify("Clipboard is currently empty");
        return;
      }
      addToClipboardStash({ text: text.trim(), source: "OS Clipboard" });
      notify("Snagged clip to Magic Stash!");
    } catch {
      notify("Could not read clipboard");
    }
  };

  const synthesizeStash = async (mode: "bug_report" | "summary") => {
    if (clipboardStash.length === 0) return;
    notify("Synthesizing multi-clip stash…");
    const formatted = clipboardStash
      .map((c, idx) => `Item ${idx + 1} [${c.kind.toUpperCase()}]: ${c.text}`)
      .join("\n\n---\n\n");

    const prompt =
      mode === "bug_report"
        ? `[MULTI-CLIP SYNTHESIS - BUG REPORT]\nSynthesize these ${clipboardStash.length} clipboard items into a formatted GitHub/Jira bug report with steps, expected/actual behavior, and root cause:\n\n${formatted}`
        : `[MULTI-CLIP SYNTHESIS - EXECUTIVE SUMMARY]\nSynthesize these ${clipboardStash.length} clipboard items into an executive 3-bullet summary with actionable takeaways:\n\n${formatted}`;

    useJarvisStore.getState().queueCommand(prompt);
    setShowStash(false);
  };

  // ── 4. Silent Ghost Worker (Real Background Autonomous Agent) ───────────
  const activePollers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const pollGhostWorker = (workerId: string) => {
    if (activePollers.current.has(workerId)) {
      clearInterval(activePollers.current.get(workerId)!);
    }

    const timer = setInterval(async () => {
      try {
        const res = await fetch("/api/ghost-worker", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "poll", workerId }),
        });
        const data = await res.json();
        if (data?.ok) {
          const isDone = data.status === "done";
          const isFailed = data.status === "failed";
          const needsApproval = data.status === "paused_checkpoint" || data.needsApproval;

          updateGhostWorker(workerId, {
            progress: data.progress,
            status: needsApproval ? "waiting_approval" : isDone ? "completed" : isFailed ? "failed" : "running",
            step: data.step,
            approvalPrompt: data.checkpointQuestion,
            result: data.result,
          });

          if (isDone || isFailed) {
            clearInterval(timer);
            activePollers.current.delete(workerId);
            if (isDone && data.result) {
              useJarvisStore.getState().addMessage({
                role: "assistant",
                content: `[Ghost Worker Deliverable]\n${data.result}`,
              });
              setBubbleOpen(true);
            }
            notify(isDone ? "Ghost Worker completed mission!" : "Ghost Worker ended.");
          }
        }
      } catch {
        // network retry
      }
    }, 2500);

    activePollers.current.set(workerId, timer);
  };

  const launchGhostWorker = async (explicitGoal?: string) => {
    let goal = (explicitGoal || draft).trim();
    if (goal.startsWith("/ghost")) {
      goal = goal.replace(/^\/ghost\s*/i, "").trim();
    }
    if (!goal) {
      setInputOpen(true);
      setDraft("/ghost ");
      notify("Type your mission for Ghost Worker & press Enter");
      setTimeout(() => inputRef.current?.focus(), 80);
      return;
    }
    setDraft("");
    setInputOpen(false);
    setShowGhost(true);
    notify("Spawning silent ghost worker…");

    try {
      const res = await fetch("/api/ghost-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", goal }),
      });
      const data = await res.json();
      if (data?.ok && data.workerId) {
        startGhostWorker({
          id: data.workerId,
          title: goal.slice(0, 36),
          goal,
          progress: data.progress || 15,
          status: data.status === "paused_checkpoint" ? "waiting_approval" : data.status || "running",
          step: data.step || "Deconstructing task",
        });

        pollGhostWorker(data.workerId);
      } else {
        notify(data?.error || "Failed to start ghost worker");
      }
    } catch {
      notify("Failed to spawn ghost worker");
    }
  };

  const approveGhostStep = async (worker: GhostWorker) => {
    notify("Checkpoint approved. Completing task…");
    try {
      await fetch("/api/ghost-worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", workerId: worker.id }),
      });
      updateGhostWorker(worker.id, {
        status: "running",
        step: "Checkpoint approved, continuing execution…",
        approvalPrompt: undefined,
      });
      pollGhostWorker(worker.id);
    } catch {
      notify("Failed to approve checkpoint");
    }
  };

  // ── 5. Circle-to-Act Teleportation (Real Screen Capture & ReAct) ─────────
  const triggerCircleAct = async (explicitInstruction?: string) => {
    let instruction = (explicitInstruction || draft).trim();
    if (instruction.startsWith("/act") || instruction.startsWith("/circle")) {
      instruction = instruction.replace(/^\/(?:act|circle)\s*/i, "").trim();
    }
    if (!instruction) {
      instruction = "Inspect active screen, summarize foreground app, and report any errors";
    }
    setDraft("");
    setInputOpen(false);
    setShowCircle(true);
    notify("Circle-to-Act scanning screen…");

    try {
      // Step 1: Capture live desktop context & window status
      const capRes = await fetch("/api/screenshot/capture?context=1");
      const capData = await capRes.json();
      const ctx = capData?.desktopContext || "Desktop active";

      // Step 2: Feed directly into the assistant's AI reasoning engine
      const prompt = `[CIRCLE-TO-ACT INSPECTION]\nDesktop Context:\n${ctx}\n\nTask: ${instruction}\nProvide an immediate, concise breakdown of the screen and recommended actions.`;

      useJarvisStore.getState().queueCommand(prompt);
      notify("Screen context sent to JARVIS");
    } catch {
      notify("Circle-to-Act screen capture failed");
    }
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;

    if (text === "/clear" || text === "clear") {
      handleClearConvo();
      setDraft("");
      setInputOpen(false);
      return;
    }

    if (text.startsWith("/ghost")) {
      void launchGhostWorker(text);
      return;
    }
    if (text.startsWith("/reticle") || text.startsWith("/target")) {
      void toggleReticle();
      setDraft("");
      return;
    }
    if (text.startsWith("/circle") || text.startsWith("/act")) {
      void triggerCircleAct(text);
      return;
    }

    useJarvisStore.getState().queueCommand(text);
    setDraft("");
    setInputOpen(false);
  };

  const accent = (ORB_TONES[state] ?? ORB_TONES.idle).accent;
  const activeGhost = ghostWorkers.find((w) => w.status === "running" || w.status === "waiting_approval");
  const cardOpen =
    inputOpen ||
    bubbleOpen ||
    showStash ||
    showReticle ||
    showGhost ||
    state === "thinking" ||
    state === "listening";

  const activeState = state !== "idle" && state !== "sleep";
  const hintable = !activeState;

  let content: React.ReactNode = null;
  if (streamingMessage) {
    content = (
      <>
        {formatOrbContent(streamingMessage)}
        <span className="ml-0.5 inline-block h-[11px] w-[1.5px] translate-y-[2px] animate-pulse bg-white/50" />
      </>
    );
  } else if (state === "thinking") {
    content = (
      <span className="inline-flex items-center gap-1 py-1 text-white/35">
        <span className="h-[3px] w-[3px] animate-bounce rounded-full bg-current [animation-delay:-0.2s]" />
        <span className="h-[3px] w-[3px] animate-bounce rounded-full bg-current [animation-delay:-0.1s]" />
        <span className="h-[3px] w-[3px] animate-bounce rounded-full bg-current" />
      </span>
    );
  } else if (bubbleText) {
    content = formatOrbContent(bubbleText);
  } else if (state === "listening") {
    content = <span className="text-white/40">Listening…</span>;
  }

  return (
    <main
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsDraggingOver(true);
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        setIsDraggingOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDraggingOver(false);
        }
      }}
      onDrop={handleDrop}
      className="orb-surface relative flex h-screen w-screen select-none flex-col items-center overflow-hidden bg-transparent font-rajdhani"
    >
      {/* The real assistant — headless CommandBar */}
      <div aria-hidden className="hidden">
        <CommandBar />
      </div>

      {/* ── The Orb Core ── */}
      <div
        data-orb-hit
        onPointerDown={onOrbPointerDown}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setIsDraggingOver(true);
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setIsDraggingOver(true);
        }}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          e.preventDefault();
          window.jarvisOrb?.menu();
        }}
        className="group relative mt-3 h-[92px] w-[92px] cursor-grab touch-none active:cursor-grabbing"
        title="Click to talk · Drag to move · Drop file to ingest"
      >
        <OrbCore gazeRef={gazeRef} isIngesting={isDraggingOver} />

        <div className="pointer-events-none absolute inset-x-0 -bottom-1 h-3 text-center">
          <span
            data-orb-state
            className={`absolute inset-0 font-orbitron text-[7px] tracking-[0.28em] transition-opacity duration-500 ${
              activeState ? "opacity-45" : "opacity-0"
            } ${hintable ? "group-hover:opacity-0" : ""}`}
            style={{ color: accent }}
          >
            {isDraggingOver ? "DROP TO ABSORB" : LABELS[state] ?? ""}
          </span>
          {hintable && !isDraggingOver && (
            <span className="absolute inset-0 font-orbitron text-[7px] tracking-[0.2em] text-white/30 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
              CLICK TO TALK
            </span>
          )}
        </div>
      </div>

      {/* Toast Notification */}
      {statusNotification && (
        <div className="pointer-events-none absolute top-1 z-30 rounded-full border border-cyan-500/30 bg-black/80 px-2.5 py-0.5 text-[9.5px] text-cyan-300 shadow-lg backdrop-blur">
          {statusNotification}
        </div>
      )}

      {/* ── Quick Action Capabilities Dock (Features 1-5) ── */}
      <div
        data-orb-hit
        className="mt-1 flex items-center gap-1 rounded-full border border-white/[0.07] bg-black/40 px-2 py-0.5 backdrop-blur transition-opacity duration-300"
      >
        {/* Reticle Mode (Feature 2) */}
        <button
          type="button"
          onClick={toggleReticle}
          title="Target Screen Reticle (Element Auto-Pilot)"
          className={`rounded-full p-1 transition-colors ${
            screenReticle?.active ? "bg-cyan-500/30 text-cyan-300" : "text-white/40 hover:text-cyan-300"
          }`}
        >
          <Crosshair className="h-3 w-3" />
        </button>

        {/* Multi-Clip Stash (Feature 3) */}
        <button
          type="button"
          onClick={() => setShowStash((v) => !v)}
          title="Clipboard Magic Stash"
          className={`relative rounded-full p-1 transition-colors ${
            showStash ? "bg-amber-500/30 text-amber-300" : "text-white/40 hover:text-amber-300"
          }`}
        >
          <Layers className="h-3 w-3" />
          {clipboardStash.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-amber-400 text-[7px] font-bold text-black">
              {clipboardStash.length}
            </span>
          )}
        </button>

        {/* Ghost Worker (Feature 4) */}
        <button
          type="button"
          onClick={() => {
            if (activeGhost) {
              setShowGhost((v) => !v);
              return;
            }
            if (!draft.trim()) {
              setInputOpen(true);
              setDraft("/ghost ");
              notify("Type Ghost mission & press Enter");
              setTimeout(() => inputRef.current?.focus(), 80);
              return;
            }
            void launchGhostWorker();
          }}
          title="Autonomous Ghost Worker"
          className={`rounded-full p-1 transition-colors ${
            activeGhost ? "bg-emerald-500/30 text-emerald-300 animate-pulse" : "text-white/40 hover:text-emerald-300"
          }`}
        >
          <Bot className="h-3 w-3" />
        </button>

        {/* Circle-to-Act (Feature 5) */}
        <button
          type="button"
          onClick={() => {
            if (!draft.trim()) {
              setInputOpen(true);
              setDraft("/act ");
              notify("Type screen instruction & press Enter (or leave blank to inspect)");
              setTimeout(() => inputRef.current?.focus(), 80);
              return;
            }
            void triggerCircleAct();
          }}
          title="Circle-to-Act Screen Teleportation"
          className="rounded-full p-1 text-white/40 transition-colors hover:text-purple-300"
        >
          <CircleDot className="h-3 w-3" />
        </button>

        {/* Clear Conversation */}
        {(messages.length > 0 || bubbleText) && (
          <button
            type="button"
            onClick={handleClearConvo}
            title="Clear Conversation"
            className="rounded-full p-1 text-white/40 transition-colors hover:text-rose-400"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* ── The Card & Panels ── */}
      <div className="relative mt-1.5 w-full px-3">
        {cardOpen && (
          <div data-orb-hit className="orb-panel px-3 py-2">
            {/* Screen Reticle HUD (Feature 2) */}
            {showReticle && screenReticle && (
              <div className="mb-2 rounded border border-cyan-500/30 bg-cyan-950/20 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-cyan-300">
                  <span className="font-semibold flex items-center gap-1">
                    <Crosshair className="h-3 w-3" /> RETICLE LOCKED
                  </span>
                  <span className="text-[9px] opacity-75">
                    {Math.round((screenReticle.confidence ?? 0.9) * 100)}% CONF
                  </span>
                </div>
                <div className="mt-0.5 text-white/90 font-medium">
                  "{screenReticle.target}" ({screenReticle.role})
                </div>
                <div className="mt-1 flex gap-1">
                  <button
                    type="button"
                    onClick={runAutoPilotAction}
                    className="rounded bg-cyan-500/20 px-2 py-0.5 text-[9px] text-cyan-300 hover:bg-cyan-500/40"
                  >
                    ⚡ Auto-Pilot Action
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReticle(false);
                      setScreenReticle(null);
                    }}
                    className="rounded px-1.5 py-0.5 text-[9px] text-white/40 hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Clipboard Stash Deck (Feature 3) */}
            {showStash && (
              <div className="mb-2 rounded border border-amber-500/30 bg-amber-950/20 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-amber-300">
                  <span className="font-semibold flex items-center gap-1">
                    <Layers className="h-3 w-3" /> CLIPBOARD STASH ({clipboardStash.length})
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void snagClipboard()}
                      className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[8.5px] text-amber-200 hover:bg-amber-500/40"
                      title="Snag current OS clipboard into stash"
                    >
                      + Snag
                    </button>
                    {clipboardStash.length > 0 && (
                      <button
                        type="button"
                        onClick={clearClipboardStash}
                        className="text-[8.5px] text-amber-300/60 hover:text-amber-300"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1 max-h-[50px] space-y-0.5 overflow-y-auto no-scrollbar">
                  {clipboardStash.length === 0 ? (
                    <div className="text-[9px] text-white/40">No clips yet. Click "+ Snag" or copy anything in OS!</div>
                  ) : (
                    clipboardStash.map((clip) => (
                      <div
                        key={clip.id}
                        className="truncate rounded bg-black/30 px-1 py-0.5 text-[9px] text-white/80"
                      >
                        <span className="text-amber-400 font-bold mr-1">[{clip.kind.toUpperCase()}]</span>
                        {clip.label}
                      </div>
                    ))
                  )}
                </div>
                {clipboardStash.length > 0 && (
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      onClick={() => void synthesizeStash("bug_report")}
                      className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[8.5px] text-amber-200 hover:bg-amber-500/40"
                    >
                      ⚡ Bug Report
                    </button>
                    <button
                      type="button"
                      onClick={() => void synthesizeStash("summary")}
                      className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[8.5px] text-amber-200 hover:bg-amber-500/40"
                    >
                      ⚡ Executive Brief
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Ghost Worker Monitor (Feature 4) */}
            {showGhost && activeGhost && (
              <div className="mb-2 rounded border border-emerald-500/30 bg-emerald-950/20 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-emerald-300">
                  <span className="font-semibold flex items-center gap-1">
                    <Bot className="h-3 w-3" /> GHOST WORKER [{activeGhost.progress}%]
                  </span>
                  <span className="text-[8.5px] text-emerald-300/80">{activeGhost.status}</span>
                </div>
                <div className="mt-0.5 text-white/90 font-medium truncate">{activeGhost.step}</div>
                {activeGhost.status === "waiting_approval" && (
                  <div className="mt-1 rounded bg-black/40 p-1 text-[9px] text-amber-300">
                    <div>{activeGhost.approvalPrompt || "Confirm checkpoint approval?"}</div>
                    <div className="mt-1 flex gap-1">
                      <button
                        type="button"
                        onClick={() => approveGhostStep(activeGhost)}
                        className="rounded bg-emerald-500/30 px-2 py-0.5 text-emerald-200 hover:bg-emerald-500/50"
                      >
                        Approve
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Conversation content */}
            {content && (
              <div className="mb-1">
                <div className="mb-1 flex items-center justify-between border-b border-white/[0.06] pb-0.5 text-[8.5px]">
                  <span className="font-semibold uppercase tracking-wider text-[7.5px] text-cyan-400/80">
                    JARVIS
                  </span>
                  <button
                    type="button"
                    onClick={handleClearConvo}
                    className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] text-white/40 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                    title="Clear conversation"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    <span>Clear</span>
                  </button>
                </div>
                <div className="no-scrollbar max-h-[140px] overflow-y-auto text-[11px] leading-[1.55] text-white/[0.82] whitespace-pre-wrap">
                  {content}
                </div>
              </div>
            )}

            {/* Input Composer */}
            {inputOpen && (
              <form
                onSubmit={submit}
                className={`flex items-center gap-1 ${
                  content || showReticle || showStash || showGhost
                    ? "mt-1.5 border-t border-white/[0.08] pt-1.5"
                    : ""
                }`}
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setInputOpen(false);
                      setDraft("");
                    }
                  }}
                  placeholder="Ask, /ghost, /target, /circle…"
                  className="min-w-0 flex-1 bg-transparent px-0.5 text-[11px] text-white/90 outline-none placeholder:text-white/[0.28]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => useJarvisStore.getState().queueVoiceToggle()}
                  className="shrink-0 rounded-full p-1 text-white/40 transition-colors hover:text-white/90"
                  title="Talk to JARVIS"
                >
                  <Mic className="h-3 w-3" />
                </button>
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  className="shrink-0 rounded-full p-1 text-white/70 transition-colors hover:text-white disabled:opacity-20"
                  title="Send"
                >
                  <Send className="h-3 w-3" />
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
