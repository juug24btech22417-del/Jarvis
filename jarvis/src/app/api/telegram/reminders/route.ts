// CRUD wrapper over `lib/telegram/reminders` for the React panel and
// any non-Telegram caller. Auth: caller must be reachable on localhost.
//
//   GET    /api/telegram/reminders?chatId=X        → list pending
//   POST   /api/telegram/reminders                 → create
//   DELETE /api/telegram/reminders?id=X&chatId=Y   → cancel

import { NextRequest, NextResponse } from "next/server";
import {
  createReminder,
  cancelReminder,
  listPendingForChat,
  listForChat,
} from "@/lib/telegram/reminders";

export async function GET(req: NextRequest) {
  const chatIdStr = req.nextUrl.searchParams.get("chatId");
  if (!chatIdStr) {
    return NextResponse.json(
      { error: "chatId query param required" },
      { status: 400 }
    );
  }
  const chatId = Number(chatIdStr);
  if (!Number.isFinite(chatId)) {
    return NextResponse.json({ error: "invalid chatId" }, { status: 400 });
  }
  const all = req.nextUrl.searchParams.get("all") === "1";
  const rows = all ? await listForChat(chatId) : await listPendingForChat(chatId);
  return NextResponse.json({ reminders: rows });
}

interface CreateBody {
  chatId?: number;
  text?: string;
  fireAt?: string; // ISO
  quietStartMin?: number;
  quietEndMin?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateBody;
    if (!body.chatId || !body.text || !body.fireAt) {
      return NextResponse.json(
        { error: "chatId, text, fireAt required" },
        { status: 400 }
      );
    }
    const fireAt = new Date(body.fireAt);
    if (Number.isNaN(fireAt.getTime())) {
      return NextResponse.json({ error: "invalid fireAt" }, { status: 400 });
    }
    const row = await createReminder({
      chatId: body.chatId,
      text: body.text,
      fireAt,
      quietStartMin: body.quietStartMin,
      quietEndMin: body.quietEndMin,
    });
    return NextResponse.json({ reminder: row });
  } catch (err: any) {
    console.error("[api/telegram/reminders] POST error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const chatIdStr = req.nextUrl.searchParams.get("chatId");
  if (!id || !chatIdStr) {
    return NextResponse.json(
      { error: "id and chatId query params required" },
      { status: 400 }
    );
  }
  const chatId = Number(chatIdStr);
  const ok = await cancelReminder(id, chatId);
  return NextResponse.json({ ok });
}