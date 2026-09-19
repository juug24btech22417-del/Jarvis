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
