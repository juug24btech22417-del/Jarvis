"use client";

// Screen Narrator — press Ctrl+Shift+D (or the toast button) and jarvis
// looks at your screen and tells you what you're doing. Vision via
// /api/screen/describe (BLIP caption, context fallback), voice via the
// existing jarvis voice engine.

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ScanEye } from "lucide-react";
import { useJarvisVoice } from "@/hooks/useVoice";

export function useScreenNarrator() {
  const { speak } = useJarvisVoice();
  const [caption, setCaption] = useState<string | null>(null);
  const busyRef = useRef(false);

  const narrate = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const res = await fetch("/api/screen/describe", { method: "POST" });
      const data = await res.json();
      if (data?.success && data.caption) {
        setCaption(data.caption);
        speak(data.caption);
      } else {
        setCaption("I couldn't read the screen, Boss");
        speak("I couldn't read the screen, Boss");
      }
    } catch {
      setCaption("Vision systems offline, Boss");
      speak("Vision systems offline, Boss");
    } finally {
      setTimeout(() => (busyRef.current = false), 2000);
    }
  }, [speak]);

  return { narrate, caption };
}

export default function ScreenNarratorToast() {
  const { narrate, caption } = useScreenNarrator();
  const [clear, setClear] = useState(false);
  // Auto-dismiss the caption after a beat.
  useEffect(() => {
    if (!caption) return;
    setClear(false);
    const t = setTimeout(() => setClear(true), 4500);
    return () => clearTimeout(t);
  }, [caption]);
  const visibleCaption = clear ? null : caption;

  // Ctrl+Shift+D to narrate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        narrate();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [narrate]);

  return (
    <>
      {/* Trigger button — bottom-right stack, below the eye button */}
      <motion.button
        onClick={narrate}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        title="Narrate my screen (Ctrl+Shift+D)"
        className="fixed bottom-[16.5rem] right-6 z-50 p-3 rounded-full bg-panel-glass text-text-secondary hover:bg-panel-border transition-colors"
      >
        <ScanEye className="w-5 h-5" />
      </motion.button>

      {/* Caption toast */}
      <AnimatePresence>
        {visibleCaption && (
          <motion.div
            key={visibleCaption}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed bottom-[16.5rem] right-[5.75rem] z-50 max-w-xs holographic-panel px-4 py-3 font-rajdhani text-sm text-reactor-core"
          >
            <div className="text-[10px] tracking-widest text-text-secondary/60 mb-1">
              SCREEN NARRATOR
            </div>
            {caption}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
