// Mission → Command Deck bridge.
//
// When a mission finishes, the useful leftovers are follow-ups: steps that
// failed, and any "what remains / next steps" the mission itself wrote down.
// This module turns those into concrete tasks (with priority + due date parsed
// from natural language) that AgentService then drops into the Command Deck.
//
// Pure — no Prisma, no Next — so it is unit-testable offline.

import { parseQuickAdd, type QuickPriority } from "@/lib/tasks/quickAdd";
import type { AgentJob } from "./types";

export type FollowUpJob = Pick<AgentJob, "results" | "plan" | "goal">;

export interface FollowUpTask {
  title: string;
  priority: QuickPriority;
  dueAt: Date | null;
  source: "failed_step" | "report";
}

/** Step kinds whose failure is not something the user should be nudged to do. */
const NON_ACTIONABLE = new Set<string>([
  "notify",
  "checkpoint",
  "memory_store",
  "task_create",
  "timer_set",
  "video_brief",
  "delegate",
]);

const SECTION_RE = /what remains|next steps?|to-?do|action items?|follow-?ups?|remaining (work|tasks?)|pending/i;

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip markdown noise / unresolved refs from a raw line. */
function cleanInline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\bfrom:[a-zA-Z0-9_-]+(\.[a-z]+)?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stepTitle(job: FollowUpJob, stepId: string): string {
  const step = job.plan?.steps.find((s) => s.id === stepId);
  if (!step) return stepId;
  return cleanInline(step.title) || stepId;
}

/**
 * Human-readable "what remains" items for a finished mission:
 *  1. every step that errored or was skipped (minus non-actionable kinds),
 *  2. any bullets the mission wrote under a next-steps style heading.
 * Deduped, order preserved.
 */
export function collectRemainingItems(job: FollowUpJob): string[] {
  const items: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const text = raw.replace(/^follow up:\s*/i, "").replace(/\s+/g, " ").trim();
    if (text.length < 3) return;
    const key = normalizeKey(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    items.push(text.slice(0, 140));
  };

  // 1. Failed / skipped steps.
  for (const r of job.results ?? []) {
    if (r.status !== "error" && r.status !== "skipped") continue;
    const step = job.plan?.steps.find((s) => s.id === r.stepId);
    if (step && NON_ACTIONABLE.has(step.kind)) continue;
    add(stepTitle(job, r.stepId));
  }

  // 2. "Next steps / what remains" bullets inside findings.
  for (const r of job.results ?? []) {
    if (r.status !== "ok") continue;
    const out = r.result as Record<string, unknown> | undefined;
    const text = typeof out?.summary === "string" ? out.summary : "";
    if (!text) continue;
    let inSection = false;
    for (const line of text.split("\n")) {
      const heading = line.match(/^#{1,6}\s*(.+)$/);
      if (heading) {
        inSection = SECTION_RE.test(heading[1]);
        continue;
      }
      if (!inSection) continue;
      const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
      if (bullet) add(cleanInline(bullet[1]));
    }
  }

  return items;
}

/** Pull the bullets from a report's "## What remains" section. */
function remainingFromReport(report: string): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const line of report.split("\n")) {
    const heading = line.match(/^#{1,6}\s*(.+)$/);
    if (heading) {
      inSection = SECTION_RE.test(heading[1]);
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const text = cleanInline(bullet[1]);
      if (text.length >= 3) out.push(text);
    }
  }
  return out;
}

/**
 * Build the follow-up tasks for a finished mission. Prefers the bullets in the
 * mission report's "What remains" section; falls back to scanning the raw job
 * when no report is supplied. Each item is run through the natural-language
 * quick-add parser so "renew domain high tomorrow" carries its priority/date.
 */
export function extractFollowUpTasks(
  job: FollowUpJob,
  report: string | null = null,
  now: Date = new Date(),
  limit = 5
): FollowUpTask[] {
  const candidates: Array<{ text: string; source: FollowUpTask["source"] }> = [];

  const reportItems = report ? remainingFromReport(report) : [];
  if (reportItems.length > 0) {
    for (const text of reportItems) candidates.push({ text, source: "report" });
  } else {
    for (const text of collectRemainingItems(job)) candidates.push({ text, source: "failed_step" });
  }

  const out: FollowUpTask[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const parsed = parseQuickAdd(c.text, now);
    const title = parsed.title.trim();
    if (!title || title.length < 3) continue;
    const key = normalizeKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ title: title.slice(0, 160), priority: parsed.priority, dueAt: parsed.dueAt, source: c.source });
    if (out.length >= limit) break;
  }
  return out;
}
