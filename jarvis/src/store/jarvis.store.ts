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
  setIsListening: (listening: boolean) => void;
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

  // UI
  activePanel: "chat" | "tasks" | "memory" | "notes" | "code" | "skill-trainer" | "image-generator" | "summarizer" | "web-scraper" | "nasa" | "huggingface" | "ifttt" | "browser" | "local-llm" | "vision" | "automation" | "price-tracker" | "transcription" | null;
  setActivePanel: (panel: JarvisStore["activePanel"]) => void;
  showBriefing: boolean;
  setShowBriefing: (show: boolean) => void;

  // User
  userName: string;
  setUserName: (name: string) => void;

  // Media Player
  currentVideo: { id: string; title: string; channel: string; embedUrl: string } | null;
  setCurrentVideo: (video: JarvisStore["currentVideo"]) => void;
  clearCurrentVideo: () => void;

  // Generated Code
  generatedCode: { language: string; code: string; description: string } | null;
  setGeneratedCode: (code: JarvisStore["generatedCode"]) => void;
  clearGeneratedCode: () => void;
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
  isMuted: false,
  setIsMuted: (isMuted) => set({ isMuted }),
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

  // UI
  activePanel: null,
  setActivePanel: (activePanel) => set({ activePanel }),
  showBriefing: false,
  setShowBriefing: (showBriefing) => set({ showBriefing }),

  // User
  userName: "Boss",
  setUserName: (userName) => set({ userName }),

  // Media Player
  currentVideo: null,
  setCurrentVideo: (currentVideo) => set({ currentVideo }),
  clearCurrentVideo: () => set({ currentVideo: null }),

  // Generated Code
  generatedCode: null,
  setGeneratedCode: (generatedCode) => set({ generatedCode }),
  clearGeneratedCode: () => set({ generatedCode: null }),
}));
