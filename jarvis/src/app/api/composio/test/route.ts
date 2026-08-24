// Synthetic event firer. Used to prove the downstream pipeline
// (normalize → dedupe → summarize → deliver → telegram + desktop)
// works end-to-end without needing a live composio connection.
//
// POST /api/composio/test
//   body (optional): { source?, type?, title?, body?, url?, priority? }
//   - If body is omitted, a default sample is used.

import { NextResponse } from "next/server";
import { recordAndCheck } from "@/lib/composio/dedupe";
import { maybeSummarize } from "@/lib/composio/summarize";
import { deliver } from "@/lib/composio/deliver";
import type { JarvisEvent, JarvisEventSource } from "@/lib/composio/eventBus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_SOURCES: JarvisEventSource[] = ["gmail", "gcal", "github"];

const SAMPLES: Record<JarvisEventSource, Omit<JarvisEvent, "id" | "occurredAt">> = {
  gmail: {
    source: "gmail",
    type: "new_email",
    title: "New email from Sarah Chen",
    body:
      "*Q3 numbers are ready*\n\n" +
      "Hey — just wrapped the dashboard. Numbers look solid, " +
      "want me to pull them into the JARVIS research panel for Friday?",
    url: "https://mail.google.com/",
    priority: "normal",
  },
  gcal: {
    source: "gcal",
    type: "event_created",
    title: "Calendar: Design review (10:00 → 10:30)",
    body: "*Design review*\n\n📍 Room 4B\nReviewing the new composio integration before the phase 1 ship.",
    url: "https://calendar.google.com/",
    priority: "normal",
  },
  github: {
    source: "github",
    type: "github_pull_request_event",
    title: "GitHub: pull_request (opened)",
    body: "📦 jarvis-ui\n*Add composio integration* #142\n\nby @dmitri",
    url: "https://github.com/dhruv/jarvis/pull/142",
    priority: "high",
  },
  notion: {
    source: "notion",
    type: "page_updated",
    title: "Notion: Phase 1 plan updated",
    body: "Phase 1 plan updated with the corrected delivery fan-out.",
    url: "https://notion.so/",
    priority: "low",
  },
  linear: {
    source: "linear",
    type: "issue_assigned",
    title: "Linear: JAR-118 assigned to you",
    body: "Trigger listener reconnect on Pusher drop.",
    priority: "normal",
  },
  jira: {
    source: "jira",
    type: "issue_updated",
    title: "Jira: JARS-401 status changed",
    body: "Status: In Progress → In Review.",
    priority: "low",
  },
  test: {
    source: "test",
    type: "manual_test",
    title: "Test fire from jarvis",
    body: "If you can read this in Telegram and saw a desktop notification, the pipeline works end-to-end.",
    priority: "normal",
  },
};

export async function POST(req: Request) {
  let body: Partial<JarvisEvent> = {};
  try {
    body = (await req.json()) as Partial<JarvisEvent>;
  } catch {
    // empty body → use defaults
  }

  const source = (body.source as JarvisEventSource) || "test";
  const sample = SAMPLES[source] ?? SAMPLES.test;

  // Use a unique id every call so dedupe doesn't drop repeated test fires.
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const event: JarvisEvent = {
    ...sample,
    ...body,
    id,
    source,
    occurredAt: new Date().toISOString(),
  };

  const dedupe = await recordAndCheck(event);
  if (!dedupe.fresh) {
    return NextResponse.json(
      { ok: false, reason: "duplicate (shouldn't happen for test events)" },
      { status: 409 }
    );
  }

  const summarized = await maybeSummarize(event);
  await deliver(summarized, dedupe.logId);

  return NextResponse.json({
    ok: true,
    event: { id: summarized.id, source: summarized.source, title: summarized.title },
    logId: dedupe.logId,
  });
}
