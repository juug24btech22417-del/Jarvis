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

/** A code artifact the Code Forge panel can display and (for web code) run. */
export interface GeneratedCodeArtifact {
  language: string;
  code: string;
  description: string;
  /** Whether the sandboxed runner can execute this language. */
  runnable: boolean;
  /** Timestamp — lets the panel keep a session history of generations. */
  createdAt: number;
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

/** Result of an OS-wide clipboard capture, handed to the in-browser overlay. */
export interface ClipboardAssist {
  id: string;
  text: string;
  /** Foreground app/window the copy came from (best effort, may be empty). */
  source?: string;
  analysis: Record<string, any>;
  /** What the clip was detected as (kind, label, per-kind action buttons). */
  detection?: Record<string, any>;
  at: number;
}

export interface StashedClip {
  id: string;
  text: string;
  kind: "code" | "error" | "url" | "text";
  label: string;
  source?: string;
  timestamp: number;
}

export interface GhostWorker {
  id: string;
  title: string;
  goal: string;
  progress: number;
  status: "running" | "waiting_approval" | "completed" | "failed";
  step: string;
  approvalPrompt?: string;
  result?: string;
  createdAt: number;
}

export interface ScreenReticle {
  active: boolean;
  target?: string;
  role?: string;
  confidence?: number;
  action?: string;
  details?: string;
}

export interface ContextLeechState {
  active: boolean;
  meetingTopic?: string;
  tacticalBullets: string[];
  factChecks: string[];
  suggestedQuestions: string[];
  lastUpdated: number;
}

export interface GhostCopilotAlert {
  active: boolean;
  file: string;
  line?: number;
  errorSummary: string;
  explanation: string;
  proposedPatch: string;
  originalSnippet?: string;
  patchedSnippet?: string;
  detectedAt: number;
}

export interface OmniFileItem {
  name: string;
  path: string;
  size: string;
  modified: string;
  kind: "screenshot" | "pdf" | "code" | "doc" | "other";
}

export interface OmniQueryResult {
  query: string;
  totalFound: number;
  files: OmniFileItem[];
  scannedPath?: string;
}

export interface EnvHealthIssue {
  id: string;
  type: "port_collision" | "zombie_process" | "git_lock" | "disk_pressure" | "unknown";
  description: string;
  port?: number;
  pid?: number;
  fixAction: string;
}

export interface EnvHealthState {
  healthy: boolean;
  issues: EnvHealthIssue[];
  lastChecked: number;
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
  /** Latches true the moment the power gate is pressed — starts the reactor assembly. */
  assemblyStarted: boolean;
  startAssembly: () => void;

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
  // Sentinel Eyes global watcher: armed from the home UI, runs even when
  // the Security panel is closed. Panel requests the camera via
  // requestSentinelCamera(); the watcher pauses its own loop and yields it.
  sentinelArmed: boolean;
  setSentinelArmed: (armed: boolean) => void;
  sentinelCameraBusy: boolean; // panel is using the camera (registration etc.)
  setSentinelCameraBusy: (busy: boolean) => void;
  sentinelLiveStatus: "idle" | "scanning" | "verified" | "intruder";
  setSentinelLiveStatus: (s: "idle" | "scanning" | "verified" | "intruder") => void;
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
  activePanel: "chat" | "tasks" | "memory" | "notes" | "code" | "skill-trainer" | "image-generator" | "summarizer" | "web-scraper" | "firecrawl" | "playwright" | "whatsapp" | "phone-remote" | "telegram" | "security" | "vault" | "dungeon" | "habits" | "time-capsule" | "voice-notes" | "nasa" | "huggingface" | "ifttt" | "browser" | "local-llm" | "vision" | "automation" | "price-tracker" | "transcription" | "proxy" | "agent" | "mission" | "analytics" | "macros" | "qr-teleporter" | "proximity-scanner" | "video-director" | "room-scanner" | "whiteboard-ocr" | "widgets" | "second-brain" | "meeting-shadow" | "face-crm" | "task-agent" | "explain-overlay" | "mcp-hub" | null;
  setActivePanel: (panel: JarvisStore["activePanel"]) => void;
  /** Goal typed/voiced elsewhere that Mission Control should run on open. */
  pendingMissionGoal: string | null;
  setPendingMissionGoal: (goal: string | null) => void;
  /** Natural-language widget request typed elsewhere; the Widgets panel builds it on open. */
  pendingWidgetPrompt: string | null;
  setPendingWidgetPrompt: (prompt: string | null) => void;
  /** Phone number a voice/text command asked Diplomat to dial on open. */
  pendingDiplomatNumber: string | null;
  setPendingDiplomatNumber: (number: string | null) => void;
  showBriefing: boolean;
  setShowBriefing: (show: boolean) => void;

  // User
  userName: string;
  setUserName: (name: string) => void;

  // Weather telemetry — city shown on the reactor arc (persisted)
  weatherCity: string;
  setWeatherCity: (city: string) => void;

  // User Interaction
  userInteracted: boolean;
  setUserInteracted: (interacted: boolean) => void;

  // Media Player
  currentVideo: { id: string; title: string; channel: string; embedUrl: string } | null;
  setCurrentVideo: (video: JarvisStore["currentVideo"]) => void;
  clearCurrentVideo: () => void;

  // Generated Code (Code Forge)
  generatedCode: GeneratedCodeArtifact | null;
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

  // OS-wide clipboard assistant — latest captured clip + its smart analysis.
  clipboardAssist: ClipboardAssist | null;
  setClipboardAssist: (assist: ClipboardAssist | null) => void;

  // ── Desktop Orb Jaw-Dropping Capabilities ─────────────────────────────
  /** Ingestion feedback (drag & drop singularity) */
  orbIngestFeedback: { active: boolean; label: string; kind?: string } | null;
  setOrbIngestFeedback: (feedback: JarvisStore["orbIngestFeedback"]) => void;

  /** Screen Reticle mode & target info */
  screenReticle: ScreenReticle | null;
  setScreenReticle: (reticle: ScreenReticle | null) => void;

  /** Multi-slot clipboard stash (up to 5 items across apps) */
  clipboardStash: StashedClip[];
  addToClipboardStash: (clip: { text: string; kind?: StashedClip["kind"]; source?: string }) => void;
  removeFromClipboardStash: (id: string) => void;
  clearClipboardStash: () => void;

  /** Autonomous background ghost workers */
  ghostWorkers: GhostWorker[];
  startGhostWorker: (worker: Omit<GhostWorker, "id" | "createdAt"> & { id?: string }) => string;
  updateGhostWorker: (id: string, update: Partial<GhostWorker>) => void;
  removeGhostWorker: (id: string) => void;

  /** Feature 1: Context Leech */
  contextLeech: ContextLeechState | null;
  setContextLeech: (state: ContextLeechState | null) => void;

  /** Feature 3: Ghost Copilot */
  ghostCopilot: GhostCopilotAlert | null;
  setGhostCopilot: (alert: GhostCopilotAlert | null) => void;

  /** Feature 4: Omni-Query */
  omniQuery: OmniQueryResult | null;
  setOmniQuery: (result: OmniQueryResult | null) => void;

  /** Feature 6: Self-Healing Environment Daemon */
  envHealth: EnvHealthState | null;
  setEnvHealth: (health: EnvHealthState | null) => void;

  /** Active / Staged file in File Explorer for operations */
  stagedFile: { name: string; path: string; size: string; type: string } | null;
  setStagedFile: (file: { name: string; path: string; size: string; type: string } | null) => void;

  // ── Desktop orb bridge ─────────────────────────────────────────────────
  // The floating orb window mounts CommandBar hidden and drives it through
  // these two fields, so asking from the orb runs the identical pipeline.
  /** A line the orb (or any other surface) wants CommandBar to execute. */
  pendingCommand: string | null;
  queueCommand: (text: string) => void;
  consumePendingCommand: () => void;
  /** Bumped by the orb's mic button; CommandBar toggles listening on change. */
  pendingVoiceToggle: number;
  queueVoiceToggle: () => void;
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
  assemblyStarted: false,
  startAssembly: () =>
    set((s) => (s.assemblyStarted ? s : { assemblyStarted: true })),

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
  sentinelActive: false, // "Sentinel Eyes" passive vision - OFF until armed
  setSentinelActive: (sentinelActive) => set({ sentinelActive }),
  biometricActive: false, // "Biometric" face recognition
  setBiometricActive: (biometricActive) => set({ biometricActive }),
  sentinelArmed: false,
  setSentinelArmed: (armed) => set({ sentinelArmed: armed }),
  sentinelCameraBusy: false,
  setSentinelCameraBusy: (busy) => set({ sentinelCameraBusy: busy }),
  sentinelLiveStatus: "idle",
  setSentinelLiveStatus: (s) => set({ sentinelLiveStatus: s }),
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
  pendingMissionGoal: null,
  setPendingMissionGoal: (pendingMissionGoal) => set({ pendingMissionGoal }),
  pendingWidgetPrompt: null,
  setPendingWidgetPrompt: (pendingWidgetPrompt) => set({ pendingWidgetPrompt }),
  pendingDiplomatNumber: null,
  setPendingDiplomatNumber: (pendingDiplomatNumber) => set({ pendingDiplomatNumber }),
  showBriefing: false,
  setShowBriefing: (showBriefing) => set({ showBriefing }),

  // User
  userName: "Dhruv",
  weatherCity: typeof window !== "undefined"
    ? localStorage.getItem("jarvis-weather-city") || "Bangalore"
    : "Bangalore",
  setWeatherCity: (city) => {
    set({ weatherCity: city });
    if (typeof window !== "undefined") {
      localStorage.setItem("jarvis-weather-city", city);
    }
  },
  setUserName: (userName) => set({ userName }),

  // User Interaction
  userInteracted: false,
  setUserInteracted: (userInteracted) => set({ userInteracted }),

  // Media Player
  currentVideo: null,
  setCurrentVideo: (currentVideo) => set({ currentVideo }),
  clearCurrentVideo: () => set({ currentVideo: null }),

  // Generated Code (Code Forge)
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

  // OS-wide clipboard assistant
  clipboardAssist: null,
  setClipboardAssist: (clipboardAssist) =>
    set((state) => {
      if (clipboardAssist?.text) {
        const clean = clipboardAssist.text.trim();
        const existing = state.clipboardStash.filter((c) => c.text.trim() !== clean);
        const isUrl = /^https?:\/\//i.test(clean);
        const isError = /error|traceback|exception|failed|fatal/i.test(clean);
        const isCode = /[{};=>]|\bdef\b|\bfunction\b|\bconst\b|\bimport\b/.test(clean);
        const kind: StashedClip["kind"] = (clipboardAssist.detection?.kind as any) || (isError ? "error" : isCode ? "code" : isUrl ? "url" : "text");
        const newItem: StashedClip = {
          id: clipboardAssist.id || Math.random().toString(36).substring(7),
          text: clean,
          kind,
          label: clean.split("\n")[0].slice(0, 42),
          source: clipboardAssist.source,
          timestamp: clipboardAssist.at || Date.now(),
        };
        return {
          clipboardAssist,
          clipboardStash: [newItem, ...existing].slice(0, 5),
        };
      }
      return { clipboardAssist };
    }),

  // Desktop Orb Jaw-Dropping Features
  orbIngestFeedback: null,
  setOrbIngestFeedback: (orbIngestFeedback) => set({ orbIngestFeedback }),

  screenReticle: null,
  setScreenReticle: (screenReticle) => set({ screenReticle }),

  clipboardStash: [],
  addToClipboardStash: (clip) =>
    set((state) => {
      const clean = clip.text.trim();
      if (!clean) return state;
      const existing = state.clipboardStash.filter((c) => c.text.trim() !== clean);
      const isUrl = /^https?:\/\//i.test(clean);
      const isError = /error|traceback|exception|failed|fatal/i.test(clean);
      const isCode = /[{};=>]|\bdef\b|\bfunction\b|\bconst\b|\bimport\b/.test(clean);
      const kind: StashedClip["kind"] = clip.kind ?? (isError ? "error" : isCode ? "code" : isUrl ? "url" : "text");
      const label = clean.split("\n")[0].slice(0, 42);
      const newItem: StashedClip = {
        id: Math.random().toString(36).substring(7),
        text: clean,
        kind,
        label,
        source: clip.source,
        timestamp: Date.now(),
      };
      return { clipboardStash: [newItem, ...existing].slice(0, 5) };
    }),
  removeFromClipboardStash: (id) =>
    set((state) => ({ clipboardStash: state.clipboardStash.filter((c) => c.id !== id) })),
  clearClipboardStash: () => set({ clipboardStash: [] }),

  ghostWorkers: [],
  startGhostWorker: (worker) => {
    const id = worker.id || Math.random().toString(36).substring(7);
    const newWorker: GhostWorker = {
      ...worker,
      id,
      createdAt: Date.now(),
    };
    set((state) => ({ ghostWorkers: [newWorker, ...state.ghostWorkers.slice(0, 4)] }));
    return id;
  },
  updateGhostWorker: (id, update) =>
    set((state) => ({
      ghostWorkers: state.ghostWorkers.map((w) => (w.id === id ? { ...w, ...update } : w)),
    })),
  removeGhostWorker: (id) =>
    set((state) => ({ ghostWorkers: state.ghostWorkers.filter((w) => w.id !== id) })),

  // 4 New Jaw-Dropping Features
  contextLeech: null,
  setContextLeech: (contextLeech) => set({ contextLeech }),

  ghostCopilot: null,
  setGhostCopilot: (ghostCopilot) => set({ ghostCopilot }),

  omniQuery: null,
  setOmniQuery: (omniQuery) => set({ omniQuery }),

  envHealth: null,
  setEnvHealth: (envHealth) => set({ envHealth }),

  stagedFile: null,
  setStagedFile: (stagedFile) => set({ stagedFile }),

  // Desktop orb bridge
  pendingCommand: null,
  queueCommand: (text) => set({ pendingCommand: text }),
  consumePendingCommand: () => set({ pendingCommand: null }),
  pendingVoiceToggle: 0,
  queueVoiceToggle: () =>
    set((state) => ({ pendingVoiceToggle: state.pendingVoiceToggle + 1 })),
}));
