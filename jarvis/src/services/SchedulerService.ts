// Tier 2B — Scheduler.
// Persists goals to ScheduledJob table; wraps each in a node-cron task
// that re-invokes AgentService on the schedule. CRUD over HTTP.

import cron, { type ScheduledTask } from "node-cron";
import { PrismaClient } from "@prisma/client";
import { planGoal, approveJob } from "@/services/AgentService";

const prisma = new PrismaClient();

// jobId (DB row id) → active cron task. In-memory; rebuilt on boot.
const tasks = new Map<string, ScheduledTask>();

export interface ScheduledJobView {
  id: string;
  name: string;
  cron: string;
  goal: string;
  enabled: boolean;
  lastRun: string | null;
  lastJobId: string | null;
  createdAt: string;
}

/** Validate a 5-field cron expression. */
export function isValidCron(expr: string): boolean {
  return cron.validate(expr);
}

function toView(j: {
  id: string;
  name: string;
  cron: string;
  goal: string;
  enabled: boolean;
  lastRun: Date | null;
  lastJobId: string | null;
  createdAt: Date;
}): ScheduledJobView {
  return {
    id: j.id,
    name: j.name,
    cron: j.cron,
    goal: j.goal,
    enabled: j.enabled,
    lastRun: j.lastRun?.toISOString() ?? null,
    lastJobId: j.lastJobId,
    createdAt: j.createdAt.toISOString(),
  };
}

/** Load all enabled jobs from the DB and arm them. Called once on boot. */
export async function initScheduler() {
  const all = await prisma.scheduledJob.findMany({ where: { enabled: true } });
  for (const j of all) {
    armJob(j.id, j.cron);
  }
  console.log(`[Scheduler] armed ${all.length} job(s).`);
}

function armJob(id: string, expr: string) {
  // Stop any existing task for this id.
  stopJob(id);
  if (!cron.validate(expr)) {
    console.warn(`[Scheduler] invalid cron for ${id}: ${expr}`);
    return;
  }
  const task = cron.schedule(expr, async () => {
    await runScheduledJob(id);
  });
  tasks.set(id, task);
}

function stopJob(id: string) {
  const existing = tasks.get(id);
  if (existing) {
    existing.stop();
    tasks.delete(id);
  }
}

async function runScheduledJob(id: string) {
  const j = await prisma.scheduledJob.findUnique({ where: { id } });
  if (!j || !j.enabled) return;
  try {
    const plan = await planGoal(j.goal);
    if (plan.status !== "awaiting_approval" || !plan.plan) {
      console.warn(`[Scheduler] job ${id} planning failed:`, plan.error);
      return;
    }
    const executed = await approveJob(plan.id);
    await prisma.scheduledJob.update({
      where: { id },
      data: { lastRun: new Date(), lastJobId: executed.id },
    });

    // Push a one-liner to Telegram so the user sees the job landed
    // even if they're away from the laptop. Fire-and-forget.
    try {
      const { notifyUser } = await import("@/lib/telegram/notify");
      await notifyUser(null, `⏰ Job "${j.name}" finished.`, {
        fromSource: "scheduler",
      });
    } catch {
      // Non-fatal — the schedule still ran; just no notification.
    }
  } catch (e) {
    console.error(`[Scheduler] run failed for ${id}:`, e);
  }
}

/* ----------------------------- PUBLIC CRUD ----------------------------- */

export async function listScheduledJobs(): Promise<ScheduledJobView[]> {
  await ensureBootstrapped();
  const all = await prisma.scheduledJob.findMany({ orderBy: { createdAt: "desc" } });
  return all.map(toView);
}

let bootstrapPromise: Promise<void> | null = null;

async function ensureBootstrapped() {
  if (!bootstrapPromise) {
    bootstrapPromise = initScheduler().catch((e) => {
      console.error("[Scheduler] init failed:", e);
      // Allow retry on next call.
      bootstrapPromise = null;
    });
  }
  return bootstrapPromise;
}

export async function createScheduledJob(input: {
  name: string;
  cron: string;
  goal: string;
}): Promise<ScheduledJobView> {
  if (!input.name?.trim()) throw new Error("name required");
  if (!input.cron?.trim()) throw new Error("cron required");
  if (!isValidCron(input.cron)) throw new Error(`invalid cron: ${input.cron}`);
  if (!input.goal?.trim()) throw new Error("goal required");
  if (input.goal.length > 600) throw new Error("goal too long (max 600 chars)");

  const j = await prisma.scheduledJob.create({
    data: {
      name: input.name.trim().slice(0, 120),
      cron: input.cron.trim(),
      goal: input.goal.trim(),
      enabled: true,
    },
  });
  armJob(j.id, j.cron);
  return toView(j);
}

export async function toggleScheduledJob(id: string, enabled: boolean): Promise<ScheduledJobView | null> {
  const j = await prisma.scheduledJob.update({
    where: { id },
    data: { enabled },
  }).catch(() => null);
  if (!j) return null;
  if (enabled) armJob(j.id, j.cron);
  else stopJob(j.id);
  return toView(j);
}

export async function deleteScheduledJob(id: string): Promise<boolean> {
  stopJob(id);
  const result = await prisma.scheduledJob.delete({ where: { id } }).catch(() => null);
  return result !== null;
}

export async function runScheduledJobNow(id: string): Promise<ScheduledJobView | null> {
  const j = await prisma.scheduledJob.findUnique({ where: { id } });
  if (!j) return null;
  await runScheduledJob(id);
  return toView(j);
}