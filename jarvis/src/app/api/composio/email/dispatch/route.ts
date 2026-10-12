// Pending-email dispatcher: force a tick, and inspect the queue.
//
// POST /api/composio/email/dispatch
//   Runs ONE dispatcher pass right now and returns what it did. The ticker in
//   instrumentation.ts already runs every 5s, so this is for tests, for a
//   manual kick after a long offline stretch, and for environments where a
//   background timer is not wanted.
//
// GET /api/composio/email/dispatch
//   Diagnostics: is the ticker alive, and what is sitting in the queue? This
//   is the endpoint to hit when "the email never arrived" — it separates
//   "nothing was ever queued", "queued but never fired" and "the send failed".

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { processBatch } from "@/lib/composio/emailDispatcher";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    const counts = await processBatch();
    return NextResponse.json({ ok: true, ...counts });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function GET() {
  const rows = await prisma.pendingEmail.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      toEmail: true,
      subject: true,
      status: true,
      fireAt: true,
      sentAt: true,
      sentMessageId: true,
      error: true,
    },
  });

  return NextResponse.json({
    ok: true,
    // The ticker lives in instrumentation.ts and drives this route over HTTP,
    // so this module cannot see it — hence a driver label rather than a
    // misleading "running: false". POST below sends the due rows regardless.
    driver: "instrumentation-http",
    tickerIntervalMs: 5_000,
    queue: rows.map((r) => ({
      id: r.id,
      to: r.toEmail,
      subject: r.subject,
      status: r.status,
      fireAt: r.fireAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      gmailMessageId: r.sentMessageId,
      error: r.error,
    })),
  });
}
