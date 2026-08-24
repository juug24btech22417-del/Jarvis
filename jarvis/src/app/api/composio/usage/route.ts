// Daily composio usage counter.
//
// Composio's free tier is 20k tool calls/month. We don't actually burn
// that on the listener (we use WebSocket push, not polling), but the
// counter is still useful as a sanity check + a future rate limit.
//
// Returns the last 30 days.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FREE_TIER_MONTHLY = 20_000;

export async function GET() {
  const rows = await prisma.composioUsage.findMany({
    orderBy: { day: "desc" },
    take: 30,
  });

  const monthCount = rows
    .filter((r) => r.day.startsWith(new Date().toISOString().slice(0, 7)))
    .reduce((s, r) => s + r.count, 0);

  const today = new Date().toISOString().slice(0, 10);
  const todayRow = rows.find((r) => r.day === today);

  return NextResponse.json({
    ok: true,
    today: todayRow?.count ?? 0,
    month: monthCount,
    freeTierMonthly: FREE_TIER_MONTHLY,
    monthPercent: Math.round((monthCount / FREE_TIER_MONTHLY) * 1000) / 10,
    history: rows.map((r) => ({ day: r.day, count: r.count })),
  });
}
