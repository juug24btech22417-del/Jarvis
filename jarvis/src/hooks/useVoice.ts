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
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const { state, isMuted, alwaysListening, setState, setVoiceLevel, setIsListening: setStoreIsListening } = useJarvisStore();

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

        // AUTO-RESTART for "Always Listening" luxury mode
        if (alwaysListening && !isMuted && state !== "listening") {
          console.log("[Voice] Auto-restarting background listener...");
          if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = setTimeout(() => {
            try {
              if (recognitionRef.current && !isStartingRef.current) {
                isStartingRef.current = true;
                recognitionRef.current.start();
              }
            } catch (e) {
              console.error("[Voice] Auto-restart failed:", e);
              isStartingRef.current = false;
            }
          }, 300); // Tiny delay to let the OS release the mic
        } else {
          console.log("[Voice] Recognition stopped - auto-restart disabled or in listening mode");
        }
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const results = event.results;
        const lastResult = results[results.length - 1];
        const transcript = lastResult[0]?.transcript || "";
        const isFinal = lastResult.isFinal;
        const confidence = lastResult[0]?.confidence || 0;

        // Barge-in on interim results too
        if (currentStateRef.current === "listening" && transcript.trim().length > 0) {
          window.dispatchEvent(new CustomEvent('jarvis-barge-in'));
        }

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
    } catch (err) {
      console.error("[Voice] Error creating recognition:", err);
      setInitError(`Error creating: ${err}`);
    }

    // Audio Level Analysis for "Luxury" Visuals
    const startAudioAnalysis = async () => {
      try {
        if (!streamRef.current) {
          streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const ctx = audioContextRef.current;
        if (ctx.state === "suspended") await ctx.resume();
        
        const source = ctx.createMediaStreamSource(streamRef.current);
        analyserRef.current = ctx.createAnalyser();
        analyserRef.current.fftSize = 256;
        source.connect(analyserRef.current);
        
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        
        const updateLevel = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Calculate average volume
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const average = sum / dataArray.length;
          
          // Boost and normalize for visual effect
          const level = Math.min(1, (average / 128) * 1.5);
          setVoiceLevel(level);
          
          animationFrameRef.current = requestAnimationFrame(updateLevel);
        };
        
        updateLevel();
      } catch (e) {
        console.error("[Voice] Audio analysis failed:", e);
      }
    };

    if (alwaysListening && !isMuted) {
      startAudioAnalysis();
      
      console.log("[Voice] Starting Always-On background listener...");
      try {
        const rec = recognitionRef.current;
        if (rec && !isStartingRef.current) {
          isStartingRef.current = true;
          rec.start();
        }
      } catch (e) {
        console.error("[Voice] Failed to start background listener:", e);
        isStartingRef.current = false;
      }
    }

    return () => {
      console.log("[Voice] Cleanup - stopping recognition and analysis");
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      
      try {
        recognitionRef.current?.abort();
        streamRef.current?.getTracks().forEach(t => t.stop());
        audioContextRef.current?.close();
      } catch { /* Ignore */ }
    };
  }, [checkWakeWord, isMuted, alwaysListening, setState, setVoiceLevel]);

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

  // Auto-start/stop based on state - UPDATED for Always-On
  useEffect(() => {
    if (!recognitionRef.current || isMuted) return;

    const now = Date.now();
    if (now - lastToggleTimeRef.current < 500) return;

    if (state === "listening") {
      // If we are in "listening" mode, we want to ensure the mic is active for the command
      if (!isListening && !isStartingRef.current) {
        console.log("[Voice] Ensuring mic is active for command listening");
        try {
          isStartingRef.current = true;
          recognitionRef.current.start();
        } catch (e) {
          console.error("[Voice] Command start failed:", e);
          isStartingRef.current = false;
        }
      }
    } else if (alwaysListening) {
      // If Always-On is enabled, we want the mic active in ALL OTHER states (idle, speaking, thinking)
      // to allow for wake word detection and barge-in.
      if (!isListening && !isStartingRef.current) {
        console.log("[Voice] Ensuring mic is active for Always-On mode (state: " + state + ")");
        try {
          isStartingRef.current = true;
          recognitionRef.current.start();
        } catch (e) {
          console.error("[Voice] Always-On auto-start failed:", e);
          isStartingRef.current = false;
        }
      }
    } else {
      // Always-On is OFF, and we are not in listening mode -> Mic should be OFF
      if (isListening && !isStartingRef.current) {
        console.log("[Voice] Stopping mic as Always-On is disabled");
        try {
          isStartingRef.current = true;
          recognitionRef.current.stop();
        } catch {
          // Ignore
        }
      }
    }
  }, [state, alwaysListening, isMuted]);

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

    // Barge-in: Stop any current speech
    stopStreaming();
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // Attempt Streaming TTS via Local Bridge
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      
      nextStartTimeRef.current = ctx.currentTime + 0.05;
      
      console.log("[TTS] Attempting to connect to bridge at ws://127.0.0.1:8787...");
      const ws = new WebSocket("ws://127.0.0.1:8787");
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        console.log("[TTS] 🟢 Streaming bridge connected!");
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        ws.send(JSON.stringify({ type: "speak", text }));
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          console.log("[TTS] Received control message:", ev.data);
          return;
        }

        console.log("[TTS] Received audio binary, size:", ev.data.byteLength);
        const pcm = new Int16Array(ev.data);
        const floats = pcm16ToFloat32(pcm);
        const sampleRate = 24000;
        
        const audioBuffer = ctx.createBuffer(1, floats.length, sampleRate);
        audioBuffer.copyToChannel(floats, 0);

        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(ctx.destination);

        activeSourcesRef.current.add(src);
        src.onended = () => {
          activeSourcesRef.current.delete(src);
          if (activeSourcesRef.current.size === 0 && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
            setIsSpeaking(false);
            isSpeakingRef.current = false;
          }
        };

        const now = ctx.currentTime;
        if (nextStartTimeRef.current < now) nextStartTimeRef.current = now + 0.01;
        src.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
      };

      ws.onerror = () => {
        console.warn("[TTS] Stream bridge unreachable. Falling back to browser TTS.");
        speakBrowser(text);
      };

      ws.onclose = () => {
        wsRef.current = null;
      };
    } catch (e) {
      console.error("[TTS] Streaming setup failed:", e);
      speakBrowser(text);
    }
  }, [isMuted, stopStreaming, speakBrowser]);

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
