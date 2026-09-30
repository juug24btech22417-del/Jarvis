// Live browser preview for a running mission.
//
// GET ?jobId=X            → the newest JPEG frame (image/jpeg, no-store)
// GET ?jobId=X&meta=1     → { active, url, title, action, stepId, at, seq, hasFrame }
//
// The panel renders the image directly in an <img>, so watching an autonomous
// browser_act mission needs no screenshots of the user's screen and no shared
// window position.

import { NextRequest, NextResponse } from "next/server";
import { getLiveFrameBuffer, getLiveMeta, isLiveViewActive } from "@/lib/agent/liveView";

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId") ?? "";
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const meta = getLiveMeta(jobId);
  if (req.nextUrl.searchParams.get("meta") === "1") {
    return NextResponse.json(
      {
        active: isLiveViewActive(jobId),
        ...(meta ?? {}),
        hasFrame: !!meta?.hasFrame,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const buf = getLiveFrameBuffer(jobId);
  if (!buf) return new NextResponse(null, { status: 204 });
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store, max-age=0" },
  });
}
