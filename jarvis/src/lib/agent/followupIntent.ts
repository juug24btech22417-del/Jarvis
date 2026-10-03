// Follow-up intent detection — pure, no LLM, no network.
//
// A follow-up used to be chat-only: "send it to my telegram" produced a nice
// sentence and nothing else. This module classifies imperative follow-ups so
// the service can actually DO them (send, save, render) instead of describing
// them. Pure so the rules are unit-testable without Telegram or the agent LLM.

import { ordinalIndex } from "./followupRefs";

export type FollowupActionKind = "telegram" | "video" | "open" | "file" | "note" | "none";

export interface FollowupAction {
  kind: FollowupActionKind;
  /** The verb that triggered it, for logging/telemetry. */
  trigger: string;
}

const SEND_VERB = /\b(send|share|forward|push|deliver|dm|message|text|ping|whatsapp|telegram)\b/i;
const TELEGRAM = /\b(telegram|tg)\b/i;
/** "dm me", "text me", "message me" — Telegram is the channel that reaches the user. */
const DM_ME = /\b(dm|message|text|ping|send)\s+(it\s+|this\s+|that\s+|the\s+\w+\s+)?(to\s+)?me\b/i;
const VIDEO_VERB = /\b(make|create|generate|render|produce|build|turn|give me|show me|drop)\b/i;
const VIDEO_NOUN = /\b(video|reel|clip|brief|brag|highlight|recap|montage)\b/i;
const FILE_VERB = /\b(save|export|write|dump|download|put)\b/i;
const FILE_NOUN = /\b(file|files|txt|text file|pdf|markdown|md|doc|document|csv|json)\b/i;
const NOTE_VERB = /\b(add|save|create|put|make|store|note down|write)\b/i;
const NOTE_NOUN = /\b(note|notes)\b/i;
const OPEN_VERB = /\b(open|launch|show( me)?|display|pull up|go to|goto|browse)\b/i;
const OPEN_TARGET = /\b(it|that|this|the one|the winner|them|those|both)\b/i;

/**
 * Classify a follow-up message. Order matters — "make a video and send it to
 * telegram" is a send, because reaching the user is the intent that matters.
 */
export function detectFollowupAction(message: string): FollowupAction {
  const m = (message || "").trim();
  if (!m) return { kind: "none", trigger: "" };

  // "send it to my telegram", "telegram me the report", "dm me this"
  if (
    (TELEGRAM.test(m) && (SEND_VERB.test(m) || /\b(me|it|this|that|results?|report|summary|findings?|brief)\b/i.test(m))) ||
    DM_ME.test(m)
  ) {
    return { kind: "telegram", trigger: "telegram" };
  }

  // "make me a video brief", "turn this into a reel"
  if (VIDEO_VERB.test(m) && VIDEO_NOUN.test(m)) {
    return { kind: "video", trigger: "video" };
  }

  // "open the second one", "open it", "show me the winner" → open an artifact
  if (OPEN_VERB.test(m) && (ordinalIndex(m) !== null || OPEN_TARGET.test(m))) {
    return { kind: "open", trigger: "open" };
  }

  // "save it to a file", "export this as a markdown file"
  if (FILE_VERB.test(m) && FILE_NOUN.test(m)) {
    return { kind: "file", trigger: "file" };
  }

  // "add this to my notes", "save it in notes"
  if (NOTE_VERB.test(m) && NOTE_NOUN.test(m)) {
    return { kind: "note", trigger: "note" };
  }

  return { kind: "none", trigger: "" };
}

/** Slugify a mission goal into a safe-ish filename stem. */
export function artifactFilename(goal: string, ext: string): string {
  const stem =
    (goal || "mission")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "mission";
  return `${stem}-${new Date().toISOString().slice(0, 10)}.${ext.replace(/^\./, "")}`;
}
