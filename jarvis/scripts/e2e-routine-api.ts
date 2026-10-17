// E2E: routine prediction through the real Next.js route and a real database.
//
// The unit tests drive predictRoutine() with synthetic actions. This drives the
// whole chain the app uses: MemoryEvent rows -> Prisma -> /api/memory/routine ->
// JSON, served by an actual `next dev` process.
//
// It runs against a THROWAWAY SQLite database on its own port, so it is
// deterministic and cannot touch the user's real pattern history. (The first
// version of this script seeded into dev.db, where 821 real "ask" events
// swamped the synthetic routine and — usefully — exposed a scoring bug the unit
// tests could not see. Keep the isolation: an e2e that depends on how much the
// user happens to have been typing is not a test.)
//
// Run with:  npm run e2e:routine

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const PORT = Number(process.env.JARVIS_E2E_PORT || 3011);
const BASE_URL = `http://localhost:${PORT}`;
/**
 * Isolated Next build output for the e2e's own dev server.
 *
 * Must be RELATIVE — Next joins `distDir` onto the project directory, so an
 * absolute path becomes `<project>\C:\Users\...` and the server dies with
 * ENOENT before it binds its port. It also has to stay out of the project's
 * own `.next`: two dev servers sharing one build directory corrupt each other's
 * webpack chunks, which is how a server ends up answering API routes while
 * returning 500 for every page.
 */
const DIST_DIR = ".next-e2e-routine";
const dir = mkdtempSync(join(tmpdir(), "jarvis-routine-e2e-"));
const dbFile = join(dir, "e2e.db");
const DATABASE_URL = `file:${dbFile.replace(/\\/g, "/")}`;

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

interface Prediction {
  key: string;
  label: string;
  probability: number;
  occurrences: number;
  meanMinuteOfDay: number;
  regularity: number;
  expectedAt: string;
  windowMinutes: number;
  minutesAway: number;
  sentence?: string;
}

function run(cmd: string, args: string[], env: Record<string, string> = {}): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      shell: true,
      stdio: "ignore",
    });
    child.on("exit", (code) => (code === 0 ? res() : rej(new Error(`${cmd} exited ${code}`))));
    child.on("error", rej);
  });
}

async function waitForServer(timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/memory/routine?limit=1`);
      if (res.status === 200) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** A day's worth of events at the given local time. */
function row(kind: string, payload: Record<string, unknown>, at: Date) {
  return { kind, payload: JSON.stringify(payload), createdAt: at };
}

function historyWith(days: number, build: (day: Date, add: (h: number, m: number, kind: string, p: Record<string, unknown>) => void) => void) {
  const rows: ReturnType<typeof row>[] = [];
  const now = new Date();
  for (let d = days; d >= 1; d--) {
    const day = new Date(now.getTime() - d * 86_400_000);
    const add = (h: number, m: number, kind: string, p: Record<string, unknown>) => {
      const at = new Date(day);
      at.setHours(h, m, 0, 0);
      rows.push(row(kind, p, at));
    };
    build(day, add);
  }
  return rows;
}

let server: ChildProcess | null = null;
let prisma: PrismaClient | null = null;

async function main() {
  console.log(`\nIsolated e2e database: ${dbFile}`);

  // ── Schema into the throwaway DB ────────────────────────────────────────
  await run("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
    DATABASE_URL,
  });
  console.log("  schema pushed");

  // ── A real Next dev server on that DB ───────────────────────────────────
  // JARVIS_DIST_DIR (see DIST_DIR) keeps this server's build output out of the
  // project's `.next`, so the e2e can run while the user's own dev server is
  // up. Sharing one build directory is what made that server answer API routes
  // while returning 500 for every page.
  server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL, JARVIS_DIST_DIR: DIST_DIR },
    shell: true,
    stdio: "ignore",
  });
  const up = await waitForServer();
  check("the app served the route on an empty database", up, "server never became ready");
  if (!up) throw new Error("dev server did not start");

  prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

  // ── Seed a real daily routine ───────────────────────────────────────────
  const rows = historyWith(21, (_day, add) => {
    add(9, 0, "panel", { panel: "spotify" });
    add(9, 5, "panel", { panel: "terminal" });
    add(18, 0, "contact", { name: "Ada", platform: "whatsapp" });
  });
  await prisma.memoryEvent.createMany({ data: rows });
  const inserted = await prisma.memoryEvent.count();
  check("history seeded", inserted === rows.length, `${inserted}/${rows.length}`);

  console.log("\nGET /api/memory/routine?limit=3&explain=1");
  const res = await fetch(`${BASE_URL}/api/memory/routine?limit=3&explain=1`);
  check("the route responds 200", res.status === 200, `${res.status}`);
  const body = (await res.json()) as { predictions: Prediction[]; sampleSize: number; next: Prediction | null };
  check("the sample size reflects the seeded rows", body.sampleSize === rows.length, `${body.sampleSize}`);
  const top = body.predictions[0];
  check("a routine was predicted from real DB rows", !!top, JSON.stringify(body).slice(0, 200));
  check("the morning panel is the top prediction", top?.key === "panel:spotify", top?.key);
  check("with a usable probability", (top?.probability ?? 0) > 0.4, `${top?.probability}`);
  check(
    "the learned time is 09:00",
    Math.min(Math.abs(540 - (top?.meanMinuteOfDay ?? 0)), 1440 - Math.abs(540 - (top?.meanMinuteOfDay ?? 0))) <= 10,
    `${top?.meanMinuteOfDay} min`
  );
  check("regularity reads the daily habit", (top?.regularity ?? 0) > 0.9, `${top?.regularity}`);
  check("the human sentence is included", /open spotify around 09:00/.test(top?.sentence ?? ""), top?.sentence);
  check("expectedAt serialises as a real date", !Number.isNaN(Date.parse(top?.expectedAt ?? "")), top?.expectedAt);
  check("the window is bounded and sane", (top?.windowMinutes ?? 0) >= 12 && (top?.windowMinutes ?? 0) <= 180, `${top?.windowMinutes}`);
  check(
    "the evening contact is also known",
    body.predictions.some((p) => p.key === "contact:ada@whatsapp"),
    body.predictions.map((p) => p.key).join(", ")
  );

  // ── The hour you ask about changes the answer ───────────────────────────
  console.log("\nGET /api/memory/routine?at=<today 18:00>");
  const evening = new Date();
  evening.setHours(18, 0, 0, 0);
  const resEvening = await fetch(
    `${BASE_URL}/api/memory/routine?limit=2&explain=1&at=${encodeURIComponent(evening.toISOString())}`
  );
  const bodyEvening = (await resEvening.json()) as { predictions: Prediction[] };
  check(
    "in the evening the contact is predicted instead",
    bodyEvening.predictions[0]?.key === "contact:ada@whatsapp",
    bodyEvening.predictions.map((p) => p.key).join(", ")
  );

  // ── The regression the real history exposed ─────────────────────────────
  console.log("\nThe ask-flood regression (what dev.db showed)");
  const flood = historyWith(21, (_day, add) => {
    for (let i = 0; i < 40; i++) add((7 + i) % 24, (i * 7) % 60, "search", { q: `question ${i}` });
  });
  await prisma.memoryEvent.createMany({ data: flood });
  const floodEvening = new Date();
  floodEvening.setHours(9, 0, 0, 0);
  const resFlood = await fetch(
    `${BASE_URL}/api/memory/routine?limit=3&explain=1&at=${encodeURIComponent(floodEvening.toISOString())}`
  );
  const bodyFlood = (await resFlood.json()) as { predictions: Prediction[] };
  const ranked = bodyFlood.predictions.map((p) => `${p.key}=${p.probability.toFixed(2)}`).join(", ");
  check(
    "840 generic asks do not bury the real routines",
    bodyFlood.predictions.length > 0 &&
      bodyFlood.predictions.every((p) => ["panel:spotify", "panel:terminal", "contact:ada@whatsapp"].includes(p.key)),
    ranked
  );
  check(
    "and no generic ask is ever recommended",
    bodyFlood.predictions.every((p) => p.key !== "ask"),
    ranked
  );
  const floodedSpotify = bodyFlood.predictions.find((p) => p.key === "panel:spotify");
  check(
    "the routine keeps its real time under the flood",
    !!floodedSpotify &&
      Math.min(Math.abs(540 - floodedSpotify.meanMinuteOfDay), 1440 - Math.abs(540 - floodedSpotify.meanMinuteOfDay)) <= 10,
    `mean=${floodedSpotify?.meanMinuteOfDay}`
  );
  check(
    "and stays as confident as it was without the flood",
    (floodedSpotify?.probability ?? 0) > 0.4,
    `${floodedSpotify?.probability}`
  );

  // ── Latency through the whole chain ────────────────────────────────────
  const t0 = performance.now();
  await fetch(`${BASE_URL}/api/memory/routine?limit=3&explain=1`);
  const ms = performance.now() - t0;
  const total = await prisma.memoryEvent.count();
  console.log(`\n  latency: ${ms.toFixed(0)}ms over ${total} rows through Prisma + HTTP + JSON`);
  check("the endpoint answers fast enough for a panel or briefing", ms < 1500, `${ms.toFixed(0)}ms`);
}

main()
  .catch((err) => {
    console.error("e2e routine harness crashed:", err);
    failed++;
  })
  .finally(async () => {
    try {
      await prisma?.$disconnect();
    } catch {
      /* ignore */
    }
    // Kill the dev server tree (Windows needs taskkill for the child tree).
    if (server?.pid) {
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          process.kill(-server.pid, "SIGTERM");
        }
      } catch {
        /* already gone */
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
    try {
      rmSync(dir, { recursive: true, force: true });
      // The isolated Next build output lives inside the project, so it is ours
      // to remove — leave no half-built `.next-e2e-routine` behind for the next
      // run to reuse.
      rmSync(DIST_DIR, { recursive: true, force: true });
      console.log(`Cleanup: removed the throwaway database at ${resolve(dir)}`);
      check("the throwaway database is gone", true);
    } catch (err) {
      console.error("Cleanup failed:", err);
      failed++;
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
