// Next.js instrumentation — runs once per server process start.
//
// Watcher heartbeat: browser watchers (price alerts etc.) must keep
// ticking even when the Browser Ops panel is closed. This interval
// calls the watcher check endpoint every 10 minutes, server-side, no
// UI required. Per-watcher interval guards inside the endpoint make
// duplicate ticks harmless.
//
// DB warmup: the first Prisma query after a cold start can take tens
// of seconds (engine spawn + schema check), which used to land right
// in the middle of the first chat message. We touch the DB in the
// background at boot instead, so a "whats up" at t+5s gets answered
// by an already-warm connection.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // ── Network resilience (installed before any request is served) ──
  // A transient DNS failure inside the Node process makes EVERY provider fail
  // at the same instant with `TypeError: fetch failed` — Groq, Gemini,
  // OpenRouter and NVIDIA together — which looks like "all models are down"
  // and reads as rate limiting, though the providers were never contacted.
  // Measured on this machine, curl reaches the same hosts successfully while
  // Node reports fetch failed, and the provider logs only ever printed
  // err.message (literally "fetch failed"), hiding the real code in err.cause.
  //   • ipv4first  — a broken IPv6 route is a common cause of Node-only connect
  //                  failures while curl's happy-eyeballs silently falls back.
  //   • fetch retry — a DNS blip is sub-second; one delayed retry clears it.
  // Imported dynamically so node-only modules stay out of the edge build.
  try {
    // IMPORTANT: do NOT write `import("node:dns")` here. This file is compiled
    // by webpack for the edge runtime as well, and a "node:" specifier fails the
    // build with UnhandledSchemeError — which 500s EVERY route sharing that
    // build. getBuiltinModule (Node 22.3+) resolves it at runtime instead, so
    // webpack never sees it. Confirmed on Node v24.
    const dns = (process as unknown as { getBuiltinModule?: (n: string) => any })
      .getBuiltinModule?.("dns");
    dns?.setDefaultResultOrder?.("ipv4first");
    // fetchRetry is an app-internal module using only web APIs, so this import
    // is bundler-safe.
    const { installFetchRetry } = await import("@/lib/net/fetchRetry");
    installFetchRetry();
    console.log("[NetGuard] ipv4first + global fetch retry installed");
  } catch (err) {
    console.warn("[NetGuard] install failed (non-fatal):", (err as Error)?.message);
  }

  // ── Audio meter warmup (fire-and-forget) ──
  // The music-reactive reactor polls /api/system/audio; the first poll used
  // to spawn a cold PowerShell/WASAPI meter process mid-session, so the
  // equalizer lagged several seconds behind the music after every server
  // restart. Touching the endpoint at boot (same pattern as the watcher
  // heartbeat — an HTTP self-call keeps node-only imports out of this file,
  // which webpack compiles for the edge runtime too) makes the first poll
  // instant.
  setTimeout(
    () =>
      void fetch("http://localhost:3000/api/system/audio")
        .then(() => console.log("[AudioMeterWarmup] meter warmed via API"))
        .catch(() => {
          /* non-fatal — the meter self-starts on the first real poll */
        }),
    4000
  );

  const tick = async () => {
    try {
      const res = await fetch("http://localhost:3000/api/browser/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      const data = await res.json().catch(() => null);
      if (data?.checked > 0) {
        console.log(`[WatcherHeartbeat] checked ${data.checked} watcher(s)`);
      }
    } catch {
      // Server warming up or restarting — next tick will catch it.
    }
  };

  // First tick shortly after boot, then every 10 minutes.
  setTimeout(tick, 15_000);
  setInterval(tick, 10 * 60_000);

  console.log("[WatcherHeartbeat] armed — watchers tick every 10 min, no panel needed");

  // ── Route compile warmup (dev only, fire-and-forget) ──
  // In dev, Next.js compiles each route on its FIRST request. A cold
  // /api/chat compile can take 10–20s, which used to land squarely on the
  // user's first message and blow past the client's timeout ("providers
  // stalled out"). Touching every heavy route at boot with a harmless GET
  // makes the first real request instant. In production these routes are
  // pre-built, so this is skipped entirely.
  if (process.env.NODE_ENV !== "production") {
    const base =
      process.env.INTERNAL_API_URL || `http://localhost:${process.env.PORT || 3000}`;
    const warmRoutes = [
      "/api/chat",
      "/api/intent",
      "/api/mcp",
      "/api/crm/dossier",
      "/api/task-agent/execute",
      "/api/explain",
      "/api/clipboard/capture",
      "/api/meeting/shadow",
      "/api/sentinel/analyze",
    ];
    setTimeout(() => {
      for (const r of warmRoutes) {
        // Wrong method on purpose: Next still compiles the route module, and
        // the handler never runs (405), so no model call is made.
        void fetch(`${base}${r}`, { method: "GET" }).catch(() => {});
      }
      console.log(`[RouteWarmup] warmed ${warmRoutes.length} routes`);
    }, 2500);
  }

  // ── Background DB warmup (fire-and-forget, never blocks boot) ──
  (async () => {
    const t0 = Date.now();
    try {
      const { prisma } = await import("@/lib/db/queries");
      await prisma.$queryRaw`SELECT 1`;
      // Touch the two tables chat reads so their plans/caches are hot.
      await Promise.allSettled([
        prisma.followUpThread.findMany({ take: 1 }),
        prisma.moodSample.findMany({ take: 1 }),
      ]);
      console.log(`[DBWarmup] warm in ${Date.now() - t0}ms`);
    } catch (err) {
      console.warn(`[DBWarmup] failed after ${Date.now() - t0}ms (non-fatal):`, (err as Error)?.message);
    }
  })();
}
