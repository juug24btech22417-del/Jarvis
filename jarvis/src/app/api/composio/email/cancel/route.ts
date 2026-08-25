// Cancel a pending email before the dispatcher sends it.
//
// POST /api/composio/email/cancel
//   body: { pendingId: string }
//
// Atomically flips the row from "pending" → "cancelled" only if it
// hasn't been claimed yet. The dispatcher's tick() also uses an
// updateMany(where: status="pending") claim, so whichever runs first
// wins — the other becomes a no-op. This is the safety net for the
// 30-second Telegram inline button.
//
// Idempotent: a second cancel on the same id returns ok=true with
// alreadyCancelled=true so the UI can show "already cancelled" without
// surfacing an error.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  pendingId?: string;
}

export async function POST(req: Request) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const pendingId = body.pendingId?.trim();
  if (!pendingId) {
    return NextResponse.json({ ok: false, error: "missing 'pendingId'" }, { status: 400 });
  }

  // Look up the row first so we can give a meaningful response on
  // already-sent / already-cancelled / not-found.
  const existing = await prisma.pendingEmail.findUnique({ where: { id: pendingId } });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "not found", notFound: true }, { status: 404 });
  }

  if (existing.status !== "pending") {
    // Don't error — return ok=true with a flag. The UI already shows
    // the post-action state via editMessageText.
    return NextResponse.json({
      ok: true,
      alreadyCancelled: existing.status === "cancelled",
      alreadySent: existing.status === "sent",
      alreadyFailed: existing.status === "failed",
      status: existing.status,
    });
  }

  // Atomic claim: only flip if still pending. If a concurrent dispatcher
  // tick has already flipped to "sending", this returns count=0 and
  // the dispatcher will send anyway.
  const claimed = await prisma.pendingEmail.updateMany({
    where: { id: pendingId, status: "pending" },
    data: { status: "cancelled" },
  });

  if (claimed.count === 0) {
    // Re-read so the caller sees the post-state.
    const fresh = await prisma.pendingEmail.findUnique({ where: { id: pendingId } });
    return NextResponse.json({
      ok: true,
      racedWithDispatcher: true,
      status: fresh?.status ?? "unknown",
    });
  }

  // Edit the original Telegram prompt to reflect the cancellation so
  // the user sees a definitive "cancelled" message instead of the
  // "Sending in 30s" one.
  if (existing.chatId && existing.callbackMessageId) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (token) {
      const { editMessageText } = await import("@/lib/telegram");
      editMessageText(
        token,
        Number(existing.chatId),
        Number(existing.callbackMessageId),
        `✖️ Cancelled email to ${existing.toEmail}\nSubject: ${existing.subject}`
      ).catch((e) =>
        console.error("[composio/email/cancel] edit telegram failed:", e)
      );
    }
  }

  return NextResponse.json({ ok: true, status: "cancelled" });
}
