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
