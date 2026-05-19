"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ArcReactor from "@/components/reactor/ArcReactor";
import StatusHUD from "@/components/panels/StatusHUD";
import MemoryPanel from "@/components/panels/MemoryPanel";
import TaskPanel from "@/components/panels/TaskPanel";
import CommandBar from "@/components/panels/CommandBar";
import TimerPanel from "@/components/panels/TimerPanel";
import CalculatorDisplay, { useCalculatorHistory } from "@/components/panels/CalculatorDisplay";
import GestureDetector from "@/components/ui/GestureDetector";
import VideoPlayer from "@/components/ui/VideoPlayer";
import CodePanel from "@/components/panels/CodePanel";
import WhatsAppPanel from "@/components/panels/WhatsAppPanel";
import InstagramPanel from "@/components/panels/InstagramPanel";
import TelegramPanel from "@/components/panels/TelegramPanel";
import CommunicationHub from "@/components/panels/CommunicationHub";
import SecurityPanel from "@/components/panels/SecurityPanel";
import VaultPanel from "@/components/panels/VaultPanel";
import DungeonPanel from "@/components/panels/DungeonPanel";
import HabitsPanel from "@/components/panels/HabitsPanel";
import TimeCapsulePanel from "@/components/panels/TimeCapsulePanel";
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
import { useJarvisStore } from "@/store/jarvis.store";
import { useTextToSpeech } from "@/hooks/useVoice";

// Boot sequence overlay
function BootSequence() {
  const { bootProgress, bootComplete, userInteracted, setUserInteracted } = useJarvisStore();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (bootComplete) {
      const timer = setTimeout(() => setShowWelcome(true), 100);
      return () => clearTimeout(timer);
    }
  }, [bootComplete]);

  if (bootComplete && showWelcome) {
    return (
      <AnimatePresence>
        {!userInteracted ? (
          <motion.div
            key="authorization-overlay"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-deep-space/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center"
            >
              <motion.div
                animate={{ scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="mb-8"
              >
                <div className="w-24 h-24 mx-auto rounded-full border-2 border-reactor-core/30 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-reactor-core/20 animate-pulse" />
                </div>
              </motion.div>
              
              <h1 className="font-orbitron text-3xl text-reactor-core mb-2">SYSTEM READY</h1>
              <p className="font-rajdhani text-text-secondary mb-8 tracking-widest uppercase">Waiting for Authorization</p>
              
              <motion.button
                whileHover={{ scale: 1.05, boxShadow: "0 0 20px rgba(0, 243, 255, 0.5)" }}
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  setUserInteracted(true);
                  // Optional: Prime audio engine immediately with a short chime or silent speak
                  if (typeof window !== 'undefined' && window.speechSynthesis) {
                    const silence = new SpeechSynthesisUtterance("");
                    window.speechSynthesis.speak(silence);
                  }
                }}
                className="px-8 py-3 bg-transparent border border-reactor-core text-reactor-core font-orbitron text-sm tracking-widest hover:bg-reactor-core/10 transition-all"
              >
                INITIALIZE PROTOCOLS
              </motion.button>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1, delay: 2 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="font-orbitron text-4xl md:text-6xl text-reactor-core glow-text mb-4"
              >
                J.A.R.V.I.S.
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-deep-space flex items-center justify-center">
      <div className="w-96">
        {/* Progress bar */}
        <div className="relative h-1 bg-panel-border/30 rounded-full overflow-hidden">
          <motion.div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-reactor-core to-reactor-glow rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${bootProgress}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>

        {/* Boot text */}
        <div className="mt-4 font-rajdhani text-xs text-text-secondary/50 space-y-1">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: bootProgress > 10 ? 1 : 0 }}
          >
            {'>'} Initializing arc reactor core...
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: bootProgress > 30 ? 1 : 0 }}
          >
            {'>'} Loading energy segments...
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: bootProgress > 50 ? 1 : 0 }}
          >
            {'>'} Calibrating ring rotation...
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: bootProgress > 70 ? 1 : 0 }}
          >
            {'>'} Initializing particle field...
          </motion.div>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: bootProgress > 90 ? 1 : 0 }}
          >
            {'>'} Systems nominal. Welcome back, Boss.
          </motion.div>
        </div>

        {/* Progress percentage */}
        <div className="mt-4 text-center">
          <span className="font-orbitron text-2xl text-reactor-core">
            {Math.round(bootProgress)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
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

export default function Home() {
  const { bootComplete, activePanel, setActivePanel, userName, tasks, userInteracted } = useJarvisStore();
  const { speak } = useJarvisVoice();
  const hasGreetedRef = useRef(false);

  // Play "Iron Man" style startup sound when boot completes
  // Track user interaction for audio policy
  // No longer need window-level listeners as we have a dedicated button
  useEffect(() => {
    // Just ensure we are in a clean state
  }, []);

  useEffect(() => {
    if (bootComplete && userInteracted) {
      const playStartupSound = async () => {
        try {
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          if (audioCtx.state === "suspended") await audioCtx.resume();
          
          // Sound 1: Hologram sweep
          const oscillator = audioCtx.createOscillator();
          const gainNode = audioCtx.createGain();
          
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(200, audioCtx.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.5);
          
          gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
          gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.1);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);
          
          oscillator.connect(gainNode);
          gainNode.connect(audioCtx.destination);
          
          oscillator.start();
          oscillator.stop(audioCtx.currentTime + 1);

          // Sound 2: High-frequency "ping"
          const ping = audioCtx.createOscillator();
          const pingGain = audioCtx.createGain();
          ping.type = 'triangle';
          ping.frequency.setValueAtTime(2400, audioCtx.currentTime + 0.3);
          pingGain.gain.setValueAtTime(0, audioCtx.currentTime + 0.3);
          pingGain.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.35);
          pingGain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
          ping.connect(pingGain);
          pingGain.connect(audioCtx.destination);
          ping.start(audioCtx.currentTime + 0.3);
          ping.stop(audioCtx.currentTime + 0.6);
        } catch (e) {
          console.warn("Audio context failed to start:", e);
        }
      };

      playStartupSound();
    }
  }, [bootComplete]);

  useEffect(() => {
    if (bootComplete && userInteracted && !hasGreetedRef.current) {
      hasGreetedRef.current = true;
      
      const triggerGreeting = async () => {
        let healthData = null;
        try {
          const res = await fetch("/api/system-health");
          if (res.ok) healthData = await res.json();
        } catch (e) {
          console.warn("Could not fetch real health data, using fallback.");
        }

        const greeting = resolveGreeting(healthData, tasks);
        // Short delay to allow boot sequence fade out
        setTimeout(() => speak(greeting), 1000);
      };

      triggerGreeting();
    }
  }, [bootComplete, speak, userName, tasks, userInteracted]);
  useJarvisSentinel();
  useJarvisBiometrics();

  const { isSpeaking, state, setState } = useJarvisStore();

  // Sync global speaking state to JARVIS state
  useEffect(() => {
    if (isSpeaking && state !== "speaking") {
      setState("speaking");
    } else if (!isSpeaking && state === "speaking") {
      setState("idle");
    }
  }, [isSpeaking, state, setState]);
  const { calculations, lastCalculation, addCalculation, clearHistory, deleteCalculation } = useCalculatorHistory();
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [instagramOpen, setInstagramOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [commHubOpen, setCommHubOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [dungeonOpen, setDungeonOpen] = useState(false);
  const [habitsOpen, setHabitsOpen] = useState(false);
  const [timeCapsuleOpen, setTimeCapsuleOpen] = useState(false);
  const [voiceNotesOpen, setVoiceNotesOpen] = useState(false);

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

    // Open the requested panel
    switch (activePanel) {
      case "skill-trainer":
        setSkillTrainerOpen(true);
        break;
      case "image-generator":
        setImageGeneratorOpen(true);
        break;
      case "summarizer":
        setSummarizerOpen(true);
        break;
      case "web-scraper":
        setWebScraperOpen(true);
        break;
      case "nasa":
        setNasaOpen(true);
        break;
      case "huggingface":
        setHuggingFaceOpen(true);
        break;
      case "ifttt":
        setIftttOpen(true);
        break;
      case "browser":
        setBrowserOpen(true);
        break;
      case "local-llm":
        setLocalLLMOpen(true);
        break;
      case "vision":
        setVisionOpen(true);
        break;
      case "automation":
        setAutomationOpen(true);
        break;
      case "price-tracker":
        setPriceTrackerOpen(true);
        break;
      case "firecrawl":
        setFirecrawlOpen(true);
        break;
      case "transcription":
        setTranscriptionOpen(true);
        break;
      case "playwright":
        setPlaywrightOpen(true);
        break;
      case "chat":
      case "tasks":
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

  return (
    <main className="relative min-h-screen overflow-hidden bg-deep-space">
      {/* Particle background (CSS fallback) */}
      <div className="absolute inset-0 opacity-30">
        {Array.from({ length: 50 }).map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-reactor-core/30 rounded-full animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 2}s`,
            }}
          />
        ))}
      </div>

      {/* Boot sequence */}
      <BootSequence />

      {/* 3D Arc Reactor */}
      <ArcReactor />

      {/* UI Panels (only show after boot) */}
      {bootComplete && (
        <>
          <StatusHUD />
          <MemoryPanel />
          <TaskPanel />
          <TimerPanel onTimerComplete={handleTimerComplete} />
          <AnimatePresence>
            {lastCalculation && (
              <CalculatorDisplay
                lastCalculation={lastCalculation}
                calculations={calculations}
                onClear={clearHistory}
                onDelete={deleteCalculation}
              />
            )}
          </AnimatePresence>
          <CommandBar
            onCalculate={addCalculation}
            onOpenWhatsapp={() => setWhatsappOpen(true)}
            onOpenInstagram={() => setInstagramOpen(true)}
            onOpenTelegram={() => setTelegramOpen(true)}
            onOpenCommHub={() => setCommHubOpen(true)}
            onOpenSecurity={() => setSecurityOpen(true)}
            onOpenVault={() => setVaultOpen(true)}
            onOpenDungeon={() => setDungeonOpen(true)}
            onOpenHabits={() => setHabitsOpen(true)}
            onOpenTimeCapsule={() => setTimeCapsuleOpen(true)}
            onOpenVoiceNotes={() => setVoiceNotesOpen(true)}
            onOpenWeather={() => setWeatherOpen(true)}
            onOpenSpotify={() => setSpotifyOpen(true)}
            onOpenNews={() => setNewsOpen(true)}
            onOpenCalendar={() => setCalendarOpen(true)}
            onOpenSkillTrainer={() => setSkillTrainerOpen(true)}
            onOpenImageGenerator={() => setImageGeneratorOpen(true)}
            onOpenSummarizer={() => setSummarizerOpen(true)}
            onOpenWebScraper={() => setWebScraperOpen(true)}
            onOpenNASA={() => setNasaOpen(true)}
            onOpenHuggingFace={() => setHuggingFaceOpen(true)}
            onOpenIFTTT={() => setIftttOpen(true)}
            onOpenBrowser={() => setBrowserOpen(true)}
            onOpenLocalLLM={() => setLocalLLMOpen(true)}
            onOpenVision={() => setVisionOpen(true)}
            onOpenAutomation={() => setAutomationOpen(true)}
            onOpenFirecrawl={() => setFirecrawlOpen(true)}
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

          {/* Instagram Panel */}
          <AnimatePresence>
            {instagramOpen && (
              <InstagramPanel
                onClose={() => setInstagramOpen(false)}
                onSendMessage={(name, message) => {
                  speak(`Instagram message sent to ${name}, Boss.`);
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

          {/* Time Capsule */}
          <AnimatePresence>
            {timeCapsuleOpen && (
              <TimeCapsulePanel
                onClose={() => setTimeCapsuleOpen(false)}
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
        </>
      )}

      {/* Scan lines overlay */}
      <div className="fixed inset-0 pointer-events-none z-40 scan-lines opacity-20" />
    </main>
  );
}
