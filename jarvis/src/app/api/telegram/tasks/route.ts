// Thin Task CRUD wrapper for the React panel and `/tasks` / `/task` /
// `/done` bot commands. Backs onto the existing `Task` Prisma model.
//
//   GET    /api/telegram/tasks?completed=false  → list
//   POST   /api/telegram/tasks                 → create { title, dueDate? }
//   PATCH  /api/telegram/tasks                 → { id, completed }
//   DELETE /api/telegram/tasks?id=X            → delete

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";

export async function GET(req: NextRequest) {
  const completed = req.nextUrl.searchParams.get("completed");
  const where: Record<string, unknown> = {};
  if (completed === "false") where.completed = false;
  else if (completed === "true") where.completed = true;

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ completed: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ tasks });
}

interface CreateBody {
  title?: string;
  description?: string;
  priority?: string;
  category?: string;
  dueDate?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as CreateBody;
    if (!body.title || !body.title.trim()) {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }
    const dueDate = body.dueDate ? new Date(body.dueDate) : null;
    const task = await prisma.task.create({
      data: {
        title: body.title.trim(),
        description: body.description ?? null,
        priority: body.priority ?? "normal",
        category: body.category ?? null,
        dueDate: dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate : null,
      },
    });
    return NextResponse.json({ task });
  } catch (err: any) {
    console.error("[api/telegram/tasks] POST error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}

interface PatchBody {
  id?: string;
  completed?: boolean;
  title?: string;
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as PatchBody;
    if (!body.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }
    const data: Record<string, unknown> = {};
    if (typeof body.completed === "boolean") data.completed = body.completed;
    if (typeof body.title === "string") data.title = body.title;
    const task = await prisma.task.update({
      where: { id: body.id },
      data,
    });
    return NextResponse.json({ task });
  } catch (err: any) {
    console.error("[api/telegram/tasks] PATCH error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "internal error" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  await prisma.task.delete({ where: { id } }).catch((e) => {
    console.error("[api/telegram/tasks] DELETE error:", e?.message || e);
  });
  return NextResponse.json({ ok: true });
}