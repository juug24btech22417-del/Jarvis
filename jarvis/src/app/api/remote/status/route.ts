import { NextResponse } from "next/server";
import os from "os";

// Phone-remote status — starts the LAN broker on demand and returns the
// URL that gets encoded into the QR code shown in PhoneRemotePanel.

type BrokerModule = {
  startBroker: () => Promise<{ port: number; ip: string } | null>;
  lanIP: () => string;
  PORT: number;
};

// Cache across invocations in dev (module scope survives route reloads
// within the same server process).
const g = globalThis as unknown as { __jarvisRemoteBroker?: BrokerModule | null };

function lanFallback() {
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}

export async function GET() {
  let broker = g.__jarvisRemoteBroker;
  if (broker === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("@/lib/os/remoteBroker.cjs") as BrokerModule;
      // Fire and forget — the broker is meant to stay up for the session.
      mod.startBroker();
      broker = mod;
      g.__jarvisRemoteBroker = broker;
    } catch (err) {
      return NextResponse.json(
        { success: false, error: "Broker unavailable", details: String(err) },
        { status: 503 }
      );
    }
  }

  if (!broker) {
    return NextResponse.json(
      { success: false, error: "Broker unavailable" },
      { status: 503 }
    );
  }

  const ip = broker.lanIP();
  return NextResponse.json({
    success: true,
    url: `http://${ip}:${broker.PORT}/remote`,
    host: os.hostname(),
  });
}
