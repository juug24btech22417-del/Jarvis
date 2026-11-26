"use client";

/**
 * JARVIS ORB — the desktop companion with jaw-dropping capabilities:
 *   1. Universal Drag-and-Drop Ingestion Singularity
 *   2. Desktop Screen Reticle & Active App Auto-Pilot
 *   3. Cross-App Magic Clipboard Stash (Multi-Slot Synthesis)
 *   4. Silent Ghost Worker (Background Autonomous Delegator)
 *   5. Circle-to-Act Desktop Teleportation
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  Eye,
  Bug,
  Search,
  Zap,
  FolderOpen,
  AlertTriangle,
  Wifi,
  FileText,
  Paperclip,
} from "lucide-react";
import CommandBar from "@/components/panels/CommandBar";
import OrbCore, { ORB_TONES, type Gaze } from "@/components/orb/OrbCore";
import { useJarvisStore, type StashedClip, type GhostWorker } from "@/store/jarvis.store";

type DevourTarget = {
  title: string;
  pid: number;
  hwnd: string;
  rect: { x: number; y: number; width: number; height: number };
};

type WindowCapture = {
  ok: boolean;
  title?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  mean?: number;
  stddev?: number;
  blank?: boolean;
  error?: string;
};

type DevourPhase = "idle" | "locked" | "swallow" | "digest";
type DevourDropPayload = { moved: boolean; target: DevourTarget | null };

/** One icon in the feature burst behind the composer's sparkle button. */
type FeatureChip = {
  key: string;
  title: string;
  icon: React.ReactNode;
  active: boolean;
  activeClass: string;
  idleClass: string;
  badge?: number;
  badgeClass?: string;
  pulse?: boolean;
  run: () => void;
};

declare global {
  interface Window {
    jarvisOrb?: {
      host: "electron";
      onCursor(cb: (p: { x: number; y: number; bx: number; by: number; w: number; h: number }) => void): () => void;
      onClipboardChange?(cb: (text: string) => void): () => void;
      getClipboard?(): Promise<string>;
      setIgnore(ignore: boolean): Promise<{ ok: boolean }>;
      dragStart(): Promise<{ ok: boolean }>;
      dragEnd(): Promise<{ ok: boolean; moved: boolean; shellOwned?: boolean }>;
      resize?(size: { width: number; height: number }): Promise<{ ok: boolean }>;
      openExternal?(url: string): void;
      openPath?(filePath: string): Promise<{ ok: boolean; error?: string }>;
      getActiveWindows?(): Promise<string[]>;
      onDevourTarget?(cb: (target: DevourTarget | null) => void): () => void;
      onDevourDrop?(cb: (payload: DevourDropPayload) => void): () => void;
      onDevourCapture?(cb: (payload: { target: DevourTarget; capture: WindowCapture }) => void): () => void;
      windowAt?(point?: { x: number; y: number }): Promise<DevourTarget | null>;
      captureWindow?(title: string): Promise<WindowCapture>;
      devourSupported?(): Promise<boolean>;
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

  // New features store hooks
  const contextLeech = useJarvisStore((s) => s.contextLeech);
  const setContextLeech = useJarvisStore((s) => s.setContextLeech);
  const ghostCopilot = useJarvisStore((s) => s.ghostCopilot);
  const setGhostCopilot = useJarvisStore((s) => s.setGhostCopilot);
  const omniQuery = useJarvisStore((s) => s.omniQuery);
  const setOmniQuery = useJarvisStore((s) => s.setOmniQuery);
  const envHealth = useJarvisStore((s) => s.envHealth);
  const setEnvHealth = useJarvisStore((s) => s.setEnvHealth);
  const stagedFile = useJarvisStore((s) => s.stagedFile);
  const setStagedFile = useJarvisStore((s) => s.setStagedFile);

  const orbFileInputRef = useRef<HTMLInputElement>(null);
  const [orbUploading, setOrbUploading] = useState(false);

  const handleOrbFileUpload = async (file: File) => {
    setOrbUploading(true);
    notify(`Selecting ${file.name}…`);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const realPath = (file as any).path;
      if (realPath) {
        formData.append("filePath", realPath);
      }
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        useJarvisStore.getState().setStagedFile({
          name: data.name,
          path: data.path,
          size: data.size,
          type: data.type,
        });
        notify(`Staged ${data.name} in File Explorer`);
        useJarvisStore.getState().addMessage({
          role: "assistant",
          content: `Selected "${data.name}" (${data.size}) in File Explorer (${data.path}). You can now ask me to rename it, delete it, move it, or review it.`,
        });
        setInputOpen(true);
        setDraft("");
        setTimeout(() => inputRef.current?.focus(), 80);
      } else {
        notify(`Selection failed: ${data.error || "error"}`);
      }
    } catch (err: any) {
      notify(`Selection error: ${err.message || "failed"}`);
    } finally {
      setOrbUploading(false);
    }
  };

  const gazeRef = useRef<Gaze>({ x: 0, y: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const omniInputRef = useRef<HTMLInputElement>(null);
  const copilotInputRef = useRef<HTMLInputElement>(null);
  const [inputOpen, setInputOpen] = useState(false);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  // The feature dock lives behind one button next to the composer — nothing
  // hangs under the orb until it is asked for.
  const [showFeatures, setShowFeatures] = useState(false);
  const [draft, setDraft] = useState("");

  // Feature modal trays
  const [showStash, setShowStash] = useState(false);
  const [showReticle, setShowReticle] = useState(false);
  const [showGhost, setShowGhost] = useState(false);
  const [showCircle, setShowCircle] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [statusNotification, setStatusNotification] = useState<string | null>(null);

  // New feature trays
  const [showLeech, setShowLeech] = useState(false);
  const [leechLoading, setLeechLoading] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotLoading, setCopilotLoading] = useState(false);
  const [showOmni, setShowOmni] = useState(false);
  const [omniInput, setOmniInput] = useState("");
  const [omniLoading, setOmniLoading] = useState(false);
  const [showEnvHeal, setShowEnvHeal] = useState(false);
  const [envHealLoading, setEnvHealLoading] = useState(false);
  const [healingId, setHealingId] = useState<string | null>(null);

  // ── Window Devourer ─────────────────────────────────────────────────────
  // The shell reports what is under the orb while dragging; the page owns the
  // theatre (card → gulp → digest) and the asking.
  const [devourPhase, setDevourPhase] = useState<DevourPhase>("idle");
  const [devourTarget, setDevourTarget] = useState<DevourTarget | null>(null);
  const [devourShot, setDevourShot] = useState<string | null>(null);
  const [devourBlank, setDevourBlank] = useState(false);
  const [devoured, setDevoured] = useState<{ title: string; app: string; context: string } | null>(null);
  const devourCardRef = useRef<HTMLDivElement>(null);
  const orbWrapRef = useRef<HTMLDivElement>(null);
  const devourTimer = useRef<number | null>(null);

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

    let ignoring = true;
    void host.setIgnore(true);

    // Hit-testing runs off the shell's cursor samples, not DOM mousemove: the
    // window is click-through until this runs, so a forwarded mousemove is a
    // chicken-and-egg source. The shell knows exactly where the cursor is.
    const applyHitTest = (clientX: number, clientY: number) => {
      // A drag owns hit-testing (the shell makes the window click-through so it
      // can see the window underneath); fighting it here would hide the target.
      if (dragging.current) return;
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const hot = !!el?.closest("[data-orb-hit]");
      if (hot !== !ignoring) {
        ignoring = !hot;
        void host.setIgnore(ignoring);
      }
    };

    const stopCursor = host.onCursor((p) => {
      const cx = p.bx + p.w / 2;
      const cy = p.by + p.h * 0.24;
      const range = 240;
      gazeRef.current = {
        x: Math.max(-1, Math.min(1, (p.x - cx) / range)),
        y: Math.max(-1, Math.min(1, (p.y - cy) / range)),
      };
      applyHitTest(p.x - p.bx, p.y - p.by);
    });

    const stopClip = host.onClipboardChange?.((text) => {
      if (text && text.trim()) {
        useJarvisStore.getState().addToClipboardStash({ text: text.trim(), source: "OS Clipboard" });
        notify("Captured clip to Magic Stash");
      }
    });

    const onMove = (e: MouseEvent) => applyHitTest(e.clientX, e.clientY);
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
      // When the shell owns the gesture it also reports the settle, so a click
      // is not toggled twice.
      if (res && !res.moved && !res.shellOwned) {
        setInputOpen((v) => !v);
      }
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
      notify(`Absorbing & staging ${file.name}…`);

      // Stage in File Explorer directly in place
      try {
        const formData = new FormData();
        formData.append("file", file);
        const realPath = (file as any).path;
        if (realPath) {
          formData.append("filePath", realPath);
        }
        const res = await fetch("/api/files/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
          useJarvisStore.getState().setStagedFile({
            name: data.name,
            path: data.path,
            size: data.size,
            type: data.type,
          });
          notify(`Staged ${data.name} in File Explorer`);
          useJarvisStore.getState().addMessage({
            role: "assistant",
            content: `Selected "${data.name}" (${data.size}) in File Explorer (${data.path}). You can now ask me to rename it, delete it, move it, or review it.`,
          });
          setInputOpen(true);
        }
      } catch (err: any) {
        console.error("Drop staging failed:", err);
      }

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
        // Only queue text prompt if file is text/code/readable
        if (!/[\x00-\x08\x0E-\x1F]/.test(snippet.slice(0, 500))) {
          useJarvisStore.getState().queueCommand(
            `[INGESTED FILE: ${file.name}]\nFile content snippet:\n\n${snippet}\n\nReview this file, explain what it does concisely, and point out any bugs or key logic.`
          );
        }
      } catch (err: any) {
        /* ignore binary file preview */
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

  // ── Feature 1: Context Leech — Live Screen Co-Pilot ─────────────────────
  const triggerContextLeech = async () => {
    setLeechLoading(true);
    setShowLeech(true);
    notify("Context Leech absorbing screen…");
    try {
      let winTitles: string[] = [];
      if (window.jarvisOrb?.getActiveWindows) {
        winTitles = await window.jarvisOrb.getActiveWindows();
      }
      const res = await fetch("/api/orb/context-leech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeWindows: winTitles }),
      });
      const data = await res.json();
      if (data?.ok) {
        setContextLeech({
          active: true,
          meetingTopic: data.meetingTopic,
          tacticalBullets: data.tacticalBullets || [],
          factChecks: data.factChecks || [],
          suggestedQuestions: data.suggestedQuestions || [],
          lastUpdated: Date.now(),
        });
        notify("Context absorbed ✓");
      } else {
        notify(data?.error || "Leech failed");
      }
    } catch {
      notify("Context Leech: network error");
    } finally {
      setLeechLoading(false);
    }
  };

  // ── Feature 3: Ghost Copilot — Bug Trapper ───────────────────────────────
  const triggerGhostCopilot = async (errorTrace?: string) => {
    const trace = (errorTrace || copilotInput).trim();
    if (!trace) {
      setShowCopilot(true);
      setTimeout(() => copilotInputRef.current?.focus(), 80);
      notify("Paste error trace & press Enter");
      return;
    }
    setCopilotLoading(true);
    notify("Ghost Copilot analyzing error…");
    try {
      const res = await fetch("/api/orb/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "diagnose", errorTrace: trace }),
      });
      const data = await res.json();
      if (data?.ok) {
        setGhostCopilot({
          active: true,
          file: data.file || "unknown",
          line: data.line,
          errorSummary: data.errorSummary || "Error detected",
          explanation: data.explanation || "",
          proposedPatch: data.proposedPatch || "",
          originalSnippet: data.originalSnippet,
          patchedSnippet: data.patchedSnippet,
          detectedAt: Date.now(),
        });
        setShowCopilot(true);
        notify("Diagnosis complete ✓");
      } else {
        notify(data?.error || "Copilot failed");
      }
    } catch {
      notify("Ghost Copilot: network error");
    } finally {
      setCopilotLoading(false);
    }
  };

  const applyGhostCopilotFix = async () => {
    if (!ghostCopilot) return;
    notify("Applying patch with safety backup…");
    try {
      const res = await fetch("/api/orb/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          file: ghostCopilot.file,
          patchedCode: ghostCopilot.patchedSnippet || ghostCopilot.proposedPatch,
        }),
      });
      const data = await res.json();
      if (data?.ok) {
        notify(`✓ Patch applied to ${ghostCopilot.file} (.bak saved)`);
        setGhostCopilot({ ...ghostCopilot, active: false });
        setShowCopilot(false);
      } else {
        notify(data?.error || "Patch apply failed");
      }
    } catch {
      notify("Apply fix: network error");
    }
  };

  // ── Feature 4: Omni-Query — Universal OS Deep Search ─────────────────────
  const runOmniSearch = async (queryOverride?: string) => {
    const q = (queryOverride || omniInput).trim();
    if (!q) {
      setShowOmni(true);
      setTimeout(() => omniInputRef.current?.focus(), 80);
      notify("Type a search query & press Enter");
      return;
    }
    setOmniLoading(true);
    notify("Omni-Query searching…");
    try {
      const res = await fetch("/api/orb/omni-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query: q }),
      });
      const data = await res.json();
      if (data?.ok) {
        setOmniQuery({
          query: q,
          totalFound: data.totalFound,
          files: data.files || [],
          scannedPath: data.scannedPath,
        });
        setShowOmni(true);
        notify(`Found ${data.totalFound} file(s)`);
      } else {
        notify(data?.error || "Omni-Query failed");
      }
    } catch {
      notify("Omni-Query: network error");
    } finally {
      setOmniLoading(false);
    }
  };

  const openOmniFile = async (filePath: string) => {
    if ((window.jarvisOrb as any)?.openPath) {
      await (window.jarvisOrb as any).openPath(filePath);
      return;
    }
    await fetch("/api/orb/omni-query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "open", filePath }),
    });
  };

  // ── Feature 6: Self-Healing Environment Daemon ───────────────────────────
  const scanEnvHealth = async () => {
    setEnvHealLoading(true);
    notify("Scanning dev environment…");
    try {
      const res = await fetch("/api/orb/env-heal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      const data = await res.json();
      if (data?.ok) {
        setEnvHealth({
          healthy: data.healthy,
          issues: data.issues || [],
          lastChecked: Date.now(),
        });
        setShowEnvHeal(true);
        notify(data.healthy ? "Environment healthy ✓" : `${data.issues.length} issue(s) detected`);
      } else {
        notify(data?.error || "Scan failed");
      }
    } catch {
      notify("Env Heal: network error");
    } finally {
      setEnvHealLoading(false);
    }
  };

  const healEnvIssue = async (issue: { id: string; type: string; pid?: number }) => {
    setHealingId(issue.id);
    notify(`Healing: ${issue.id}…`);
    try {
      const res = await fetch("/api/orb/env-heal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "heal", issueId: issue.id, type: issue.type, pid: issue.pid }),
      });
      const data = await res.json();
      if (data?.ok) {
        notify(`✓ ${data.message}`);
        if (envHealth) {
          const remaining = envHealth.issues.filter((i) => i.id !== issue.id);
          setEnvHealth({ ...envHealth, issues: remaining, healthy: remaining.length === 0 });
        }
      } else {
        notify(data?.error || "Heal failed");
      }
    } catch {
      notify("Heal: network error");
    } finally {
      setHealingId(null);
    }
  };

  // ── Window Devourer ─────────────────────────────────────────────────────
  /** The gulp: the target card leaves the world and becomes the orb. */
  const swallow = useCallback(async () => {
    setDevourPhase("swallow");
    const card = devourCardRef.current;
    const orb = orbWrapRef.current;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (card && orb && !reduced) {
      const c = card.getBoundingClientRect();
      const o = orb.getBoundingClientRect();
      const dx = o.left + o.width / 2 - (c.left + c.width / 2);
      const dy = o.top + o.height / 2 - (c.top + c.height / 2);
      const flight = card.animate(
        [
          { transform: "translate3d(0,0,0) scale(1)", opacity: 1, filter: "blur(0px)", offset: 0 },
          {
            transform: `translate3d(${(dx * 0.42).toFixed(1)}px, ${(dy * 0.42).toFixed(1)}px, 0) scale(0.62)`,
            opacity: 0.92,
            filter: "blur(1px)",
            offset: 0.5,
          },
          {
            transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(0.04) rotate(-3deg)`,
            opacity: 0,
            filter: "blur(6px)",
            offset: 1,
          },
        ],
        { duration: 520, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "forwards" }
      );
      await flight.finished.catch(() => {});
    } else {
      await new Promise((r) => window.setTimeout(r, 90));
    }

    setDevourPhase("digest");
    if (devourTimer.current) window.clearTimeout(devourTimer.current);
    devourTimer.current = window.setTimeout(() => {
      setDevourPhase("idle");
      setDevourShot(null);
      setDevourBlank(false);
    }, 2800);
  }, []);

  /** Ask about what was just swallowed — one model call, through the real pipeline. */
  const digest = useCallback(async (target: DevourTarget, capture: WindowCapture | null) => {
    const blank = !capture?.ok || !!capture?.blank;
    try {
      const res = await fetch("/api/orb/window-devour", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: target.title, blank, hasFrame: !!capture?.dataUrl }),
      });
      const data = await res.json();
      if (!data?.ok) {
        notify(data?.error || "Could not read that window");
        return;
      }

      setDevoured({ title: data.raw, app: data.app, context: data.context });
      notify(blank ? `Swallowed ${data.app} · frame protected` : `Swallowed ${data.app}`);

      // The window's pixels become the context the assistant answers from.
      if (capture?.dataUrl && !blank) {
        useJarvisStore.getState().setCurrentScreenshot(capture.dataUrl);
      }
      useJarvisStore.getState().queueCommand(data.context);
    } catch {
      notify("Window Devourer: network error");
    }
  }, []);

  const handleDevourDrop = useCallback(
    (payload: DevourDropPayload) => {
      const commit = (payload as { commit?: boolean } | null)?.commit === true;
      const log = (window as unknown as { __jarvisDevourEvents?: string[] }).__jarvisDevourEvents;
      log?.push(`drop:moved=${payload?.moved}:commit=${commit}:${payload?.target?.title ?? "none"}`);
      if (!payload?.moved) {
        setDevourPhase("idle");
        setDevourTarget(null);
        setInputOpen((v) => !v);
        return;
      }
      if (!payload.target) {
        setDevourPhase("idle");
        setDevourTarget(null);
        return;
      }
      // Moving the orb is not eating it: only a shift-committed drop swallows,
      // so a casual drag across an app never spends a question.
      if (!commit) {
        setDevourPhase("idle");
        setDevourTarget(null);
        return;
      }
      setDevourShot(null);
      setDevourBlank(false);
      setDevourTarget(payload.target);
      setDevourPhase("locked");
      void swallow();
    },
    [swallow]
  );

  const handleDevourCapture = useCallback(
    (payload: { target: DevourTarget; capture: WindowCapture }) => {
      if (!payload?.capture) return;
      if (payload.capture.ok && payload.capture.dataUrl) {
        setDevourShot(payload.capture.dataUrl);
        setDevourBlank(!!payload.capture.blank);
      }
      void digest(payload.target, payload.capture);
    },
    [digest]
  );

  useEffect(() => {
    const log = (window as unknown as { __jarvisDevourEvents?: string[] }).__jarvisDevourEvents;
    log?.push(`phase:${devourPhase}`);
  }, [devourPhase]);

  const dropRef = useRef(handleDevourDrop);
  const captureRef = useRef(handleDevourCapture);
  dropRef.current = handleDevourDrop;
  captureRef.current = handleDevourCapture;

  // The shell drives the gesture; these are its three reports.
  useEffect(() => {
    const host = window.jarvisOrb;
    if (!host?.onDevourTarget) return;

    const seen: string[] = [];
    (window as unknown as { __jarvisDevourEvents?: string[] }).__jarvisDevourEvents = seen;

    const stopTarget = host.onDevourTarget((target) => {
      seen.push(target ? target.title : "(none)");
      if (!target) {
        setDevourTarget(null);
        setDevourPhase((p) => (p === "locked" ? "idle" : p));
        return;
      }
      setDevourTarget(target);
      setDevourPhase((p) => (p === "idle" ? "locked" : p));
    });
    const stopDrop = host.onDevourDrop?.((payload) => dropRef.current(payload));
    const stopCapture = host.onDevourCapture?.((payload) => captureRef.current(payload));

    return () => {
      stopTarget();
      stopDrop?.();
      stopCapture?.();
      delete (window as unknown as { __jarvisDevourEvents?: string[] }).__jarvisDevourEvents;
      if (devourTimer.current) window.clearTimeout(devourTimer.current);
    };
  }, []);

  // Dev-only handle so the e2e suite can exercise the drop path without
  // hijacking the physical mouse. Stripped from production bundles.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as {
      __jarvisDevourDrop?: (target: DevourTarget) => void;
      __jarvisDevourCapture?: (target: DevourTarget) => Promise<WindowCapture | null>;
    };
    w.__jarvisDevourDrop = (target: DevourTarget) => dropRef.current({ moved: true, target });
    w.__jarvisDevourCapture = async (target: DevourTarget) => {
      const capture = (await window.jarvisOrb?.captureWindow?.(target.title)) ?? null;
      if (capture) captureRef.current({ target, capture });
      return capture;
    };
    return () => {
      delete w.__jarvisDevourDrop;
      delete w.__jarvisDevourCapture;
    };
  }, []);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;

    if (text === "/clear" || text === "clear") {
      handleClearConvo();
      setDraft("");
      setInputOpen(false);
      return;
    }

    if (text.startsWith("/leech")) { void triggerContextLeech(); setDraft(""); return; }
    if (text.startsWith("/copilot")) { void triggerGhostCopilot(text.replace(/^\/copilot\s*/i, "")); setDraft(""); return; }
    if (text.startsWith("/omni")) { const q = text.replace(/^\/omni\s*/i, ""); setOmniInput(q); void runOmniSearch(q); setDraft(""); return; }
    if (text.startsWith("/heal")) { void scanEnvHealth(); setDraft(""); return; }
    if (text === "/spit") {
      setDevoured(null);
      setDevourTarget(null);
      setDevourShot(null);
      notify("Released the window");
      setDraft("");
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

    // ── Direct File Explorer Command Handling in Orb ──
    const currentStaged = useJarvisStore.getState().stagedFile;
    const cleanLower = text.toLowerCase().trim();
    const isFileCmd =
      (currentStaged && /\b(rename|delete|remove|trash|move|copy|duplicate|reveal|open|show|what|check)\b/i.test(cleanLower)) ||
      /\b(?:rename|change\s+(?:the\s+)?name\s+of)\b/i.test(cleanLower) ||
      /\b(?:delete|remove|trash|destroy)\b[\s\S]*?\b(?:file|folder|directory|it|this|document|screenshot|\.\w{2,5})\b/i.test(cleanLower) ||
      /\b(?:move|copy|duplicate)\b[\s\S]*?\bto\b/i.test(cleanLower) ||
      (!!currentStaged &&
        /\b(?:put|place|send|transfer|shift|take|drag)\b[\s\S]*?\b(?:to|into|in|on|onto)\b/i.test(cleanLower)) ||
      /\b(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\b/i.test(cleanLower) ||
      /\b(?:reveal|open|show)\b[\s\S]*?\b(?:in\s+(?:file\s+)?explorer|file\s+explorer|downloads\s+folder|desktop\s+folder|documents\s+folder)\b/i.test(cleanLower);

    if (isFileCmd) {
      setDraft("");
      setInputOpen(false);
      notify("Processing File Explorer command…");
      try {
        const res = await fetch("/api/files/manage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: text,
            contextFile: currentStaged,
          }),
        });
        const data = await res.json();
        if (data.ok) {
          if (data.action === "rename" && data.newPath) {
            useJarvisStore.getState().setStagedFile({
              name: data.newName,
              path: data.newPath,
              size: currentStaged?.size || "",
              type: currentStaged?.type || "",
            });
          } else if (data.action === "delete") {
            useJarvisStore.getState().setStagedFile(null);
          } else if (data.action === "move" && data.destPath) {
            useJarvisStore.getState().setStagedFile({
              name: data.fileName,
              path: data.destPath,
              size: currentStaged?.size || "",
              type: currentStaged?.type || "",
            });
          }
          const msg = data.message || "File Explorer action completed.";
          useJarvisStore.getState().addMessage({
            role: "assistant",
            content: msg,
          });
          setBubbleOpen(true);
          notify(msg);
          return;
        } else {
          const errMsg = `File operation failed: ${data.error || "Unknown error"}`;
          useJarvisStore.getState().addMessage({
            role: "assistant",
            content: errMsg,
          });
          setBubbleOpen(true);
          notify(errMsg);
          return;
        }
      } catch (err: any) {
        notify(`File error: ${err.message || "failed"}`);
        return;
      }
    }

    // Once a window is inside the orb, follow-up questions are about it.
    const focus = devoured ? `[FOCUS: ${devoured.title}]\n` : "";
    useJarvisStore.getState().queueCommand(`${focus}${text}`);
    setDraft("");
    setInputOpen(false);
  };

  const accent = (ORB_TONES[state] ?? ORB_TONES.idle).accent;
  const activeGhost = ghostWorkers.find((w) => w.status === "running" || w.status === "waiting_approval");
  const cardOpen =
    showFeatures ||
    inputOpen ||
    bubbleOpen ||
    showStash ||
    showReticle ||
    showGhost ||
    showLeech ||
    showCopilot ||
    showOmni ||
    showEnvHeal ||
    !!stagedFile ||
    devourPhase !== "idle" ||
    state === "thinking" ||
    state === "listening";

  // ── Dynamic window resize when card / panels open ────────────────────────
  useEffect(() => {
    if (window.jarvisOrb?.resize) {
      if (cardOpen) {
        // Fixed height: the feature burst borrows room from the conversation
        // pane instead of making the whole window grow.
        void window.jarvisOrb.resize({ width: 320, height: 490 });
      } else {
        void window.jarvisOrb.resize({ width: 320, height: 330 });
      }
    }
  }, [cardOpen]);

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
        ref={orbWrapRef}
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
        <OrbCore
          gazeRef={gazeRef}
          isIngesting={isDraggingOver}
          devour={
            devourPhase === "swallow" ? "swallow" : devourPhase === "digest" ? "digest" : "idle"
          }
          devourImage={devourShot}
        />

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

      {/* ── Window Devourer: the window the orb is about to eat ── */}
      {devourPhase !== "idle" && devourTarget && (
        <div
          ref={devourCardRef}
          className="devour-card"
          aria-live="polite"
          data-devour-phase={devourPhase}
        >
          <div className="devour-card__sheen" />
          <div className="devour-card__eyebrow">
            {devourPhase === "locked"
              ? "⇧ + RELEASE TO SWALLOW"
              : devourPhase === "swallow"
                ? "ABSORBING"
                : "DIGESTING"}
          </div>
          <div className="devour-card__title">{devourTarget.title}</div>
          <div className="devour-card__meta">
            <span className="devour-card__dot" />
            {devourBlank ? "frame protected" : "live window"}
          </div>
          {devourShot && (
            <img className="devour-card__shot" src={devourShot} alt="" draggable={false} />
          )}
        </div>
      )}

      <style>{`
        .devour-card {
          position: absolute; left: 44px; top: 112px; width: 232px;
          padding: 9px 12px 11px; border-radius: 18px; overflow: hidden;
          background: linear-gradient(158deg, rgba(18,30,42,0.94), rgba(6,11,18,0.96));
          border: 1px solid rgba(150,225,255,0.22);
          box-shadow: 0 22px 50px -14px rgba(0,0,0,0.9),
                      0 1px 0 rgba(255,255,255,0.15) inset;
          backdrop-filter: blur(18px) saturate(140%);
          transform-origin: 50% 50%; will-change: transform, opacity, filter;
          pointer-events: none;
          animation: devour-in 240ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        .devour-card__sheen {
          position: absolute; inset: 0 0 auto 0; height: 45%;
          background: linear-gradient(180deg, rgba(255,255,255,0.09), transparent);
          pointer-events: none;
        }
        .devour-card__eyebrow {
          font-family: var(--font-orbitron, inherit); font-size: 7px;
          letter-spacing: 0.26em; color: rgba(141,227,255,0.75);
        }
        .devour-card__title {
          margin-top: 3px; font-size: 11px; line-height: 1.35; font-weight: 600;
          color: rgba(255,255,255,0.92);
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .devour-card__meta {
          display: flex; align-items: center; gap: 5px; margin-top: 5px;
          font-size: 8px; letter-spacing: 0.06em; color: rgba(255,255,255,0.38);
        }
        .devour-card__dot {
          width: 4px; height: 4px; border-radius: 999px;
          background: rgba(110,231,168,0.95);
          box-shadow: 0 0 6px rgba(110,231,168,0.8);
        }
        .devour-card__shot {
          display: block; width: 100%; height: 52px; margin-top: 8px;
          object-fit: cover; border-radius: 10px;
          opacity: 0.85; filter: saturate(115%);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset;
        }
        @keyframes devour-in {
          from { opacity: 0; transform: translate3d(0, 7px, 0) scale(0.96); filter: blur(6px); }
          to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .devour-card { animation: none; }
        }
        /* Feature burst — grows out of the orb */
        .feature-burst {
          transform-origin: 50% -46px;
          animation: burst-in 280ms cubic-bezier(0.2, 0.9, 0.3, 1.25) both;
        }
        @keyframes burst-in {
          from { opacity: 0; transform: translateY(-16px) scale(0.5); filter: blur(6px); }
          to   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        .feature-chip {
          animation: chip-in 380ms cubic-bezier(0.2, 0.9, 0.3, 1.4) both;
          opacity: 0;
        }
        .feature-chip svg { width: 10px; height: 10px; }
        @keyframes chip-in {
          from { opacity: 0; transform: translate3d(0, -18px, 0) scale(0.35); filter: blur(4px); }
          to   { opacity: 1; transform: translate3d(0, 0, 0) scale(1); filter: blur(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .feature-burst, .feature-chip { animation: none; opacity: 1; }
        }
      `}</style>

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

            {/* ── Context Leech HUD (Feature 1) ── */}
            {showLeech && (
              <div className="mb-2 rounded border border-violet-500/30 bg-violet-950/20 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-violet-300 mb-1">
                  <span className="font-semibold flex items-center gap-1">
                    <Eye className="h-3 w-3" /> CONTEXT LEECH
                  </span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => void triggerContextLeech()}
                      className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[8.5px] text-violet-200 hover:bg-violet-500/40">
                      {leechLoading ? "…" : "↻ Refresh"}
                    </button>
                    <button type="button" onClick={() => setShowLeech(false)} className="text-white/40 hover:text-white px-1">✕</button>
                  </div>
                </div>
                {!contextLeech || leechLoading ? (
                  <div className="text-white/40 text-[9px]">{leechLoading ? "Absorbing screen context…" : "Click Refresh to absorb screen"}</div>
                ) : (
                  <div className="max-h-[160px] overflow-y-auto pr-1 select-text" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(168,85,247,0.4) transparent" }}>
                    {contextLeech.meetingTopic && (
                      <div className="text-violet-200 font-semibold mb-1 text-[9.5px]">📌 {contextLeech.meetingTopic}</div>
                    )}
                    {contextLeech.tacticalBullets.length > 0 && (
                      <div className="mb-1.5">
                        <div className="text-violet-400/80 text-[8px] font-bold uppercase tracking-wider mb-0.5">INTEL</div>
                        {contextLeech.tacticalBullets.map((b, i) => (
                          <div key={i} className="text-white/85 text-[9px] leading-[1.4] mb-0.5">• {b}</div>
                        ))}
                      </div>
                    )}
                    {contextLeech.factChecks.length > 0 && (
                      <div className="mb-1.5">
                        <div className="text-amber-400/80 text-[8px] font-bold uppercase tracking-wider mb-0.5">FACTS</div>
                        {contextLeech.factChecks.map((f, i) => (
                          <div key={i} className="text-amber-200/80 text-[9px] leading-[1.4] mb-0.5">✓ {f}</div>
                        ))}
                      </div>
                    )}
                    {contextLeech.suggestedQuestions.length > 0 && (
                      <div>
                        <div className="text-cyan-400/80 text-[8px] font-bold uppercase tracking-wider mb-0.5">ASK</div>
                        {contextLeech.suggestedQuestions.map((q, i) => (
                          <div key={i}
                            className="text-cyan-300/80 text-[9px] leading-[1.4] cursor-pointer hover:text-cyan-200 mb-0.5"
                            onClick={() => useJarvisStore.getState().queueCommand(q)}>
                            → {q}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Ghost Copilot HUD (Feature 3) ── */}
            {showCopilot && (
              <div className="mb-2 rounded border border-orange-500/30 bg-orange-950/20 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-orange-300 mb-1">
                  <span className="font-semibold flex items-center gap-1">
                    <Bug className="h-3 w-3" /> GHOST COPILOT
                  </span>
                  <button type="button" onClick={() => { setShowCopilot(false); setGhostCopilot(null); }}
                    className="text-white/40 hover:text-white px-1">✕</button>
                </div>
                {!ghostCopilot ? (
                  <form onSubmit={(e) => { e.preventDefault(); void triggerGhostCopilot(); }} className="flex flex-col gap-1">
                    <input
                      ref={copilotInputRef}
                      value={copilotInput}
                      onChange={(e) => setCopilotInput(e.target.value)}
                      placeholder="Paste error trace or describe bug…"
                      className="w-full rounded bg-black/40 px-1.5 py-1 text-[9.5px] text-white/80 outline-none placeholder:text-white/30"
                    />
                    <button type="submit" disabled={copilotLoading}
                      className="self-start rounded bg-orange-500/20 px-2 py-0.5 text-[8.5px] text-orange-200 hover:bg-orange-500/40 disabled:opacity-50">
                      {copilotLoading ? "Analyzing…" : "⚡ Diagnose"}
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="text-orange-200 font-semibold mb-0.5 truncate">
                      🐛 {ghostCopilot.errorSummary}
                    </div>
                    <div className="text-white/70 text-[9px] mb-0.5">
                      📄 {ghostCopilot.file}{ghostCopilot.line ? `:${ghostCopilot.line}` : ""}
                    </div>
                    {ghostCopilot.explanation && (
                      <div className="text-white/80 text-[9px] mb-1 max-h-[48px] overflow-y-auto no-scrollbar">
                        {ghostCopilot.explanation}
                      </div>
                    )}
                    <div className="flex gap-1 mt-1">
                      {ghostCopilot.active && (
                        <button type="button" onClick={() => void applyGhostCopilotFix()}
                          className="rounded bg-orange-500/30 px-2 py-0.5 text-[8.5px] text-orange-200 hover:bg-orange-500/50">
                          ⚡ Apply Fix (.bak)
                        </button>
                      )}
                      <button type="button" onClick={() => { setGhostCopilot(null); setCopilotInput(""); }}
                        className="rounded px-1.5 py-0.5 text-[8.5px] text-white/40 hover:text-white">
                        Re-diagnose
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Omni-Query HUD (Feature 4) ── */}
            {showOmni && (
              <div className="mb-2 rounded border border-sky-500/30 bg-sky-950/20 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-sky-300 mb-1">
                  <span className="font-semibold flex items-center gap-1">
                    <Search className="h-3 w-3" /> OMNI-QUERY
                  </span>
                  <button type="button" onClick={() => setShowOmni(false)} className="text-white/40 hover:text-white px-1">✕</button>
                </div>
                <form onSubmit={(e) => { e.preventDefault(); void runOmniSearch(); }} className="flex gap-1 mb-1">
                  <input
                    ref={omniInputRef}
                    value={omniInput}
                    onChange={(e) => setOmniInput(e.target.value)}
                    placeholder="screenshots from yesterday, .py files…"
                    className="flex-1 min-w-0 rounded bg-black/40 px-1.5 py-1 text-[9.5px] text-white/80 outline-none placeholder:text-white/30"
                  />
                  <button type="submit" disabled={omniLoading}
                    className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[8.5px] text-sky-200 hover:bg-sky-500/40 disabled:opacity-50">
                    {omniLoading ? "…" : "Go"}
                  </button>
                </form>
                {omniQuery && (
                  <>
                    <div className="text-white/50 text-[8.5px] mb-0.5">{omniQuery.totalFound} file(s) · {omniQuery.scannedPath}</div>
                    <div className="max-h-[72px] overflow-y-auto no-scrollbar space-y-0.5">
                      {omniQuery.files.length === 0 ? (
                        <div className="text-white/30 text-[9px]">No files found for this query</div>
                      ) : (
                        omniQuery.files.slice(0, 10).map((f, i) => (
                          <div key={i}
                            className="flex items-center gap-1 rounded bg-black/30 px-1 py-0.5 cursor-pointer hover:bg-sky-900/30 group"
                            onClick={() => void openOmniFile(f.path)}
                            title={f.path}
                          >
                            <FolderOpen className="h-2.5 w-2.5 text-sky-400 shrink-0" />
                            <span className="flex-1 truncate text-[9px] text-white/80 group-hover:text-sky-200">{f.name}</span>
                            <span className="text-[8px] text-white/30 shrink-0">{f.size}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Self-Healing Env HUD (Feature 6) ── */}
            {showEnvHeal && (
              <div className="mb-2 rounded border border-green-500/30 bg-green-950/20 p-1.5 text-[10px]">
                <div className="flex items-center justify-between text-green-300 mb-1">
                  <span className="font-semibold flex items-center gap-1">
                    <Zap className="h-3 w-3" /> ENV DOCTOR
                  </span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => void scanEnvHealth()}
                      className="rounded bg-green-500/20 px-1.5 py-0.5 text-[8.5px] text-green-200 hover:bg-green-500/40">
                      {envHealLoading ? "…" : "↻ Rescan"}
                    </button>
                    <button type="button" onClick={() => setShowEnvHeal(false)} className="text-white/40 hover:text-white px-1">✕</button>
                  </div>
                </div>
                {!envHealth || envHealLoading ? (
                  <div className="text-white/40 text-[9px]">{envHealLoading ? "Scanning environment…" : "Click Rescan"}</div>
                ) : envHealth.healthy ? (
                  <div className="text-green-300 text-[9px]">✓ All dev ports clear, no locks detected</div>
                ) : (
                  <div className="space-y-0.5 max-h-[80px] overflow-y-auto no-scrollbar">
                    {envHealth.issues.map((issue) => (
                      <div key={issue.id} className="flex items-center gap-1 rounded bg-black/30 px-1 py-0.5">
                        <AlertTriangle className="h-2.5 w-2.5 text-red-400 shrink-0" />
                        <span className="flex-1 truncate text-[9px] text-white/80">{issue.description}</span>
                        <button
                          type="button"
                          disabled={healingId === issue.id}
                          onClick={() => void healEnvIssue(issue)}
                          className="shrink-0 rounded bg-green-500/30 px-1.5 py-0.5 text-[7.5px] text-green-200 hover:bg-green-500/50 disabled:opacity-50"
                        >
                          {healingId === issue.id ? "…" : "⚡ Fix"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Feature burst — one tap from the composer, out of the orb ── */}
            {showFeatures && (
              <div
                data-orb-hit
                className="feature-burst mb-1 grid grid-cols-5 gap-0.5 rounded-lg border border-white/[0.07] bg-black/50 p-0.5 backdrop-blur"
              >
                {([
                  {
                    key: "reticle",
                    title: "Target Screen Reticle (Element Auto-Pilot)",
                    icon: <Crosshair className="h-3 w-3" />,
                    active: !!screenReticle?.active,
                    activeClass: "bg-cyan-500/25 text-cyan-300 border-cyan-400/30",
                    idleClass: "hover:text-cyan-300",
                    run: () => void toggleReticle(),
                  },
                  {
                    key: "stash",
                    title: "Clipboard Magic Stash",
                    icon: <Layers className="h-3 w-3" />,
                    active: showStash,
                    activeClass: "bg-amber-500/25 text-amber-300 border-amber-400/30",
                    idleClass: "hover:text-amber-300",
                    badge: clipboardStash.length,
                    badgeClass: "bg-amber-400 text-black",
                    run: () => setShowStash((v) => !v),
                  },
                  {
                    key: "ghost",
                    title: "Autonomous Ghost Worker",
                    icon: <Bot className="h-3 w-3" />,
                    active: !!activeGhost,
                    activeClass: "bg-emerald-500/25 text-emerald-300 border-emerald-400/30 animate-pulse",
                    idleClass: "hover:text-emerald-300",
                    run: () => {
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
                    },
                  },
                  {
                    key: "circle",
                    title: "Circle-to-Act Screen Teleportation",
                    icon: <CircleDot className="h-3 w-3" />,
                    active: showCircle,
                    activeClass: "bg-purple-500/25 text-purple-300 border-purple-400/30",
                    idleClass: "hover:text-purple-300",
                    run: () => {
                      if (!draft.trim()) {
                        setInputOpen(true);
                        setDraft("/act ");
                        notify("Type screen instruction & press Enter (or leave blank to inspect)");
                        setTimeout(() => inputRef.current?.focus(), 80);
                        return;
                      }
                      void triggerCircleAct();
                    },
                  },
                  {
                    key: "leech",
                    title: "Context Leech: absorb screen & get tactical notes (/leech)",
                    icon: <Eye className="h-3 w-3" />,
                    active: showLeech && !!contextLeech,
                    activeClass: "bg-violet-500/25 text-violet-300 border-violet-400/30",
                    idleClass: "hover:text-violet-300",
                    pulse: leechLoading,
                    run: () => void triggerContextLeech(),
                  },
                  {
                    key: "copilot",
                    title: "Ghost Copilot: paste an error trace → get an AI patch (/copilot)",
                    icon: <Bug className="h-3 w-3" />,
                    active: showCopilot,
                    activeClass: "bg-orange-500/25 text-orange-300 border-orange-400/30",
                    idleClass: "hover:text-orange-300",
                    pulse: copilotLoading,
                    run: () => {
                      setShowCopilot((v) => !v);
                      setTimeout(() => copilotInputRef.current?.focus(), 80);
                    },
                  },
                  {
                    key: "omni",
                    title: "Omni-Query: search any file in natural language (/omni)",
                    icon: <Search className="h-3 w-3" />,
                    active: showOmni,
                    activeClass: "bg-sky-500/25 text-sky-300 border-sky-400/30",
                    idleClass: "hover:text-sky-300",
                    pulse: omniLoading,
                    run: () => {
                      setShowOmni((v) => !v);
                      setTimeout(() => omniInputRef.current?.focus(), 80);
                    },
                  },
                  {
                    key: "heal",
                    title: "Self-Healing Env: scan & fix port collisions, git locks (/heal)",
                    icon: <Zap className="h-3 w-3" />,
                    active: showEnvHeal,
                    activeClass: "bg-green-500/25 text-green-300 border-green-400/30",
                    idleClass: "hover:text-green-300",
                    pulse: envHealLoading,
                    badge: envHealth && !envHealth.healthy ? envHealth.issues.length : 0,
                    badgeClass: "bg-red-500 text-white",
                    run: () => void scanEnvHealth(),
                  },
                  {
                    key: "upload",
                    title: "Upload a file to File Explorer (rename / delete / move)",
                    icon: <Upload className="h-3 w-3" />,
                    active: !!stagedFile,
                    activeClass: "bg-emerald-500/25 text-emerald-300 border-emerald-400/30",
                    idleClass: "hover:text-emerald-300",
                    pulse: orbUploading,
                    run: () => orbFileInputRef.current?.click(),
                  },
                  ...(messages.length > 0 || bubbleText
                    ? [
                        {
                          key: "clear",
                          title: "Clear Conversation",
                          icon: <Trash2 className="h-3 w-3" />,
                          active: false,
                          activeClass: "",
                          idleClass: "hover:text-rose-400",
                          run: handleClearConvo,
                        },
                      ]
                    : []),
                ] as FeatureChip[]).map((f, i) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      f.run();
                      // A tray that just opened needs the room; give it back.
                      if (f.key !== "upload") setShowFeatures(false);
                    }}
                    title={f.title}
                    style={{ animationDelay: `${40 + i * 28}ms` }}
                    className={`feature-chip relative flex h-5 items-center justify-center rounded border text-white/45 transition-colors ${
                      f.active
                        ? f.activeClass
                        : `border-white/[0.05] bg-white/[0.02] ${f.idleClass}`
                    } ${f.pulse ? "animate-pulse" : ""}`}
                  >
                    {f.icon}
                    {!!f.badge && (
                      <span
                        className={`absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full text-[6.5px] font-bold ${f.badgeClass}`}
                      >
                        {f.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Hidden file input for the Upload chip */}
            <input
              ref={orbFileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  void handleOrbFileUpload(e.target.files[0]);
                  e.target.value = "";
                }
              }}
            />

            {/* Conversation content */}            {content && (
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
                <div
                  className={`no-scrollbar overflow-y-auto text-[11px] leading-[1.55] text-white/[0.82] whitespace-pre-wrap ${
                    showFeatures ? "max-h-[88px]" : "max-h-[140px]"
                  }`}
                >
                  {content}
                </div>
              </div>
            )}

            {/* Staged File Banner for File Explorer Control */}
            {stagedFile && (
              <div className="mb-1.5 flex items-center justify-between rounded bg-emerald-950/70 border border-emerald-500/40 px-2 py-1 text-[9px] text-emerald-300">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileText className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span className="truncate font-mono font-medium">{stagedFile.name}</span>
                  <span className="text-emerald-400/60 font-mono">({stagedFile.size})</span>
                </div>
                <button
                  type="button"
                  onClick={() => useJarvisStore.getState().setStagedFile(null)}
                  className="ml-1 text-emerald-400/60 hover:text-white transition-colors"
                  title="Clear staged file"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Input Composer — also stays up while the feature burst is open,
                so the sparkle button never disappears from under the pointer. */}
            {(inputOpen || showFeatures) && (
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
                  placeholder={stagedFile ? "Ask or command: rename it to..., delete, move..." : "Ask, /ghost, /target, /circle…"}
                  className="min-w-0 flex-1 bg-transparent px-0.5 text-[11px] text-white/90 outline-none placeholder:text-white/[0.28]"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowFeatures((v) => !v)}
                  className={`shrink-0 rounded-full p-1 transition-colors ${
                    showFeatures ? "bg-cyan-500/20 text-cyan-300" : "text-white/40 hover:text-cyan-300"
                  }`}
                  title="Features"
                >
                  <Sparkles
                    className={`h-3 w-3 transition-transform duration-300 ${
                      showFeatures ? "rotate-45 scale-110" : ""
                    }`}
                  />
                </button>
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
