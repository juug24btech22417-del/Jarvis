// Initiate a composio OAuth flow for a toolkit.
//
// POST /api/composio/connect
//   body: { toolkit: "gmail" | "googlecalendar" | "github" }
//
// Looks up (or creates) a composio-managed auth config for the toolkit,
// then calls `connectedAccounts.link` to get a one-time redirect URL.
// The browser opens that URL (in a popup) where the user consents; on
// success composio redirects to /api/composio/callback which persists
// the connected account.

import { NextResponse } from "next/server";
import { readComposioEnv, getOrCreateAuthConfig, getAppBaseUrl } from "@/lib/composio/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PHASE1_TOOLKITS = new Set(["gmail", "googlecalendar", "github"]);

export async function POST(req: Request) {
  let body: { toolkit?: string } = {};
  try {
    body = (await req.json()) as { toolkit?: string };
  } catch {
    // empty body
  }
  const toolkit = (body.toolkit ?? "").toLowerCase();
  if (!toolkit || !PHASE1_TOOLKITS.has(toolkit)) {
    return NextResponse.json(
      { ok: false, error: `unsupported toolkit: ${toolkit}` },
      { status: 400 }
    );
  }

  const { userId } = readComposioEnv();
  const baseUrl = getAppBaseUrl();
  const callbackUrl = `${baseUrl}/api/composio/callback?toolkit=${encodeURIComponent(toolkit)}`;

  try {
    const authConfigId = await getOrCreateAuthConfig(toolkit);
    const { getComposio } = await import("@/lib/composio/client");
    const composio = getComposio();
    const connectionRequest = await composio.connectedAccounts.link(
      userId,
      authConfigId,
      { callbackUrl, allowMultiple: true }
    );

    return NextResponse.json({
      ok: true,
      toolkit,
      connectionRequestId: connectionRequest.id,
      redirectUrl: connectionRequest.redirectUrl,
      authConfigId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
