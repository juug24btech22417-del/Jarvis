// Live Gmail inbox access via composio's GMAIL_FETCH_EMAILS action.
//
// Used by /api/composio/inbox and (preferred) by /api/chat's "summarise
// my inbox" shortcut. The event-log feed in /api/composio/events is
// useful for proactive notifications but it can lag — listener crashes,
// missed Pusher frames, or quiet periods between incoming mail all leave
// the log stale. The composio action hits Gmail directly, so the user
// always gets fresh results.

import { prisma } from "@/lib/db/queries";

export interface InboxMessage {
  messageId: string;
  threadId: string | null;
  subject: string;
  from: string;
  fromEmail: string;
  date: string | null;
  snippet: string;
  link: string | null;
  isUnread: boolean;
}

export interface InboxFetchResult {
  ok: boolean;
  source: "composio";
  query: string;
  count: number;
  messages: InboxMessage[];
  error?: string;
}

const QUERY_DEFAULT = "in:inbox";
const QUERY_UNREAD = "in:inbox is:unread";

interface FetchEmailsResponse {
  messages?: Array<{
    messageId?: string;
    threadId?: string;
    subject?: string;
    sender?: string;
    to?: string;
    labelIds?: string[];
    messageText?: string;
    messageTimestamp?: string;
    preview?: { body?: string; subject?: string } | string;
    payload?: {
      headers?: Array<{ name?: string; value?: string }>;
    };
    display_url?: string;
  }>;
}

function parseFrom(raw: string | undefined): { name: string; email: string } {
  if (!raw) return { name: "Unknown", email: "" };
  // "Name <addr@x.com>" or just "addr@x.com"
  const m = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<\s*([^>]+@[^>]+)\s*>\s*$/);
  if (m) return { name: (m[1] || m[2]).trim(), email: m[2].trim().toLowerCase() };
  const at = raw.match(/([^\s<>]+@[^\s<>]+)/);
  if (at) {
    const name = raw.split("<")[0].trim().replace(/^["']|["']$/g, "");
    return { name: name || at[1], email: at[1].toLowerCase() };
  }
  return { name: raw.trim(), email: "" };
}

// Pull a header value from the raw payload if `sender` is missing or empty.
function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const h = headers.find((x) => (x.name ?? "").toLowerCase() === name.toLowerCase());
  return h?.value?.trim() || undefined;
}

export async function fetchInboxViaComposio(opts: {
  userId?: string;
  unreadOnly?: boolean;
  maxResults?: number;
}): Promise<InboxFetchResult> {
  const max = Math.min(Math.max(opts.maxResults ?? 15, 1), 30);
  const query = opts.unreadOnly ? QUERY_UNREAD : QUERY_DEFAULT;

  // Resolve the active Gmail connection from the local registry.
  const conn = await prisma.composioConnection.findFirst({
    where: {
      toolkitSlug: "gmail",
      status: { in: ["SUCCESS", "ACTIVE"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!conn) {
    return {
      ok: false,
      source: "composio",
      query,
      count: 0,
      messages: [],
      error: "no active Gmail connection",
    };
  }

  const { Composio } = await import("@composio/core");
  const c = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });

  try {
    const res = await c.tools.execute(
      "GMAIL_FETCH_EMAILS",
      {
        userId: opts.userId ?? "jarvis-local",
        connectedAccountId: conn.connectedAccountId,
        dangerouslySkipVersionCheck: true,
        arguments: { query, max_results: max },
      },
      { signal: AbortSignal.timeout(15_000) }
    );

    if (!res.successful) {
      return {
        ok: false,
        source: "composio",
        query,
        count: 0,
        messages: [],
        error: res.error ?? "composio returned unsuccessful",
      };
    }

    const data = (res.data ?? {}) as FetchEmailsResponse;
    const raw = data.messages ?? [];

    const messages: InboxMessage[] = raw
      .filter((m) => m.messageId)
      .map((m) => {
        // Prefer top-level `sender`; fall back to payload `From` header.
        const fromRaw =
          m.sender ??
          headerValue(m.payload?.headers, "From") ??
          headerValue(m.payload?.headers, "from") ??
          "";
        const { name, email } = parseFrom(fromRaw);
        const dateRaw =
          m.messageTimestamp ??
          headerValue(m.payload?.headers, "Date") ??
          headerValue(m.payload?.headers, "date") ??
          null;
        return {
          messageId: m.messageId!,
          threadId: m.threadId ?? null,
          subject: (m.subject ?? "(no subject)").trim(),
          from: name,
          fromEmail: email,
          date: dateRaw,
          snippet: (typeof m.preview === "string"
            ? m.preview
            : m.preview?.body ?? m.messageText ?? ""
          ).slice(0, 240).replace(/\s+/g, " ").trim(),
          link: m.display_url ?? null,
          isUnread: Array.isArray(m.labelIds) && m.labelIds.includes("UNREAD"),
        };
      });

    return { ok: true, source: "composio", query, count: messages.length, messages };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      source: "composio",
      query,
      count: 0,
      messages: [],
      error: msg,
    };
  }
}