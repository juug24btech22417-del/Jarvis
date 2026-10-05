import { NextRequest, NextResponse } from "next/server";
import { startProxyServer, stopProxyServer, getProxyStatus } from "@/services/ProxyServer";
import fs from "fs";

export async function GET(req: NextRequest) {
  try {
    const status = getProxyStatus();
    return NextResponse.json({ success: true, status });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === "start") {
      const started = await startProxyServer();
      const status = getProxyStatus();
      // Surface WHY it failed (e.g. the port is already held by a stale proxy)
      // instead of a bare success:false the panel can't explain.
      return NextResponse.json({
        success: started,
        status,
        ...(started ? {} : { error: status.lastError || "Failed to start the proxy." }),
      });
    } else if (action === "stop") {
      const stopped = await stopProxyServer();
      const status = getProxyStatus();
      return NextResponse.json({ success: stopped, status });
    } else {
      return NextResponse.json(
        { success: false, error: "Invalid action. Must be 'start' or 'stop'." },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error("[Proxy API] Control error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
