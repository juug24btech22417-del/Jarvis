import { create } from "zustand";

export type JarvisState =
  | "booting"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "sleep";

export type Theme = "arc-blue" | "crimson" | "stealth" | "quantum" | "batman" | "ironman";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface SentinelSuggestion {
  id: string;
  type: "debug" | "security_risk" | "task" | "reminder";
  title: string;
  details: string;
  comment: string;
  metadata?: Record<string, any>;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  priority: "critical" | "high" | "normal" | "someday";
  dueDate?: Date;
}

export interface Memory {
  id: string;
  content: string;
  category: string;
  source: string;
}

interface JarvisStore {
  // Core state
  state: JarvisState;
  setState: (state: JarvisState) => void;

  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;

  // Boot sequence
  bootProgress: number;
  setBootProgress: (progress: number) => void;
  bootComplete: boolean;
  setBootComplete: (complete: boolean) => void;

  // Messages
  messages: Message[];
  addMessage: (message: Omit<Message, "id" | "timestamp">) => void;
  clearMessages: () => void;
  streamingMessage: string;
  setStreamingMessage: (message: string) => void;
  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;

  // Voice
  isListening: boolean;
  setIsListening: (isListening: boolean) => void;
  alwaysListening: boolean;
  setAlwaysListening: (alwaysListening: boolean) => void;
  sentinelActive: boolean;
  setSentinelActive: (sentinelActive: boolean) => void;
  biometricActive: boolean;
  setBiometricActive: (biometricActive: boolean) => void;
  isSpeaking: boolean;
  setIsSpeaking: (isSpeaking: boolean) => void;
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  voiceLevel: number;
  setVoiceLevel: (level: number) => void;

  // Gesture/Proximity
  gestureDetected: string | null;
  setGestureDetected: (gesture: string | null) => void;
  faceDetected: boolean;
  setFaceDetected: (detected: boolean) => void;

  // Tasks
  tasks: Task[];
  addTask: (task: Omit<Task, "id">) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;

  // Memory
  memories: Memory[];
  addMemory: (memory: Omit<Memory, "id">) => void;

  // Tier 3B: Persona system
  persona: "stark" | "tactical" | "whisper" | "dev";
  setPersona: (p: JarvisStore["persona"]) => void;
  /** Manual override — when set, auto-switch is bypassed for 30 min. */
  personaOverride: JarvisStore["persona"] | null;
  personaOverrideExpiresAt: number | null;
  setPersonaOverride: (p: JarvisStore["persona"] | null, durationMs?: number) => void;
  /** Active alerts (incoming messages, security events, agent errors). */
  activeAlerts: number;
  bumpActiveAlerts: (delta: number) => void;

  // Tier 3A: Reactor as system truth
  /** Logical reactor mode — drives color, density, and ring behavior. */
  reactorMode: "idle" | "listening" | "thinking" | "speaking" | "focused" | "alert" | "whisper";
  setReactorMode: (m: JarvisStore["reactorMode"]) => void;
  /** Reactor hue override — color driver for ArcReactor / panels. */
  reactorHue: "cyan" | "gold" | "red" | "dim";
  setReactorHue: (h: JarvisStore["reactorHue"]) => void;
  /** Reactor load — 0..1; drives ring speed + particle density. */
  reactorLoad: number;
  setReactorLoad: (n: number) => void;
  /** Last pulse time — increments on incoming alert / step complete. */
  reactorPulse: number;
  pulseReactor: () => void;

  // UI
  activePanel: "chat" | "tasks" | "memory" | "notes" | "code" | "skill-trainer" | "image-generator" | "summarizer" | "web-scraper" | "firecrawl" | "playwright" | "whatsapp" | "instagram" | "telegram" | "security" | "vault" | "dungeon" | "habits" | "time-capsule" | "voice-notes" | "nasa" | "huggingface" | "ifttt" | "browser" | "local-llm" | "vision" | "automation" | "price-tracker" | "transcription" | "proxy" | "agent" | null;
  setActivePanel: (panel: JarvisStore["activePanel"]) => void;
  showBriefing: boolean;
  setShowBriefing: (show: boolean) => void;

  // User
  userName: string;
  setUserName: (name: string) => void;

  // User Interaction
  userInteracted: boolean;
  setUserInteracted: (interacted: boolean) => void;

  // Media Player
  currentVideo: { id: string; title: string; channel: string; embedUrl: string } | null;
  setCurrentVideo: (video: JarvisStore["currentVideo"]) => void;
  clearCurrentVideo: () => void;

  // Generated Code
  generatedCode: { language: string; code: string; description: string } | null;
  setGeneratedCode: (code: JarvisStore["generatedCode"]) => void;
  clearGeneratedCode: () => void;
  currentScreenshot: string | null;
  setCurrentScreenshot: (screenshot: string | null) => void;

  // Automation Logs
  playwrightLogs: string[];
  setPlaywrightLogs: (logs: string[]) => void;
  addPlaywrightLog: (log: string) => void;
  firecrawlLogs: string[];
  setFirecrawlLogs: (logs: string[]) => void;
  addFirecrawlLog: (log: string) => void;

  // Sentinel Suggestion
  activeSuggestion: SentinelSuggestion | null;
  setActiveSuggestion: (suggestion: SentinelSuggestion | null) => void;
  clearActiveSuggestion: () => void;
}

export const useJarvisStore = create<JarvisStore>((set) => ({
  // Core state
  state: "booting",
  setState: (state) => set({ state }),

  // Theme
  theme: "arc-blue",
  setTheme: (theme) => set({ theme }),

  // Boot sequence
  bootProgress: 0,
  setBootProgress: (bootProgress) => set({ bootProgress }),
  bootComplete: false,
  setBootComplete: (bootComplete) => set({ bootComplete }),

  // Messages
  messages: [],
  addMessage: (message) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          ...message,
          id: Math.random().toString(36).substring(7),
          timestamp: new Date(),
        },
      ],
    })),
  clearMessages: () => set({ messages: [] }),
  streamingMessage: "",
  setStreamingMessage: (streamingMessage) => set({ streamingMessage }),
  isStreaming: false,
  setIsStreaming: (isStreaming) => set({ isStreaming }),

  // Voice
  isListening: false,
  setIsListening: (isListening) => set({ isListening }),
  alwaysListening: true,
  setAlwaysListening: (alwaysListening) => set({ alwaysListening }),
  sentinelActive: true, // "Sentinel Eyes" passive vision
  setSentinelActive: (sentinelActive) => set({ sentinelActive }),
  biometricActive: false, // "Biometric" face recognition
  setBiometricActive: (biometricActive) => set({ biometricActive }),
  isMuted: false,
  setIsMuted: (isMuted: boolean) => set({ isMuted }),
  isSpeaking: false,
  setIsSpeaking: (isSpeaking: boolean) => set({ isSpeaking }),
  voiceLevel: 0,
  setVoiceLevel: (voiceLevel) => set({ voiceLevel }),

  // Gesture/Proximity
  gestureDetected: null,
  setGestureDetected: (gestureDetected) => set({ gestureDetected }),
  faceDetected: false,
  setFaceDetected: (faceDetected) => set({ faceDetected }),

  // Tasks
  tasks: [],
  addTask: (task) =>
    set((state) => ({
      tasks: [...state.tasks, { ...task, id: Math.random().toString(36).substring(7) }],
    })),
  toggleTask: (id) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, completed: !t.completed } : t
      ),
    })),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
    })),

  // Memory
  memories: [],
  addMemory: (memory) =>
    set((state) => ({
      memories: [
        ...state.memories,
        { ...memory, id: Math.random().toString(36).substring(7) },
      ],
    })),

  // Tier 3B: Persona system
  persona: "stark",
  setPersona: (persona) => set({ persona }),
  personaOverride: null,
  personaOverrideExpiresAt: null,
  setPersonaOverride: (p, durationMs) =>
    set({
      personaOverride: p,
      personaOverrideExpiresAt:
        p && durationMs ? Date.now() + durationMs : null,
      persona: p ?? "stark",
    }),
  activeAlerts: 0,
  bumpActiveAlerts: (delta) =>
    set((state) => {
      const next = Math.max(0, state.activeAlerts + delta);
      // Tier 3A: any change in alert count triggers a reactor pulse.
      return {
        activeAlerts: next,
        ...(delta !== 0 ? { reactorPulse: Date.now() } : {}),
      };
    }),

  // Tier 3A: Reactor as system truth
  reactorMode: "idle",
  setReactorMode: (reactorMode) => set({ reactorMode }),
  reactorHue: "cyan",
  setReactorHue: (reactorHue) => set({ reactorHue }),
  reactorLoad: 0.4,
  setReactorLoad: (reactorLoad) => set({ reactorLoad: Math.max(0, Math.min(1, reactorLoad)) }),
  reactorPulse: 0,
  pulseReactor: () => set({ reactorPulse: Date.now() }),

  // UI
  activePanel: null,
  setActivePanel: (activePanel) => set({ activePanel }),
  showBriefing: false,
  setShowBriefing: (showBriefing) => set({ showBriefing }),

  // User
  userName: "Boss",
  setUserName: (userName) => set({ userName }),

  // User Interaction
  userInteracted: false,
  setUserInteracted: (userInteracted) => set({ userInteracted }),

  // Media Player
  currentVideo: null,
  setCurrentVideo: (currentVideo) => set({ currentVideo }),
  clearCurrentVideo: () => set({ currentVideo: null }),

  // Generated Code
  generatedCode: null,
  setGeneratedCode: (generatedCode) => set({ generatedCode }),
  clearGeneratedCode: () => set({ generatedCode: null }),
  currentScreenshot: null,
  setCurrentScreenshot: (currentScreenshot) => set({ currentScreenshot }),
  // Automation Logs
  playwrightLogs: [],
  setPlaywrightLogs: (playwrightLogs) => set({ playwrightLogs }),
  addPlaywrightLog: (log) => set((state) => ({ playwrightLogs: [...state.playwrightLogs, log] })),
  firecrawlLogs: [],
  setFirecrawlLogs: (firecrawlLogs) => set({ firecrawlLogs }),
  addFirecrawlLog: (log) => set((state) => ({ firecrawlLogs: [...state.firecrawlLogs, log] })),

  // Sentinel Suggestion
  activeSuggestion: null,
  setActiveSuggestion: (activeSuggestion) => set({ activeSuggestion }),
  clearActiveSuggestion: () => set({ activeSuggestion: null }),
}));
