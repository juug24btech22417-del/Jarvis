import { NextRequest, NextResponse } from "next/server";
import {
  getFormHistory,
  getFormFillAnalytics,
  clearFormHistory,
} from "@/lib/ghost/formHistory";

// GET /api/ghost/history — fetch fill history or analytics
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "history";

    if (action === "analytics") {
      const analytics = await getFormFillAnalytics();
      return NextResponse.json({ success: true, analytics });
    }

    const limit = parseInt(url.searchParams.get("limit") || "50");
    const domain = url.searchParams.get("domain") || undefined;
    const source = url.searchParams.get("source") || undefined;
    const since = url.searchParams.get("since") || undefined;

    const history = await getFormHistory({ limit, domain, source, since });
    return NextResponse.json({ success: true, history, count: history.length });
  } catch (error: any) {
    console.error("[ghost/history] GET error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

// DELETE /api/ghost/history — clear all history
export async function DELETE() {
  try {
    await clearFormHistory();
    return NextResponse.json({ success: true, message: "History cleared" });
  } catch (error: any) {
    console.error("[ghost/history] DELETE error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
