import { useJarvisStore } from "@/store/jarvis.store";

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// Wake word logic separated for purity
export function checkWakeWord(text: string): boolean {
  const lowerText = text.toLowerCase().trim();

  const jarvisPatterns = [
    /^jarvis\b/,
    /^travis\b/,
    /^chavez\b/,
    /^java\b/,
    /^jervis\b/,
    /^j\s*a\s*r\s*v\s*i\s*s\b/,
    /j[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,
    /s[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,
    /d[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,
    /[jz][aeiou]*r[aeiou]*[vw][aeiou]*/,
  ];

  for (const pattern of jarvisPatterns) {
    if (pattern.test(lowerText)) {
      const match = lowerText.match(pattern);
      console.log("[VoiceEngine] ✓ Wake word fuzzy match:", match?.[0], "in:", lowerText);
      return true;
    }
  }

  const greetings = /^(hey|hi|hello|yo|ok|okay|aey|hay|hii)\s*/;
  if (greetings.test(lowerText)) {
    const afterGreeting = lowerText.replace(greetings, "").trim();
    if (afterGreeting.length >= 3 && afterGreeting.length <= 12) {
      if (afterGreeting.includes('r') || afterGreeting.includes('v') || afterGreeting.includes('s')) {
        console.log("[VoiceEngine] ✓ Wake word greeting match:", afterGreeting);
        return true;
      }
    }
  }

  if (lowerText.includes('jar') || lowerText.includes('jerv') || lowerText.includes('serv')) {
    console.log("[VoiceEngine] ✓ Contains jar/jerv/serv:", lowerText);
    return true;
  }

  return false;
}

export type VoiceEngineCallbacks = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onWakeWord: () => void;
  onError: (error: string) => void;
};

export class VoiceEngine {
  private static instance: VoiceEngine | null = null;
  private recognition: any = null;
  private callbacks: VoiceEngineCallbacks = {
    onInterim: () => {},
    onFinal: () => {},
    onWakeWord: () => {},
    onError: () => {},
  };
  
  // States
  public isRunning: boolean = false;
  private isIntentionallyStopped: boolean = false;
  private isTTSPlaying: boolean = false;
  private restartTimeout: any = null;
  private listeningStartTime: number = 0;

  private constructor() {
    this.init();
  }

  public static getInstance(): VoiceEngine {
    if (!VoiceEngine.instance) {
      VoiceEngine.instance = new VoiceEngine();
    }
    return VoiceEngine.instance;
  }

  public setCallbacks(callbacks: VoiceEngineCallbacks) {
    this.callbacks = callbacks;
  }

  private init() {
    if (!SpeechRecognitionAPI) {
      this.callbacks.onError("Speech Recognition not supported in this browser.");
      return;
    }

    this.recognition = new SpeechRecognitionAPI();
    this.recognition.lang = "en-US";
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    // Listen to state changes to track activation time
    useJarvisStore.subscribe((state) => {
      if (state.state === "listening" && !this.listeningStartTime) {
        this.listeningStartTime = Date.now();
      } else if (state.state !== "listening") {
        this.listeningStartTime = 0;
      }
    });

    this.recognition.onstart = () => {
      console.log("[VoiceEngine] Hardware Mic Started");
      this.isRunning = true;
      useJarvisStore.getState().setIsListening(true);
    };

    this.recognition.onend = () => {
      console.log("[VoiceEngine] Hardware Mic Stopped");
      this.isRunning = false;
      useJarvisStore.getState().setIsListening(false);

      // Auto-restart logic
      if (!this.isIntentionallyStopped && !useJarvisStore.getState().isMuted) {
        console.log("[VoiceEngine] Auto-restarting...");
        this.restartTimeout = setTimeout(() => {
          this.start();
        }, 300);
      }
    };

    this.recognition.onerror = (event: any) => {
      console.error("[VoiceEngine] Error:", event.error);
      if (event.error === "not-allowed") {
        this.callbacks.onError("Microphone permission denied.");
        this.isIntentionallyStopped = true;
      }
    };

    this.recognition.onresult = (event: any) => {
      // If TTS is currently playing, aggressively drop ALL audio frames
      if (this.isTTSPlaying) {
        return;
      }

      const results = event.results;
      const lastResult = results[results.length - 1];
      const transcript = lastResult[0]?.transcript || "";
      const isFinal = lastResult.isFinal;

      const currentState = useJarvisStore.getState().state;

      if (!isFinal) {
        if (currentState === "listening") {
          this.callbacks.onInterim(transcript);
        }
        return;
      }

      // If we are IDLE, we are ONLY looking for the wake word
      if (currentState === "idle" || currentState === "sleep") {
        if (checkWakeWord(transcript)) {
          this.callbacks.onWakeWord();
        }
        return;
      }

      // If we are LISTENING, we accept the transcript as a command
      if (currentState === "listening") {
        if (this.listeningStartTime > 0 && Date.now() - this.listeningStartTime < 2500) {
          console.log("[VoiceEngine] Dropping initial buffer/click noise");
          return;
        }

        if (transcript.trim().length > 0) {
          console.log("[VoiceEngine] Final Command Accepted:", transcript);
          this.callbacks.onFinal(transcript);
        }
      }
    };
  }

  public start() {
    this.isIntentionallyStopped = false;
    if (this.isRunning || !this.recognition) return;
    try {
      this.recognition.start();
    } catch (e) {
      console.warn("[VoiceEngine] Start failed:", e);
    }
  }

  public stop() {
    this.isIntentionallyStopped = true;
    if (this.restartTimeout) clearTimeout(this.restartTimeout);
    if (!this.isRunning || !this.recognition) return;
    try {
      this.recognition.stop();
    } catch (e) {}
  }

  public pauseForTTS() {
    console.log("[VoiceEngine] Pausing for TTS output");
    this.isTTSPlaying = true;
  }

  public resumeAfterTTS() {
    console.log("[VoiceEngine] Resuming after TTS output (waiting 2.5s to flush echo buffers)");
    setTimeout(() => {
      this.isTTSPlaying = false;
      console.log("[VoiceEngine] Echo buffer flushed, mic is fully active");
    }, 2500);
  }
}
