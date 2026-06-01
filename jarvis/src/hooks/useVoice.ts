import { useEffect, useRef, useCallback, useState } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import { VoiceEngine } from "@/lib/VoiceEngine";

// Simplified Voice Hook
export function useVoice() {
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [isSupported, setIsSupported] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  const { state, isMuted, alwaysListening, setState, setVoiceLevel } = useJarvisStore();
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const engine = VoiceEngine.getInstance();

    engine.setCallbacks({
      onInterim: (text) => setInterimTranscript(text),
      onFinal: (text) => {
        setFinalTranscript(text);
        setInterimTranscript("");
      },
      onWakeWord: () => {
        setState("listening");
        setInterimTranscript("");
      },
      onError: (err) => {
        setInitError(err);
        if (err.includes("not supported")) setIsSupported(false);
      }
    });

    // Start engine if alwaysListening
    if (alwaysListening && !isMuted) {
      engine.start();
    }

    return () => {
      // We don't stop the engine on unmount because it's global and should stay active
    };
  }, [alwaysListening, isMuted, setState]);

  // Audio Level Analysis (for UI visualizer)
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
    if (state === "idle" || state === "sleep") {
      setInterimTranscript("");
      setFinalTranscript("");
    }
  }, [state]);

  const stopListening = useCallback(() => {
    VoiceEngine.getInstance().stop();
  }, []);

  const startListening = useCallback(() => {
    VoiceEngine.getInstance().start();
  }, []);

  return {
    interimTranscript,
    finalTranscript,
    isSupported,
    initError,
    stopListening,
    startListening,
    setFinalTranscript,
  };
}

// Text-to-Speech hook
export function useTextToSpeech() {
  const { isMuted, isSpeaking, setIsSpeaking } = useJarvisStore();
  const wsRef = useRef<WebSocket | null>(null);

  const speakBrowser = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis || isMuted) return;
    window.speechSynthesis.cancel();
    
    // Explicitly pause the mic BEFORE we start talking
    VoiceEngine.getInstance().pauseForTTS();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-GB";
    utterance.pitch = 0.9;
    utterance.rate = 0.9;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.includes("GB")) || voices.find(v => v.lang.startsWith("en"));
    if (voice) utterance.voice = voice;
    
    setIsSpeaking(true);
    
    utterance.onend = () => {
      setIsSpeaking(false);
      // Resume mic AFTER we finish talking
      VoiceEngine.getInstance().resumeAfterTTS();
    };
    
    utterance.onerror = () => {
      setIsSpeaking(false);
      VoiceEngine.getInstance().resumeAfterTTS();
    };
    
    window.speechSynthesis.speak(utterance);
  }, [isMuted, setIsSpeaking]);

  const speak = useCallback((text: string) => {
    if (isMuted) return;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    speakBrowser(text);
  }, [isMuted, speakBrowser]);

  const stop = useCallback(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeaking(false);
    VoiceEngine.getInstance().resumeAfterTTS();
  }, [setIsSpeaking]);

  const stopSpeaking = useCallback(() => {
    stop();
  }, [stop]);

  // Listen for barge-in events
  useEffect(() => {
    const handleBargeIn = () => {
      console.log("[TTS] Barge-in detected, stopping audio...");
      stop();
    };
    window.addEventListener('jarvis-barge-in', handleBargeIn);
    return () => window.removeEventListener('jarvis-barge-in', handleBargeIn);
  }, [stop]);

  // Stubs for future streaming
  const startStreamingSpeak = useCallback(() => {}, []);
  const sendStreamingChunk = useCallback((_text: string) => {}, []);
  const endStreamingSpeak = useCallback(() => {}, []);

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
  
  const hasSpokenRef = useRef(false);
  const listeningTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    interimTranscript,
    finalTranscript,
    isSupported,
    stopListening,
    startListening,
    setFinalTranscript,
  } = useVoice();

  // Speak "Yes, Boss?" only once when entering listening mode
  useEffect(() => {
    if (state === "listening" && !isSpeaking && !hasSpokenRef.current) {
      hasSpokenRef.current = true;
      speak("Yes, Boss?");
    }
  }, [state, isSpeaking, speak]);

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
      setState("idle");
    } else {
      hasSpokenRef.current = false;
      setState("listening");
    }
  }, [state, setState]);

  return {
    interimTranscript,
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
