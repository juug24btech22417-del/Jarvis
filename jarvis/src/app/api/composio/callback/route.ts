// OAuth callback from composio.
//
// After the user completes the OAuth flow, composio redirects the browser
// back to the callbackUrl we passed to `connectedAccounts.link`. Query
// params include at least `connected_account_id` (and sometimes a
// `status`). We persist the connection, kick off auto-subscribe for the
// phase-1 triggers of this toolkit, then bounce back to the Connected
// panel.
//
// We render a tiny success page (rather than a 302) because popup-based
// OAuth flows often lose cookies on redirect; the popup stays open,
// posts a message to its opener, and self-closes.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { getComposio, readComposioEnv } from "@/lib/composio/client";
import { autoSubscribeTriggers } from "@/lib/composio/autoSubscribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUCCESS_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>JARVIS — Connected</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#67e8f9;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{padding:24px 32px;border:1px solid rgba(103,232,249,.3);border-radius:12px;background:rgba(0,0,0,.5);text-align:center}
h1{margin:0 0 8px;font-size:18px;font-weight:600}p{margin:0;font-size:13px;opacity:.7}</style>
</head><body><div class="card"><h1 id="msg">✓ Connected. You can close this window.</h1><p>JARVIS is listening for events.</p></div>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({ type: "composio:connected", toolkit: new URLSearchParams(location.search).get("toolkit") }, "*");
  }
  setTimeout(() => window.close(), 1500);
} catch (e) {}
</script></body></html>`;

const FAIL_HTML = (msg: string) => `<!doctype html>
<html><head><meta charset="utf-8"><title>JARVIS — Connection failed</title>
<style>body{font-family:system-ui;background:#0a0a0a;color:#fca5a5;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
.card{padding:24px 32px;border:1px solid rgba(252,165,165,.3);border-radius:12px;background:rgba(0,0,0,.5);text-align:center;max-width:480px}
h1{margin:0 0 8px;font-size:16px;font-weight:600}p{margin:0;font-size:12px;opacity:.8;word-break:break-word}</style>
</head><body><div class="card"><h1>✗ Connection failed</h1><p>${msg}</p></div></body></html>`;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const connectedAccountId = url.searchParams.get("connected_account_id");
  const toolkit = (url.searchParams.get("toolkit") ?? "").toLowerCase();
  const status = url.searchParams.get("status") ?? "ACTIVE";

  if (!connectedAccountId) {
    return new Response(FAIL_HTML("Missing connected_account_id in callback."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!toolkit) {
    return new Response(FAIL_HTML("Missing toolkit in callback."), {
      status: 400,
      headers: { "Content-Type": "text/html" },
    });
  }

  const { userId } = readComposioEnv();
  const composio = getComposio();

  // Look up the actual account to grab the authConfigId.
  let authConfigId = "";
  try {
    const listed = await composio.connectedAccounts.list({
      userIds: [userId],
      toolkitSlugs: [toolkit],
    });
    const acc = listed.items.find((a) => a.id === connectedAccountId);
    if (acc) {
      authConfigId = acc.authConfig?.id ?? "";
    }
  } catch (e) {
    console.error("[composio/callback] list failed:", e);
  }

  // Upsert the connection row.
  try {
    await prisma.composioConnection.upsert({
      where: { userId_toolkitSlug: { userId, toolkitSlug: toolkit } },
      create: {
        userId,
        toolkitSlug: toolkit,
        connectedAccountId,
        authConfigId,
        status: status.toUpperCase(),
      },
      update: {
        connectedAccountId,
        authConfigId,
        status: status.toUpperCase(),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(FAIL_HTML(`Failed to save connection: ${msg}`), {
      status: 500,
      headers: { "Content-Type": "text/html" },
    });
  }

  // Fire-and-forget: auto-subscribe to phase-1 triggers for this toolkit.
  // Don't fail the callback if this errors — the connection is recorded,
  // the user can retry subscribe from the panel.
  void autoSubscribeTriggers(toolkit, userId).catch((e) => {
    console.error(
      `[composio/callback] autoSubscribeTriggers(${toolkit}) failed:`,
      e instanceof Error ? e.message : e
    );
  });

  return new Response(SUCCESS_HTML, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}
