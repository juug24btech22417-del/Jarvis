"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ArcReactor from "@/components/reactor/ArcReactor";
import AvengersAssemble from "@/components/cinematic/AvengersAssemble";
import StatusHUD from "@/components/panels/StatusHUD";
import DiagnosticsPanel from "@/components/panels/DiagnosticsPanel";
import MeetingShadowPanel from "@/components/panels/MeetingShadowPanel";
import FaceCrmPanel from "@/components/panels/FaceCrmPanel";
import AutonomousTaskAgentPanel from "@/components/panels/AutonomousTaskAgentPanel";
import McpHubPanel from "@/components/panels/McpHubPanel";
import ExplainOverlay from "@/components/ui/ExplainOverlay";
import { useWeatherAmbient } from "@/hooks/useWeatherAmbient";
import ReactorTelemetry from "@/components/panels/ReactorTelemetry";
import CommandBar from "@/components/panels/CommandBar";
import TimerPanel from "@/components/panels/TimerPanel";
import CalculatorDisplay, { useCalculatorHistory } from "@/components/panels/CalculatorDisplay";
import GestureDetector from "@/components/ui/GestureDetector";
import VideoPlayer from "@/components/ui/VideoPlayer";
import CodePanel from "@/components/panels/CodePanel";
import WhatsAppPanel from "@/components/panels/WhatsAppPanel";
import TelegramPanel from "@/components/panels/TelegramPanel";
import EyeControlOverlay from "@/components/ui/EyeControlOverlay";
import AirMouseControl from "@/components/ui/AirMouseControl";
import GestureDJ from "@/components/ui/GestureDJ";
import PhoneRemotePanel from "@/components/panels/PhoneRemotePanel";
import GesturePractice from "@/components/ui/GesturePractice";
import ScreenNarratorToast from "@/components/ui/ScreenNarratorToast";
import ConnectedPanel from "@/components/panels/ConnectedPanel";
import AppDeck, { type DeckId } from "@/components/hud/AppDeck";
import CommunicationHub from "@/components/panels/CommunicationHub";
import SecurityPanel from "@/components/panels/SecurityPanel";
import { useSentinelWatcher } from "@/hooks/useSentinelWatcher";
import VaultPanel from "@/components/panels/VaultPanel";
import DungeonPanel from "@/components/panels/DungeonPanel";
import HabitsPanel from "@/components/panels/HabitsPanel";

import VoiceNotesPanel from "@/components/panels/VoiceNotesPanel";
import WeatherPanel from "@/components/panels/WeatherPanel";
import SpotifyPanel from "@/components/panels/SpotifyPanel";
import NewsPanel from "@/components/panels/NewsPanel";
import CalendarPanel from "@/components/panels/CalendarPanel";
// Tier 2: New Feature Panels
import SkillTrainerPanel from "@/components/panels/SkillTrainerPanel";
import ImageGeneratorPanel from "@/components/panels/ImageGeneratorPanel";
import SummarizerPanel from "@/components/panels/SummarizerPanel";
import WebScraperPanel from "@/components/panels/WebScraperPanel";
import FirecrawlPanel from "@/components/panels/FirecrawlPanel";
import NASAPanel from "@/components/panels/NASAPanel";
import HuggingFacePanel from "@/components/panels/HuggingFacePanel";
import IFTTTPanel from "@/components/panels/IFTTTPanel";
import BrowserAutomationPanel from "@/components/panels/BrowserAutomationPanel";
import LocalLLMPanel from "@/components/panels/LocalLLMPanel";
import VisionPanel from "@/components/panels/VisionPanel";
import AutomationPanel from "@/components/panels/AutomationPanel";
import PriceTrackerPanel from "@/components/panels/PriceTrackerPanel";
import PlaywrightPanel from "@/components/panels/PlaywrightPanel";
import TranscriptionPanel from "@/components/panels/TranscriptionPanel";
import ProxyPanel from "@/components/panels/ProxyPanel";
import AgentPanel from "@/components/panels/AgentPanel";
import MissionControlPanel from "@/components/panels/MissionControlPanel";
import WidgetsPanel from "@/components/panels/WidgetsPanel";
import SecondBrainPanel from "@/components/panels/SecondBrainPanel";
import TaskTimerDashboard from "@/components/panels/TaskTimerDashboard";
import WidgetRail from "@/components/hud/WidgetRail";
import AnalyticsPanel from "@/components/panels/AnalyticsPanel";
import MacroPanel from "@/components/panels/MacroPanel";
import QRTeleportPanel from "@/components/panels/QRTeleportPanel";
import ProximityPanel from "@/components/panels/ProximityPanel";
import VideoDirectorPanel from "@/components/panels/VideoDirectorPanel";
import RoomScannerPanel from "@/components/panels/RoomScannerPanel";
import WhiteboardOCRPanel from "@/components/panels/WhiteboardOCRPanel";
import { useJarvisStore } from "@/store/jarvis.store";
import { playRepulsor } from "@/lib/sounds";
import { primeScore } from "@/lib/cinematic/score";
import { useTextToSpeech } from "@/hooks/useVoice";

// Boot sequence — power gate. Pure black screen; one press starts the
// reactor assembly, the soundtrack, and the greeting in a single gesture.
function BootSequence({ greeting }: { greeting?: string | null } = {}) {
  const bootComplete = useJarvisStore((s) => s.bootComplete);
  const setUserInteracted = useJarvisStore((s) => s.setUserInteracted);
  const [powered, setPowered] = useState(false);
  const [bootFinished, setBootFinished] = useState(false);

  // Safety watchdog: ensure boot never hangs or stays blank
  useEffect(() => {
    if (powered && !bootFinished) {
      const watchdog = setTimeout(() => {
        useJarvisStore.getState().setBootComplete(true);
        setBootFinished(true);
      }, 5500);
      return () => clearTimeout(watchdog);
    }
  }, [powered, bootFinished]);

  const pressPower = useCallback(() => {
    if (powered) return;
    setPowered(true);
    setUserInteracted(true);
    try {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
      }
    } catch {}
    import("@/hooks/useHandControl").then((m) => m.warmHandEngine()).catch(() => {});
    import("@/hooks/useEyeControl").then((m) => m.warmEyeEngine()).catch(() => {});
    primeScore();
    useJarvisStore.getState().startAssembly();
    window.dispatchEvent(new Event("jarvis:power-gate"));
  }, [powered, setUserInteracted]);

  // Allow pressing Enter or Space anywhere to power on or Esc to skip
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        pressPower();
      } else if (e.key === "Escape") {
        setPowered(true);
        setUserInteracted(true);
        useJarvisStore.getState().setBootComplete(true);
        setBootFinished(true);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [pressPower, setUserInteracted]);

  const skipBoot = (e: React.MouseEvent) => {
    e.stopPropagation();
    setPowered(true);
    setUserInteracted(true);
    useJarvisStore.getState().setBootComplete(true);
    setBootFinished(true);
  };

  return (
    <AnimatePresence>
      {bootFinished ? null : bootComplete && powered ? (
        /* ── Welcome card — fades over the freshly assembled reactor ── */
        <motion.div
          key="welcome"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.8 } }}
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        >
          <div className="text-center">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="font-orbitron text-4xl md:text-6xl text-reactor-core glow-text mb-4"
            >
              J.A.R.V.I.S.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="font-rajdhani text-xl text-text-secondary tracking-widest"
            >
              Just A Rather Very Intelligent System
            </motion.p>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 }}
              className="mt-8 text-text-secondary/50 font-rajdhani text-sm"
            >
              {greeting || "Systems online, Boss."}
            </motion.div>
          </div>
        </motion.div>
      ) : (
        /* ── Power gate — the only thing on screen until pressed ── */
        !powered ? (
          <motion.div
            key="gate"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 1.1, ease: "easeInOut" } }}
            onClick={pressPower}
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black cursor-pointer select-none"
          >
            <motion.div
              animate={{ scale: [1, 1.06, 1], opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              className="w-20 h-20 rounded-full border border-white/25 flex items-center justify-center"
            >
              <div className="w-9 h-9 rounded-full bg-white/10 border border-white/20" />
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
              className="mt-10 font-orbitron text-2xl md:text-3xl text-white/90 tracking-[0.45em] pl-[0.45em]"
            >
              ARC REACTOR
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7, duration: 0.8 }}
              className="mt-3 font-rajdhani text-sm text-white/40 tracking-[0.35em] pl-[0.35em]"
            >
              MARK II · STARK INDUSTRIES
            </motion.p>
            <motion.p
              animate={{ opacity: [0.25, 0.8, 0.25] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
              className="mt-14 font-rajdhani text-xs text-white/60 tracking-[0.4em] pl-[0.4em]"
            >
              PRESS OR CLICK ANYWHERE TO POWER ON
            </motion.p>
            <button
              onClick={skipBoot}
              className="mt-8 px-4 py-1.5 rounded-full border border-cyan-500/30 bg-cyan-950/20 text-cyan-400/70 hover:text-cyan-300 hover:border-cyan-400 font-rajdhani text-xs tracking-widest transition-all z-20 cursor-pointer"
            >
              SKIP INTRO [ESC]
            </button>
          </motion.div>
        ) : (
          /* Black flash after the press — lifts immediately so the core
             ignition and every assembly beat stay in full view */
          <motion.div
            key="hold"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.0, ease: "easeInOut" }}
            className="fixed inset-0 z-[60] bg-black pointer-events-none"
          />
        )
      )}
    </AnimatePresence>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

// ─── Companion greeting (personal JARVIS) ───────────────────────────
// Replaces the random canned greeting pool with a greeting built from
// real context: how long you were away, your recent mood, open
// follow-up threads (exams, deadlines), and late-night awareness.

type CompanionGreeting = {
  ok: boolean;
  greeting: string;
  careNotes: string[];
  threads: Array<{ id: string; topic: string; dueLabel: string }>;
};

async function fetchCompanionGreeting(): Promise<CompanionGreeting | null> {
  try {
    const res = await fetch("/api/companion");
    if (!res.ok) return null;
    return (await res.json()) as CompanionGreeting;
  } catch {
    return null;
  }
}

function fallbackGreeting(tasks?: any[]): string {
  // No canned pool: when the companion API is unreachable, build a real line
  // from the current time, day, and what is actually open on the user's list.
  const band = getGreeting();
  const now = new Date();
  const day = now.toLocaleDateString(undefined, { weekday: "long" });
  const pending = (tasks || []).filter((t) => t && !t.completed).length;

  let line =
    band === "late night"
      ? `It's the middle of the night, Boss. It's ${day}.`
      : `${band.charAt(0).toUpperCase() + band.slice(1)}, Boss. It's ${day}.`;
  line += " Systems are online and the reactor is stable.";
  if (pending > 0) {
    line += ` ${pending} thing${pending === 1 ? "" : "s"} still open on your list.`;
  }
  return line;
}

import { useJarvisVoice } from "@/hooks/useVoice";
import { useJarvisSentinel } from "@/hooks/useSentinel";
import { useJarvisBiometrics } from "@/hooks/useBiometrics";
import { useAutoPersona } from "@/hooks/useAutoPersona";
import { useReactorDrive } from "@/hooks/useReactorDrive";
import { useAmbientContext } from "@/hooks/useAmbientContext";
import { composeLocalBriefing, polishBriefing } from "@/services/BriefingService";
import OnboardingModal from "@/components/panels/OnboardingModal";
import SentinelSuggestionWidget from "@/components/ui/SentinelSuggestionWidget";

// ─── Weather-reactive ambient particles ───────────────────────────────
function WeatherParticles() {
  const ambient = useWeatherAmbient();

  // Generate deterministic particle positions on mount
  const particles = useRef(
    Array.from({ length: 120 }, (_, i) => ({
      x: ((i * 17 + 13) % 100),
      y: ((i * 31 + 7) % 100),
      size: 0.5 + ((i * 13) % 30) / 10,
      delay: ((i * 7) % 40) / 10,
      dur: 2 + ((i * 11) % 30) / 10,
      colorIdx: i % ambient.particleColors.length,
    }))
  ).current;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {/* Scene tint overlay */}
      <div
        className="absolute inset-0 transition-all duration-[3000ms]"
        style={{
          background: ambient.overlayColor,
          filter: ambient.sceneFilter,
        }}
      />

      {/* Particles */}
      {particles.slice(0, ambient.particleCount).map((p, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: `${p.size * 2}px`,
            height: `${p.size * 2}px`,
            backgroundColor: ambient.particleColors[p.colorIdx],
            opacity: 0.25 + (p.size / 3.5) * 0.3,
            animation: `particleDrift ${p.dur}s ease-in-out ${p.delay}s infinite alternate`,
          }}
        />
      ))}

      {/* Rain streaks overlay */}
      {ambient.showRainStreaks && <div className="weather-rain-streaks" />}

      {/* Fog overlay */}
      {ambient.showFog && <div className="weather-fog-overlay" />}
    </div>
  );
}

export default function Home() {
  const bootComplete = useJarvisStore((s) => s.bootComplete);
  const activePanel = useJarvisStore((s) => s.activePanel);
  const setActivePanel = useJarvisStore((s) => s.setActivePanel);
  const userName = useJarvisStore((s) => s.userName);
  const tasks = useJarvisStore((s) => s.tasks);
  const userInteracted = useJarvisStore((s) => s.userInteracted);
  const memories = useJarvisStore((s) => s.memories);
  const addMessage = useJarvisStore((s) => s.addMessage);
  const { speak } = useJarvisVoice();
  const hasGreetedRef = useRef(false);
  // The real, context-built greeting, surfaced on the boot card too so the
  // welcome line is never a single hardcoded sentence. Fetched once when the
  // power gate is pressed (cached in a ref) so we never ask the companion API
  // twice for the same boot.
  const [bootGreeting, setBootGreeting] = useState<string | null>(null);
  const companionGreetingRef = useRef<CompanionGreeting | null>(null);

  // Companion: first-boot onboarding + weekly reflection state.
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [weeklyReflection, setWeeklyReflection] = useState<string | null>(null);

  // Tier 3B: auto-switch persona on time/alerts/panel/chat context.
  useAutoPersona();
  // Sentinel Eyes global watcher — headless face-security loop that runs
  // regardless of which panel is open. Controlled by SentinelArmToggle.
  useSentinelWatcher();
  // Tier 3A: drive reactor color/speed/density from persona + state + alerts.
  useReactorDrive();
  // Tier 3C: aggregate ambient signals for downstream consumers.
  const ambient = useAmbientContext();

  // Play "Iron Man" style startup sound when boot completes
  // Track user interaction for audio policy
  // No longer need window-level listeners as we have a dedicated button
  useEffect(() => {
    // Just ensure we are in a clean state
  }, []);

  useEffect(() => {
    if (bootComplete && userInteracted) {
      // Boot sound — the same repulsor blast as the toggle, fired the moment
      // the reactor finishes assembling (already unlocked by the gate press).
      playRepulsor();
    }
  }, [bootComplete, userInteracted]);

  // Power pressed -> fetch the real greeting right away so the welcome card
  // can show it while the reactor assembles.
  useEffect(() => {
    if (!userInteracted || companionGreetingRef.current) return;
    fetchCompanionGreeting()
      .then((c) => {
        if (c) {
          companionGreetingRef.current = c;
          setBootGreeting(c.greeting);
        }
      })
      .catch(() => {});
  }, [userInteracted]);

  useEffect(() => {
    if (bootComplete && userInteracted && !hasGreetedRef.current) {
      hasGreetedRef.current = true;
      
      const triggerGreeting = async () => {
        // Personal companion greeting — built from real context: how long
        // you were away, your recent mood, open follow-up threads, and
        // late-night awareness. Falls back to the legacy pool on failure.
        const companion = companionGreetingRef.current ?? (await fetchCompanionGreeting());
        let greeting = companion?.greeting || fallbackGreeting(tasks);
        setBootGreeting((prev) => prev ?? greeting);

        // Keep the old critical-task awareness — JARVIS still notices
        // what's urgent, he just leads with warmth now.
        const criticalTasks = tasks.filter((t) => t.priority === "critical" && !t.completed);
        if (criticalTasks.length > 0) {
          greeting += ` You have ${criticalTasks.length} critical ${criticalTasks.length === 1 ? "task" : "tasks"} waiting, Boss — we should probably start there.`;
        }

        // Chat bubble: JARVIS's first words when you walk into the lab.
        addMessage({
          role: "assistant",
          content: greeting,
        });

        // Short delay to allow boot sequence fade out
        setTimeout(() => speak(greeting), 1000);

        // Tier 3D: Morning briefing once per session, if it's morning.
        // Other kinds (evening/weekly) are available via voice command.
        const today = new Date().toDateString();
        const lastBriefingDate =
          typeof window !== "undefined"
            ? window.localStorage.getItem("jarvis:last-briefing-date")
            : null;
        if (
          ambient.hour >= 6 &&
          ambient.hour < 11 &&
          lastBriefingDate !== today
        ) {
          const draft = composeLocalBriefing("morning", {
            ambient,
            pendingTasks: tasks
              .filter((t) => !t.completed)
              .map((t) => t.title),
            memoryHighlights: memories
              .map((m) => m.content)
              .slice(0, 5),
            upcomingEvents: [],
            newsHeadlines: [],
            userName: userName || "Boss",
          });
          const polished = await polishBriefing(draft);
          setTimeout(() => speak(`${polished.greeting} ${polished.body}`), 6000);
          try {
            window.localStorage.setItem("jarvis:last-briefing-date", today);
          } catch {
            // ignore
          }
        }
      };

      triggerGreeting();
    }
  }, [bootComplete, speak, userName, tasks, userInteracted, memories, ambient, setActivePanel]);

  // Companion: check once per session whether onboarding is needed and
  // whether a weekly reflection is due (shown as a chat message).
  useEffect(() => {
    if (!bootComplete) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/companion/onboard");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data?.onboarded === false) setNeedsOnboarding(true);
        }
      } catch {
        // non-fatal
      }
      try {
        const today = new Date().toDateString();
        const last = typeof window !== "undefined" ? window.localStorage.getItem("jarvis:last-reflection-week") : null;
        // Show at most once a week. New users get nothing (hasData=false).
        const lastDate = last ? new Date(last) : null;
        const weekPassed = !lastDate || Date.now() - lastDate.getTime() > 6.5 * 864e5;
        if (!cancelled && weekPassed) {
          const r = await fetch("/api/companion/reflection");
          if (r.ok) {
            const data = await r.json();
            if (!cancelled && data?.ok && data?.rendered && data?.hasData) {
              setWeeklyReflection(data.rendered as string);
              try {
                window.localStorage.setItem("jarvis:last-reflection-week", today);
              } catch {
                // ignore
              }
            }
          }
        }
      } catch {
        // non-fatal
      }
    };
    check();
    return () => {
      cancelled = true;
    };
  }, [bootComplete]);

  useJarvisSentinel();
  useJarvisBiometrics();

  // Companion: deliver the weekly reflection as a chat bubble + voice
  // once it has been fetched.
  const reflectionSpokenRef = useRef(false);
  useEffect(() => {
    if (weeklyReflection && !reflectionSpokenRef.current) {
      reflectionSpokenRef.current = true;
      addMessage({ role: "assistant", content: weeklyReflection });
      setTimeout(() => speak(weeklyReflection.replace(/\*\*/g, "")), 4000);
    }
  }, [weeklyReflection, addMessage, speak]);

  // Strip basic markdown for desktop notification bodies (they don't
  // render markdown). Local helper to avoid pulling a dep.
  const stripMd = (s: string): string =>
    s
      .replace(/^>+\s?/gm, "")
      .replace(/[*_`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\n+/g, " ")
      .trim();

  // Tier 3: composio event stream → desktop system notifications.
  // One EventSource per app load. Auto-reconnects on close. Fires
  // a system Notification for every composio event, regardless of
  // whether the Connected panel is open.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
    let es: EventSource | null = null;
    let cancelled = false;
    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/events/stream");
      // OS-wide clipboard assistant — the watcher analysed a copy made
      // elsewhere on the laptop. Store it so the overlay can offer it. This
      // runs before the Notification guard: the offer must not depend on
      // notification permission.
      es.addEventListener("jarvis:clipboard", (e: MessageEvent<string>) => {
        try {
          const data = JSON.parse(e.data);
          useJarvisStore.getState().setClipboardAssist(data);
        } catch {
          // malformed event — skip
        }
      });

      es.addEventListener("jarvis:event", (e: MessageEvent<string>) => {
        if (Notification.permission !== "granted") return;
        try {
          const data = JSON.parse(e.data) as {
            title: string;
            body: string;
            url?: string;
            source: string;
            id: string;
          };
          const n = new Notification(data.title, {
            body: stripMd(data.body).slice(0, 240),
            tag: `composio:${data.source}:${data.id}`,
            icon: "/favicon.ico",
          });
          n.onclick = () => {
            window.focus();
            if (data.url) window.open(data.url, "_blank", "noopener");
            n.close();
          };
        } catch {
          // malformed event — skip
        }
      });
      es.onerror = () => {
        // Browser will auto-reconnect. We just close to avoid
        // duplicate storms if the SSE endpoint went away.
        if (es) {
          es.close();
          es = null;
        }
        if (!cancelled) setTimeout(connect, 5_000);
      };
    };
    connect();
    return () => {
      cancelled = true;
      if (es) es.close();
    };
  }, []);

  const { isSpeaking, state, setState } = useJarvisStore();

  // Sync global speaking state to JARVIS state — but NEVER stomp an explicit
  // DORMANT (sleep) choice: speech may not force the reactor awake, and an
  // utterance ending may not wake it either. Idle is the only auto state.
  useEffect(() => {
    if (isSpeaking && state !== "speaking" && state !== "sleep") {
      setState("speaking");
    } else if (!isSpeaking && state === "speaking") {
      setState("idle");
    }
  }, [isSpeaking, state, setState]);
  const { calculations, lastCalculation, addCalculation, clearHistory, deleteCalculation } = useCalculatorHistory();
  const [calculatorOpen, setCalculatorOpen] = useState(true);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [phoneRemoteOpen, setPhoneRemoteOpen] = useState(false);
  const [connectedOpen, setConnectedOpen] = useState(false);
  const [commHubOpen, setCommHubOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [dungeonOpen, setDungeonOpen] = useState(false);
  const [habitsOpen, setHabitsOpen] = useState(false);
  const [voiceNotesOpen, setVoiceNotesOpen] = useState(false);


  // Tier 1C: lightweight pattern observation. Fire-and-forget POST.
  const recordPanelOpen = useCallback((panelName: string) => {
    if (typeof window === "undefined") return;
    fetch("/api/memory/patterns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "panel",
        payload: { panel: panelName, openedAt: new Date().toISOString() },
      }),
    }).catch(() => {});
  }, []);

  // App Deck -> the panel each entry opens. One place, so the deck component
  // stays a pure UI shell and the panel state stays here with its siblings.
  const launchDeck = useCallback(
    (deckId: DeckId) => {
      recordPanelOpen(deckId);
      switch (deckId) {
        case "security":
          setSecurityOpen(true);
          break;
        case "second-brain":
          setSecondBrainOpen(true);
          break;
        case "tasks":
          setTaskDeckOpen(true);
          break;
        case "telegram":
          setTelegramOpen(true);
          break;
        case "connected":
          setConnectedOpen(true);
          break;
        case "qr-teleporter":
          setTeleportOpen(true);
          break;
        case "proximity-scanner":
          setProximityOpen(true);
          break;
        case "video-director":
          setVideoDirectorOpen(true);
          break;
        case "room-scanner":
          setRoomScannerOpen(true);
          break;
        case "whiteboard-ocr":
          setWhiteboardOpen(true);
          break;
        case "meeting-shadow":
          setMeetingShadowOpen(true);
          break;
        case "face-crm":
          setFaceCrmOpen(true);
          break;
        case "task-agent":
          setTaskAgentOpen(true);
          break;
        case "mcp-hub":
          setMcpHubOpen(true);
          break;
      }
    },
    [recordPanelOpen]
  );

  // Tier 2: API-based features
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Tier 2: New Implementation Features
  const [skillTrainerOpen, setSkillTrainerOpen] = useState(false);
  const [imageGeneratorOpen, setImageGeneratorOpen] = useState(false);
  const [summarizerOpen, setSummarizerOpen] = useState(false);
  const [webScraperOpen, setWebScraperOpen] = useState(false);
  const [firecrawlOpen, setFirecrawlOpen] = useState(false);
  const [nasaOpen, setNasaOpen] = useState(false);
  const [huggingFaceOpen, setHuggingFaceOpen] = useState(false);
  const [iftttOpen, setIftttOpen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [localLLMOpen, setLocalLLMOpen] = useState(false);
  const [visionOpen, setVisionOpen] = useState(false);

  // Direct API Automation
  const [automationOpen, setAutomationOpen] = useState(false);

  // Price Tracker
  const [priceTrackerOpen, setPriceTrackerOpen] = useState(false);

  // Transcription
  const [transcriptionOpen, setTranscriptionOpen] = useState(false);
  const [playwrightOpen, setPlaywrightOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  // Tier 2A v3: hybrid Firecrawl × Playwright mission control
  const [missionOpen, setMissionOpen] = useState(false);
  const [widgetsOpen, setWidgetsOpen] = useState(false);
  const [secondBrainOpen, setSecondBrainOpen] = useState(false);
  // Unified Task + Timer command deck
  const [taskDeckOpen, setTaskDeckOpen] = useState(false);
  // Ghost Analytics
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  // Record & Replay Macros
  const [macroOpen, setMacroOpen] = useState(false);
  // Tier 4: Wild New Features
  const [teleportOpen, setTeleportOpen] = useState(false);
  const [proximityOpen, setProximityOpen] = useState(false);
  const [videoDirectorOpen, setVideoDirectorOpen] = useState(false);
  const [roomScannerOpen, setRoomScannerOpen] = useState(false);
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  // Tier 5: Flex-Worthy & MCP Features
  const [meetingShadowOpen, setMeetingShadowOpen] = useState(false);
  const [faceCrmOpen, setFaceCrmOpen] = useState(false);
  const [taskAgentOpen, setTaskAgentOpen] = useState(false);
  const [mcpHubOpen, setMcpHubOpen] = useState(false);

  // Handle timer completion - speak notification
  const handleTimerComplete = useCallback((label: string) => {
    const message = label.toLowerCase().includes("alarm")
      ? `Boss, your ${label} is ringing.`
      : `Boss, your ${label} is up.`;
    speak(message);
  }, [speak]);

  // Sync activePanel from store with local panel states
  useEffect(() => {
    if (!activePanel) return;

    // Close all panels first
    setSkillTrainerOpen(false);
    setImageGeneratorOpen(false);
    setSummarizerOpen(false);
    setWebScraperOpen(false);
    setNasaOpen(false);
    setHuggingFaceOpen(false);
    setIftttOpen(false);
    setBrowserOpen(false);
    setLocalLLMOpen(false);
    setVisionOpen(false);
    setAutomationOpen(false);
    setPriceTrackerOpen(false);
    setFirecrawlOpen(false);
    setPlaywrightOpen(false);
    setProxyOpen(false);
    setMissionOpen(false);
    setWidgetsOpen(false);
    setSecondBrainOpen(false);
    setTaskDeckOpen(false);
    setMacroOpen(false);
    setAnalyticsOpen(false);
    setAgentOpen(false);
    setTranscriptionOpen(false);
    setTeleportOpen(false);
    setProximityOpen(false);
    setVideoDirectorOpen(false);
    setRoomScannerOpen(false);
    setWhiteboardOpen(false);
    setMeetingShadowOpen(false);
    setFaceCrmOpen(false);
    setTaskAgentOpen(false);
    setMcpHubOpen(false);

    // Open the requested panel
    switch (activePanel) {
      case "skill-trainer":
        setSkillTrainerOpen(true);
        recordPanelOpen("skill-trainer");
        break;
      case "image-generator":
        setImageGeneratorOpen(true);
        recordPanelOpen("image-generator");
        break;
      case "summarizer":
        setSummarizerOpen(true);
        recordPanelOpen("summarizer");
        break;
      case "web-scraper":
        setWebScraperOpen(true);
        recordPanelOpen("web-scraper");
        break;
      case "nasa":
        setNasaOpen(true);
        recordPanelOpen("nasa");
        break;
      case "huggingface":
        setHuggingFaceOpen(true);
        recordPanelOpen("huggingface");
        break;
      case "ifttt":
        setIftttOpen(true);
        recordPanelOpen("ifttt");
        break;
      case "browser":
        setBrowserOpen(true);
        recordPanelOpen("browser");
        break;
      case "local-llm":
        setLocalLLMOpen(true);
        recordPanelOpen("local-llm");
        break;
      case "vision":
        setVisionOpen(true);
        recordPanelOpen("vision");
        break;
      case "automation":
        setAutomationOpen(true);
        recordPanelOpen("automation");
        break;
      case "price-tracker":
        setPriceTrackerOpen(true);
        recordPanelOpen("price-tracker");
        break;
      case "firecrawl":
        setFirecrawlOpen(true);
        recordPanelOpen("firecrawl");
        break;
      case "transcription":
        setTranscriptionOpen(true);
        recordPanelOpen("transcription");
        break;
      case "playwright":
        setPlaywrightOpen(true);
        recordPanelOpen("playwright");
        break;
      case "proxy":
        setProxyOpen(true);
        recordPanelOpen("proxy");
        break;
      case "agent":
        setAgentOpen(true);
        recordPanelOpen("agent");
        break;
      case "mission":
        setMissionOpen(true);
        recordPanelOpen("mission");
        break;
      case "widgets":
        setWidgetsOpen(true);
        recordPanelOpen("widgets");
        break;
      case "second-brain":
        setSecondBrainOpen(true);
        recordPanelOpen("second-brain");
        break;
      case "analytics":
        setAnalyticsOpen(true);
        recordPanelOpen("analytics");
        break;
      case "macros":
        setMacroOpen(true);
        recordPanelOpen("macros");
        break;
      case "qr-teleporter":
        setTeleportOpen(true);
        recordPanelOpen("qr-teleporter");
        break;
      case "proximity-scanner":
        setProximityOpen(true);
        recordPanelOpen("proximity-scanner");
        break;
      case "video-director":
        setVideoDirectorOpen(true);
        recordPanelOpen("video-director");
        break;
      case "room-scanner":
        setRoomScannerOpen(true);
        recordPanelOpen("room-scanner");
        break;
      case "whiteboard-ocr":
        setWhiteboardOpen(true);
        recordPanelOpen("whiteboard-ocr");
        break;
      case "meeting-shadow":
        setMeetingShadowOpen(true);
        recordPanelOpen("meeting-shadow");
        break;
      case "face-crm":
        setFaceCrmOpen(true);
        recordPanelOpen("face-crm");
        break;
      case "task-agent":
        setTaskAgentOpen(true);
        recordPanelOpen("task-agent");
        break;
      case "mcp-hub":
        setMcpHubOpen(true);
        recordPanelOpen("mcp-hub");
        break;
      case "tasks":
        // Tasks + timers share one command deck.
        setTaskDeckOpen(true);
        recordPanelOpen("tasks");
        break;
      case "chat":
      case "memory":
      case "notes":
      case "code":
        // These are handled by other mechanisms that rely on the global state remaining active
        return;
    }

    // Reset activePanel after opening
    setActivePanel(null);
  }, [activePanel, setActivePanel]);

  // Global keyboard shortcuts for Tier 1 features
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+H: Toggle calculator history
      if (e.ctrlKey && e.key === "h") {
        e.preventDefault();
        // Toggle calculator display by triggering a dummy calculation or using existing
        if (calculations.length === 0) {
          // If no calculations, add a dummy one to show the panel
          addCalculation("0", "0");
        }
      }

      // Ctrl+V: Open Voice Notes
      if (e.ctrlKey && e.key === "v" && e.shiftKey) {
        e.preventDefault();
        setVoiceNotesOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [calculations.length, addCalculation]);

  // The app dock belongs to the JARVIS desktop. Any open panel is modal, so the
  // dock hides (the calculator is excluded — it is a transient overlay and
  // starts open).
  const desktopView = ![
    whatsappOpen, telegramOpen, phoneRemoteOpen, connectedOpen, commHubOpen, securityOpen,
    vaultOpen, dungeonOpen, habitsOpen, voiceNotesOpen, weatherOpen, spotifyOpen, newsOpen,
    calendarOpen, skillTrainerOpen, imageGeneratorOpen, summarizerOpen, webScraperOpen,
    nasaOpen, huggingFaceOpen, iftttOpen, browserOpen, localLLMOpen, visionOpen,
    automationOpen, priceTrackerOpen, transcriptionOpen, playwrightOpen, proxyOpen,
    agentOpen, missionOpen, widgetsOpen, secondBrainOpen, taskDeckOpen, macroOpen, analyticsOpen,
    teleportOpen, proximityOpen, videoDirectorOpen, roomScannerOpen, whiteboardOpen,
    firecrawlOpen, meetingShadowOpen, faceCrmOpen, taskAgentOpen, mcpHubOpen,
  ].some(Boolean);

  return (
    <main className="relative min-h-screen overflow-hidden bg-deep-space">
      {/* Weather-reactive ambient particle background */}
      <WeatherParticles />

      {/* Boot sequence */}
      <BootSequence greeting={bootGreeting} />

      {/* 3D Arc Reactor */}
      <ArcReactor />

      {/* Avengers Assemble — full cinematic sequence (idle until triggered) */}
      <AvengersAssemble />

      {/* Companion: first-boot onboarding interview */}
      {bootComplete && needsOnboarding && (
        <OnboardingModal
          onDone={() => setNeedsOnboarding(false)}
        />
      )}

      {/* UI Panels (only show after boot) */}
      {bootComplete && (
        <>
          {/* Sentinel arm/disarm — consolidated into the top-left app dock */}
          <StatusHUD />
          <ReactorTelemetry />
          <TimerPanel onTimerComplete={handleTimerComplete} />
          <AnimatePresence>
            {calculatorOpen && lastCalculation && (
              <CalculatorDisplay
                key={lastCalculation.id}
                lastCalculation={lastCalculation}
                calculations={calculations}
                onClear={clearHistory}
                onDelete={deleteCalculation}
                onClose={() => setCalculatorOpen(false)}
              />
            )}
          </AnimatePresence>
          <CommandBar
            onCalculate={(expr: string, result: string) => {
              addCalculation(expr, result);
              setCalculatorOpen(true);
            }}
            onOpenWhatsapp={() => { recordPanelOpen("whatsapp"); setWhatsappOpen(true); }}
            onOpenTelegram={() => { recordPanelOpen("telegram"); setTelegramOpen(true); }}
            onOpenPhoneRemote={() => { recordPanelOpen("phone-remote"); setPhoneRemoteOpen(true); }}
            onOpenCommHub={() => { recordPanelOpen("comm-hub"); setCommHubOpen(true); }}
            onOpenSecurity={() => { recordPanelOpen("security"); setSecurityOpen(true); }}
            onOpenVault={() => { recordPanelOpen("vault"); setVaultOpen(true); }}
            onOpenDungeon={() => { recordPanelOpen("dungeon"); setDungeonOpen(true); }}
            onOpenHabits={() => { recordPanelOpen("habits"); setHabitsOpen(true); }}
            onOpenVoiceNotes={() => { recordPanelOpen("voice-notes"); setVoiceNotesOpen(true); }}
            onOpenWeather={() => { recordPanelOpen("weather"); setWeatherOpen(true); }}
            onOpenSpotify={() => { recordPanelOpen("spotify"); setSpotifyOpen(true); }}
            onOpenNews={() => { recordPanelOpen("news"); setNewsOpen(true); }}
            onOpenCalendar={() => { recordPanelOpen("calendar"); setCalendarOpen(true); }}
            onOpenSkillTrainer={() => { recordPanelOpen("skill-trainer"); setSkillTrainerOpen(true); }}
            onOpenImageGenerator={() => { recordPanelOpen("image-generator"); setImageGeneratorOpen(true); }}
            onOpenSummarizer={() => { recordPanelOpen("summarizer"); setSummarizerOpen(true); }}
            onOpenWebScraper={() => { recordPanelOpen("web-scraper"); setWebScraperOpen(true); }}
            onOpenNASA={() => { recordPanelOpen("nasa"); setNasaOpen(true); }}
            onOpenHuggingFace={() => { recordPanelOpen("huggingface"); setHuggingFaceOpen(true); }}
            onOpenIFTTT={() => { recordPanelOpen("ifttt"); setIftttOpen(true); }}
            onOpenBrowser={() => { recordPanelOpen("browser"); setBrowserOpen(true); }}
            onOpenLocalLLM={() => { recordPanelOpen("local-llm"); setLocalLLMOpen(true); }}
            onOpenVision={() => { recordPanelOpen("vision"); setVisionOpen(true); }}
            onOpenAutomation={() => { recordPanelOpen("automation"); setAutomationOpen(true); }}
            onOpenFirecrawl={() => { recordPanelOpen("firecrawl"); setFirecrawlOpen(true); }}
            onOpenMcpHub={() => { recordPanelOpen("mcp-hub"); setMcpHubOpen(true); }}
          />
          <GestureDetector />
          <VideoPlayer />
          <CodePanel />

          {/* WhatsApp Panel */}
          <AnimatePresence>
            {whatsappOpen && (
              <WhatsAppPanel
                onClose={() => setWhatsappOpen(false)}
                onSendMessage={(name, message) => {
                  speak(`Message sent to ${name}, Boss.`);
                }}
              />
            )}
          </AnimatePresence>

          {/* Telegram Panel */}
          <AnimatePresence>
            {telegramOpen && (
              <TelegramPanel
                onClose={() => setTelegramOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Phone-as-arc-remote — QR pairing + status */}
          <AnimatePresence>
            {phoneRemoteOpen && (
              <PhoneRemotePanel onClose={() => setPhoneRemoteOpen(false)} />
            )}
          </AnimatePresence>

          {/* ── Flex features: eyes · air-mouse · gesture DJ ── */}
          <EyeControlOverlay
            onOpenSpotify={() => { recordPanelOpen("spotify"); setSpotifyOpen(true); }}
            onOpenWeather={() => { recordPanelOpen("weather"); setWeatherOpen(true); }}
            onOpenNews={() => { recordPanelOpen("news"); setNewsOpen(true); }}
            onOpenCalendar={() => { recordPanelOpen("calendar"); setCalendarOpen(true); }}
            onOpenVoiceNotes={() => { recordPanelOpen("voice-notes"); setVoiceNotesOpen(true); }}
          />
          <AirMouseControl />
          <GestureDJ />
          <GesturePractice />
          <ScreenNarratorToast />

          {/* Connected Apps Panel */}
          <AnimatePresence>
            {connectedOpen && (
              <ConnectedPanel
                onClose={() => setConnectedOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* App Deck (top-left) — one glass button instead of a row of
              floating launchers. The deck carries every tool, its live state
              and its inline controls, so the home screen stays clean. */}
          {desktopView && <AppDeck onLaunch={launchDeck} />}

          {/* Communication Hub */}
          <AnimatePresence>
            {commHubOpen && (
              <CommunicationHub
                onClose={() => setCommHubOpen(false)}
                onSendMessage={(platform, name, message) => {
                  speak(`${platform} message sent to ${name}, Boss.`);
                }}
              />
            )}
          </AnimatePresence>

          {/* Security Panel */}
          <AnimatePresence>
            {securityOpen && (
              <SecurityPanel
                onClose={() => setSecurityOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Vault Panel */}
          <AnimatePresence>
            {vaultOpen && (
              <VaultPanel
                onClose={() => setVaultOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Dungeon Master */}
          <AnimatePresence>
            {dungeonOpen && (
              <DungeonPanel
                onClose={() => setDungeonOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Reality Check Habits */}
          <AnimatePresence>
            {habitsOpen && (
              <HabitsPanel
                onClose={() => setHabitsOpen(false)}
              />
            )}
          </AnimatePresence>



          {/* Voice Notes */}
          <VoiceNotesPanel
            isOpen={voiceNotesOpen}
            onClose={() => setVoiceNotesOpen(false)}
          />

          {/* Tier 2: Weather Widget */}
          <WeatherPanel
            isOpen={weatherOpen}
            onClose={() => setWeatherOpen(false)}
          />

          {/* Tier 2: Spotify Control */}
          <SpotifyPanel
            isOpen={spotifyOpen}
            onClose={() => setSpotifyOpen(false)}
          />

          {/* Tier 2: News Briefing */}
          <NewsPanel
            isOpen={newsOpen}
            onClose={() => setNewsOpen(false)}
          />

          {/* Tier 2: Google Calendar */}
          <CalendarPanel
            isOpen={calendarOpen}
            onClose={() => setCalendarOpen(false)}
          />

          {/* Tier 2: NEW FEATURES */}
          {/* Skill Trainer */}
          <AnimatePresence>
            {skillTrainerOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-2xl h-[80vh]">
                  <SkillTrainerPanel />
                </div>
                <button
                  onClick={() => setSkillTrainerOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Image Generator */}
          <AnimatePresence>
            {imageGeneratorOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <ImageGeneratorPanel />
                </div>
                <button
                  onClick={() => setImageGeneratorOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Content Summarizer */}
          <AnimatePresence>
            {summarizerOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <SummarizerPanel />
                </div>
                <button
                  onClick={() => setSummarizerOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Web Scraper */}
          <AnimatePresence>
            {webScraperOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <WebScraperPanel />
                </div>
                <button
                  onClick={() => setWebScraperOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Firecrawl */}
          <AnimatePresence>
            {firecrawlOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[85vh]">
                  <FirecrawlPanel />
                </div>
                <button
                  onClick={() => setFirecrawlOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* NASA Explorer */}
          <AnimatePresence>
            {nasaOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-2xl h-[80vh]">
                  <NASAPanel />
                </div>
                <button
                  onClick={() => setNasaOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Hugging Face */}
          <AnimatePresence>
            {huggingFaceOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <HuggingFacePanel />
                </div>
                <button
                  onClick={() => setHuggingFaceOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* IFTTT */}
          <AnimatePresence>
            {iftttOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <IFTTTPanel />
                </div>
                <button
                  onClick={() => setIftttOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Browser Automation */}
          <AnimatePresence>
            {browserOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-2xl h-[80vh]">
                  <BrowserAutomationPanel />
                </div>
                <button
                  onClick={() => setBrowserOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Local LLM */}
          <AnimatePresence>
            {localLLMOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <LocalLLMPanel />
                </div>
                <button
                  onClick={() => setLocalLLMOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Vision AI */}
          <AnimatePresence>
            {visionOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <VisionPanel />
                </div>
                <button
                  onClick={() => setVisionOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Direct API Automations */}
          <AnimatePresence>
            {automationOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-lg h-[80vh]">
                  <AutomationPanel />
                </div>
                <button
                  onClick={() => setAutomationOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Price Tracker */}
          <AnimatePresence>
            {priceTrackerOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-2xl h-[80vh]">
                  <PriceTrackerPanel />
                </div>
                <button
                  onClick={() => setPriceTrackerOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Transcription */}
          <AnimatePresence>
            {transcriptionOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-3xl h-[85vh]">
                  <TranscriptionPanel onClose={() => setTranscriptionOpen(false)} />
                </div>
                <button
                  onClick={() => setTranscriptionOpen(false)}
                  className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
                >
                  ✕
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Autonomous Web Interceptor Proxy */}
          <ProxyPanel
            isOpen={proxyOpen}
            onClose={() => setProxyOpen(false)}
          />

          {/* Tier 2A: Goal agent */}
          <AgentPanel
            isOpen={agentOpen}
            onClose={() => setAgentOpen(false)}
          />

          {/* Tier 2A v3: Mission Control (hybrid Firecrawl × Playwright engine) */}
          <MissionControlPanel
            isOpen={missionOpen}
            onClose={() => setMissionOpen(false)}
          />

          {/* Natural-language widgets (JSON-driven HUD mini-panels) */}
          <WidgetsPanel isOpen={widgetsOpen} onClose={() => setWidgetsOpen(false)} />

          {/* Second Brain — the memory graph as a 3D constellation */}
          <SecondBrainPanel isOpen={secondBrainOpen} onClose={() => setSecondBrainOpen(false)} />

          {/* Command Deck — tasks + timers in one closable dashboard. Stays
              mounted so it can detect new tasks/timers and surface itself. */}
          <TaskTimerDashboard
            isOpen={taskDeckOpen}
            onClose={() => setTaskDeckOpen(false)}
            onNudge={() => setTaskDeckOpen(true)}
          />

          {/* Always-on widget rail on the HUD */}
          <WidgetRail />

          {/* Ghost Analytics Panel */}
          <AnimatePresence>
            {analyticsOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-2xl h-[85vh]">
                  <AnalyticsPanel onClose={() => setAnalyticsOpen(false)} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Record & Replay Macro Panel */}
          <AnimatePresence>
            {macroOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
              >
                <div className="w-full max-w-2xl h-[85vh]">
                  <MacroPanel onClose={() => setMacroOpen(false)} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* QR Code Teleporter */}
          <AnimatePresence>
            {teleportOpen && (
              <QRTeleportPanel onClose={() => setTeleportOpen(false)} />
            )}
          </AnimatePresence>

          {/* Proximity Awareness Radar */}
          <AnimatePresence>
            {proximityOpen && (
              <ProximityPanel onClose={() => setProximityOpen(false)} />
            )}
          </AnimatePresence>

          {/* AI Video Director */}
          <AnimatePresence>
            {videoDirectorOpen && (
              <VideoDirectorPanel onClose={() => setVideoDirectorOpen(false)} />
            )}
          </AnimatePresence>

          {/* Spatial Room Scanner */}
          <AnimatePresence>
            {roomScannerOpen && (
              <RoomScannerPanel onClose={() => setRoomScannerOpen(false)} />
            )}
          </AnimatePresence>

          {/* Whiteboard OCR Live */}
          <AnimatePresence>
            {whiteboardOpen && (
              <WhiteboardOCRPanel onClose={() => setWhiteboardOpen(false)} />
            )}
          </AnimatePresence>

          {/* Real-Time Meeting Shadow (Feature 1) */}
          <AnimatePresence>
            {meetingShadowOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setMeetingShadowOpen(false);
                }}
                className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md cursor-pointer"
              >
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-zinc-950 rounded-2xl border border-cyan-500/40 relative custom-scrollbar cursor-default"
                >
                  <button
                    onClick={() => setMeetingShadowOpen(false)}
                    className="absolute top-4 right-4 z-20 px-3 py-1 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-mono border border-zinc-700 hover:text-white transition-colors cursor-pointer"
                  >
                    CLOSE [ESC]
                  </button>
                  <MeetingShadowPanel />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Face-to-CRM (Feature 2) */}
          <AnimatePresence>
            {faceCrmOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setFaceCrmOpen(false);
                }}
                className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md cursor-pointer"
              >
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-6xl max-h-[92vh] overflow-y-auto bg-zinc-950 rounded-2xl border border-cyan-500/40 relative custom-scrollbar cursor-default"
                >
                  <button
                    onClick={() => setFaceCrmOpen(false)}
                    className="absolute top-4 right-4 z-20 px-3 py-1 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-mono border border-zinc-700 hover:text-white transition-colors cursor-pointer"
                  >
                    CLOSE [ESC]
                  </button>
                  <FaceCrmPanel />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Autonomous Task Agent (Feature 5) */}
          <AnimatePresence>
            {taskAgentOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setTaskAgentOpen(false);
                }}
                className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md cursor-pointer"
              >
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-zinc-950 rounded-2xl border border-cyan-500/40 relative custom-scrollbar cursor-default"
                >
                  <button
                    onClick={() => setTaskAgentOpen(false)}
                    className="absolute top-4 right-4 z-20 px-3 py-1 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-mono border border-zinc-700 hover:text-white transition-colors cursor-pointer"
                  >
                    CLOSE [ESC]
                  </button>
                  <AutonomousTaskAgentPanel />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* MCP Hub (GitHub, Filesystem, Maps, WhatsApp) */}
          <AnimatePresence>
            {mcpHubOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                onClick={(e) => {
                  if (e.target === e.currentTarget) setMcpHubOpen(false);
                }}
                className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md cursor-pointer"
              >
                <div 
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-5xl max-h-[92vh] overflow-y-auto bg-zinc-950 rounded-2xl border border-cyan-500/40 relative custom-scrollbar cursor-default"
                >
                  <button
                    onClick={() => setMcpHubOpen(false)}
                    className="absolute top-4 right-4 z-20 px-3 py-1 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs font-mono border border-zinc-700 hover:text-white transition-colors cursor-pointer"
                  >
                    CLOSE [ESC]
                  </button>
                  <McpHubPanel />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Instant Explain Overlay (Feature 8 - Global Hotkey & Selection) */}
          <ExplainOverlay />

          {/* Sentinel Proactive Suggestion Widget */}
          <SentinelSuggestionWidget />

          {/* Iron Man Diagnostics Panel — right sidebar */}
          <DiagnosticsPanel />
        </>
      )}

      {/* Scan lines overlay */}
      <div className="fixed inset-0 pointer-events-none z-40 scan-lines opacity-20" />
    </main>
  );
}
