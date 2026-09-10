// Weekly reflection endpoint.
//
//   GET /api/companion/reflection → rendered weekly reflection

import { NextResponse } from "next/server";
import { buildWeeklyReflection } from "@/lib/companion/reflection";

export async function GET() {
  try {
    const reflection = await buildWeeklyReflection();
    return NextResponse.json({ ok: true, ...reflection });
  } catch (e) {
    console.warn("[Reflection] GET failed:", (e as Error).message);
    return NextResponse.json({ ok: false, rendered: "" });
  }
}
