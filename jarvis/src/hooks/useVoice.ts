"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useJarvisStore } from "@/store/jarvis.store";

// Web Speech API types
interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
    webkitSpeechGrammarList?: unknown;
    SpeechGrammarList?: unknown;
  }
}

// JARVIS wake words - more variations
const WAKE_WORDS = [
  "hey jarvis",
  "hey service",
  "jarvis",
  "service",
  "ok jarvis",
  "okay jarvis",
  "hi jarvis",
  "yo jarvis",
  "jarvice",
  "jarv",
  "jarves",
  "jarvus",
  "jevus",
  "jevous",
];

// Fuzzy wake word check - ULTRA PERMISSIVE
function checkWakeWordFuzzy(text: string): boolean {
  const lowerText = text.toLowerCase().trim();

  // Log what we're checking for debugging
  console.log("[WakeWord] Checking:", lowerText);

  // Skip very short or very long strings
  if (lowerText.length < 3 || lowerText.length > 40) {
    return false;
  }

  // Exact matches first
  for (const word of WAKE_WORDS) {
    if (lowerText.includes(word)) {
      console.log("[WakeWord] ✓ Exact match:", word);
      return true;
    }
  }

  // ULTRA broad fuzzy match - catches almost any "jarvis-like" sound
  // Very permissive patterns
  const jarvisPatterns = [
    /j[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,     // jarvis, jervis, jarves, etc
    /g[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,     // garvis, gervous
    /ch[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,    // charvis, chervis
    /s[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,     // service, sarvis, servis
    /d[aeiou]*r[aeiou]*v[aeiou]*[sz]?/,     // darvis
    /[jz][aeiou]*r[aeiou]*[vw][aeiou]*/,    // catch-all for jr/jw sounds
  ];

  for (const pattern of jarvisPatterns) {
    if (pattern.test(lowerText)) {
      const match = lowerText.match(pattern);
      console.log("[WakeWord] ✓ Fuzzy match:", match?.[0], "in:", lowerText);
      return true;
    }
  }

  // Check for greeting + something jarvis-like
  const greetings = /^(hey|hi|hello|yo|ok|okay|aey|hay|hii)\s*/;
  if (greetings.test(lowerText)) {
    const afterGreeting = lowerText.replace(greetings, "").trim();
    // If it's short and has 'r' or 'v' in it, probably jarvis
    if (afterGreeting.length >= 3 && afterGreeting.length <= 12) {
      if (afterGreeting.includes('r') || afterGreeting.includes('v') || afterGreeting.includes('s')) {
        console.log("[WakeWord] ✓ Greeting + jarvis-like:", afterGreeting);
        return true;
      }
    }
  }

  // If it contains "jar" or "jerv" it's probably trying to say jarvis
  if (lowerText.includes('jar') || lowerText.includes('jerv') || lowerText.includes('serv')) {
    console.log("[WakeWord] ✓ Contains jar/jerv/serv:", lowerText);
    return true;
  }

  return false;
}

export function useVoice() {
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListeningLocal] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const restartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentStateRef = useRef<string>("idle");
  const hasSpokenRef = useRef(false);
  const isStartingRef = useRef(false);
  const lastResultTimeRef = useRef<number>(Date.now());
  const manualActivationRef = useRef(false);
  const lastToggleTimeRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastSpeakEndTimeRef = useRef<number>(0); // tracks when Jarvis TTS finishes, to ignore echo
  const isListeningRef = useRef(false); // tracks actual recognition listening state to avoid race conditions
  const listeningStartTimeRef = useRef<number>(0); // tracks when listening state was entered

  const { state, isMuted, alwaysListening, setState, setVoiceLevel, setIsListening: setStoreIsListening } = useJarvisStore();
  const prevIsSpeakingRef = useRef(false);

  // Keep ref in sync synchronously to avoid race conditions with onresult
  useEffect(() => {
    // Initial sync
    currentStateRef.current = useJarvisStore.getState().state;
    if (currentStateRef.current === "listening") {
      listeningStartTimeRef.current = Date.now();
    }
    
    // Subscribe for synchronous updates
    const unsub = useJarvisStore.subscribe((s) => {
      if (s.state === "listening" && currentStateRef.current !== "listening") {
        listeningStartTimeRef.current = Date.now();
      }
      currentStateRef.current = s.state;
    });
    return unsub;
  }, []);

  // Track when Jarvis finishes speaking, to ignore mic echo for a cooldown period
  useEffect(() => {
    const unsub = useJarvisStore.subscribe((s) => {
      if (prevIsSpeakingRef.current && !s.isSpeaking) {
        // Jarvis just stopped speaking — record timestamp
        lastSpeakEndTimeRef.current = Date.now();
        console.log("[Voice] TTS ended, echo cooldown started");
      }
      prevIsSpeakingRef.current = s.isSpeaking;
    });
    return unsub;
  }, []);

  // Check for wake word with fuzzy matching
  const checkWakeWord = useCallback((text: string) => {
    return checkWakeWordFuzzy(text);
  }, []);

  // Initialize speech recognition — runs ONCE on mount
  useEffect(() => {
    console.log("[Voice] Init effect running...");
    if (typeof window === "undefined") return;

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setIsSupported(false);
      setInitError("SpeechRecognition not supported");
      return;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        console.log("[Voice] === RECOGNITION STARTED ===");
        setIsListeningLocal(true);
        isListeningRef.current = true;
        isStartingRef.current = false;
        lastResultTimeRef.current = Date.now();
        // Sync store isListening so the UI (CommandBar) can reflect listening state
        setStoreIsListening(true);
      };

      recognition.onend = () => {
        console.log("[Voice] === RECOGNITION ENDED ===");
        setIsListeningLocal(false);
        isListeningRef.current = false;
        isStartingRef.current = false;
        setStoreIsListening(false);
        // Read fresh values from store to avoid stale closures
        const store = useJarvisStore.getState();
        const curState = currentStateRef.current;

        // Auto-restart: keep mic alive when in listening mode or alwaysListening
        if ((curState === "listening" || store.alwaysListening) && !store.isMuted) {
          console.log("[Voice] Auto-restarting recognition (state:", curState, ")");
          if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = setTimeout(() => {
            try {
              if (recognitionRef.current && !isStartingRef.current && !isListeningRef.current) {
                isStartingRef.current = true;
                recognitionRef.current.start();
              }
            } catch (e) {
              console.error("[Voice] Auto-restart failed:", e);
              isStartingRef.current = false;
            }
          }, 300);
        } else {
          console.log(`[Voice] Recognition stopped (State: ${curState}, Muted: ${store.isMuted})`);
        }
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const results = event.results;
        const lastResult = results[results.length - 1];
        const transcript = lastResult[0]?.transcript || "";
        const isFinal = lastResult.isFinal;
        const confidence = lastResult[0]?.confidence || 0;

        // Only barge-in if the USER is speaking (not Jarvis's own TTS echoing into the mic)
        // Also skip barge-in during the activation cooldown ("Yes, Boss?" is still playing)
        if (currentStateRef.current === "listening" && transcript.trim().length > 0) {
          const storeNow = useJarvisStore.getState();
          const timeSinceActivation = Date.now() - listeningStartTimeRef.current;
          if (!storeNow.isSpeaking && timeSinceActivation > 2500) {
            window.dispatchEvent(new CustomEvent('jarvis-barge-in'));
          }
        }
        lastResultTimeRef.current = Date.now();
        console.log(`[Voice] Transcript: "${transcript}" (conf: ${confidence.toFixed(2)}), isFinal: ${isFinal}, state: ${currentStateRef.current}`);

        if ((currentStateRef.current === "idle" || currentStateRef.current === "speaking") && transcript.trim().length > 0) {
          if (checkWakeWordFuzzy(transcript)) {
            console.log("[Voice] 🎤 WAKE WORD DETECTED (State: " + currentStateRef.current + ")");
            hasSpokenRef.current = false;
            useJarvisStore.getState().setState("listening");
            setInterimTranscript("");
            if (isFinal) {
              const lowerTranscript = transcript.toLowerCase().trim();
              let wakeWordEndIndex = 0;
              for (const word of WAKE_WORDS) {
                const idx = lowerTranscript.indexOf(word);
                if (idx !== -1) {
                  wakeWordEndIndex = Math.max(wakeWordEndIndex, idx + word.length);
                }
              }
              const command = transcript.slice(wakeWordEndIndex).trim();
              if (command.length > 0) {
                setFinalTranscript(command);
              }
            }
          }
          return;
        }

        if (currentStateRef.current === "listening") {
          if (!isFinal) {
            setInterimTranscript(transcript);
          } else {
            console.log("[Voice] FINAL COMMAND:", transcript);
            const trimmed = transcript.trim();
            if (trimmed.length > 0) {
              // If we are currently speaking, ignore this transcript to prevent stopping on our own voice
              const store = useJarvisStore.getState();
              if (store.isSpeaking) {
                console.log("[Voice] Ignoring final transcript while speaking");
                setInterimTranscript("");
                return;
              }
              // Cooldown: ignore transcripts arriving within 3s of Jarvis finishing speaking
              // These are echoes of Jarvis's own TTS picked up by the mic
              if (Date.now() - lastSpeakEndTimeRef.current < 3000) {
                console.log("[Voice] Ignoring echo transcript (cooldown after TTS)");
                setInterimTranscript("");
                return;
              }
              // Cooldown: ignore transcripts arriving within 2.5s of entering listening state
              // This covers the "Yes, Boss?" TTS + any buffered audio / click noise
              if (Date.now() - listeningStartTimeRef.current < 2500) {
                console.log("[Voice] Ignoring transcript received too quickly after listening activation (likely buffered/click noise or Yes Boss echo)");
                setInterimTranscript("");
                return;
              }
              setFinalTranscript(transcript);
              setInterimTranscript("");
              try { recognition.stop(); } catch {}
            } else {
              // ignore empty final transcript, keep listening
              setInterimTranscript("");
            }
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("[Voice] Recognition ERROR:", event.error, event.message);
        isStartingRef.current = false;
        if (event.error === "not-allowed") {
          setInitError("Microphone permission denied");
        } else if (event.error !== "aborted") {
          console.log("[Voice] Will restart after error...");
        }
      };

      recognitionRef.current = recognition;
      console.log("[Voice] Recognition ready. Auto-starting...");

      // Start immediately
      try {
        isStartingRef.current = true;
        recognition.start();
      } catch (e) {
        console.error("[Voice] Init start failed:", e);
        isStartingRef.current = false;
      }
    } catch (err) {
      console.error("[Voice] Error creating recognition:", err);
      setInitError(`Error creating: ${err}`);
    }

    return () => {
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      try { recognitionRef.current?.abort(); } catch {}
      recognitionRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs ONCE

  // Audio Level Analysis
  useEffect(() => {
    if (!alwaysListening || isMuted) return;
    let cancelled = false;
    const run = async () => {
      try {
        if (!streamRef.current) streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        const ctx = audioContextRef.current;
        if (ctx.state === "suspended") await ctx.resume();
        const source = ctx.createMediaStreamSource(streamRef.current);
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        const tick = () => {
          if (cancelled || !analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          setVoiceLevel(Math.min(1, (sum / dataArray.length / 128) * 1.5));
          animationFrameRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { console.error("[Voice] Audio analysis failed:", e); }
    };
    run();
    return () => { cancelled = true; if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
  }, [alwaysListening, isMuted, setVoiceLevel]);

  // Reset when going idle
  useEffect(() => {
    if (state === "idle") {
      hasSpokenRef.current = false;
      if (interimTranscript !== "") setInterimTranscript("");
      if (finalTranscript !== "") setFinalTranscript("");
    }
  }, [state, interimTranscript, finalTranscript]);

  // Watchdog
  useEffect(() => {
    if (!alwaysListening || isMuted) return;
    const id = setInterval(() => {
      if (Date.now() - lastResultTimeRef.current > 30000 && currentStateRef.current === "idle" && !isStartingRef.current) {
        console.log("[Voice] Watchdog: force restarting...");
        try { recognitionRef.current?.stop(); } catch {}
      }
    }, 10000);
    return () => clearInterval(id);
  }, [alwaysListening, isMuted]);

  // State change manager — ensure mic is on when needed
  useEffect(() => {
    if (!recognitionRef.current || isMuted) return;
    if (state === "listening" || alwaysListening) {
      if (!isListeningRef.current && !isStartingRef.current) {
        console.log("[Voice] State manager: starting mic for state:", state);
        try { isStartingRef.current = true; recognitionRef.current.start(); } catch { isStartingRef.current = false; }
      }
    } else if (!alwaysListening && isListeningRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
  }, [state, alwaysListening, isMuted]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
    setIsListeningLocal(false);
  }, []);

  const startListening = useCallback(() => {
    if (Date.now() - lastToggleTimeRef.current < 500) return;
    lastToggleTimeRef.current = Date.now();
    manualActivationRef.current = true;
    if (restartTimeoutRef.current) { clearTimeout(restartTimeoutRef.current); restartTimeoutRef.current = null; }
    if (recognitionRef.current && !isStartingRef.current) {
      try {
        isStartingRef.current = true;
        recognitionRef.current.start();
      } catch (e) {
        console.error("[Voice] Failed to start:", e);
        isStartingRef.current = false;
        manualActivationRef.current = false;
      }
    }
    setTimeout(() => { manualActivationRef.current = false; }, 2000);
  }, []);


  const setFinalTranscriptWrapper = useCallback((text: string) => {
    setFinalTranscript(text);
  }, []);

  return {
    interimTranscript,
    finalTranscript,
    isListening,
    isSupported,
    initError,
    hasSpokenRef,
    stopListening,
    startListening,
    setFinalTranscript: setFinalTranscriptWrapper,
  };
}

// Text-to-Speech hook using Browser TTS with British English voice
export function useTextToSpeech() {
  const { isMuted, isSpeaking, setIsSpeaking } = useJarvisStore();
  const isSpeakingRef = useRef(false);
  
  // Streaming Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const nextStartTimeRef = useRef(0);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // PCM Conversion (s16le to f32)
  const pcm16ToFloat32 = (int16: Int16Array) => {
    const out = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
    return out;
  };

  const stopStreaming = useCallback(() => {
    activeSourcesRef.current.forEach(src => {
      try { src.stop(0); } catch {}
    });
    activeSourcesRef.current.clear();
    
    if (wsRef.current) {
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "cancel" }));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsSpeaking(false);
    isSpeakingRef.current = false;
  }, []);

  const speakBrowser = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis || isMuted) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.pitch = 0.9;
    utterance.rate = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.includes("GB")) || voices.find(v => v.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    
    setIsSpeaking(true);
    isSpeakingRef.current = true;
    utterance.onend = () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      isSpeakingRef.current = false;
    };
    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  const speak = useCallback((text: string) => {
    if (isMuted) return;

    // Stop any currently playing speech first (barge-in)
    if (wsRef.current) {
      try { wsRef.current.close(); } catch {}
      wsRef.current = null;
    }
    activeSourcesRef.current.forEach(src => { try { src.stop(0); } catch {} });
    activeSourcesRef.current.clear();
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // Use browser TTS directly — streaming bridge (port 8787) is not running
    speakBrowser(text);
  }, [isMuted, speakBrowser]);

  // Streaming speak methods — no-op while streaming bridge (port 8787) is offline.
  // These are kept so call sites don't break. When the server is running,
  // replace speakBrowser calls in speak() and restore the WS logic.
  const startStreamingSpeak = useCallback(() => {
    // No-op: streaming server not running
    console.log("[TTS] startStreamingSpeak called (streaming server offline, skipping)");
  }, []);

  const sendStreamingChunk = useCallback((_text: string) => {
    // No-op
  }, []);

  const endStreamingSpeak = useCallback(() => {
    // No-op
  }, []);

  const stop = useCallback(() => {
    stopStreaming();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }, [stopStreaming]);

  const stopSpeaking = useCallback(() => {
    stop();
  }, [stop]);

  // Listen for barge-in events to stop speaking
  useEffect(() => {
    const handleBargeIn = () => {
      console.log("[TTS] Barge-in detected, stopping audio...");
      stop();
    };
    window.addEventListener('jarvis-barge-in', handleBargeIn);
    return () => window.removeEventListener('jarvis-barge-in', handleBargeIn);
  }, [stop]);

  return { speak, startStreamingSpeak, sendStreamingChunk, endStreamingSpeak, stop, stopSpeaking, isSpeaking };

}

// Combined voice hook for JARVIS
export function useJarvisVoice() {
  const [lastCommand, setLastCommand] = useState("");
  const { state, setState } = useJarvisStore();
  const {
    speak,
    startStreamingSpeak,
    sendStreamingChunk,
    endStreamingSpeak,
    stopSpeaking,
    isSpeaking,
  } = useTextToSpeech();
  const listeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    interimTranscript,
    finalTranscript,
    isListening,
    isSupported,
    hasSpokenRef,
    stopListening,
    startListening,
    setFinalTranscript,
  } = useVoice();

  // The speaking state is now globally managed in the store via useTextToSpeech

  // Speak "Yes, Boss?" only once when entering listening mode
  useEffect(() => {
    if (state === "listening" && !isSpeaking && !hasSpokenRef.current) {
      hasSpokenRef.current = true;
      speak("Yes, Boss?");
    }
  }, [state, isSpeaking, speak, hasSpokenRef]);

  // Reset timeout when user is speaking
  useEffect(() => {
    if (state !== "listening") return;
    if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
    listeningTimeoutRef.current = setTimeout(() => {
      if (state === "listening") setState("idle");
    }, 15000);
    return () => {
      if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
    };
  }, [interimTranscript, state, setState]);

  // Submit final transcript
  useEffect(() => {
    if (finalTranscript && state === "listening") {
      setLastCommand(finalTranscript);
      setFinalTranscript("");
      setState("thinking");
      if (listeningTimeoutRef.current) clearTimeout(listeningTimeoutRef.current);
    }
  }, [finalTranscript, state, setState, setFinalTranscript]);

  const toggleListening = useCallback(() => {
    if (state === "listening") {
      stopListening();
      setState("idle");
    } else {
      hasSpokenRef.current = false;
      setState("listening");
    }
  }, [state, setState, stopListening, hasSpokenRef]);

  return {
    interimTranscript,
    isListening,
    isSpeaking,
    isSupported,
    lastCommand,
    speak,
    startStreamingSpeak,
    sendStreamingChunk,
    endStreamingSpeak,
    stopSpeaking,
    toggleListening,
    stopListening,
    startListening,
    hasSpokenRef,
  };
}

