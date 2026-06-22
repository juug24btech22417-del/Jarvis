/**
 * ProxyMemory — Lightweight flat-file memory store for the JARVIS proxy.
 *
 * Why not Prisma/graph.ts?
 *   ProxyServer.ts runs inside the http-mitm-proxy process which cannot
 *   safely import Prisma (no Next.js request context, different module
 *   resolution). Instead we persist memories to a simple JSON file that
 *   both the proxy AND the Next.js API layer can read/write.
 *
 * File location:  <project-root>/.jarvis-memory.json
 * Structure:
 *   {
 *     "facts": [{ "text": "...", "ts": 1234567890, "source": "proxy" }],
 *     "preferences": { "key": "value" },
 *     "recentTopics": ["topic1", "topic2"]
 *   }
 */

import fs from "fs";
import path from "path";

const MEMORY_PATHS = [
  path.join(process.cwd(), ".jarvis-memory.json"),
  path.join(process.cwd(), "jarvis", ".jarvis-memory.json"),
  "c:\\Users\\dhruv\\Desktop\\Jarvis\\jarvis\\.jarvis-memory.json",
];

export interface MemoryStore {
  facts: Array<{ text: string; ts: number; source: string }>;
  preferences: Record<string, string>;
  recentTopics: string[];
}

const EMPTY_STORE: MemoryStore = { facts: [], preferences: {}, recentTopics: [] };

function resolveMemoryPath(): string {
  // Use the first path that already exists, else default to first candidate
  for (const p of MEMORY_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return MEMORY_PATHS[0];
}

export function loadMemory(): MemoryStore {
  try {
    const p = resolveMemoryPath();
    if (!fs.existsSync(p)) return { ...EMPTY_STORE, facts: [], preferences: {}, recentTopics: [] };
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw) as MemoryStore;
  } catch {
    return { ...EMPTY_STORE, facts: [], preferences: {}, recentTopics: [] };
  }
}

export function saveMemory(store: MemoryStore): void {
  try {
    const p = resolveMemoryPath();
    fs.writeFileSync(p, JSON.stringify(store, null, 2), "utf8");
  } catch (e) {
    console.error("[ProxyMemory] Failed to save memory:", e);
  }
}

// ─── Simple NLP extraction ─────────────────────────────────────────────────

const PREFERENCE_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /i (?:prefer|like|love|enjoy|use|always use)\s+(.+)/i, key: "preference" },
  { re: /my (?:name is|nickname is)\s+(.+)/i, key: "name" },
  { re: /i(?:'m| am) (?:a |an )?(.+)/i, key: "identity" },
  { re: /i work (?:at|for|in)\s+(.+)/i, key: "employer" },
  { re: /i(?:'m| am) (?:based|located|living) in\s+(.+)/i, key: "location" },
];

const FACT_PATTERNS: RegExp[] = [
  /(?:my|the) (?:project|app|site|product|startup|company) (?:is|called|named)\s+(.+)/i,
  /(?:jarvis|you) (?:should|must|need to) (?:remember|know) (?:that )?\s*(.+)/i,
  /(?:remember|note) (?:that )?\s*(.+)/i,
  /(?:don't forget)\s+(.+)/i,
];

/**
 * Extract new facts and preferences from a single conversation turn.
 * Returns them so the caller can decide whether to persist.
 */
export function extractMemoryFromTurn(
  userText: string,
  assistantText: string
): { facts: string[]; preferences: Record<string, string> } {
  const facts: string[] = [];
  const preferences: Record<string, string> = {};

  const combined = userText + " " + assistantText;

  for (const { re, key } of PREFERENCE_PATTERNS) {
    const m = userText.match(re);
    if (m && m[1]) {
      const val = m[1].replace(/[.!?]+$/, "").trim().slice(0, 120);
      if (val.length > 2) preferences[key] = val;
    }
  }

  for (const re of FACT_PATTERNS) {
    const m = userText.match(re);
    if (m && m[1]) {
      const fact = m[1].replace(/[.!?]+$/, "").trim().slice(0, 200);
      if (fact.length > 5) facts.push(fact);
    }
  }

  return { facts, preferences };
}

/**
 * Persist extracted memory into the flat JSON store.
 * Deduplicates facts by text similarity (exact match).
 */
export function persistMemory(
  extracted: ReturnType<typeof extractMemoryFromTurn>,
  source = "proxy"
): void {
  if (!extracted.facts.length && !Object.keys(extracted.preferences).length) return;

  const store = loadMemory();

  for (const fact of extracted.facts) {
    const alreadyKnown = store.facts.some((f) => f.text.toLowerCase() === fact.toLowerCase());
    if (!alreadyKnown) {
      store.facts.push({ text: fact, ts: Date.now(), source });
    }
  }

  for (const [k, v] of Object.entries(extracted.preferences)) {
    store.preferences[k] = v;
  }

  // Keep only the last 200 facts to avoid unbounded growth
  if (store.facts.length > 200) {
    store.facts = store.facts.slice(store.facts.length - 200);
  }

  saveMemory(store);
  console.log(`[ProxyMemory] Persisted ${extracted.facts.length} fact(s), ${Object.keys(extracted.preferences).length} preference(s)`);
}

/**
 * Build a compact memory context string to inject into the LLM system prompt.
 * Only surfaces the most relevant facts (recency + keyword overlap).
 */
export function buildMemoryContext(query: string, maxFacts = 8): string {
  const store = loadMemory();
  if (!store.facts.length && !Object.keys(store.preferences).length) return "";

  const queryWords = new Set(
    query.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  );

  // Score facts by keyword overlap with the query
  const scored = store.facts.map((f) => {
    const words = f.text.toLowerCase().split(/\W+/);
    const overlap = words.filter((w) => queryWords.has(w)).length;
    return { ...f, score: overlap * 10 + (f.ts / 1e12) }; // recency tie-break
  });

  scored.sort((a, b) => b.score - a.score);
  const topFacts = scored.slice(0, maxFacts).map((f) => `• ${f.text}`);

  const prefLines = Object.entries(store.preferences)
    .slice(0, 5)
    .map(([k, v]) => `• ${k}: ${v}`);

  const parts: string[] = [];
  if (prefLines.length) parts.push(`User preferences:\n${prefLines.join("\n")}`);
  if (topFacts.length) parts.push(`Remembered facts:\n${topFacts.join("\n")}`);

  return parts.join("\n\n");
}
