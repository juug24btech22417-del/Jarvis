// Tier 3B — Automatic persona switching.
// Picks the right persona given: manual override, time of day, alerts,
// and the active panel. Manual override wins for 30 minutes.

import type { PersonaId } from "./voiceProfiles";

export interface AutoSwitchInputs {
  /** Manual override set by voice command or UI; null if none. */
  override: PersonaId | null;
  /** When the manual override expires (null = never). */
  overrideExpiresAt: number | null;
  /** Current local hour (0-23). */
  hour: number;
  /** Are headphones plugged in? (Best-effort — the autoSwitch is a heuristic.) */
  isHeadphonesIn?: boolean;
  /** Count of active alerts (incoming messages, security events, agent errors). */
  activeAlerts: number;
  /** Currently active panel — "code" forces dev mode, etc. */
  activePanel: string | null;
  /** Did the most recent chat turn contain a code block? */
  recentChatHadCode?: boolean;
  /** Override the auto-switch (e.g. for tests). */
  disabled?: boolean;
}

export interface AutoSwitchResult {
  persona: PersonaId;
  reason: "override" | "time" | "alerts" | "panel" | "chat" | "default";
}

const OVERRIDE_DURATION_MS = 30 * 60 * 1000;

export function decidePersona(input: AutoSwitchInputs): AutoSwitchResult {
  if (input.disabled) {
    return { persona: input.override ?? "stark", reason: "default" };
  }

  // 1. Manual override wins until it expires.
  if (input.override && input.overrideExpiresAt && Date.now() < input.overrideExpiresAt) {
    return { persona: input.override, reason: "override" };
  }

  // 2. Active alerts → tactical.
  if (input.activeAlerts > 0) {
    return { persona: "tactical", reason: "alerts" };
  }

  // 3. Time-of-day → whisper during quiet hours or when headphones are in.
  const isQuietHour = input.hour >= 22 || input.hour < 6;
  if (isQuietHour || input.isHeadphonesIn) {
    return { persona: "whisper", reason: "time" };
  }

  // 4. Code panel or recent code block → dev.
  if (input.activePanel === "code" || input.recentChatHadCode) {
    return { persona: "dev", reason: input.recentChatHadCode ? "chat" : "panel" };
  }

  // 5. Default.
  return { persona: "stark", reason: "default" };
}

/**
 * Convenience: how long should a manual override last? (30 minutes.)
 */
export const MANUAL_OVERRIDE_MS = OVERRIDE_DURATION_MS;