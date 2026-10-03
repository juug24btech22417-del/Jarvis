// GET /api/agent/last → the most recent mission, for cross-turn follow-ups.
//
// The CommandBar uses this so a message like "open the second one" or "find its
// repo" is answered against the last mission's artifacts instead of being
// planned from scratch as a brand-new goal.

import { NextResponse } from "next/server";
import { listJobs } from "@/lib/agent/store";
import type { JobStatus } from "@/lib/agent/types";

const SETTLED: JobStatus[] = ["done", "failed", "cancelled"];

export async function GET() {
  const jobs = listJobs(); // newest first
  const settled = jobs.filter((j) => SETTLED.includes(j.status));
  // Prefer the most recent mission that actually produced something, so
  // "open the second one" points at a real result and not at a trivial
  // status check that happened to finish last.
  const job =
    settled.find((j) => (j.artifacts?.length ?? 0) > 0) ??
    settled[0] ??
    jobs[0] ??
    null;
  if (!job) return NextResponse.json({ job: null });

  return NextResponse.json({
    job: {
      id: job.id,
      goal: job.goal,
      status: job.status,
      partial: job.partial === true,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      artifacts: (job.artifacts ?? []).map((a) => ({
        id: a.id,
        kind: a.kind,
        label: a.label,
        value: a.value,
      })),
      planSummary: job.plan?.summary ?? null,
    },
  });
}
