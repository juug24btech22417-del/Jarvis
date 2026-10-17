// Proactive Companion Hook
// ───────────────────────────────────────────
// Listens in the background for moments when JARVIS "feels like talking".
// Speaks aloud via TTS and adds the thought to the chat timeline,
// with strict anti-annoyance filters so it never bothers the user.

"use client";

import { useEffect, useRef } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import { useJarvisVoice } from "@/hooks/useVoice";

const CHECK_INTERVAL_MS = 35_000; // Check every 35s

export function useProactiveCompanion() {
  const addMessage = useJarvisStore((s) => s.addMessage);
  const userName = useJarvisStore((s) => s.userName);
  const isMuted = useJarvisStore((s) => s.isMuted);
  const isSpeaking = useJarvisStore((s) => s.isSpeaking);
  const isListening = useJarvisStore((s) => s.isListening);
  const { speak } = useJarvisVoice();

  const isSpeakingRef = useRef(isSpeaking);
  isSpeakingRef.current = isSpeaking;
  const isListeningRef = useRef(isListening);
  isListeningRef.current = isListening;
  const isMutedRef = useRef(isMuted);
  isMutedRef.current = isMuted;

  useEffect(() => {
    let timer: NodeJS.Timeout;

    const checkProactive = async () => {
      // Don't interrupt if user is actively speaking, listening, or muted
      if (isSpeakingRef.current || isListeningRef.current || isMutedRef.current) {
        return;
      }

      try {
        const res = await fetch(`/api/companion/proactive?user=${encodeURIComponent(userName || "Dhruv")}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.ok && data.shouldSpeak && data.message) {
          console.log("[Companion] Proactive thought:", data.message, "trigger:", data.trigger);
          
          // 1. Post to chat timeline
          addMessage({
            role: "assistant",
            content: data.message,
          });

          // 2. Speak aloud
          speak(data.message);
        }
      } catch (err) {
        // Quietly fail-soft
      }
    };

    // Stagger first check by 15s after mount so boot sequence finishes cleanly
    const initialTimer = setTimeout(() => {
      checkProactive();
      timer = setInterval(checkProactive, CHECK_INTERVAL_MS);
    }, 15_000);

    return () => {
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
    };
  }, [userName, addMessage, speak]);
}
