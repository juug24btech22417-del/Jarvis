// Query the composio event log.
//
// GET /api/composio/events
//   Query params:
//     since: ISO timestamp (default: 24h ago)
//     source: "gmail" | "gcal" | "github" | "notion" | ... (optional)
//     limit: 1..200 (default: 50)
//
// Used by /api/chat's regex shortcut so the assistant can answer
// "what came today" / "any important emails" without an LLM round-trip.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseSince(raw: string | null): Date {
  if (!raw) {
    const d = new Date();
    d.setUTCHours(d.getUTCHours() - 24);
    return d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date(Date.now() - 24 * 3600 * 1000) : d;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const since = parseSince(url.searchParams.get("since"));
  const source = url.searchParams.get("source")?.trim().toLowerCase() || undefined;
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  );

  const where: { receivedAt: { gte: Date }; source?: string } = { receivedAt: { gte: since } };
  if (source) where.source = source;

  const rows = await prisma.composioEventLog.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    take: limit,
    select: {
      id: true,
      source: true,
      type: true,
      title: true,
      body: true,
      url: true,
      priority: true,
      telegramSent: true,
      desktopPushed: true,
      receivedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    since: since.toISOString(),
    source: source ?? null,
    count: rows.length,
    events: rows.map((r) => ({
      id: r.id,
      source: r.source,
      type: r.type,
      title: r.title,
      body: r.body.length > 600 ? r.body.slice(0, 600) + "…" : r.body,
      url: r.url,
      priority: r.priority,
      telegramSent: r.telegramSent,
      desktopPushed: r.desktopPushed,
      receivedAt: r.receivedAt.toISOString(),
    })),
  });
}