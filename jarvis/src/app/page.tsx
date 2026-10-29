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
import PanelWindow from "@/components/ui/PanelWindow";
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
import MeetingStatusPill from "@/components/hud/MeetingStatusPill";
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
import AutomationPanel, { type AutomationTabId } from "@/components/panels/AutomationPanel";
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
import { installFetchGate } from "@/lib/fetchGate";
import { prefetchVisionAssets } from "@/lib/visionPrefetch";

// Install the same-origin request gate at module scope, before any poller or
// camera/model request can go out. See src/lib/fetchGate.ts for why.
installFetchGate();

// Start pulling the MediaPipe assets straight away — the earliest point in the
// app's life, before the heavy UI mounts — so the 12MB wasm is already in the
// HTTP cache by the time a vision feature asks for it. See visionPrefetch.ts:
// cold, that fetch measured 17.9–53.3s on this machine, all of it the page
// being too busy to drain the response.
prefetchVisionAssets();

/**
 * Warm both vision engines. Shared by EVERY way in — power-on, Enter/Space,
 * Escape and the skip button — because the skip paths used to skip the warmup
 * entirely, so the first air-mouse/eye toggle paid the full wasm + model +
 * camera cost while the app was still booting, which is how a feature ends up
 * saying "loading model…" for a minute.
 *
 * Staggered, not parallel: both engines sit on the same wasm runtime, so
 * warming them at once just means two concurrent 12MB loads racing the boot.
 */
let visionWarmupStarted = false;
function warmVisionEngines(): void {
  if (visionWarmupStarted || typeof window === "undefined") return;
  visionWarmupStarted = true;
  prefetchVisionAssets();
  void import("@/hooks/useHandControl")
    .then((m) => m.warmHandEngine())
    .catch(() => {})
    .finally(() => {
      void import("@/hooks/useEyeControl")
        .then((m) => m.warmEyeEngine())
        .catch(() => {});
    });
}

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
    warmVisionEngines();
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
        warmVisionEngines();
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
    warmVisionEngines();
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
import { useProactiveCompanion } from "@/hooks/useProactiveCompanion";
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
  // Proactive companion: speaks unprompted when natural with anti-annoyance filters.
  useProactiveCompanion();
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
  // Landing tab for the panel — the in-meeting pill opens it on the Bot tab.
  const [automationTab, setAutomationTab] = useState<AutomationTabId>("notion");

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

  // Panels are windows now, not modals: several can be open at once and the
  // desktop (dock, reactor, command bar) stays live underneath them. So the app
  // dock is always mounted instead of hiding behind whichever panel is open.

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
          {/* Way back into a running meeting: the bot stays in the call when the
              automation panel is closed, so this pill reopens that view in one
              tap while a session is live (and hides itself once it is not). */}
          <MeetingStatusPill
            hidden={automationOpen}
            onOpen={() => {
              setAutomationTab("meeting");
              recordPanelOpen("automation");
              setAutomationOpen(true);
            }}
          />
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
          <PanelWindow
            id="whatsapp"
            title="WhatsApp"
            open={whatsappOpen}
            onClose={() => setWhatsappOpen(false)}
            showClose={false}
            size={{ w: 460, h: 720 }}
          >
            <WhatsAppPanel
              onClose={() => setWhatsappOpen(false)}
              onSendMessage={(name, message) => {
                speak(`Message sent to ${name}, Boss.`);
              }}
            />
          </PanelWindow>

          {/* Telegram Panel */}
          <PanelWindow
            id="telegram"
            title="Telegram"
            open={telegramOpen}
            onClose={() => setTelegramOpen(false)}
            showClose={false}
            size={{ w: 560, h: 700 }}
          >
            <TelegramPanel onClose={() => setTelegramOpen(false)} />
          </PanelWindow>

          {/* Phone-as-arc-remote — QR pairing + status */}
          <PanelWindow
            id="phone-remote"
            title="Phone Remote"
            open={phoneRemoteOpen}
            onClose={() => setPhoneRemoteOpen(false)}
            showClose={false}
            size={{ w: 520, h: 640 }}
          >
            <PhoneRemotePanel onClose={() => setPhoneRemoteOpen(false)} />
          </PanelWindow>

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
          <PanelWindow
            id="connected"
            title="Connected Apps"
            open={connectedOpen}
            onClose={() => setConnectedOpen(false)}
            showClose={false}
            size={{ w: 720, h: 680 }}
          >
            <ConnectedPanel onClose={() => setConnectedOpen(false)} />
          </PanelWindow>

          {/* App Deck (top-left) — one glass button instead of a row of
              floating launchers. The deck carries every tool, its live state
              and its inline controls, so the home screen stays clean. */}
          <AppDeck onLaunch={launchDeck} />

          {/* Communication Hub */}
          <PanelWindow
            id="comm-hub"
            title="Communication Hub"
            open={commHubOpen}
            onClose={() => setCommHubOpen(false)}
            showClose={false}
            size={{ w: 640, h: 640 }}
          >
            <CommunicationHub
              onClose={() => setCommHubOpen(false)}
              onSendMessage={(platform, name, message) => {
                speak(`${platform} message sent to ${name}, Boss.`);
              }}
            />
          </PanelWindow>

          {/* Security Panel */}
          <PanelWindow
            id="security"
            title="Security"
            open={securityOpen}
            onClose={() => setSecurityOpen(false)}
            showClose={false}
            size={{ w: 480, h: 720 }}
          >
            <SecurityPanel onClose={() => setSecurityOpen(false)} />
          </PanelWindow>

          {/* Vault Panel */}
          <PanelWindow
            id="vault"
            title="Vault"
            open={vaultOpen}
            onClose={() => setVaultOpen(false)}
            showClose={false}
            size={{ w: 460, h: 680 }}
          >
            <VaultPanel onClose={() => setVaultOpen(false)} />
          </PanelWindow>

          {/* Dungeon Master */}
          <PanelWindow
            id="dungeon"
            title="Dungeon Master"
            open={dungeonOpen}
            onClose={() => setDungeonOpen(false)}
            showClose={false}
            size={{ w: 820, h: 700 }}
          >
            <DungeonPanel onClose={() => setDungeonOpen(false)} />
          </PanelWindow>

          {/* Reality Check Habits */}
          <PanelWindow
            id="habits"
            title="Reality Check"
            open={habitsOpen}
            onClose={() => setHabitsOpen(false)}
            showClose={false}
            size={{ w: 440, h: 700 }}
          >
            <HabitsPanel onClose={() => setHabitsOpen(false)} />
          </PanelWindow>

          {/* Voice Notes */}
          <PanelWindow
            id="voice-notes"
            title="Voice Notes"
            open={voiceNotesOpen}
            onClose={() => setVoiceNotesOpen(false)}
            showClose={false}
          >
            <VoiceNotesPanel isOpen onClose={() => setVoiceNotesOpen(false)} />
          </PanelWindow>

          {/* Tier 2: Weather Widget */}
          <PanelWindow
            id="weather"
            title="Weather Station"
            open={weatherOpen}
            onClose={() => setWeatherOpen(false)}
            showClose={false}
          >
            <WeatherPanel isOpen onClose={() => setWeatherOpen(false)} />
          </PanelWindow>

          {/* Tier 2: Spotify Control */}
          <PanelWindow
            id="spotify"
            title="Spotify"
            open={spotifyOpen}
            onClose={() => setSpotifyOpen(false)}
            showClose={false}
          >
            <SpotifyPanel isOpen onClose={() => setSpotifyOpen(false)} />
          </PanelWindow>

          {/* Tier 2: News Briefing */}
          <PanelWindow
            id="news"
            title="News Briefing"
            open={newsOpen}
            onClose={() => setNewsOpen(false)}
            showClose={false}
            size={{ w: 780, h: 680 }}
          >
            <NewsPanel isOpen onClose={() => setNewsOpen(false)} />
          </PanelWindow>

          {/* Tier 2: Google Calendar */}
          <PanelWindow
            id="calendar"
            title="Calendar"
            open={calendarOpen}
            onClose={() => setCalendarOpen(false)}
            showClose={false}
            size={{ w: 720, h: 660 }}
          >
            <CalendarPanel isOpen onClose={() => setCalendarOpen(false)} />
          </PanelWindow>

          {/* Tier 2: NEW FEATURES */}
          {/* Skill Trainer */}
          <PanelWindow
            id="skill-trainer"
            title="Skill Trainer"
            open={skillTrainerOpen}
            onClose={() => setSkillTrainerOpen(false)}
          >
            <SkillTrainerPanel />
          </PanelWindow>

          {/* Image Generator */}
          <PanelWindow
            id="image-generator"
            title="Image Generator"
            open={imageGeneratorOpen}
            onClose={() => setImageGeneratorOpen(false)}
            size={{ w: 640, h: 700 }}
          >
            <ImageGeneratorPanel />
          </PanelWindow>

          {/* Content Summarizer */}
          <PanelWindow
            id="summarizer"
            title="Summarizer"
            open={summarizerOpen}
            onClose={() => setSummarizerOpen(false)}
            size={{ w: 640, h: 660 }}
          >
            <SummarizerPanel />
          </PanelWindow>

          {/* Web Scraper */}
          <PanelWindow
            id="web-scraper"
            title="Web Scraper"
            open={webScraperOpen}
            onClose={() => setWebScraperOpen(false)}
            size={{ w: 640, h: 700 }}
          >
            <WebScraperPanel />
          </PanelWindow>

          {/* Firecrawl */}
          <PanelWindow
            id="firecrawl"
            title="Firecrawl"
            open={firecrawlOpen}
            onClose={() => setFirecrawlOpen(false)}
            size={{ w: 660, h: 720 }}
          >
            <FirecrawlPanel />
          </PanelWindow>

          {/* NASA Explorer */}
          <PanelWindow
            id="nasa"
            title="NASA Explorer"
            open={nasaOpen}
            onClose={() => setNasaOpen(false)}
            size={{ w: 880, h: 700 }}
          >
            <NASAPanel />
          </PanelWindow>

          {/* Hugging Face */}
          <PanelWindow
            id="huggingface"
            title="Hugging Face"
            open={huggingFaceOpen}
            onClose={() => setHuggingFaceOpen(false)}
            size={{ w: 700, h: 700 }}
          >
            <HuggingFacePanel />
          </PanelWindow>

          {/* IFTTT */}
          <PanelWindow
            id="ifttt"
            title="IFTTT"
            open={iftttOpen}
            onClose={() => setIftttOpen(false)}
            size={{ w: 640, h: 640 }}
          >
            <IFTTTPanel />
          </PanelWindow>

          {/* Browser Automation */}
          <PanelWindow
            id="browser"
            title="Browser Automation"
            open={browserOpen}
            onClose={() => setBrowserOpen(false)}
            size={{ w: 880, h: 700 }}
          >
            <BrowserAutomationPanel />
          </PanelWindow>

          {/* Local LLM */}
          <PanelWindow
            id="local-llm"
            title="Local LLM"
            open={localLLMOpen}
            onClose={() => setLocalLLMOpen(false)}
            size={{ w: 640, h: 680 }}
          >
            <LocalLLMPanel />
          </PanelWindow>

          {/* Vision AI */}
          <PanelWindow
            id="vision"
            title="Vision AI"
            open={visionOpen}
            onClose={() => setVisionOpen(false)}
            size={{ w: 660, h: 680 }}
          >
            <VisionPanel />
          </PanelWindow>

          {/* Direct API Automations */}
          <PanelWindow
            id="automation"
            title="Automation"
            open={automationOpen}
            onClose={() => {
              // Reset the landing tab so any later open starts on the default.
              setAutomationTab("notion");
              setAutomationOpen(false);
            }}
            // The meeting console is a two-column workspace (setup | notes, Q&A,
            // revision), so it opens wide; the other tabs are settings forms.
            size={automationTab === "meeting" ? { w: 1240, h: 860 } : { w: 720, h: 720 }}
          >
            <AutomationPanel initialTab={automationTab} />
          </PanelWindow>

          {/* Price Tracker */}
          <PanelWindow
            id="price-tracker"
            title="Price Tracker"
            open={priceTrackerOpen}
            onClose={() => setPriceTrackerOpen(false)}
            size={{ w: 860, h: 680 }}
          >
            <PriceTrackerPanel />
          </PanelWindow>

          {/* Transcription */}
          <PanelWindow
            id="transcription"
            title="Transcription"
            open={transcriptionOpen}
            onClose={() => setTranscriptionOpen(false)}
            showClose={false}
            size={{ w: 960, h: 660 }}
          >
            <TranscriptionPanel onClose={() => setTranscriptionOpen(false)} />
          </PanelWindow>

          {/* Autonomous Web Interceptor Proxy */}
          <PanelWindow
            id="proxy"
            title="Interceptor Proxy"
            open={proxyOpen}
            onClose={() => setProxyOpen(false)}
            showClose={false}
            size={{ w: 480, h: 700 }}
          >
            <ProxyPanel isOpen onClose={() => setProxyOpen(false)} />
          </PanelWindow>

          {/* Tier 2A: Goal agent */}
          <PanelWindow
            id="agent"
            title="Goal Agent"
            open={agentOpen}
            onClose={() => setAgentOpen(false)}
            showClose={false}
            size={{ w: 560, h: 700 }}
          >
            <AgentPanel isOpen onClose={() => setAgentOpen(false)} />
          </PanelWindow>

          {/* Tier 2A v3: Mission Control (hybrid Firecrawl × Playwright engine) */}
          <PanelWindow
            id="mission"
            title="Mission Control"
            open={missionOpen}
            onClose={() => setMissionOpen(false)}
            showClose={false}
            size={{ w: 900, h: 720 }}
          >
            <MissionControlPanel isOpen onClose={() => setMissionOpen(false)} />
          </PanelWindow>

          {/* Natural-language widgets (JSON-driven HUD mini-panels) */}
          <PanelWindow
            id="widgets"
            title="Widgets"
            open={widgetsOpen}
            onClose={() => setWidgetsOpen(false)}
            showClose={false}
            size={{ w: 560, h: 700 }}
          >
            <WidgetsPanel isOpen onClose={() => setWidgetsOpen(false)} />
          </PanelWindow>

          {/* Second Brain — the memory graph as a 3D constellation */}
          <PanelWindow
            id="second-brain"
            title="Second Brain"
            open={secondBrainOpen}
            onClose={() => setSecondBrainOpen(false)}
            showClose={false}
            size={{ w: 1000, h: 720 }}
          >
            <SecondBrainPanel isOpen onClose={() => setSecondBrainOpen(false)} />
          </PanelWindow>

          {/* Command Deck — tasks + timers in one closable dashboard. Stays
              mounted so it can detect new tasks/timers and surface itself. */}
          <PanelWindow
            id="tasks"
            title="Command Deck"
            open={taskDeckOpen}
            onClose={() => setTaskDeckOpen(false)}
            showClose={false}
            keepMounted
            size={{ w: 880, h: 680 }}
          >
            <TaskTimerDashboard
              isOpen
              onClose={() => setTaskDeckOpen(false)}
              onNudge={() => setTaskDeckOpen(true)}
            />
          </PanelWindow>

          {/* Always-on widget rail on the HUD */}
          <WidgetRail />

          {/* Ghost Analytics Panel */}
          <PanelWindow
            id="analytics"
            title="Ghost Analytics"
            open={analyticsOpen}
            onClose={() => setAnalyticsOpen(false)}
            showClose={false}
            size={{ w: 900, h: 700 }}
          >
            <AnalyticsPanel onClose={() => setAnalyticsOpen(false)} />
          </PanelWindow>

          {/* Record & Replay Macro Panel */}
          <PanelWindow
            id="macros"
            title="Macros"
            open={macroOpen}
            onClose={() => setMacroOpen(false)}
            showClose={false}
            size={{ w: 900, h: 700 }}
          >
            <MacroPanel onClose={() => setMacroOpen(false)} />
          </PanelWindow>

          {/* QR Code Teleporter */}
          <PanelWindow
            id="qr-teleporter"
            title="QR Teleporter"
            open={teleportOpen}
            onClose={() => setTeleportOpen(false)}
            showClose={false}
            size={{ w: 820, h: 680 }}
          >
            <QRTeleportPanel onClose={() => setTeleportOpen(false)} />
          </PanelWindow>

          {/* Proximity Awareness Radar */}
          <PanelWindow
            id="proximity-scanner"
            title="Proximity Radar"
            open={proximityOpen}
            onClose={() => setProximityOpen(false)}
            showClose={false}
            size={{ w: 820, h: 700 }}
          >
            <ProximityPanel onClose={() => setProximityOpen(false)} />
          </PanelWindow>

          {/* AI Video Director */}
          <PanelWindow
            id="video-director"
            title="Video Director"
            open={videoDirectorOpen}
            onClose={() => setVideoDirectorOpen(false)}
            showClose={false}
            size={{ w: 900, h: 720 }}
          >
            <VideoDirectorPanel onClose={() => setVideoDirectorOpen(false)} />
          </PanelWindow>

          {/* Spatial Room Scanner */}
          <PanelWindow
            id="room-scanner"
            title="Room Scanner"
            open={roomScannerOpen}
            onClose={() => setRoomScannerOpen(false)}
            showClose={false}
            size={{ w: 860, h: 720 }}
          >
            <RoomScannerPanel onClose={() => setRoomScannerOpen(false)} />
          </PanelWindow>

          {/* Whiteboard OCR Live */}
          <PanelWindow
            id="whiteboard-ocr"
            title="Whiteboard OCR"
            open={whiteboardOpen}
            onClose={() => setWhiteboardOpen(false)}
            showClose={false}
            size={{ w: 900, h: 720 }}
          >
            <WhiteboardOCRPanel onClose={() => setWhiteboardOpen(false)} />
          </PanelWindow>

          {/* Real-Time Meeting Shadow (Feature 1) */}
          <PanelWindow
            id="meeting-shadow"
            title="Meeting Shadow"
            open={meetingShadowOpen}
            onClose={() => setMeetingShadowOpen(false)}
            size={{ w: 1080, h: 720 }}
          >
            <div className="h-full w-full overflow-y-auto custom-scrollbar">
              <MeetingShadowPanel />
            </div>
          </PanelWindow>

          {/* Face-to-CRM (Feature 2) */}
          <PanelWindow
            id="face-crm"
            title="Face to CRM"
            open={faceCrmOpen}
            onClose={() => setFaceCrmOpen(false)}
            size={{ w: 1120, h: 740 }}
          >
            <div className="h-full w-full overflow-y-auto custom-scrollbar">
              <FaceCrmPanel />
            </div>
          </PanelWindow>

          {/* Autonomous Task Agent (Feature 5) */}
          <PanelWindow
            id="task-agent"
            title="Task Agent"
            open={taskAgentOpen}
            onClose={() => setTaskAgentOpen(false)}
            size={{ w: 1000, h: 720 }}
          >
            <div className="h-full w-full overflow-y-auto custom-scrollbar">
              <AutonomousTaskAgentPanel />
            </div>
          </PanelWindow>

          {/* MCP Hub (GitHub, Filesystem, Maps, WhatsApp) */}
          <PanelWindow
            id="mcp-hub"
            title="MCP Hub"
            open={mcpHubOpen}
            onClose={() => setMcpHubOpen(false)}
            size={{ w: 1000, h: 720 }}
          >
            <div className="h-full w-full overflow-y-auto custom-scrollbar">
              <McpHubPanel />
            </div>
          </PanelWindow>

          {/* Browser console (Playwright) — same window shell as every other
              panel, so it can sit beside the mission it is driving. */}
          <PanelWindow
            id="playwright"
            title="Playwright Logs"
            open={playwrightOpen}
            onClose={() => setPlaywrightOpen(false)}
            showClose={false}
            size={{ w: 520, h: 620 }}
          >
            <PlaywrightPanel isOpen onClose={() => setPlaywrightOpen(false)} />
          </PanelWindow>

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
