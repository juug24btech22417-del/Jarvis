// Tier 2B — Scheduled jobs HTTP API.
// GET → list
// POST {name, cron, goal} → create
// PATCH {id, enabled} → toggle
// DELETE {id} → delete

import { NextRequest, NextResponse } from "next/server";
import {
  listScheduledJobs,
  createScheduledJob,
  toggleScheduledJob,
  deleteScheduledJob,
  runScheduledJobNow,
} from "@/services/SchedulerService";

export async function GET() {
  const jobs = await listScheduledJobs();
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name : "";
  const cron = typeof body.cron === "string" ? body.cron : "";
  const goal = typeof body.goal === "string" ? body.goal : "";
  if (!name || !cron || !goal) {
    return NextResponse.json({ error: "name, cron, and goal are required" }, { status: 400 });
  }

  try {
    const job = await createScheduledJob({ name, cron, goal });
    return NextResponse.json(job, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const enabled = typeof body.enabled === "boolean" ? body.enabled : null;
  if (!id || enabled === null) {
    return NextResponse.json({ error: "id and enabled required" }, { status: 400 });
  }
  const job = await toggleScheduledJob(id, enabled);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(job);
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ok = await deleteScheduledJob(id);
  if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}