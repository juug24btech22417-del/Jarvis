"use client";

import { useEffect, useState, useCallback } from "react";
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
import { useJarvisStore } from "@/store/jarvis.store";
import { useTextToSpeech } from "@/hooks/useVoice";

// Boot sequence overlay
function BootSequence() {
  const { bootProgress, bootComplete } = useJarvisStore();
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (bootComplete) {
      const timer = setTimeout(() => setShowWelcome(true), 100);
      return () => clearTimeout(timer);
    }
  }, [bootComplete]);

  if (bootComplete && showWelcome) {
    return (
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 1, delay: 3 }}
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
            className="mt-2 text-reactor-core/70 font-rajdhani text-xs tracking-wider"
          >
            Say &quot;Hey JARVIS&quot; or click the reactor to begin
          </motion.div>
        </motion.div>
      </motion.div>
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
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export default function Home() {
  const { bootComplete, activePanel, setActivePanel } = useJarvisStore();
  const { speak } = useTextToSpeech();
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
