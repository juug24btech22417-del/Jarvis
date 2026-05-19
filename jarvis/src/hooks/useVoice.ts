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

  const { state, isMuted, alwaysListening, setState, setVoiceLevel, setIsListening: setStoreIsListening } = useJarvisStore();

  // Keep ref in sync
  useEffect(() => {
    currentStateRef.current = state;
  }, [state]);

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
        isStartingRef.current = false;
        lastResultTimeRef.current = Date.now();
      };

      recognition.onend = () => {
        console.log("[Voice] === RECOGNITION ENDED ===");
        setIsListeningLocal(false);
        isStartingRef.current = false;
        // Read fresh values from store to avoid stale closures
        const store = useJarvisStore.getState();
        const curState = currentStateRef.current;

        if (store.alwaysListening && !store.isMuted && curState !== "listening" && curState !== "thinking") {
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

        if (currentStateRef.current === "listening" && transcript.trim().length > 0) {
          window.dispatchEvent(new CustomEvent('jarvis-barge-in'));
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
            setFinalTranscript(transcript);
            setInterimTranscript("");
            try { recognition.stop(); } catch {}
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
      if (!isListening && !isStartingRef.current) {
        console.log("[Voice] State manager: starting mic for state:", state);
        try { isStartingRef.current = true; recognitionRef.current.start(); } catch { isStartingRef.current = false; }
      }
    } else if (!alwaysListening && isListening) {
      try { recognitionRef.current.stop(); } catch {}
    }
  }, [state, alwaysListening, isMuted, isListening]);

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
      
      const ws = new WebSocket("ws://127.0.0.1:8787");
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        ws.send(JSON.stringify({ type: "speak", text }));
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const ctrl = JSON.parse(ev.data);
            if (ctrl.type === "error") {
              stopStreaming();
              speakBrowser(text);
            }
          } catch (e) {}
          return;
        }

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

      ws.onerror = () => speakBrowser(text);
      ws.onclose = () => { wsRef.current = null; };
    } catch (e) {
      speakBrowser(text);
    }
  }, [isMuted, stopStreaming, speakBrowser]);

  // NEW: Real-time streaming methods
  const startStreamingSpeak = useCallback(() => {
    if (isMuted) return;
    stopStreaming();
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      nextStartTimeRef.current = ctx.currentTime + 0.05;

      const ws = new WebSocket("ws://127.0.0.1:8787");
      wsRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        setIsSpeaking(true);
        isSpeakingRef.current = true;
        ws.send(JSON.stringify({ type: "start_stream" }));
      };

      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") return;
        const pcm = new Int16Array(ev.data);
        const floats = pcm16ToFloat32(pcm);
        const audioBuffer = ctx.createBuffer(1, floats.length, 24000);
        audioBuffer.copyToChannel(floats, 0);
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(ctx.destination);
        activeSourcesRef.current.add(src);
        src.onended = () => activeSourcesRef.current.delete(src);
        const now = ctx.currentTime;
        if (nextStartTimeRef.current < now) nextStartTimeRef.current = now + 0.01;
        src.start(nextStartTimeRef.current);
        nextStartTimeRef.current += audioBuffer.duration;
      };
      ws.onclose = () => { wsRef.current = null; };
    } catch (e) {
      console.error("[TTS] Stream start failed", e);
    }
  }, [isMuted, stopStreaming]);

  const sendStreamingChunk = useCallback((text: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "chunk", text }));
    }
  }, []);

  const endStreamingSpeak = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "end_stream" }));
    }
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

