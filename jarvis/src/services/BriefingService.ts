// Tier 3D — Briefing rituals.
// Composes morning / evening / weekly summaries from local context,
// optionally delegates prose generation to /api/briefing/generate.

import type { AmbientContext } from "@/hooks/useAmbientContext";

export type BriefingKind = "morning" | "evening" | "weekly";

export interface BriefingContext {
  ambient: AmbientContext;
  /** Pending task titles (top N). */
  pendingTasks: string[];
  /** Memory highlights (top N entity names). */
  memoryHighlights: string[];
  /** Upcoming calendar events (already-summarized strings). */
  upcomingEvents: string[];
  /** Headline titles (top 3). */
  newsHeadlines: string[];
  /** User display name. */
  userName: string;
}

export interface Briefing {
  kind: BriefingKind;
  /** Opening line spoken aloud (e.g. "Good morning, Boss."). */
  greeting: string;
  /** 1-3 paragraph prose body. */
  body: string;
  /** Short single-line summary for the AgentPanel history. */
  short: string;
}

/**
 * Compose a deterministic, local-only briefing (no LLM call).
 * Always available; safe to call during boot.
 */
export function composeLocalBriefing(
  kind: BriefingKind,
  ctx: BriefingContext
): Briefing {
  const { ambient, pendingTasks, memoryHighlights, upcomingEvents, newsHeadlines, userName } = ctx;
  const greeting = greetingFor(kind, ambient, userName);

  if (kind === "morning") {
    const parts: string[] = [];
    parts.push(
      `It's ${formatHour(ambient.hour)} on a ${ambient.isWeekend ? "weekend" : "weekday"}, ${ambient.dayPhase}.`
    );
    if (pendingTasks.length) {
      parts.push(
        `${pendingTasks.length} task${pendingTasks.length > 1 ? "s" : ""} on deck: ${pendingTasks.slice(0, 3).join("; ")}.`
      );
    } else {
      parts.push("Your task list is clear — pick a hill to take.");
    }
    if (upcomingEvents.length) {
      parts.push(`Today's calendar: ${upcomingEvents.slice(0, 2).join("; ")}.`);
    }
    if (memoryHighlights.length) {
      parts.push(`Memory surfaced ${memoryHighlights.slice(0, 3).join(", ")}.`);
    }
    if (newsHeadlines.length) {
      parts.push(`Top headlines: ${newsHeadlines.slice(0, 3).join("; ")}.`);
    }
    return {
      kind,
      greeting,
      body: parts.join(" "),
      short: `Morning briefing — ${pendingTasks.length} tasks, ${upcomingEvents.length} events.`,
    };
  }

  if (kind === "evening") {
    const parts: string[] = [];
    parts.push(`Day's winding down. ${ambient.dayPhase} phase engaged.`);
    if (pendingTasks.length === 0) {
      parts.push("Nothing on the open list — well done, Boss.");
    } else {
      parts.push(
        `${pendingTasks.length} task${pendingTasks.length > 1 ? "s" : ""} still open: ${pendingTasks.slice(0, 3).join("; ")}.`
      );
    }
    if (memoryHighlights.length) {
      parts.push(`Today's memory: ${memoryHighlights.slice(0, 3).join(", ")}.`);
    }
    return {
      kind,
      greeting,
      body: parts.join(" "),
      short: `Evening check-in — ${pendingTasks.length} tasks open.`,
    };
  }

  // weekly
  const parts: string[] = [];
  parts.push(`Weekly retrospective, ${ambient.dayPhase}.`);
  parts.push(`${pendingTasks.length} tasks still pending.`);
  if (memoryHighlights.length) {
    parts.push(`Memory grew around ${memoryHighlights.slice(0, 5).join(", ")}.`);
  }
  return {
    kind,
    greeting,
    body: parts.join(" "),
    short: `Weekly retrospective — ${pendingTasks.length} pending, ${memoryHighlights.length} memory nodes.`,
  };
}

function greetingFor(kind: BriefingKind, ambient: AmbientContext, userName: string) {
  const who = userName?.trim() || "Boss";
  if (kind === "morning") {
    if (ambient.hour < 7) return `Early start, ${who}.`;
    if (ambient.hour < 12) return `Good morning, ${who}.`;
    return `Late morning, ${who}.`;
  }
  if (kind === "evening") {
    if (ambient.hour < 20) return `Evening, ${who}.`;
    return `Late night, ${who}.`;
  }
  return `Weekly review, ${who}.`;
}

function formatHour(hour: number) {
  if (hour === 0) return "midnight";
  if (hour === 12) return "noon";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

/**
 * Optional polish: send the local draft to the LLM for a tighter read.
 * Falls back to the local draft if the route errors.
 */
export async function polishBriefing(local: Briefing): Promise<Briefing> {
  try {
    const res = await fetch("/api/briefing/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: local.kind, draft: local }),
    });
    if (!res.ok) return local;
    const data = await res.json();
    if (data?.body && typeof data.body === "string") {
      return { ...local, body: data.body };
    }
  } catch {
    // ignore
  }
  return local;
}