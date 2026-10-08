"use client";

// App Deck — the single glass button (top-left) that replaced fourteen
// floating launcher buttons.
//
// One tap opens a fully frosted panel: every tool is a row in the left rail
// (the way a system settings window lists its pages) and the right side is
// that tool's own page - title, what it does, its live state, its inline
// controls and one wide "Open" row. Arrow keys walk the rail, Enter opens,
// Esc closes. The glass strength is a real control, not decoration.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Brain,
  ChevronRight,
  Clapperboard,
  Ear,
  FileText,
  Layers,
  LayoutGrid,
  ListTodo,
  Plug,
  QrCode,
  Radio,
  Scan,
  Send,
  Shield,
  UserCheck,
  X,
} from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";
import SentinelArmToggle from "@/components/panels/SentinelArmToggle";

export type DeckId =
  | "security"
  | "second-brain"
  | "tasks"
  | "telegram"
  | "connected"
  | "qr-teleporter"
  | "proximity-scanner"
  | "video-director"
  | "room-scanner"
  | "whiteboard-ocr"
  | "meeting-shadow"
  | "face-crm"
  | "task-agent"
  | "mcp-hub";

type DeckRow =
  | { kind: "status"; label: string; value: string; tone?: "ok" | "warn" | "bad" | "off" }
  | { kind: "node"; label: string; node: React.ReactNode };

interface DeckEntry {
  /** Same id the launcher callback uses. */
  id: DeckId;
  /** Rail label. */
  label: string;
  /** Small tracked label above the page title, like "DISPLAY" in the mock. */
  kicker: string;
  /** One line explaining the tool. */
  description: string;
  /** What it can actually do (shown as chips). */
  caps: string[];
  /** Accent colour for the icon tile, title glow and Open row. */
  accent: string;
  icon: React.ReactNode;
  /** Optional live state / inline controls for the page. */
  rows?: DeckRow[];
}

const TONE: Record<NonNullable<Extract<DeckRow, { kind: "status" }>["tone"]> | "default", string> = {
  ok: "text-emerald-300",
  warn: "text-amber-300",
  bad: "text-rose-300",
  off: "text-white/45",
  default: "text-white/90",
};

const LIVE_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "off" }> = {
  idle: { label: "Idle", tone: "off" },
  scanning: { label: "Scanning", tone: "warn" },
  verified: { label: "You recognised", tone: "ok" },
  intruder: { label: "Intruder", tone: "bad" },
};

export default function AppDeck({ onLaunch }: { onLaunch: (id: DeckId) => void }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  // 0 = barely frosted, 100 = heavy glass. Real: it drives the panel's own
  // background alpha and backdrop blur.
  const [glass, setGlass] = useState(55);

  const armed = useJarvisStore((s) => s.sentinelArmed);
  const live = useJarvisStore((s) => s.sentinelLiveStatus);
  const tasks = useJarvisStore((s) => s.tasks);
  const memories = useJarvisStore((s) => s.memories);

  const openTasks = useMemo(() => tasks.filter((t) => !t.completed).length, [tasks]);
  const liveState = LIVE_LABEL[live] ?? LIVE_LABEL.idle;

  const entries: DeckEntry[] = useMemo(
    () => [
      {
        id: "security",
        label: "Sentinel",
        kicker: "SECURITY",
        description:
          "The global face watcher. Arm it here and JARVIS keeps an eye on who is in front of the machine.",
        caps: ["Face recognition", "Live status ring", "Intruder alert"],
        accent: "#22d3ee",
        icon: <Shield className="w-[18px] h-[18px]" />,
        rows: [
          {
            kind: "status",
            label: "Face watcher",
            value: armed ? "Armed" : "Disarmed",
            tone: armed ? "ok" : "off",
          },
          { kind: "status", label: "Live state", value: liveState.label, tone: liveState.tone },
          { kind: "node", label: "Quick arm", node: <SentinelArmToggle /> },
        ],
      },
      {
        id: "second-brain",
        label: "Second Brain",
        kicker: "MEMORY",
        description: "Your memory constellation — everything JARVIS has learned, in one graph.",
        caps: ["Memory graph", "Recall across sessions", "Saved dossiers"],
        accent: "#67e8f9",
        icon: <Brain className="w-[18px] h-[18px]" />,
        rows: [{ kind: "status", label: "Memories stored", value: String(memories.length) }],
      },
      {
        id: "tasks",
        label: "Command Deck",
        kicker: "COMMAND",
        description: "Your tasks and timers, with focus sessions built in.",
        caps: ["Task board", "Timers & focus", "Priorities"],
        accent: "#fbbf24",
        icon: <ListTodo className="w-[18px] h-[18px]" />,
        rows: [
          { kind: "status", label: "Open tasks", value: String(openTasks), tone: openTasks ? "warn" : "ok" },
          { kind: "status", label: "Completed", value: String(tasks.length - openTasks), tone: "off" },
        ],
      },
      {
        id: "telegram",
        label: "Telegram",
        kicker: "COMMS",
        description: "The Telegram bot relay — message JARVIS from your phone, anywhere.",
        caps: ["Bot relay", "Two-way messages", "Remote commands"],
        accent: "#38bdf8",
        icon: <Send className="w-[18px] h-[18px]" />,
      },
      {
        id: "connected",
        label: "Connected Apps",
        kicker: "COMMS",
        description: "Every service JARVIS is wired into, and the live event stream it feeds.",
        caps: ["Service connections", "Live event stream", "Notifications"],
        accent: "#5eead4",
        icon: <Plug className="w-[18px] h-[18px]" />,
      },
      {
        id: "qr-teleporter",
        label: "QR Teleporter",
        kicker: "TRANSFER",
        description: "Beam a link or payload from this screen straight onto your phone.",
        caps: ["QR pairing", "Beam to phone", "Instant handoff"],
        accent: "#22d3ee",
        icon: <QrCode className="w-[18px] h-[18px]" />,
      },
      {
        id: "proximity-scanner",
        label: "Proximity Radar",
        kicker: "PRESENCE",
        description: "Desk presence awareness — JARVIS knows when you arrive and when you step away.",
        caps: ["Desk presence", "Walk-away awareness", "Presence triggers"],
        accent: "#4ade80",
        icon: <Radio className="w-[18px] h-[18px]" />,
      },
      {
        id: "video-director",
        label: "Video Director",
        kicker: "CINEMA",
        description: "Stark Cinema's AI director — plan shots and cut a sequence from a prompt.",
        caps: ["Shot planning", "AI direction", "Stitched sequences"],
        accent: "#fbbf24",
        icon: <Clapperboard className="w-[18px] h-[18px]" />,
      },
      {
        id: "room-scanner",
        label: "Room Scanner",
        kicker: "SPATIAL",
        description: "Spatial capture of your desk and room for the 3D view.",
        caps: ["Spatial capture", "Desk mapping", "3D viewing"],
        accent: "#22d3ee",
        icon: <Scan className="w-[18px] h-[18px]" />,
      },
      {
        id: "whiteboard-ocr",
        label: "Whiteboard OCR",
        kicker: "CAPTURE",
        description: "Photograph a whiteboard and get the handwriting and schematics back as text.",
        caps: ["Handwriting OCR", "Schematic digitising", "Text extraction"],
        accent: "#a78bfa",
        icon: <FileText className="w-[18px] h-[18px]" />,
      },
      {
        id: "meeting-shadow",
        label: "Meeting Shadow",
        kicker: "PRESENCE",
        description: "A private earpiece AI that listens to the meeting and feeds you the answer.",
        caps: ["Live meeting listening", "Private earpiece replies", "Notes on the fly"],
        accent: "#22d3ee",
        icon: <Ear className="w-[18px] h-[18px]" />,
      },
      {
        id: "face-crm",
        label: "Face to CRM",
        kicker: "IDENTITY",
        description: "Recognise a face and pull up the dossier you have on that person.",
        caps: ["Face recognition", "Contact dossiers", "Instant recall"],
        accent: "#34d399",
        icon: <UserCheck className="w-[18px] h-[18px]" />,
      },
      {
        id: "task-agent",
        label: "Task Agent",
        kicker: "AUTOMATION",
        description: "Tell it what you want done — it plans the steps and runs them itself.",
        caps: ["Multi-step runs", "Autonomous execution", "Progress tracking"],
        accent: "#fbbf24",
        icon: <Bot className="w-[18px] h-[18px]" />,
      },
      {
        id: "mcp-hub",
        label: "MCP Hub",
        kicker: "PROTOCOL",
        description: "Model Context Protocol servers — GitHub, filesystem, maps and WhatsApp tools.",
        caps: ["GitHub · Filesystem · Maps", "Tool servers", "WhatsApp bridge"],
        accent: "#c084fc",
        icon: <Layers className="w-[18px] h-[18px]" />,
      },
    ],
    [armed, liveState, memories.length, openTasks, tasks.length]
  );

  const current = entries[Math.min(selected, entries.length - 1)];
  const selectedRef = useRef(0);
  selectedRef.current = selected;

  const launch = useCallback(
    (id: DeckId) => {
      setOpen(false);
      onLaunch(id);
    },
    [onLaunch]
  );

  // Rail + page keyboard control. Captured so arrow keys never reach the
  // command bar while the deck is up.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => (s + 1) % entries.length);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((s) => (s - 1 + entries.length) % entries.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        launch(entries[selectedRef.current].id);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, entries, launch]);

  // Frosted glass: the slider drives both the white sheen and the blur.
  const g = glass / 100;
  const panelStyle: React.CSSProperties = {
    background: `linear-gradient(150deg, rgba(255,255,255,${(0.055 + g * 0.075).toFixed(3)}) 0%, rgba(103,232,249,${(0.02 + g * 0.045).toFixed(3)}) 45%, rgba(255,255,255,${(0.03 + g * 0.05).toFixed(3)}) 100%), rgba(4,16,30,${(0.64 - g * 0.2).toFixed(3)})`,
    backdropFilter: `blur(${Math.round(10 + g * 30)}px) saturate(150%)`,
    WebkitBackdropFilter: `blur(${Math.round(10 + g * 30)}px) saturate(150%)`,
  };

  return (
    <>
      {/* ── The one button (same spot the launcher row sat in) ── */}
      <motion.button
        whileHover={{ scale: 1.06, y: -1 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        title="App Deck — every tool in one glass panel"
        aria-label="Open the App Deck"
        aria-haspopup="dialog"
        className="fixed top-12 sm:top-16 left-2 sm:left-5 z-[75] w-11 h-11 shrink-0 rounded-[15px] flex items-center justify-center overflow-hidden border border-cyan-400/45 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240] backdrop-blur-md transition-colors duration-300 shadow-[0_0_14px_rgba(6,182,212,0.35)] outline-none focus:outline-none focus-visible:outline-none"
      >
        <span className="absolute inset-0 rounded-[15px] bg-gradient-to-br from-cyan-500/25 to-blue-600/10" />
        <LayoutGrid className="w-5 h-5 text-cyan-300 drop-shadow-[0_0_8px_rgba(0,243,255,0.8)] relative z-10" />
      </motion.button>

      {/* ── The glass deck ── */}
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-[115] flex items-start justify-center px-4 pt-[6vh] sm:pt-[7vh]">
            {/* Backdrop: a little colour for the glass to frost, then a scrim. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
              className="absolute inset-0 bg-black/45 backdrop-blur-[3px]"
              onClick={() => setOpen(false)}
            >
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "radial-gradient(58% 52% at 22% 16%, rgba(34,211,238,0.18), transparent 62%), radial-gradient(52% 52% at 78% 84%, rgba(129,74,255,0.16), transparent 62%)",
                }}
              />
            </motion.div>

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="App Deck"
              initial={{ opacity: 0, scale: 0.975, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.975, y: 10 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              style={panelStyle}
              className="relative w-full max-w-[880px] h-[min(76vh,690px)] rounded-[30px] overflow-hidden border border-white/15 shadow-[0_40px_120px_-30px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(255,255,255,0.06)] flex flex-col"
            >
              {/* glass sheen */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-white/[0.13] to-transparent" />

              {/* Header */}
              <div className="relative flex items-center justify-between gap-4 px-5 h-14 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-[11px] flex items-center justify-center border border-white/20 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
                    <LayoutGrid className="w-4 h-4 text-cyan-200" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-orbitron text-[11px] tracking-[0.22em] text-cyan-100/90 truncate">
                      JARVIS · APP DECK
                    </div>
                    <div className="text-[10.5px] text-white/45 truncate">
                      {entries.length} tools · one panel
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  {/* Real control: how frosted the glass is. */}
                  <div className="hidden sm:flex items-center gap-3">
                    <span className="text-[10.5px] tracking-[0.14em] text-white/45 uppercase">
                      Glass
                    </span>
                    <span className="text-[11px] text-white/80 font-semibold tabular-nums w-7 text-right">
                      {glass}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={glass}
                      onChange={(e) => setGlass(Number(e.target.value))}
                      aria-label="Glass intensity"
                      className="w-28 h-[6px] rounded-full appearance-none cursor-pointer outline-none
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-200
                        [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(34,211,238,0.95)]
                        [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full
                        [&::-moz-range-thumb]:bg-cyan-200 [&::-moz-range-thumb]:border-0"
                      style={{
                        background: `linear-gradient(to right, rgba(34,211,238,0.95) 0%, rgba(34,211,238,0.95) ${glass}%, rgba(255,255,255,0.16) ${glass}%, rgba(255,255,255,0.16) 100%)`,
                      }}
                    />
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    aria-label="Close the App Deck"
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.12] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="relative flex flex-1 min-h-0">
                {/* Rail */}
                <div className="w-[168px] sm:w-[218px] shrink-0 border-r border-white/10 overflow-y-auto py-2.5 px-1.5 sm:px-2 space-y-0.5 custom-scrollbar">
                  {entries.map((entry, i) => {
                    const active = i === selected;
                    return (
                      <button
                        key={entry.id}
                        onMouseEnter={() => setSelected(i)}
                        onClick={() => launch(entry.id)}
                        className={`w-full flex items-center gap-2.5 rounded-2xl px-2 py-[7px] text-left transition-colors duration-150 ${
                          active ? "bg-white/[0.14] ring-1 ring-white/20" : "hover:bg-white/[0.07]"
                        }`}
                      >
                        <span
                          className="w-8 h-8 shrink-0 rounded-[11px] flex items-center justify-center border transition-all duration-150"
                          style={{
                            borderColor: active ? `${entry.accent}77` : "rgba(255,255,255,0.12)",
                            background: active ? `${entry.accent}24` : "rgba(255,255,255,0.05)",
                            color: entry.accent,
                            boxShadow: active ? `0 0 14px ${entry.accent}55` : "none",
                          }}
                        >
                          {entry.icon}
                        </span>
                        <span
                          className={`text-[12.5px] truncate transition-colors ${
                            active ? "text-white" : "text-white/65"
                          }`}
                        >
                          {entry.label}
                        </span>
                        {active && (
                          <ChevronRight className="w-3.5 h-3.5 ml-auto text-white/45 shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Page */}
                <div className="flex-1 min-w-0 overflow-y-auto px-4 sm:px-6 py-5 custom-scrollbar">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={current.id}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -8 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                    >
                      <div className="text-[10px] tracking-[0.3em] text-white/35 uppercase text-center">
                        {current.kicker}
                      </div>

                      <div className="flex items-center gap-4 mt-2">
                        <span className="flex-1 h-px bg-gradient-to-r from-transparent via-white/20 to-white/20" />
                        <h2
                          className="font-orbitron text-[19px] font-light tracking-[0.28em] uppercase whitespace-nowrap"
                          style={{ color: current.accent, textShadow: `0 0 22px ${current.accent}66` }}
                        >
                          {current.label}
                        </h2>
                        <span className="flex-1 h-px bg-gradient-to-l from-transparent via-white/20 to-white/20" />
                      </div>

                      <p className="mt-3 text-[12.5px] leading-relaxed text-white/60 max-w-[54ch] mx-auto text-center">
                        {current.description}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
                        {current.caps.map((c) => (
                          <span
                            key={c}
                            className="px-2.5 py-1 rounded-full text-[11px] text-white/60 border border-white/10 bg-white/[0.06]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>

                      {/* Rows — live state and inline controls (the settings-page feel) */}
                      {current.rows && current.rows.length > 0 && (
                        <div className="mt-5 space-y-1.5">
                          {current.rows.map((row) => (
                            <div
                              key={row.label}
                              className="flex items-center justify-between gap-4 rounded-xl px-3.5 py-2 transition-colors hover:bg-white/[0.07]"
                            >
                              <span className="text-[12.5px] text-white/60">{row.label}</span>
                              {row.kind === "status" ? (
                                <span
                                  className={`text-[12.5px] font-medium ${TONE[row.tone ?? "default"]}`}
                                >
                                  {row.value}
                                </span>
                              ) : (
                                row.node
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* One wide Open row (the "Standard ⌃" row in the mock) */}
                      <button
                        onClick={() => launch(current.id)}
                        className="mt-5 w-full flex items-center justify-between gap-3 rounded-2xl px-4 py-3 border transition-colors"
                        style={{
                          borderColor: `${current.accent}55`,
                          background: `${current.accent}1f`,
                        }}
                      >
                        <span className="text-[12.5px] text-white/85">
                          Open {current.id === "security" ? "the Security panel" : current.label}
                        </span>
                        <span className="flex items-center gap-2 text-[11px] text-white/50">
                          Enter
                          <ChevronRight className="w-4 h-4" style={{ color: current.accent }} />
                        </span>
                      </button>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Hint bar */}
              <div className="relative h-10 shrink-0 border-t border-white/10 flex items-center justify-center gap-5 text-[10.5px] text-white/40">
                <span className="flex items-center gap-1.5">
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> Navigate
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>↵</Kbd> Open
                </span>
                <span className="flex items-center gap-1.5">
                  <Kbd>ESC</Kbd> Close
                </span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-1.5 py-0.5 rounded-[6px] border border-white/15 bg-white/[0.07] text-white/60 text-[10px]">
      {children}
    </span>
  );
}
