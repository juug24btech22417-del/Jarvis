// List composio connections for the current user.
//
// Returns one row per (toolkitSlug, status). Sourced from the local
// ComposioConnection table (cached at connect time) — we do NOT call
// composio on every page load to keep quota untouched.
//
// Future: revalidate against composio's listActive() on demand.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { isComposioConfigured, readComposioEnv } from "@/lib/composio/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const configured = isComposioConfigured();
  const userId = configured ? readComposioEnv().userId : "jarvis-local";

  const rows = await prisma.composioConnection.findMany({
    where: { userId },
    orderBy: { toolkitSlug: "asc" },
  });

  return NextResponse.json({
    ok: true,
    configured,
    userId,
    connections: rows.map((r) => ({
      id: r.id,
      toolkitSlug: r.toolkitSlug,
      connectedAccountId: r.connectedAccountId,
      status: r.status,
      connectedAt: r.connectedAt.toISOString(),
    })),
  });
}
