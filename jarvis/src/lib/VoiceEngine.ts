import { useJarvisStore } from "@/store/jarvis.store";

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
  // Tracks whether the underlying recognition session has actually started
  private didStart: boolean = false;
  // Exponential back-off for repeated failures
  private failCount: number = 0;
  private MAX_RESTART_DELAY_MS = 8000;

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

  private getSpeechAPI() {
    if (typeof window === "undefined") return null;
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
  }

  private init() {
    const API = this.getSpeechAPI();
    if (!API) {
      console.warn("[VoiceEngine] SpeechRecognition not available yet, will retry on start()");
      return;
    }

    this.recognition = new API();
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
      console.log("[VoiceEngine] ✅ Hardware Mic Started");
      this.isRunning = true;
      this.didStart = true;
      this.failCount = 0; // reset back-off on successful start
      useJarvisStore.getState().setIsListening(true);
    };

    this.recognition.onend = () => {
      console.log("[VoiceEngine] Hardware Mic Stopped (didStart=" + this.didStart + ")");
      this.isRunning = false;
      this.didStart = false;
      useJarvisStore.getState().setIsListening(false);

      // Auto-restart logic — skip if intentionally stopped or muted
      if (!this.isIntentionallyStopped && !useJarvisStore.getState().isMuted) {
        // Exponential back-off: 300ms → 600 → 1200 → ... → MAX
        const delay = Math.min(300 * Math.pow(2, this.failCount), this.MAX_RESTART_DELAY_MS);
        console.log(`[VoiceEngine] Auto-restarting in ${delay}ms (attempt ${this.failCount + 1})`);
        if (this.restartTimeout) clearTimeout(this.restartTimeout);
        this.restartTimeout = setTimeout(() => {
          this.start();
        }, delay);
      }
    };

    this.recognition.onerror = (event: any) => {
      const err: string = event.error;
      console.error("[VoiceEngine] Error:", err);

      switch (err) {
        case "not-allowed":
        case "service-not-allowed":
          // Mic permission denied — show error but DON'T permanently latch.
          // User may grant permission later via browser settings; they can
          // call reset() or just toggle alwaysListening to recover.
          this.callbacks.onError(
            "Microphone permission denied. Please allow microphone access in your browser settings, then refresh."
          );
          this.isIntentionallyStopped = true;
          // Schedule a soft-reset after 5s so the engine will try again
          // when the user re-enables the toggle or grants permission.
          setTimeout(() => {
            if (this.isIntentionallyStopped) {
              console.log("[VoiceEngine] Soft-reset after permission error — will retry next start()");
              this.isIntentionallyStopped = false;
              this.failCount = 0;
            }
          }, 5000);
          break;

        case "aborted":
          // Benign — browser aborted the session (tab switch, new session, etc.)
          // onend will fire and handle the restart. Don't increment failCount.
          console.log("[VoiceEngine] Session aborted (benign), will auto-restart via onend");
          break;

        case "audio-capture":
          // Mic hardware failure / no default input device
          this.callbacks.onError("No microphone detected. Please connect a microphone and try again.");
          this.failCount++;
          break;

        case "network":
          // Chrome's remote speech endpoint is unavailable — back off
          this.failCount++;
          break;

        case "no-speech":
          // Normal — silence detected, session ended. onend handles restart.
          break;

        default:
          this.failCount++;
          break;
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

    // Lazy-init if init() was called too early (SSR / before window existed)
    if (!this.recognition) {
      this.init();
      if (!this.recognition) {
        console.warn("[VoiceEngine] SpeechRecognition still not available, cannot start");
        return;
      }
    }

    if (this.isRunning) return;

    try {
      this.recognition.start();
      console.log("[VoiceEngine] recognition.start() called");
    } catch (e: any) {
      // "InvalidStateError: recognition already started" — ignore
      if (e?.name !== "InvalidStateError") {
        console.warn("[VoiceEngine] Start failed:", e);
        this.failCount++;
      }
    }
  }

  public stop() {
    this.isIntentionallyStopped = true;
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }
    if (!this.isRunning || !this.recognition) return;
    try {
      this.recognition.stop();
    } catch (e) {}
  }

  /** Hard-reset: re-create the recognition object entirely (useful after permission grant) */
  public reset() {
    this.stop();
    this.isIntentionallyStopped = false;
    this.isRunning = false;
    this.didStart = false;
    this.failCount = 0;
    this.recognition = null;
    this.init();
    console.log("[VoiceEngine] Hard reset complete");
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
