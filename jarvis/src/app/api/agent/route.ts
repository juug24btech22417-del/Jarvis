// Tier 2A — Goal agent HTTP API.
// POST {goal} → plan (awaiting_approval)
// POST {jobId, action: "approve" | "cancel"}
// GET ?jobId=X → status
// GET (no jobId) → list

import { NextRequest, NextResponse } from "next/server";
import { planGoal, approveJob, cancelJob, getJob, listJobs } from "@/services/AgentService";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(job);
  }
  return NextResponse.json({ jobs: listJobs() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Approve / cancel branch
  const jobId = typeof body.jobId === "string" ? body.jobId : null;
  const action = typeof body.action === "string" ? body.action : null;
  if (jobId && action) {
    if (action === "approve") {
      const job = await approveJob(jobId);
      return NextResponse.json(job);
    }
    if (action === "cancel") {
      const job = await cancelJob(jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json(job);
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  // Plan branch
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return NextResponse.json({ error: "Missing 'goal'" }, { status: 400 });
  if (goal.length > 600) return NextResponse.json({ error: "Goal too long (max 600 chars)" }, { status: 400 });

  const job = await planGoal(goal);
  return NextResponse.json(job, { status: 202 });
}