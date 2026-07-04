// Tier 3B — Wire the auto-switch into the running app.
// Runs on an interval: every 60s it consults decidePersona() and updates
// the store. Also reacts to changes in activePanel, activeAlerts.

"use client";

import { useEffect } from "react";
import { useJarvisStore } from "@/store/jarvis.store";
import { decidePersona } from "@/lib/persona/autoSwitch";

const TICK_MS = 60_000;

/**
 * Best-effort headphone detection. Most browsers don't expose this directly,
 * so we look for a media element with audio output (Bluetooth / wired hint).
 */
function detectHeadphones(): boolean {
  if (typeof navigator === "undefined") return false;
  // If media session is active, treat as "headphones-like" usage.
  if ("mediaSession" in navigator) {
    try {
      // @ts-ignore — not all browsers type metadata.
      if (navigator.mediaSession.metadata) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function useAutoPersona() {
  const personaOverride = useJarvisStore((s) => s.personaOverride);
  const personaOverrideExpiresAt = useJarvisStore(
    (s) => s.personaOverrideExpiresAt
  );
  const setPersona = useJarvisStore((s) => s.setPersona);
  const activeAlerts = useJarvisStore((s) => s.activeAlerts);
  const activePanel = useJarvisStore((s) => s.activePanel);
  const messages = useJarvisStore((s) => s.messages);

  useEffect(() => {
    const evaluate = () => {
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === "assistant")?.content;
      const recentChatHadCode = !!lastAssistant && /```[\s\S]+?```/.test(lastAssistant);

      const result = decidePersona({
        override: personaOverride,
        overrideExpiresAt: personaOverrideExpiresAt,
        hour: new Date().getHours(),
        isHeadphonesIn: detectHeadphones(),
        activeAlerts,
        activePanel,
        recentChatHadCode,
      });

      setPersona(result.persona);
    };

    evaluate();
    const t = setInterval(evaluate, TICK_MS);
    return () => clearInterval(t);
  }, [
    personaOverride,
    personaOverrideExpiresAt,
    activeAlerts,
    activePanel,
    messages,
    setPersona,
  ]);
}