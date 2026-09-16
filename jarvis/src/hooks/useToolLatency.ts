"use client";

/**
 * useToolLatency — lightweight tool-health probe for the diagnostics HUD.
 *
 * Pings a handful of lightweight endpoints on a slow cadence (45s), records
 * round-trip times, and keeps a rolling EMA so the bars feel stable instead
 * of jittering with each sample. Unreachable tools report null → rendered
 * as "offline", not as a fast time.
 *
 * Deliberately NOT a hard health-check: each probe hits a cheap endpoint
 * (or the tool's base route with a tiny timeout) purely to measure reach +
 * latency. Failures decay smoothly to offline rather than snapping.
 */

import { useState, useEffect, useRef } from "react";

export interface ToolLatency {
  id: string;
  label: string;
  color: string;
  /** Smoothed round-trip time in ms. null = offline/unreachable. */
  latency: number | null;
}

/** EMA factor — lower = smoother bars. */
const EMA = 0.35;
const INTERVAL_MS = 45_000;
const PROBE_TIMEOUT_MS = 8_000;

const TOOLS: Array<{ id: string; label: string; color: string; probe: string }> = [
  { id: "vision",    label: "VISION",     color: "#8FDDB8", probe: "/api/os" },
  { id: "playwright",label: "PLAYWRIGHT", color: "#9BB8E8", probe: "/api/playwright" },
  { id: "firecrawl", label: "FIRECRAWL",  color: "#E8B98A", probe: "/api/firecrawl" },
  { id: "composio",  label: "COMPOSIO",   color: "#F0A8C0", probe: "/api/composio" },
  { id: "memory",    label: "MEMORY",     color: "#B8A8E8", probe: "/api/memories" },
];

export function useToolLatency(): ToolLatency[] {
  const [tools, setTools] = useState<ToolLatency[]>(
    TOOLS.map(({ id, label, color }) => ({ id, label, color, latency: null }))
  );
  const emaRef = useRef<Record<string, number | null>>({});

  useEffect(() => {
    let cancelled = false;

    const probe = async (url: string): Promise<number | null> => {
      const t0 = performance.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
        await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        return Math.round(performance.now() - t0);
      } catch {
        return null;
      }
    };

    const tick = async () => {
      const results = await Promise.all(
        TOOLS.map(async ({ id, probe: url }) => ({ id, ms: await probe(url) }))
      );
      if (cancelled) return;

      for (const { id, ms } of results) {
        const prev = emaRef.current[id] ?? null;
        emaRef.current[id] =
          ms === null
            ? prev === null
              ? null
              : Math.round(prev + (0 - prev) * EMA) <= 1
                ? null // decayed to zero → offline
                : Math.round(prev + (0 - prev) * EMA)
            : prev === null
              ? ms
              : Math.round(prev + (ms - prev) * EMA);
      }

      setTools((prevTools) =>
        prevTools.map((t) => ({
          ...t,
          latency: emaRef.current[t.id] ?? null,
        }))
      );
    };

    tick();
    const t = setInterval(tick, INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return tools;
}
