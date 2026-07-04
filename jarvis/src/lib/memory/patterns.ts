// Tier 1C — Pattern-of-life observability.
// Reads the MemoryEvent stream and surfaces "I've noticed" insights.
//
// This is observability only in v2 — no auto-actions. The agent layer
// (Tier 2) reads these patterns when the user opts in to proactive mode.

import { prisma } from "@/lib/db/queries";

export interface Pattern {
  id: string;
  category: "search" | "panel" | "contact" | "time" | "frequency";
  text: string;
  confidence: number; // 0-1 — higher = more occurrences
  sampleCount: number;
  lastSeenAt: Date;
}

interface SearchEvent {
  q?: string;
  panel?: string;
}

interface PanelEvent {
  panel: string;
  openedAt: string;
  closedAt?: string;
}

interface ContactEvent {
  name?: string;
  platform?: string;
}

type EventPayload = SearchEvent | PanelEvent | ContactEvent | Record<string, unknown>;

const PATTERN_LOOKBACK_DAYS = 14;
const MIN_SAMPLES = 3; // need at least 3 occurrences to surface a pattern
const TOP_N = 5;

/**
 * Aggregate events from the last N days into patterns.
 */
export async function detectPatterns(opts?: {
  lookbackDays?: number;
  minSamples?: number;
}): Promise<Pattern[]> {
  const lookbackDays = opts?.lookbackDays ?? PATTERN_LOOKBACK_DAYS;
  const minSamples = opts?.minSamples ?? MIN_SAMPLES;

  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const events = await prisma.memoryEvent.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 5000, // hard cap; patterns only need a sample
  });

  const patterns: Pattern[] = [];

  patterns.push(...detectSearchPatterns(events, minSamples));
  patterns.push(...detectPanelPatterns(events, minSamples));
  patterns.push(...detectTimeOfDayPatterns(events, minSamples));
  patterns.push(...detectContactPatterns(events, minSamples));

  // Sort by confidence * sampleCount, take top N.
  patterns.sort(
    (a, b) =>
      b.confidence * b.sampleCount - a.confidence * a.sampleCount
  );
  return patterns.slice(0, TOP_N);
}

function safePayload(raw: string): EventPayload {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function detectSearchPatterns(
  events: Array<{ kind: string; payload: string; createdAt: Date }>,
  minSamples: number
): Pattern[] {
  const counts = new Map<string, { n: number; lastAt: Date }>();
  for (const e of events) {
    // Treat explicit "search" and chat queries the same way for pattern purposes.
    if (e.kind !== "search" && e.kind !== "chat") continue;
    const p = safePayload(e.payload) as SearchEvent;
    const q = (p.q || (p as any).query || "").trim().toLowerCase();
    if (!q || q.length < 2) continue;
    const existing = counts.get(q);
    if (existing) {
      existing.n++;
      if (e.createdAt > existing.lastAt) existing.lastAt = e.createdAt;
    } else {
      counts.set(q, { n: 1, lastAt: e.createdAt });
    }
  }

  const out: Pattern[] = [];
  for (const [q, agg] of Array.from(counts.entries())) {
    const { n, lastAt } = agg;
    if (n < minSamples) continue;
    out.push({
      id: `search:${q}`,
      category: "search",
      text: `"${q}" has come up ${n} times recently`,
      confidence: Math.min(1, n / 10),
      sampleCount: n,
      lastSeenAt: lastAt,
    });
  }
  return out;
}

function detectPanelPatterns(
  events: Array<{ kind: string; payload: string; createdAt: Date }>,
  minSamples: number
): Pattern[] {
  const counts = new Map<string, { n: number; lastAt: Date }>();
  for (const e of events) {
    if (e.kind !== "panel") continue;
    const p = safePayload(e.payload) as PanelEvent;
    if (!p.panel) continue;
    const existing = counts.get(p.panel);
    if (existing) {
      existing.n++;
      if (e.createdAt > existing.lastAt) existing.lastAt = e.createdAt;
    } else {
      counts.set(p.panel, { n: 1, lastAt: e.createdAt });
    }
  }

  const out: Pattern[] = [];
  for (const [panel, agg] of Array.from(counts.entries())) {
    const { n, lastAt } = agg;
    if (n < minSamples) continue;
    out.push({
      id: `panel:${panel}`,
      category: "panel",
      text: `You opened ${panel} ${n} times recently`,
      confidence: Math.min(1, n / 12),
      sampleCount: n,
      lastSeenAt: lastAt,
    });
  }
  return out;
}

function detectTimeOfDayPatterns(
  events: Array<{ kind: string; payload: string; createdAt: Date }>,
  minSamples: number
): Pattern[] {
  // For "panel", "search", and "chat" events, find dominant hour bucket.
  const buckets = new Map<string, Map<number, number>>(); // kind → (hour → count)
  const lastSeen = new Map<string, Date>();

  for (const e of events) {
    if (e.kind !== "panel" && e.kind !== "search" && e.kind !== "chat") continue;
    const hour = e.createdAt.getHours();
    let m = buckets.get(e.kind);
    if (!m) {
      m = new Map();
      buckets.set(e.kind, m);
    }
    m.set(hour, (m.get(hour) ?? 0) + 1);
    const key = `${e.kind}:${hour}`;
    const prev = lastSeen.get(key);
    if (!prev || e.createdAt > prev) lastSeen.set(key, e.createdAt);
  }

  const out: Pattern[] = [];
  for (const [kind, hours] of Array.from(buckets.entries())) {
    // Find dominant hour bucket
    const sorted: Array<[number, number]> = Array.from(hours.entries()).sort(
      (a: [number, number], b: [number, number]) => b[1] - a[1]
    );
    const top = sorted[0];
    if (!top || top[1] < minSamples) continue;
    const hour: number = top[0];
    const n: number = top[1];
    const phase = hourOfDayToPhase(hour);
    const label =
      kind === "chat"
        ? "messages"
        : kind === "search"
          ? "queries"
          : "panels";
    out.push({
      id: `time:${kind}:${hour}`,
      category: "time",
      text: `Most of your ${label} come in during the ${phase} (${n}× recently)`,
      confidence: Math.min(1, n / 15),
      sampleCount: n,
      lastSeenAt: lastSeen.get(`${kind}:${hour}`) ?? new Date(),
    });
  }
  return out;
}

function detectContactPatterns(
  events: Array<{ kind: string; payload: string; createdAt: Date }>,
  minSamples: number
): Pattern[] {
  const counts = new Map<string, { n: number; lastAt: Date }>();
  for (const e of events) {
    if (e.kind !== "contact") continue;
    const p = safePayload(e.payload) as ContactEvent;
    const name = (p.name || "").trim();
    if (!name) continue;
    const key = p.platform ? `${name}@${p.platform}` : name;
    const existing = counts.get(key);
    if (existing) {
      existing.n++;
      if (e.createdAt > existing.lastAt) existing.lastAt = e.createdAt;
    } else {
      counts.set(key, { n: 1, lastAt: e.createdAt });
    }
  }

  const out: Pattern[] = [];
  for (const [name, agg] of Array.from(counts.entries())) {
    const { n, lastAt } = agg;
    if (n < minSamples) continue;
    out.push({
      id: `contact:${name}`,
      category: "contact",
      text: `You contacted ${name} ${n} times recently`,
      confidence: Math.min(1, n / 8),
      sampleCount: n,
      lastSeenAt: lastAt,
    });
  }
  return out;
}

function hourOfDayToPhase(hour: number): string {
  if (hour < 6) return "wee hours";
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  if (hour < 22) return "evening";
  return "night";
}

/**
 * Record a single event. Fire-and-forget — never throws to the caller.
 */
export async function recordEvent(
  kind: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.memoryEvent.create({
      data: {
        kind,
        payload: JSON.stringify(payload),
      },
    });
  } catch (err) {
    // Pattern observation is best-effort. Never block the caller.
    console.warn("[Patterns] recordEvent failed:", err);
  }
}