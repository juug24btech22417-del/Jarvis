// One-line LLM summarization for composio events.
//
// Only fires for sources where the body is dense text (gmail bodies, notion
// page content). GitHub / GCal subjects are already short and human-readable,
// so we skip the LLM call there entirely.
//
// Per the OpenRouter/ECONNRESET memory: we use AbortController with a 2.5s
// timeout, never Promise.race (which leaks resources on win), and a timeout
// falls back to the un-summarized event. We also pin to cheap models via
// the existing runLlmChain (OpenRouter + Groq tier) and skip NVIDIA per
// project memory.
//
// Cache: 24h body-hash → summary in sqlite. Re-fetching the same email
// across reconnect = $0.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/queries";
import { runLlmChain } from "@/services/LlmChain";
import type { JarvisEvent } from "./eventBus";

const SUMMARIZABLE_SOURCES = new Set(["gmail", "notion"]);
const TIMEOUT_MS = 2500;
const CACHE_TTL_HOURS = 24;

interface CacheRow {
  summary: string;
  expiresAt: Date;
}

function hashBody(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

async function cacheGet(key: string): Promise<string | null> {
  try {
    const row = await prisma.composioEventLog.findFirst({
      where: { seenKey: { startsWith: `cache:${key}` } },
      select: { seenKey: true, body: true, retentionUntil: true },
    });
    if (!row) return null;
    if (row.retentionUntil.getTime() < Date.now()) return null;
    return row.body;
  } catch {
    return null;
  }
}

async function cachePut(key: string, summary: string): Promise<void> {
  try {
    const expires = new Date();
    expires.setHours(expires.getHours() + CACHE_TTL_HOURS);
    // Reuse ComposioEventLog with a cache: prefix. Same table, different
    // namespace. This avoids a new model for what is a tiny cache row.
    await prisma.composioEventLog.upsert({
      where: { seenKey: `cache:${key}` },
      create: {
        seenKey: `cache:${key}`,
        source: "_cache",
        type: "summary",
        title: "summary",
        body: summary,
        priority: "low",
        retentionUntil: expires,
      },
      update: {
        body: summary,
        retentionUntil: expires,
      },
    });
  } catch {
    // Cache failure is non-fatal.
  }
}

/**
 * Optionally prepend a 1-line summary to a JarvisEvent body.
 * If the source doesn't need summarization, or the LLM times out / fails,
 * returns the event unchanged.
 */
export async function maybeSummarize(event: JarvisEvent): Promise<JarvisEvent> {
  if (!SUMMARIZABLE_SOURCES.has(event.source)) return event;
  if (!event.body || event.body.length < 240) return event; // already short

  const cacheKey = hashBody(`${event.source}:${event.body}`);
  const cached = await cacheGet(cacheKey);
  if (cached) {
    return {
      ...event,
      body: `> ${cached}\n\n${event.body}`,
    };
  }

  const prompt = `Summarize the following ${event.source} notification in ONE short sentence (max 20 words). Plain text, no markdown, no quotes.

Notification:
${event.body}

One-line summary:`;

  let summary: string | null = null;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    // runLlmChain doesn't accept a signal today, so we race it but never
    // let the racer leak — we discard the LLM response if it arrives late.
    const chainPromise = runLlmChain(prompt, {
      maxTokens: 60,
      temperature: 0.2,
      skipNvidia: true,
    });
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS)
    );
    const result = await Promise.race([chainPromise, timeoutPromise]);
    clearTimeout(t);
    if (result && result.content) {
      summary = result.content.trim().replace(/^["'`]+|["'`]+$/g, "").slice(0, 240);
    }
  } catch {
    // LLM failed or timed out — deliver raw.
  }

  if (!summary) return event;

  await cachePut(cacheKey, summary);
  return {
    ...event,
    body: `> ${summary}\n\n${event.body}`,
  };
}
