// Optional webhook transport — only enabled when
// TELEGRAM_USE_WEBHOOK=true. Returns 200 either way so a curl test
// doesn't 404; the long-polling path in `poller.ts` continues to be
// the default.

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (process.env.TELEGRAM_USE_WEBHOOK !== "true") {
    return NextResponse.json(
      { ok: false, mode: "long-polling", message: "Webhook disabled" },
      { status: 200 }
    );
  }
  // TODO: implement webhook-mode dispatch when the user wants it.
  // For now, log the body and ack.
  try {
    const body = await req.json().catch(() => ({}));
    console.log("[api/telegram/webhook] received update (no-op):", JSON.stringify(body).slice(0, 200));
  } catch {}
  return NextResponse.json({ ok: true });
}