import { NextRequest, NextResponse } from "next/server";
import { fetchInboxViaComposio, InboxMessage } from "@/lib/composio/inbox";

interface TeleportPayload {
  id: string;
  type: "text" | "url" | "note" | "code" | "clipboard" | "image";
  title: string;
  content: string;
  language?: string;
  createdAt: number;
  expiresAt: number;
  source: "pc" | "phone";
}

const g = globalThis as unknown as {
  __jarvisTeleportInbox?: TeleportPayload[];
};

if (!g.__jarvisTeleportInbox) {
  g.__jarvisTeleportInbox = [];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type"); // 'teleport' | 'email' | 'all'

    const beams = (g.__jarvisTeleportInbox || []).slice(-30).reverse();

    let emails: InboxMessage[] = [];
    let composioConnected = false;
    let composioError: string | null = null;

    if (type !== "teleport") {
      try {
        const inboxRes = await fetchInboxViaComposio({ maxResults: 10 });
        emails = inboxRes.messages || [];
        composioConnected = inboxRes.ok;
      } catch (err) {
        composioError = String(err);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: Date.now(),
      teleportInbox: beams,
      emails,
      composioConnected,
      composioError,
      stats: {
        totalBeams: beams.length,
        totalEmails: emails.length,
        unreadEmails: emails.filter((m) => m.isUnread).length,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to fetch unified inbox", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, id, item } = body;

    if (action === "clear" || action === "clear-inbox") {
      g.__jarvisTeleportInbox = [];
      return NextResponse.json({ success: true, message: "Inbox cleared", teleportInbox: [] });
    }

    if (action === "delete" && id) {
      g.__jarvisTeleportInbox = (g.__jarvisTeleportInbox || []).filter((b) => b.id !== id);
      return NextResponse.json({
        success: true,
        message: "Item removed",
        teleportInbox: (g.__jarvisTeleportInbox || []).slice(-30).reverse(),
      });
    }

    if (action === "beam" && item) {
      const newBeam: TeleportPayload = {
        id: item.id || `beam-${Date.now()}`,
        type: item.type || "text",
        title: item.title || "Quick Beam",
        content: item.content || "",
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
        source: item.source || "phone",
      };

      g.__jarvisTeleportInbox = g.__jarvisTeleportInbox || [];
      g.__jarvisTeleportInbox.push(newBeam);

      return NextResponse.json({
        success: true,
        beam: newBeam,
        teleportInbox: g.__jarvisTeleportInbox.slice(-30).reverse(),
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: "Inbox operation failed", details: String(error) },
      { status: 500 }
    );
  }
}
