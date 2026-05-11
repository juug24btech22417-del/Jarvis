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
  const watchdogIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const manualActivationRef = useRef(false);
  const lastToggleTimeRef = useRef<number>(0);

  const { setState, state, isMuted, setIsListening: setStoreIsListening } = useJarvisStore();

  // Keep ref in sync
  useEffect(() => {
    currentStateRef.current = state;
  }, [state]);

  // REMOVED: Sync local listening state with store - was causing extra re-renders
  // The store is now only updated when user explicitly toggles the mic

  // Check for wake word with fuzzy matching
  const checkWakeWord = useCallback((text: string) => {
    return checkWakeWordFuzzy(text);
  }, []);

  // Initialize speech recognition
  useEffect(() => {
    console.log("[Voice] Effect running - checking environment...");

    if (typeof window === "undefined") {
      console.log("[Voice] Window is undefined - SSR");
      return;
    }

    const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionAPI) {
      console.error("[Voice] SpeechRecognition NOT supported in this browser");
      setIsSupported(false);
      setInitError("SpeechRecognition not supported");
      return;
    }

    console.log("[Voice] SpeechRecognition API found, creating instance...");

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = "en-US";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      console.log("[Voice] Recognition instance created, setting up handlers...");

      recognition.onstart = () => {
        console.log("[Voice] === RECOGNITION STARTED ===");
        setIsListeningLocal(true);
        isStartingRef.current = false;
        lastResultTimeRef.current = Date.now();
      };

      recognition.onend = () => {
        console.log("[Voice] === RECOGNITION ENDED ===");
        setIsListeningLocal(false);
        isStartingRef.current = false;

        // Clear any pending restart
        if (restartTimeoutRef.current) {
          clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = null;
        }

        // DO NOT auto-restart - only start when explicitly triggered by user or wake word
        // This prevents the mic from flickering on/off rapidly
        console.log("[Voice] Recognition stopped - waiting for explicit trigger");
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const results = event.results;
        const lastResult = results[results.length - 1];
        const transcript = lastResult[0]?.transcript || "";
        const isFinal = lastResult.isFinal;
        const confidence = lastResult[0]?.confidence || 0;

        // Update last result time for watchdog
        lastResultTimeRef.current = Date.now();

        // ALWAYS log transcripts for debugging
        console.log(`[Voice] Transcript: "${transcript}" (conf: ${confidence.toFixed(2)}), isFinal: ${isFinal}, state: ${currentStateRef.current}`);

        // Check wake word when idle - use interim results too for faster response
        if (currentStateRef.current === "idle") {
          const isWakeWord = checkWakeWord(transcript);
          if (isWakeWord) {
            console.log("[Voice] 🎤 WAKE WORD DETECTED! Transitioning to listening mode...");
            hasSpokenRef.current = false;
            setState("listening");
            setInterimTranscript("");

            // If this is the final result, and it contains more than just the wake word,
            // extract the command part (everything after the wake word)
            if (isFinal) {
              const lowerTranscript = transcript.toLowerCase().trim();
              // Find where wake word ends
              let wakeWordEndIndex = 0;
              for (const word of WAKE_WORDS) {
                if (lowerTranscript.includes(word)) {
                  const idx = lowerTranscript.indexOf(word);
                  if (idx !== -1) {
                    wakeWordEndIndex = Math.max(wakeWordEndIndex, idx + word.length);
                  }
                }
              }

              // Extract command after wake word
              const command = transcript.slice(wakeWordEndIndex).trim();
              if (command.length > 0) {
                console.log("[Voice] Command with wake word:", command);
                setFinalTranscript(command);
              } else {
                // Just wake word, wait for more speech
                console.log("[Voice] Wake word only, waiting for command...");
                setInterimTranscript("");
              }
            }
            return;
          }
          // Not a wake word, ignore in idle state
          return;
        }

        // Process command when listening
        if (currentStateRef.current === "listening") {
          if (!isFinal) {
            // Show interim results for feedback
            setInterimTranscript(transcript);
          } else {
            // Final result - this is the command
            console.log("[Voice] FINAL COMMAND:", transcript);
            setFinalTranscript(transcript);
            setInterimTranscript("");

            // Stop to clear buffer - onend will auto-restart for wake word detection
            try {
              recognition.stop();
            } catch {
              // Ignore
            }
          }
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error("[Voice] Recognition ERROR:", event.error, event.message);
        isStartingRef.current = false;

        // For most errors, we want to restart
        // Only abort and not-allowed should stop us permanently
        if (event.error === "not-allowed") {
          setInitError("Microphone permission denied");
          alert("Microphone permission denied. Please allow microphone access.");
        } else if (event.error === "aborted") {
          console.log("[Voice] Recognition aborted (normal)");
        } else {
          // For network, service-not-allowed, no-speech, etc - restart
          console.log("[Voice] Will restart after error...");
          // onend will fire after error and trigger restart
        }
      };

      recognitionRef.current = recognition;
      console.log("[Voice] Recognition instance stored in ref");

      // Start recognition for wake word detection
      // Mic must be ON to detect "hey jarvis" even when in other apps
      console.log("[Voice] Starting wake word detection...");
      try {
        isStartingRef.current = true;
        recognition.start();
      } catch (e) {
        console.error("[Voice] Failed to start:", e);
        isStartingRef.current = false;
      }
    } catch (err) {
      console.error("[Voice] Error creating recognition:", err);
      setInitError(`Error creating: ${err}`);
    }

    // WATCHDOG REMOVED - was causing mic flickering
    // Recognition will be started explicitly when needed

    return () => {
      console.log("[Voice] Cleanup - stopping recognition");
      if (restartTimeoutRef.current) {
        clearTimeout(restartTimeoutRef.current);
      }
      try {
        recognitionRef.current?.abort();
      } catch {
        // Ignore
      }
    };
  }, [checkWakeWord, isMuted, setState]);

  // Reset when going idle
  useEffect(() => {
    if (state === "idle") {
      hasSpokenRef.current = false;
      setInterimTranscript("");
      setFinalTranscript("");
    }
  }, [state]);

  const stopListening = useCallback(() => {
    console.log("[Voice] Manual stop called");
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore
      }
    }
    setIsListeningLocal(false);
  }, []);

  const startListening = useCallback(() => {
    const now = Date.now();
    // Debounce: prevent rapid toggling (min 500ms between toggles)
    if (now - lastToggleTimeRef.current < 500) {
      console.log("[Voice] Toggle debounced - too soon");
      return;
    }
    lastToggleTimeRef.current = now;

    console.log("[Voice] Manual start called");
    manualActivationRef.current = true;

    // Clear any pending auto-restart
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

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

    // Clear manual activation flag after 2 seconds
    setTimeout(() => {
      manualActivationRef.current = false;
    }, 2000);
  }, []);

  // Auto-start/stop based on state - SIMPLIFIED to prevent flickering
  // Only start/stop when state changes, not based on isListening feedback
  useEffect(() => {
    if (!recognitionRef.current) return;

    // Debounce: prevent rapid state changes (1 second)
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 1000) {
      return;
    }

    if (state === "listening") {
      // User activated mic - start listening for commands
      if (!isStartingRef.current && !isListening) {
        console.log("[Voice] Auto-starting for listening state");
        try {
          isStartingRef.current = true;
          recognitionRef.current.start();
        } catch (e) {
          console.error("[Voice] Auto-start failed:", e);
          isStartingRef.current = false;
        }
      }
    } else {
      // In thinking/speaking/idle states - stop mic to prevent capturing unintended speech
      // User can manually toggle to re-enable
      if (isListening && !isStartingRef.current) {
        console.log("[Voice] Auto-stopping for state:", state);
        try {
          isStartingRef.current = true;
          recognitionRef.current.stop();
        } catch {
          // Ignore
        }
      }
    }
  }, [state]);

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
  const { isMuted } = useJarvisStore();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Simple speak function using browser's British English voice
  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis || isMuted) {
      console.log("[TTS] Cannot speak - muted");
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    console.log("[TTS] Speaking:", text.substring(0, 50) + "...");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB"; // British English
    utterance.pitch = 0.9; // Slightly lower for deeper voice
    utterance.rate = 0.9; // Slightly slower for clarity
    utterance.volume = 1;

    // Get available voices and find British English
    const voices = window.speechSynthesis.getVoices();

    // Prefer British English voices
    const britishVoice = voices.find((v) =>
      v.lang === "en-GB" || v.lang.includes("GB") || v.lang.includes("UK")
    );

    // Fallback to any English voice
    const englishVoice = britishVoice || voices.find((v) => v.lang.startsWith("en"));

    if (englishVoice) {
      utterance.voice = englishVoice;
      console.log("[TTS] Using voice:", englishVoice.name, `(${englishVoice.lang})`);
    }

    // Set refs to track state without causing re-renders
    isSpeakingRef.current = true;
    setIsSpeaking(true);

    utterance.onend = () => {
      console.log("[TTS] Speech ended");
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      utteranceRef.current = null;
    };

    utterance.onerror = (e) => {
      console.error("[TTS] Speech error:", e.error);
      if (e.error !== "canceled" && e.error !== "interrupted") {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      }
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [isMuted]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  return { speak, stop, stopSpeaking, isSpeaking };
}

// Combined voice hook for JARVIS
export function useJarvisVoice() {
  const [lastCommand, setLastCommand] = useState("");
  const { state, setState } = useJarvisStore();
  const { speak, stopSpeaking, isSpeaking } = useTextToSpeech();
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

  // Speak "Yes, Boss?" only once when entering listening mode
  useEffect(() => {
    console.log("[JarvisVoice] State check - state:", state, "isSpeaking:", isSpeaking, "hasSpoken:", hasSpokenRef.current);
    if (state === "listening" && !isSpeaking && !hasSpokenRef.current) {
      console.log("[JarvisVoice] Speaking 'Yes, Boss?'");
      hasSpokenRef.current = true;
      speak("Yes, Boss?");
    }

    return () => {
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current);
        listeningTimeoutRef.current = null;
      }
    };
  }, [state, isSpeaking, speak, hasSpokenRef, setState]);

  // Reset timeout when user is speaking (interim transcript changes)
  useEffect(() => {
    if (state !== "listening") return;

    // Clear existing timeout
    if (listeningTimeoutRef.current) {
      clearTimeout(listeningTimeoutRef.current);
    }

    // Set new 15-second timeout
    listeningTimeoutRef.current = setTimeout(() => {
      if (state === "listening") {
        console.log("[JarvisVoice] Listening timeout (15s) - returning to idle");
        setState("idle");
      }
    }, 15000);

    return () => {
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current);
        listeningTimeoutRef.current = null;
      }
    };
  }, [interimTranscript, state, setState]);

  // Submit final transcript
  useEffect(() => {
    if (finalTranscript && state === "listening") {
      console.log("[JarvisVoice] Got final command:", finalTranscript);
      setLastCommand(finalTranscript);
      setFinalTranscript("");
      setState("thinking");

      // Clear the timeout since we got a command
      if (listeningTimeoutRef.current) {
        clearTimeout(listeningTimeoutRef.current);
        listeningTimeoutRef.current = null;
      }
    }
  }, [finalTranscript, state, setState, setFinalTranscript]);

  // Toggle listening manually
  const toggleListening = useCallback(() => {
    console.log("[JarvisVoice] Toggle listening, current state:", state);
    if (state === "listening") {
      stopListening();
      setState("idle");
    } else {
      // Reset hasSpoken so we can say "Yes, Boss?" again
      hasSpokenRef.current = false;
      setState("listening");
    }
  }, [state, setState, stopListening]);

  return {
    interimTranscript,
    isListening,
    isSpeaking,
    isSupported,
    lastCommand,
    speak,
    stopSpeaking,
    toggleListening,
    stopListening,
    startListening,
    hasSpokenRef,
  };
}
