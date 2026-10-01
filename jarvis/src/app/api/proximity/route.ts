import { NextRequest, NextResponse } from "next/server";
import {
  getConfig,
  getHistory,
  getRemoteStatus,
  ringPhone,
  scan,
  setBeacon,
  setLabel,
  setRssi,
  toggleFavorite,
  updateConfig,
} from "@/services/ProximityService";

type BrokerModule = {
  startBroker: () => Promise<{ port: number; ip: string } | null>;
  PORT: number;
};

// Same lazily-started broker instance the QR remote uses (see
// /api/remote/status) — kept on globalThis so dev reloads reuse one process.
const g = globalThis as unknown as { __jarvisRemoteBroker?: BrokerModule | null };

/**
 * The launchable-app catalogue, so the panel can offer real choices for the
 * "welcome me back" scene without keeping its own copy of the list.
 */
function appCatalog(): Array<{ id: string; label: string }> {
  try {
    const mod = require("@/lib/os/apps.cjs") as { APPS: Record<string, { label: string }> };
    return Object.entries(mod.APPS).map(([id, a]) => ({ id, label: a.label }));
  } catch {
    return [];
  }
}

/** Make sure the LAN broker is listening before we ask it to ring the phone. */
function ensureBroker(): void {
  if (g.__jarvisRemoteBroker !== undefined) return;
  try {
    const mod = require("@/lib/os/remoteBroker.cjs") as BrokerModule;
    mod.startBroker();
    g.__jarvisRemoteBroker = mod;
  } catch {
    g.__jarvisRemoteBroker = null;
  }
}

// GET /api/proximity        → cached live sweep
// GET /api/proximity?refresh=1 → force a fresh subnet sweep
export async function GET(req: NextRequest) {
  try {
    const refresh = req.nextUrl.searchParams.get("refresh") === "1";
    // A refresh kicks the sweep off in the background and answers immediately —
    // a /22 sweep takes ~20s, and blocking the request made the whole panel
    // feel stuck until it finished. Fresh devices arrive on the next poll.
    if (refresh) {
      // Defer slightly so this response can flush before the ICMP flood starts
      // competing for the event loop.
      setTimeout(() => void scan({ force: true }).catch(() => {}), 150);
    }
    const [result, remote] = await Promise.all([scan(), getRemoteStatus()]);
    return NextResponse.json({
      ...result,
      remote,
      apps: appCatalog(),
      sweeping: refresh || undefined,
      history: refresh ? getHistory() : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Proximity scan error", details: String(error) },
      { status: 500 }
    );
  }
}

// POST actions:
//   set-label   { id, label }
//   favorite    { id }
//   set-beacon  { id, kind: "mac" | "ip" }
//   config      { config: {...} }
//   rssi        { id, rssi }        — phone beacon reports a real radio reading
//   ping-phone                       — make the phone remote ring
//   refresh                          — force a sweep now
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? "");

    if (action === "set-label" && typeof body.id === "string") {
      setLabel(body.id, String(body.label ?? ""));
      return NextResponse.json({ success: true });
    }

    if (action === "favorite" && typeof body.id === "string") {
      const favorite = toggleFavorite(body.id);
      return NextResponse.json({ success: true, favorite });
    }

    if (action === "set-beacon" && typeof body.id === "string") {
      setBeacon(body.id, body.kind === "ip" ? "ip" : "mac");
      return NextResponse.json({ success: true, config: getConfig() });
    }

    if (action === "config" && body.config && typeof body.config === "object") {
      const config = updateConfig(body.config);
      return NextResponse.json({ success: true, config });
    }

    if (action === "rssi" && typeof body.id === "string") {
      setRssi(body.id, Number(body.rssi));
      return NextResponse.json({ success: true });
    }

    if (action === "ping-phone") {
      ensureBroker();
      const ringing = await ringPhone();
      const remote = await getRemoteStatus();
      return NextResponse.json({
        success: true,
        ringing,
        // "Sent" only means the PC raised it — phoneConnected says whether
        // anything is listening on the other end.
        phoneConnected: !!remote?.phoneConnected,
        message: ringing
          ? remote?.phoneConnected
            ? "Find-my-phone sent — your phone is connected and should be ringing"
            : "Ping raised, but no phone is connected to the remote. Open the remote URL on it."
          : "Phone remote is not reachable — open the QR remote page on the phone first",
      });
    }

    if (action === "refresh") {
      const result = await scan({ force: true });
      return NextResponse.json({ ...result, history: getHistory() });
    }

    if (action === "history") {
      return NextResponse.json({ success: true, history: getHistory() });
    }

    return NextResponse.json({ success: false, error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "Failed to update proximity", details: String(error) },
      { status: 500 }
    );
  }
}
