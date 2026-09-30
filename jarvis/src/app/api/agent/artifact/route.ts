// Serve a mission artifact (screenshot / brief / file) from the artifact store.
// GET ?path=<absolute path under .jarvis-data/artifacts>

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { resolveArtifactPath, contentTypeFor } from "@/lib/agent/artifacts";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams.get("path");
  if (!p) return NextResponse.json({ error: "path required" }, { status: 400 });

  const resolved = resolveArtifactPath(decodeURIComponent(p));
  if (!resolved) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = fs.readFileSync(resolved);
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(resolved),
      "Cache-Control": "private, max-age=300",
    },
  });
}
