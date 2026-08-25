// Schedule an email to be sent in 30 seconds (auto-cancelable).
//
// POST /api/composio/email/send
//   body: {
//     to: string          // "alice@example.com" or "Alice <alice@example.com>"
//     about: string       // what's the email about (subject + body)
//     tone?: string       // professional | friendly | polite | formal | urgent | casual (auto if absent)
//     hint?: string       // optional extra details to fold into the body
//     chatId?: number     // telegram chat for the cancel/edit UIs
//   }
//
// Flow:
//   1. Parse `to` into { name?, email }
//   2. Compose subject + body via LLM in the inferred/requested tone
//   3. Persist PendingEmail row with status=pending, fireAt=now+30s
//   4. Post a Telegram "Sending in 30s" message with a Cancel inline button
//      (skipped if no chatId)
//   5. Return { ok, pendingId, fireAt, subject, body, tone } so the chat
//      shortcut can show the preview before the user goes off-platform

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { composeEmail, inferTone, type EmailTone } from "@/lib/composio/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CANCEL_WINDOW_SEC = 30;
const VALID_TONES: EmailTone[] = [
  "professional",
  "friendly",
  "polite",
  "formal",
  "urgent",
  "casual",
];

interface RequestBody {
  to?: string;
  about?: string;
  tone?: string;
  hint?: string;
  chatId?: number;
}

function parseRecipient(raw: string): { name?: string; email: string } | null {
  const trimmed = raw.trim();
  // "Alice <alice@example.com>"
  const m = trimmed.match(/^(.+?)\s*<\s*([^>\s]+@[^>\s]+)\s*>$/);
  if (m) return { name: m[1].trim(), email: m[2].trim() };
  // "alice@example.com"
  if (/^[^\s<>]+@[^\s<>]+$/.test(trimmed)) return { email: trimmed };
  return null;
}

export async function POST(req: Request) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const toRaw = body.to?.trim();
  const about = body.about?.trim();
  if (!toRaw || !about) {
    return NextResponse.json(
      { ok: false, error: "missing 'to' or 'about'" },
      { status: 400 }
    );
  }
  const recipient = parseRecipient(toRaw);
  if (!recipient) {
    return NextResponse.json(
      { ok: false, error: `can't parse recipient email from "${toRaw}"` },
      { status: 400 }
    );
  }

  const tone: EmailTone = (
    body.tone && VALID_TONES.includes(body.tone as EmailTone)
      ? (body.tone as EmailTone)
      : inferTone(about)
  );

  // Resolve the active gmail connection for this user.
  // composio's OAuth callback writes `status=success` (uppercased to
  // SUCCESS in our row). Older rows may still hold "ACTIVE" from an
  // earlier code path — accept either so we don't false-negative a
  // freshly connected account.
  const conn = await prisma.composioConnection.findFirst({
    where: {
      toolkitSlug: "gmail",
      status: { in: ["SUCCESS", "ACTIVE"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "no active Gmail connection. Open the Connected Apps panel and connect Gmail first.",
      },
      { status: 400 }
    );
  }

  // Compose the body.
  const composed = await composeEmail({
    toEmail: recipient.email,
    toName: recipient.name,
    about,
    tone,
    hint: body.hint,
  });

  const fireAt = new Date(Date.now() + CANCEL_WINDOW_SEC * 1000);

  // Persist PendingEmail row.
  const row = await prisma.pendingEmail.create({
    data: {
      toEmail: recipient.email,
      toName: recipient.name ?? null,
      body: composed.body,
      subject: composed.subject,
      tone: composed.tone,
      requestRaw: about,
      chatId: body.chatId ?? null,
      fireAt,
      status: "pending",
      connectedAccountId: conn.connectedAccountId,
    },
  });

  // Fire-and-forget: post the Telegram cancel message. We don't want to
  // block the chat response on this. If Telegram is not configured or
  // chatId wasn't passed, skip silently.
  if (body.chatId) {
    void postTelegramCancelPrompt(body.chatId, row.id, composed, fireAt).catch(
      (e) => console.error("[composio/email/send] telegram prompt failed:", e)
    );
  }

  return NextResponse.json({
    ok: true,
    pendingId: row.id,
    fireAt: fireAt.toISOString(),
    cancelWindowSec: CANCEL_WINDOW_SEC,
    subject: composed.subject,
    body: composed.body,
    tone: composed.tone,
    to: recipient,
  });
}

async function postTelegramCancelPrompt(
  chatId: number,
  pendingId: string,
  composed: { subject: string; body: string; tone: EmailTone },
  fireAt: Date
): Promise<void> {
  // Import lazily so we don't pull telegram deps on every call.
  const { notifyUser } = await import("@/lib/telegram/notify");
  const text =
    `📧 Sending email in ${CANCEL_WINDOW_SEC}s (${composed.tone} tone)\n\n` +
    `Subject: ${composed.subject}\n\n` +
    `${composed.body}\n\n` +
    `Tap Cancel to abort before ${fireAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`;

  const result = await notifyUser(chatId, text, {
    buttons: [
      [
        {
          text: "✖️ Cancel send",
          callback_data: `email:cancel:${pendingId}`,
        },
      ],
    ],
  });
  if (result.sent && result.messageIds && result.messageIds.length > 0) {
    await prisma.pendingEmail.update({
      where: { id: pendingId },
      data: { callbackMessageId: BigInt(result.messageIds[0]) },
    });
  }
}