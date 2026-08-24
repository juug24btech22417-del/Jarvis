// Maps a raw composio trigger payload → our normalized JarvisEvent.
//
// Composio's payload shape per trigger is documented at
// https://docs.composio.dev/triggers but the exact JSON varies per toolkit
// and per trigger version. We take a defensive approach: try a few common
// field names, fall back to JSON.stringify if nothing matches, and let
// downstream code (telegram + desktop) render whatever we produce.
//
// The point of this layer is *not* perfect extraction — it's to guarantee
// the user always gets a notification, even if some fields are empty.

import type { JarvisEvent, JarvisEventSource } from "./eventBus";

interface NormalizeInput {
  triggerSlug: string;
  toolkitSlug: string;
  payload: Record<string, unknown> | undefined;
  id: string;
  occurredAt: string;
}

function pickString(obj: Record<string, unknown> | undefined, ...keys: string[]): string {
  if (!obj) return "";
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function pickUrl(obj: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  const v = pickString(obj, ...keys);
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  return undefined;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/**
 * Map a composio IncomingTriggerPayload (minus the bits we don't need) to a
 * JarvisEvent. Always returns something — unknown slugs get a generic
 * low-priority event so the user still sees *something* arrived.
 */
export function normalize(input: NormalizeInput): JarvisEvent {
  const p = (input.payload ?? {}) as Record<string, unknown>;
  const slug = input.triggerSlug.toUpperCase();

  // Gmail: GMAIL_NEW_GMAIL_MESSAGE
  if (slug.startsWith("GMAIL_") || input.toolkitSlug.toLowerCase() === "gmail") {
    const from = pickString(p, "sender", "from", "from_email");
    const subject = pickString(p, "subject", "title");
    const snippet = pickString(p, "snippet", "body_text", "body", "preview");
    const messageId = pickString(p, "message_id", "id", "gmail_id");
    return {
      id: input.id || `gmail:${messageId}`,
      source: "gmail",
      type: "new_email",
      occurredAt: input.occurredAt,
      title: `New email from ${from || "unknown"}`,
      body: truncate(`${subject ? `*${subject}*\n\n` : ""}${snippet || "(no preview)"}`, 1500),
      url: pickUrl(p, "url", "permalink", "web_url") ?? `https://mail.google.com/`,
      priority: "normal",
      raw: p,
    };
  }

  // Google Calendar: GOOGLECALENDAR_*_EVENT_CREATED_TRIGGER / _UPDATED / _STARTING_SOON
  if (slug.startsWith("GOOGLECALENDAR_") || slug.startsWith("GOOGLE_CALENDAR_") || input.toolkitSlug.toLowerCase() === "googlecalendar" || input.toolkitSlug.toLowerCase() === "gcal") {
    const summary = pickString(p, "summary", "title", "event_title");
    const start = pickString(p, "start", "start_time", "startTime", "start_dateTime");
    const end = pickString(p, "end", "end_time", "endTime");
    const location = pickString(p, "location");
    const description = pickString(p, "description", "notes");
    const timeRange = start && end ? ` (${start} → ${end})` : start ? ` at ${start}` : "";
    const upper = input.triggerSlug.toUpperCase();
    const type: JarvisEvent["type"] =
      upper.includes("STARTING_SOON") ? "event_starting_soon" :
      upper.includes("CANCELED") || upper.includes("DELETED") ? "event_canceled" :
      upper.includes("UPDATED") || upper.includes("CHANGE") ? "event_updated" :
      "event_created";
    return {
      id: input.id,
      source: "gcal",
      type,
      occurredAt: input.occurredAt,
      title:
        type === "event_starting_soon"
          ? `Calendar starting soon: ${summary || "event"}${start ? ` at ${start}` : ""}`
          : `Calendar: ${summary || "new event"}${timeRange}`,
      body: truncate(
        `${summary ? `*${summary}*${timeRange}\n\n` : ""}${location ? `📍 ${location}\n` : ""}${description || ""}`,
        1500
      ),
      url: pickUrl(p, "htmlLink", "url", "web_url"),
      priority: type === "event_starting_soon" ? "high" : "normal",
      raw: p,
    };
  }

  // GitHub: GITHUB_PULL_REQUEST_EVENT / _REVIEWERS_CHANGED / _ISSUES / _STAR
  if (slug.startsWith("GITHUB_") || input.toolkitSlug.toLowerCase() === "github") {
    const action = pickString(p, "action");
    const repo = pickString(p, "repository", "repo", "repo_name") || pickString(p["pull_request"] as Record<string, unknown>, "base", "repo", "full_name");
    const title = pickString(p["pull_request"] as Record<string, unknown>, "title")
      || pickString(p["issue"] as Record<string, unknown>, "title")
      || pickString(p, "title");
    const number = (p["pull_request"] as Record<string, unknown>)?.number
      ?? (p["issue"] as Record<string, unknown>)?.number;
    const sender = pickString(p["sender"] as Record<string, unknown>, "login") || pickString(p, "sender");
    const htmlUrl = pickUrl(p["pull_request"] as Record<string, unknown>, "html_url")
      || pickUrl(p["issue"] as Record<string, unknown>, "html_url")
      || pickUrl(p, "html_url");
    const upper = input.triggerSlug.toUpperCase();
    return {
      id: input.id,
      source: "github",
      type: `github_${slug.toLowerCase()}`,
      occurredAt: input.occurredAt,
      title: `GitHub: ${slug.replace("GITHUB_", "").toLowerCase().replace(/_/g, " ")}${action ? ` (${action})` : ""}`,
      body: truncate(
        `${repo ? `📦 ${repo}\n` : ""}${title ? `*${title}*${number ? ` #${number}` : ""}\n\n` : ""}${sender ? `by @${sender}` : ""}`,
        1500
      ),
      url: htmlUrl,
      priority:
        upper.includes("REVIEW_REQUESTED") || upper.includes("REVIEWERS_CHANGED") ||
        upper.includes("MENTION") || upper.includes("ASSIGNED_TO_ME")
          ? "high"
          : "normal",
      raw: p,
    };
  }

  // Unknown toolkit/slug — still emit something useful.
  return {
    id: input.id,
    source: (input.toolkitSlug.toLowerCase() as JarvisEventSource) || "test",
    type: input.triggerSlug,
    occurredAt: input.occurredAt,
    title: `Composio event: ${input.triggerSlug}`,
    body: truncate(`From ${input.toolkitSlug || "unknown source"}.\n\nRaw payload:\n${JSON.stringify(p, null, 2).slice(0, 1000)}`, 1500),
    priority: "low",
    raw: p,
  };
}
