// GET /api/composio/inbox
//   Query params:
//     unread: "true" (default false)
//     limit: 1..30 (default 15)
//
// Returns the user's live Gmail inbox via composio's GMAIL_FETCH_EMAILS.
// Distinct from /api/composio/events, which reads the cached event log
// and is suitable for "what came in recently" queries. This endpoint
// always reflects the current inbox state, regardless of listener health.

import { NextResponse } from "next/server";
import { fetchInboxViaComposio } from "@/lib/composio/inbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "true";
  const limitParam = parseInt(url.searchParams.get("limit") ?? "15", 10);
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 30)) : 15;

  const result = await fetchInboxViaComposio({
    unreadOnly,
    maxResults: limit,
  });

  if (!result.ok) {
    const status = result.error?.includes("no active Gmail connection") ? 400 : 502;
    return NextResponse.json(
      { ok: false, error: result.error ?? "unknown error" },
      { status }
    );
  }

  return NextResponse.json({
    ok: true,
    unreadOnly,
    query: result.query,
    count: result.count,
    messages: result.messages,
  });
}