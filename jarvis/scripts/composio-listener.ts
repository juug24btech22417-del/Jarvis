// Standalone runner for the composio trigger listener.
//
// Started as a sibling process by start-jarvis.bat alongside the Next dev
// server. Runs `runListener()` until SIGINT/SIGTERM.
//
// Loads .env.local manually because we're outside Next.js's runtime.
// DATABASE_URL is consumed by Prisma via process.env, so dotenv must
// run BEFORE any @/lib/db import is hit.

import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
loadEnv({ path: envPath });

async function main() {
  const { runListener, requestStop } = await import("../src/lib/composio/listener");

  // Graceful shutdown — wait up to 5s for in-flight delivery to finish.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[composio-listener] received ${signal}, shutting down...`);
    requestStop();
    setTimeout(() => {
      console.log("[composio-listener] forced exit after 5s timeout");
      process.exit(1);
    }, 5000).unref();
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await runListener();
  process.exit(0);
}

main().catch((e) => {
  console.error("[composio-listener] fatal:", e);
  process.exit(1);
});
