"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { QrCode, Radio, Clapperboard, Scan, FileText, Brain, ListTodo } from "lucide-react";
import ArcReactor from "@/components/reactor/ArcReactor";
import AvengersAssemble from "@/components/cinematic/AvengersAssemble";
import StatusHUD from "@/components/panels/StatusHUD";
import DiagnosticsPanel from "@/components/panels/DiagnosticsPanel";
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
import CommunicationHub from "@/components/panels/CommunicationHub";
import SecurityPanel from "@/components/panels/SecurityPanel";
import SentinelArmToggle from "@/components/panels/SentinelArmToggle";
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
function BootSequence() {
  const bootComplete = useJarvisStore((s) => s.bootComplete);
  const setUserInteracted = useJarvisStore((s) => s.setUserInteracted);
  const [powered, setPowered] = useState(false);
  const [bootFinished, setBootFinished] = useState(false);

  useEffect(() => {
    if (bootComplete && powered) {
      const timer = setTimeout(() => setBootFinished(true), 3600);
      return () => clearTimeout(timer);
    }
  }, [bootComplete, powered]);

  const pressPower = useCallback(() => {
    if (powered) return;
    setPowered(true);
    setUserInteracted(true);
    // Prime the speech engine inside the same gesture (autoplay policy).
    try {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
      }
    } catch {}
    // Pre-warm the vision engines while the boot animation plays: both wasm
    // runtimes + models compile in the background, so toggling air-mouse or
    // eye control afterwards attaches to a hot engine instead of freezing
    // mid-bootload ("air mouse took 15 minutes to load").
    import("@/hooks/useHandControl").then((m) => m.warmHandEngine()).catch(() => {});
    import("@/hooks/useEyeControl").then((m) => m.warmEyeEngine()).catch(() => {});
    // Unlock + warm the cinematic score context in this same gesture, so the
    // first "Avengers Assemble" can detonate instantly (autoplay policy).
    primeScore();
    // The reactor listens for this — starts assembly + soundtrack.
    useJarvisStore.getState().startAssembly();
    window.dispatchEvent(new Event("jarvis:power-gate"));
  }, [powered, setUserInteracted]);

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
              Systems online. Good {getGreeting()}, Boss.
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
              PRESS TO POWER ON
            </motion.p>
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

function fallbackGreeting(): string {
  // Delegates to the legacy greeting pool so it stays as a graceful
  // fallback when the companion API is unreachable.
  return resolveGreeting();
}

const GREETING_POOL = [
  "Welcome back, Boss. Systems are operational and the core is stable.",
  "Good {timeOfDay}, Boss. I've been refining the protocols while you were away.",
  "At your service, Boss. All panels are online and ready for your command.",
  "Back so soon? I was just starting to enjoy the quiet. Just kidding, Boss.",
  "The arc reactor is at peak efficiency. Good {timeOfDay}, Boss.",
  "I've optimized your memory buffers and cleared the cache. Welcome back, Boss.",
  "The world hasn't ended yet, Boss. I checked while you were gone.",
  "Protocols engaged. Everything is ready for your next project, Boss.",
  "Good {timeOfDay}. I've prepared your dashboard with the latest data, Boss.",
  "Systems initialized. It's good to see you, Boss. How can I assist you?",
  "Welcome back, Boss. The Bangalore weather is currently {weather}.",
  "Good {timeOfDay}, Boss. I've synchronized the systems with Bangalore standard time.",
  "Systems online. It's a fine {timeOfDay} in Bangalore, wouldn't you agree, Boss?",
  "Greetings, Boss. I see some new activity in the tech sector: {news}.",
  "Ready for work, Boss? I've calibrated the sensors for the {weather} climate in Bangalore.",
  "Greetings. The latest headlines are reporting that {news}. I can give you a full briefing whenever you're ready, Boss.",
  "Still at it, Boss? It's a bit {timeOfDay}, but the systems are ready whenever you are.",
  "Working hard, or hardly working? It's {timeOfDay} in Bangalore, Boss. I've dimmed the holographic displays for your comfort.",
  "The city of Bangalore is quiet, but the core is humming. Good {timeOfDay}, Boss."
];

function resolveGreeting(context?: any, tasks?: any[]) {
  const timeOfDay = getGreeting();
  const template = GREETING_POOL[Math.floor(Math.random() * GREETING_POOL.length)];
  
  let greeting = template
    .replace(/{timeOfDay}/g, timeOfDay);

  if (context) {
    greeting = greeting
      .replace(/{weather}/g, context.weather || "clear")
      .replace(/{news}/g, context.topNews || "the tech world is evolving");

    const healthMsg = ` CPU is running at ${context.cpuTemp} degrees with ${context.memoryUsed} gigabytes of memory active. Systems are ${context.status}.`;
    
    // Add task info if available
    let taskMsg = "";
    if (tasks && tasks.length > 0) {
      const criticalTasks = tasks.filter(t => t.priority === "critical" && !t.completed);
      const highTasks = tasks.filter(t => t.priority === "high" && !t.completed);
      
      if (criticalTasks.length > 0) {
        taskMsg = ` You have ${criticalTasks.length} critical ${criticalTasks.length === 1 ? 'task' : 'tasks'} pending, Boss. We should probably start there.`;
      } else if (highTasks.length > 0) {
        taskMsg = ` You have ${highTasks.length} high priority tasks to address today.`;
      }
    }

    return greeting + healthMsg + taskMsg;
  }

  return greeting;
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

  useEffect(() => {
    if (bootComplete && userInteracted && !hasGreetedRef.current) {
      hasGreetedRef.current = true;
      
      const triggerGreeting = async () => {
        // Personal companion greeting — built from real context: how long
        // you were away, your recent mood, open follow-up threads, and
        // late-night awareness. Falls back to the legacy pool on failure.
        const companion = await fetchCompanionGreeting();
        let greeting = companion?.greeting || fallbackGreeting();

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
    firecrawlOpen,
  ].some(Boolean);

  return (
    <main className="relative min-h-screen overflow-hidden bg-deep-space">
      {/* Weather-reactive ambient particle background */}
      <WeatherParticles />

      {/* Boot sequence */}
      <BootSequence />

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

          {/* Holographic App Dock (top-left) — home screen only. Every panel is
              modal, so the dock steps aside instead of floating over it. */}
          {desktopView && (
          <div className="fixed top-12 sm:top-16 left-2 sm:left-5 z-[75] flex items-center gap-1.5 sm:gap-2.5 overflow-x-auto max-w-[calc(100vw-1rem)] sm:max-w-none pb-1 no-scrollbar">
            <SentinelArmToggle />

            {/* Second Brain launcher */}
            <motion.button
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                recordPanelOpen("second-brain");
                setSecondBrainOpen(true);
              }}
              title="Second Brain — your memory constellation"
              aria-label="Open Second Brain"
              className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-400/50 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240]"
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500/25 to-violet-600/10 opacity-70 group-hover:opacity-100 transition-opacity" />
              <Brain className="w-5 h-5 text-cyan-300 group-hover:text-cyan-100 transition-colors drop-shadow-[0_0_8px_rgba(0,243,255,0.8)] relative z-10" />
            </motion.button>

            {/* Command Deck — tasks + timers */}
            <motion.button
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                recordPanelOpen("tasks");
                setTaskDeckOpen(true);
              }}
              title="Command Deck — your tasks and timers"
              aria-label="Open Command Deck"
              className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-amber-400/50 hover:border-amber-300 bg-[#1a1206]/90 hover:bg-[#241a08]"
            >
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-amber-500/25 to-orange-600/10 opacity-70 group-hover:opacity-100 transition-opacity" />
              <ListTodo className="w-5 h-5 text-amber-300 group-hover:text-amber-100 transition-colors drop-shadow-[0_0_8px_rgba(255,190,60,0.8)] relative z-10" />
            </motion.button>

            {/* Telegram quick-launch button */}
            <AnimatePresence>
              {!telegramOpen && (
                <motion.button
                  key="telegram-launcher"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileHover={{ scale: 1.08, y: -1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    recordPanelOpen("telegram");
                    setTelegramOpen(true);
                  }}
                  title="Open Telegram Bot Relay"
                  aria-label="Open Telegram Bot Relay"
                  className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-400/40 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240]"
                >
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500/25 to-blue-600/10 opacity-70 group-hover:opacity-100 transition-opacity" />
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="w-5 h-5 text-cyan-400 group-hover:text-cyan-200 transition-colors drop-shadow-[0_0_8px_rgba(0,243,255,0.7)] relative z-10"
                    aria-hidden="true"
                  >
                    <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.73 12.86c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
                  </svg>
                  {/* Glowing online indicator dot */}
                  <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-cyan-400 ring-2 ring-[#061426] shadow-[0_0_8px_#00f3ff]" />
                </motion.button>
              )}
            </AnimatePresence>

            {/* Connected Apps launcher */}
            <AnimatePresence>
              {!connectedOpen && (
                <motion.button
                  key="connected-launcher"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileHover={{ scale: 1.08, y: -1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => {
                    recordPanelOpen("connected");
                    setConnectedOpen(true);
                  }}
                  title="Open Connected Apps"
                  aria-label="Open Connected Apps"
                  className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-500/40 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240]"
                >
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500/25 to-teal-600/10 opacity-70 group-hover:opacity-100 transition-opacity" />
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="w-5 h-5 text-cyan-400 group-hover:text-cyan-200 transition-colors drop-shadow-[0_0_8px_rgba(0,243,255,0.7)] relative z-10"
                    aria-hidden="true"
                  >
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>

            {/* QR Teleporter launcher */}
            <motion.button
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                recordPanelOpen("qr-teleporter");
                setTeleportOpen(true);
              }}
              title="Quantum QR Teleporter (Beam to Phone)"
              aria-label="Quantum QR Teleporter"
              className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-500/40 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240]"
            >
              <QrCode className="w-5 h-5 text-cyan-400 group-hover:text-cyan-200 transition-colors drop-shadow-[0_0_8px_rgba(0,243,255,0.7)]" />
            </motion.button>

            {/* Proximity Awareness Radar launcher */}
            <motion.button
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                recordPanelOpen("proximity-scanner");
                setProximityOpen(true);
              }}
              title="Proximity Radar & Desk Presence"
              aria-label="Proximity Radar"
              className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-500/40 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240]"
            >
              <Radio className="w-5 h-5 text-green-400 group-hover:text-green-200 transition-colors drop-shadow-[0_0_8px_rgba(0,255,136,0.7)]" />
            </motion.button>

            {/* AI Video Director launcher */}
            <motion.button
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                recordPanelOpen("video-director");
                setVideoDirectorOpen(true);
              }}
              title="Stark Cinema AI Video Director"
              aria-label="AI Video Director"
              className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-500/40 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240]"
            >
              <Clapperboard className="w-5 h-5 text-amber-400 group-hover:text-amber-200 transition-colors drop-shadow-[0_0_8px_rgba(255,170,0,0.7)]" />
            </motion.button>

            {/* Spatial Room Scanner launcher */}
            <motion.button
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                recordPanelOpen("room-scanner");
                setRoomScannerOpen(true);
              }}
              title="Spatial Desk & Room Scanner"
              aria-label="Spatial Room Scanner"
              className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-500/40 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240]"
            >
              <Scan className="w-5 h-5 text-cyan-400 group-hover:text-cyan-200 transition-colors drop-shadow-[0_0_8px_rgba(0,243,255,0.7)]" />
            </motion.button>



            {/* Whiteboard OCR launcher */}
            <motion.button
              whileHover={{ scale: 1.08, y: -1 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                recordPanelOpen("whiteboard-ocr");
                setWhiteboardOpen(true);
              }}
              title="Whiteboard OCR & Schematic Digitizer"
              aria-label="Whiteboard OCR"
              className="w-11 h-11 aspect-square shrink-0 !rounded-full outline-none focus-visible:!outline-none flex items-center justify-center relative group transition-all duration-300 backdrop-blur-md border border-cyan-500/40 hover:border-cyan-300 bg-[#061426]/90 hover:bg-[#092240] shrink-0"
            >
              <FileText className="w-5 h-5 text-purple-400 group-hover:text-purple-200 transition-colors drop-shadow-[0_0_8px_rgba(168,85,247,0.7)]" />
            </motion.button>
          </div>
          )}

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
