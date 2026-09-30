// Tier 2A — Goal agent HTTP API.
// POST {goal} → plan (awaiting_approval)
// POST {jobId, action: "approve" | "cancel" | "resume", pick?}
// GET ?jobId=X → status
// GET (no jobId) → list

import { NextRequest, NextResponse } from "next/server";
import { planGoal, approveJob, cancelJob, resumeCheckpoint, getJob, listJobs, listJobSummaries } from "@/services/AgentService";
import { renderVideoBrief, briefSummary } from "@/services/MissionVideoService";
import { putJob, flushMissions } from "@/lib/agent/store";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (jobId) {
    const job = getJob(jobId);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(job);
  }
  // ?summary=1 → lightweight history rail (id/goal/status/timestamps).
  if (req.nextUrl.searchParams.get("summary") === "1") {
    return NextResponse.json({ jobs: listJobSummaries() });
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
    if (action === "video_brief") {
      const job = getJob(jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      // Serve audio/imagery from the origin the panel is actually using.
      const { path: file, slides } = renderVideoBrief(job, undefined, { baseUrl: req.nextUrl.origin });
      job.artifacts = job.artifacts ?? [];
      if (!job.artifacts.some((a) => a.value === file)) {
        job.artifacts.push({
          id: `brief_${Date.now()}`,
          kind: "video",
          label: "Mission video brief",
          value: file,
          stepId: "panel",
          at: Date.now(),
        });
      }
      putJob(job);
      flushMissions();
      return NextResponse.json({ path: file, slides: slides.length, summary: briefSummary(slides) });
    }

    if (action === "resume") {
      // Checkpoint answer from the user (e.g. which option they picked).
      const pick = typeof body.pick === "string" ? body.pick.trim() : "";
      if (!pick) return NextResponse.json({ error: "Missing 'pick' for resume" }, { status: 400 });
      try {
        const job = await resumeCheckpoint(jobId, pick);
        return NextResponse.json(job);
      } catch (e) {
        return NextResponse.json({ error: (e as Error)?.message ?? "resume failed" }, { status: 400 });
      }
    }
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  // Plan branch
  const goal = typeof body.goal === "string" ? body.goal.trim() : "";
  if (!goal) return NextResponse.json({ error: "Missing 'goal'" }, { status: 400 });
  if (goal.length > 600) return NextResponse.json({ error: "Goal too long (max 600 chars)" }, { status: 400 });

  // auto: true → fast lane (skip the approval gate, execute immediately).
  // watch: true → open a visible Chromium window for autonomous browser steps
  // and stream live frames to the panel.
  const job = await planGoal(goal, {
    autoApprove: body.auto !== false,
    watch: body.watch === true,
  });
  return NextResponse.json(job, { status: 202 });
}