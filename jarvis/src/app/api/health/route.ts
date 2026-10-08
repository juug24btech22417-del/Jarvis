import { NextRequest, NextResponse } from "next/server";
import {
  checkAll,
  healIntegration,
  healAllBroken,
  summarize,
} from "@/lib/agent/selfHealing";

// Integration health + self-healing.
//
//   GET  /api/health                 -> status of every integration
//   POST /api/health {action:"heal", id:"whatsapp-bridge"}
//   POST /api/health {action:"heal-all"}
//
// A heal is only ever reported as successful when a fresh probe confirms it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const checks = await checkAll();
    return NextResponse.json({
      success: true,
      summary: summarize(checks),
      checkedAt: new Date().toISOString(),
      checks,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Health sweep failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "heal");

    if (action === "heal-all") {
      const { results, health } = await healAllBroken();
      return NextResponse.json({
        success: true,
        summary: summarize(health),
        repaired: results.filter((r) => r.healed).length,
        attempted: results.filter((r) => r.attempted).length,
        results,
        checks: health,
      });
    }

    if (action === "heal") {
      const id = String(body.id || "").trim();
      if (!id) {
        return NextResponse.json({ success: false, error: "An integration id is required." }, { status: 400 });
      }
      const result = await healIntegration(id);
      const checks = await checkAll();
      return NextResponse.json({
        success: result.healed || result.attempted,
        summary: summarize(checks),
        result,
        checks,
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action '${action}'. Use 'heal' or 'heal-all'.` },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || "Heal failed" }, { status: 500 });
  }
}
