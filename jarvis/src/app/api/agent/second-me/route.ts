// Tier 2D — Second Me HTTP API.
// POST {input} → {bundle} (preview before apply)
// POST {input, apply: true} → {bundle, applied: {...counts}}

import { NextRequest, NextResponse } from "next/server";
import { parseBrief, applyBundle, type SecondMeBundle } from "@/services/SecondMeService";

export async function POST(req: NextRequest) {
  let body: { input?: string; apply?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const input = typeof body.input === "string" ? body.input : "";
  if (!input.trim()) {
    return NextResponse.json({ error: "input required" }, { status: 400 });
  }
  if (input.length > 8000) {
    return NextResponse.json({ error: "input too long (max 8000 chars)" }, { status: 400 });
  }

  const bundle: SecondMeBundle = await parseBrief(input);
  if (!body.apply) {
    return NextResponse.json({ bundle });
  }

  const counts = await applyBundle(bundle);
  return NextResponse.json({ bundle, applied: counts });
}