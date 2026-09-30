// Conversational follow-up on a completed mission.
// POST { jobId, message } → { answer, turns }

import { NextRequest, NextResponse } from "next/server";
import { answerFollowup } from "@/services/MissionFollowupService";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const message = typeof body.message === "string" ? body.message : "";
  if (!jobId || !message.trim()) {
    return NextResponse.json({ error: "jobId and message are required" }, { status: 400 });
  }
  if (message.length > 2000) {
    return NextResponse.json({ error: "message too long (max 2000 chars)" }, { status: 400 });
  }
  try {
    const result = await answerFollowup(jobId, message);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
