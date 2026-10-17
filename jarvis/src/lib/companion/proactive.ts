// JARVIS Proactive Companion Engine
// ─────────────────────────────────────────
// Enables JARVIS to speak unprompted when it feels natural and thoughtful,
// with bulletproof anti-annoyance guardrails so it NEVER pesters the user.
//
// Key Guardrails:
//   1. Cooldown Ceiling: Minimum 15-20 min between proactive utterances.
//   2. Silence Backoff: If JARVIS speaks and user doesn't answer, stay quiet (no stacking).
//   3. Daily Cap: Max 5-6 proactive thoughts per 24 hours.
//   4. Quiet Hours: 02:00 - 08:00 unless active interaction occurred in last 5 min.
//   5. Snooze: Respects user requests for space/quiet.

import fs from "fs/promises";
import path from "path";
import { getCareContext } from "./care";
import { detectTone } from "./toneDetector";

export interface ProactiveState {
  lastSpokenAt: number;        // Epoch ms
  lastUserMessageAt: number;   // Epoch ms
  lastTopic: string;
  unansweredCount: number;     // Proactive messages sent without user response
  dailyCount: number;          // Count of proactive messages sent today
  dailyDate: string;           // YYYY-MM-DD
  snoozeUntil: number;         // Epoch ms
}

const STATE_FILE = path.join(process.cwd(), ".jarvis_proactive_state.json");
const COOLDOWN_MS = 15 * 60 * 1000;          // 15 minutes minimum between unprompted comments
const UNANSWERED_BACKOFF_MS = 90 * 60 * 1000; // 90 minutes silence if user didn't reply to previous ping
const DAILY_MAX = 6;

let memState: ProactiveState = {
  lastSpokenAt: 0,
  lastUserMessageAt: Date.now(),
  lastTopic: "",
  unansweredCount: 0,
  dailyCount: 0,
  dailyDate: new Date().toISOString().slice(0, 10),
  snoozeUntil: 0,
};

async function loadState(): Promise<ProactiveState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const data = JSON.parse(raw);
    const today = new Date().toISOString().slice(0, 10);
    if (data.dailyDate !== today) {
      data.dailyDate = today;
      data.dailyCount = 0;
    }
    memState = { ...memState, ...data };
  } catch {
    // Fall back to default memState
  }
  return memState;
}

async function saveState(state: ProactiveState): Promise<void> {
  memState = state;
  try {
    await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.warn("[Proactive] Failed to persist state:", err);
  }
}

/**
 * Called whenever the user speaks or sends a chat message.
 * Resets unanswered count and records user presence.
 */
export async function recordUserInteraction(): Promise<void> {
  const state = await loadState();
  state.lastUserMessageAt = Date.now();
  state.unansweredCount = 0;
  await saveState(state);
}

/**
 * Snooze proactive remarks for a duration in minutes.
 */
export async function snoozeProactive(minutes: number = 60): Promise<void> {
  const state = await loadState();
  state.snoozeUntil = Date.now() + minutes * 60 * 1000;
  await saveState(state);
}

export interface ProactiveEvaluationResult {
  shouldSpeak: boolean;
  message?: string;
  trigger?: "late_night" | "stressed_recheck" | "care_thread" | "idle_checkin" | "spontaneous";
  archetype?: string;
  reason: string;
  cooldownRemainingMs?: number;
}

/**
 * Evaluates whether JARVIS should initiate conversation now.
 * Zero lag, fully cached context, strict anti-annoyance filters.
 */
export async function evaluateProactiveSpeech(options: {
  force?: boolean;
  now?: Date;
  mockHour?: number;
  userName?: string;
} = {}): Promise<ProactiveEvaluationResult> {
  const now = options.now || new Date();
  const hour = options.mockHour !== undefined ? options.mockHour : now.getHours();
  const userName = options.userName || "Dhruv";
  const nowMs = now.getTime();

  const state = await loadState();

  // Reset daily count if date changed
  const today = now.toISOString().slice(0, 10);
  if (state.dailyDate !== today) {
    state.dailyDate = today;
    state.dailyCount = 0;
  }

  // ── Guardrail 1: Snooze active ──
  if (!options.force && state.snoozeUntil > nowMs) {
    return {
      shouldSpeak: false,
      reason: "snoozed",
      cooldownRemainingMs: state.snoozeUntil - nowMs,
    };
  }

  // ── Guardrail 2: Daily cap ──
  if (!options.force && state.dailyCount >= DAILY_MAX) {
    return {
      shouldSpeak: false,
      reason: "daily_cap_reached",
    };
  }

  // ── Guardrail 3: Unanswered backoff (Anti-annoyance: do not spam into the void) ──
  if (!options.force && state.unansweredCount >= 1) {
    const elapsedSinceLastSpoken = nowMs - state.lastSpokenAt;
    if (elapsedSinceLastSpoken < UNANSWERED_BACKOFF_MS) {
      return {
        shouldSpeak: false,
        reason: "unanswered_backoff",
        cooldownRemainingMs: UNANSWERED_BACKOFF_MS - elapsedSinceLastSpoken,
      };
    }
  }

  // ── Guardrail 4: Standard cooldown ──
  if (!options.force && state.lastSpokenAt > 0) {
    const elapsedSinceLastSpoken = nowMs - state.lastSpokenAt;
    if (elapsedSinceLastSpoken < COOLDOWN_MS) {
      return {
        shouldSpeak: false,
        reason: "cooldown_active",
        cooldownRemainingMs: COOLDOWN_MS - elapsedSinceLastSpoken,
      };
    }
  }

  // ── Guardrail 5: Quiet hours (02:00 to 08:00) ──
  const isQuietHours = hour >= 2 && hour < 8;
  const userRecentlyActive = nowMs - state.lastUserMessageAt < 5 * 60 * 1000;
  if (!options.force && isQuietHours && !userRecentlyActive) {
    return {
      shouldSpeak: false,
      reason: "quiet_hours",
    };
  }

  // ── Evaluate Triggers ──
  let careCtx;
  try {
    careCtx = await getCareContext(now);
  } catch {
    careCtx = { openThreads: [], recentMoods: [] };
  }

  // Trigger A: User was stressed / low mood earlier & enough time has passed to recheck
  const lastMood = careCtx.recentMoods?.[0];
  const isStressedOrLow = lastMood && (lastMood.mood === "stressed" || lastMood.mood === "low" || lastMood.score <= 2);
  const timeSinceMood = lastMood ? nowMs - new Date(lastMood.at).getTime() : Infinity;
  if (isStressedOrLow && timeSinceMood > 15 * 60 * 1000 && timeSinceMood < 180 * 60 * 1000) {
    const tone = detectTone("stressed", [], userName);
    const message = `Hey ${tone.preferredAddress}, just checking in on you. Take a breather if you need to — don't let it wear you down.`;
    
    state.lastSpokenAt = nowMs;
    state.unansweredCount += 1;
    state.dailyCount += 1;
    state.lastTopic = "stressed_recheck";
    await saveState(state);

    return {
      shouldSpeak: true,
      trigger: "stressed_recheck",
      archetype: "confidant",
      message,
      reason: "user_recent_stress_checkin",
    };
  }

  // Trigger B: Late night companion (grinding past 23:00)
  if (hour >= 23 || hour < 4) {
    const timeSinceUser = nowMs - state.lastUserMessageAt;
    if (timeSinceUser < 45 * 60 * 1000 || options.force) {
      const lateMessages = [
        `Burning the midnight oil, bro? Don't forget to grab some water and rest your eyes for a minute.`,
        `Late session tonight, Dhruv. How's the code holding up?`,
        `Still at the desk, bro? Pace yourself — tomorrow's going to need you sharp.`,
      ];
      const message = lateMessages[Math.floor(Math.random() * lateMessages.length)];

      state.lastSpokenAt = nowMs;
      state.unansweredCount += 1;
      state.dailyCount += 1;
      state.lastTopic = "late_night";
      await saveState(state);

      return {
        shouldSpeak: true,
        trigger: "late_night",
        archetype: "bro",
        message,
        reason: "late_night_active",
      };
    }
  }

  // Trigger C: Open care thread / unresolved task check-in
  const openThread = careCtx.openThreads?.find(
    (t: any) => t.dueLabel === "today" || t.dueLabel === "overdue" || t.askedCount === 0
  );
  if (openThread && openThread.topic !== state.lastTopic) {
    const message = `Hey ${userName}, checking in on ${openThread.topic} — did you get that sorted, or still dealing with it?`;
    
    state.lastSpokenAt = nowMs;
    state.unansweredCount += 1;
    state.dailyCount += 1;
    state.lastTopic = openThread.topic;
    await saveState(state);

    return {
      shouldSpeak: true,
      trigger: "care_thread",
      archetype: "bro",
      message,
      reason: "open_care_thread",
    };
  }

  // Trigger D: Idle after focused work (15 - 45 min idle)
  const idleMs = nowMs - state.lastUserMessageAt;
  if ((idleMs >= 20 * 60 * 1000 && idleMs <= 50 * 60 * 1000) || options.force) {
    const idleRemarks = [
      `Desk has gone quiet, bro. Everything smooth, or need me to look into anything?`,
      `Taking a quick break, Dhruv? Let me know whenever you're ready to jump back in.`,
      `Things look stable here, bro. Holler if you need a hand with whatever you're tackling.`,
    ];
    const message = idleRemarks[Math.floor(Math.random() * idleRemarks.length)];

    state.lastSpokenAt = nowMs;
    state.unansweredCount += 1;
    state.dailyCount += 1;
    state.lastTopic = "idle_checkin";
    await saveState(state);

    return {
      shouldSpeak: true,
      trigger: "idle_checkin",
      archetype: "bro",
      message,
      reason: "post_focus_idle",
    };
  }

  return {
    shouldSpeak: false,
    reason: "no_active_triggers",
  };
}

/**
 * Fetch current proactive status for UI indicators or debugging.
 */
export async function getProactiveStatus(): Promise<{
  state: ProactiveState;
  cooldownRemainingSec: number;
  canSpeakNow: boolean;
}> {
  const state = await loadState();
  const now = Date.now();
  const cooldownRemaining = Math.max(0, COOLDOWN_MS - (now - state.lastSpokenAt));
  const canSpeak = cooldownRemaining === 0 && state.unansweredCount === 0 && state.dailyCount < DAILY_MAX;

  return {
    state,
    cooldownRemainingSec: Math.round(cooldownRemaining / 1000),
    canSpeakNow: canSpeak,
  };
}
