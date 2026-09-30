// Durable mission store.
//
// The old implementation kept jobs on globalThis and lost every mission on
// restart. This store mirrors jobs to a JSON file on disk (debounced) and
// reloads them on boot, so history survives dev-server restarts and HMR.
//
// Design notes:
//  - Runtime-only fields (checkpointResolve function, checkpointResults Map)
//    are stripped on write and rehydrated on read.
//  - Writes are debounced to a single file write per ~400ms so a running
//    mission does not hammer the disk.
//  - The map itself stays on globalThis so Next dev module re-evals keep one
//    instance.

import fs from "fs";
import path from "path";
import type { AgentJob, StepResult } from "./types";

const DATA_DIR = path.join(process.cwd(), ".jarvis-data");
const JOBS_FILE = path.join(DATA_DIR, "missions.json");

/** Only keep the most recent N missions on disk. */
const MAX_PERSISTED = 200;

type PersistedJob = Omit<AgentJob, "checkpointResolve" | "checkpointResults"> & {
  checkpointResultsEntries?: Array<[string, StepResult]>;
};

function serialize(job: AgentJob): PersistedJob {
  const { checkpointResolve: _r, checkpointResults, ...rest } = job;
  void _r;
  return {
    ...rest,
    checkpointResultsEntries: checkpointResults ? Array.from(checkpointResults.entries()) : undefined,
  };
}

function deserialize(p: PersistedJob): AgentJob {
  const { checkpointResultsEntries, ...rest } = p;
  const job = rest as AgentJob;
  // A mission that was mid-flight when the server died cannot resume (its
  // in-memory executor is gone) — mark it failed so the UI is honest.
  if (job.status === "running" || job.status === "planning" || job.status === "paused_checkpoint") {
    job.status = "failed";
    job.error = job.error ?? "Interrupted by a server restart";
    job.finishedAt = job.finishedAt ?? Date.now();
  }
  if (checkpointResultsEntries) {
    job.checkpointResults = new Map(checkpointResultsEntries);
  }
  return job;
}

interface StoreGlobal {
  __jarvisMissionJobs?: Map<string, AgentJob>;
  __jarvisMissionLoaded?: boolean;
  __jarvisMissionWriteTimer?: ReturnType<typeof setTimeout>;
}

const g = globalThis as unknown as StoreGlobal;

function ensureLoaded(): void {
  if (g.__jarvisMissionLoaded && g.__jarvisMissionJobs) return;
  if (!g.__jarvisMissionJobs) g.__jarvisMissionJobs = new Map();
  g.__jarvisMissionLoaded = true;
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(JOBS_FILE, "utf8")) as PersistedJob[];
      if (Array.isArray(raw)) {
        for (const p of raw) {
          const job = deserialize(p);
          if (!g.__jarvisMissionJobs.has(job.id)) g.__jarvisMissionJobs.set(job.id, job);
        }
      }
    }
  } catch (e) {
    console.warn("[MissionStore] could not load persisted missions:", (e as Error)?.message);
  }
}

function writeNow(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const jobs = Array.from(g.__jarvisMissionJobs?.values() ?? [])
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_PERSISTED)
      .map(serialize);
    // Write atomically (temp + rename) so a crash mid-write can't corrupt.
    const tmp = `${JOBS_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(jobs), "utf8");
    fs.renameSync(tmp, JOBS_FILE);
  } catch (e) {
    console.warn("[MissionStore] persist failed:", (e as Error)?.message);
  }
}

function persistSoon(): void {
  if (g.__jarvisMissionWriteTimer) return;
  g.__jarvisMissionWriteTimer = setTimeout(() => {
    g.__jarvisMissionWriteTimer = undefined;
    writeNow();
  }, 400);
}

/* ----------------------------- PUBLIC API ----------------------------- */

export function listJobs(): AgentJob[] {
  ensureLoaded();
  return Array.from(g.__jarvisMissionJobs!.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function listJobSummaries(): Array<{
  id: string;
  goal: string;
  status: AgentJob["status"];
  createdAt: number;
  finishedAt?: number;
  partial?: boolean;
  creditsUsed?: number;
}> {
  return listJobs().map((j) => ({
    id: j.id,
    goal: j.goal,
    status: j.status,
    createdAt: j.createdAt,
    finishedAt: j.finishedAt,
    partial: j.partial,
    creditsUsed: j.creditsUsed,
  }));
}

export function getJob(id: string): AgentJob | undefined {
  ensureLoaded();
  return g.__jarvisMissionJobs!.get(id);
}

export function putJob(job: AgentJob): void {
  ensureLoaded();
  g.__jarvisMissionJobs!.set(job.id, job);
  persistSoon();
}

/** Force an immediate flush (used on mission completion). */
export function flushMissions(): void {
  if (g.__jarvisMissionWriteTimer) {
    clearTimeout(g.__jarvisMissionWriteTimer);
    g.__jarvisMissionWriteTimer = undefined;
  }
  writeNow();
}

export function removeJob(id: string): void {
  ensureLoaded();
  g.__jarvisMissionJobs!.delete(id);
  persistSoon();
}
