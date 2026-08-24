// Manually subscribe (or re-subscribe) a trigger.
//
// POST /api/composio/subscribe
//   body: { slug: "GMAIL_NEW_GMAIL_MESSAGE" }
//
// Calls composio.triggers.create() which upserts the trigger instance.
// Useful when auto-subscribe missed a slug (it doesn't exist for the
// toolkit version) or when we add a new trigger in phase 2+.

import { NextResponse } from "next/server";
import { readComposioEnv, getComposio } from "@/lib/composio/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { slug?: string } = {};
  try {
    body = (await req.json()) as { slug?: string };
  } catch {
    // empty
  }
  const slug = body.slug?.trim();
  if (!slug) {
    return NextResponse.json(
      { ok: false, error: "missing slug" },
      { status: 400 }
    );
  }

  const { userId } = readComposioEnv();
  const composio = getComposio();

  try {
    await composio.triggers.getType(slug);
    const created = await composio.triggers.create(userId, slug);
    return NextResponse.json({ ok: true, slug, triggerId: created.triggerId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg, slug },
      { status: 500 }
    );
  }
}
