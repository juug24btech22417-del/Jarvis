// Memory Retriever - Fetches relevant memories for chat context
// Uses graph traversal and semantic search to find related information

import {
  findEntityByName,
  getEntityRelationships,
  findConnectedEntities,
  traverseGraph,
  searchEntities,
  queryEntitiesByType,
  getDecryptedMetadata,
  EntityType,
} from "./graph";

export interface MemoryContext {
  /** IDs of every entity that contributed to this context — for reinforcement. */
  entityIds: string[];
  entities: Array<{
    id: string;
    name: string;
    type: string;
    description: string | null;
    relationships: string[];
    strength: number;
    pinned: boolean;
  }>;
  preferences: string[];
  relevantFacts: string[];
}

// Stop words for keyword extraction
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
  "from", "as", "into", "through", "during", "before", "after", "above",
  "below", "between", "under", "again", "further", "then", "once", "here",
  "there", "when", "where", "why", "how", "all", "each", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own",
  "same", "so", "than", "too", "very", "just", "and", "but", "if", "or",
  "because", "until", "while", "although", "though", "i", "me", "my",
  "myself", "we", "our", "ours", "ourselves", "you", "your", "yours",
  "yourself", "yourselves", "he", "him", "his", "himself", "she", "her",
  "hers", "herself", "it", "its", "itself", "they", "them", "their",
  "theirs", "themselves", "what", "which", "who", "whom", "this", "that",
  "these", "those", "am",
]);

function relationshipStringsFor(
  entityId: string,
  name: string,
  rels: Array<{ type: string; source: { id: string; name: string }; target: { id: string; name: string } }>
): string[] {
  return rels.map((r) => {
    const isSource = r.source.id === entityId;
    const other = isSource ? r.target : r.source;
    return `${other.name} ${isSource ? r.type : reverseRelationship(r.type)} ${name}`;
  });
}

// ── Hot-path cache ────────────────────────────────────────────────
// The chat route calls this on every turn. A short TTL means a burst of
// messages (and the panel's own refreshes) reuse one graph read instead of
// hammering SQLite with the same handful of queries. Keyed by the normalized
// query; entity writes invalidate implicitly via the TTL.
const RETRIEVAL_TTL_MS = 20_000;
const RETRIEVAL_CACHE_MAX = 64;
const retrievalCache = new Map<string, { at: number; value: MemoryContext }>();

function cacheKey(query: string, maxEntities: number, maxHops: number, includePreferences: boolean): string {
  return `${query.toLowerCase().replace(/\s+/g, " ").trim()}|${maxEntities}|${maxHops}|${includePreferences ? 1 : 0}`;
}

/** Drop the retrieval cache (used after a memory write so the next turn is fresh). */
export function invalidateMemoryRetrievalCache(): void {
  retrievalCache.clear();
}

/**
 * Retrieve relevant memories based on a query.
 * Used to inject context into chat responses.
 *
 * Latency contract: every DB read is fired in PARALLEL and each one is
 * individually guarded, so a slow/dead query degrades to "fewer memories"
 * rather than serialising the whole turn. The old implementation awaited
 * search → relationships → preferences → traverse in sequence, which turned a
 * cold Prisma connection into a multi-second stall on every message.
 */
export async function retrieveRelevantMemories(
  query: string,
  options?: {
    maxEntities?: number;
    maxHops?: number;
    includePreferences?: boolean;
  }
): Promise<MemoryContext> {
  const maxEntities = options?.maxEntities ?? 10;
  const maxHops = options?.maxHops ?? 2;
  const includePreferences = options?.includePreferences ?? true;

  const key = cacheKey(query, maxEntities, maxHops, includePreferences);
  const cached = retrievalCache.get(key);
  if (cached && Date.now() - cached.at < RETRIEVAL_TTL_MS) return cached.value;

  const keywords = extractKeywords(query).slice(0, 8);

  const context: MemoryContext = {
    entityIds: [],
    entities: [],
    preferences: [],
    relevantFacts: [],
  };

  const foundEntities = new Map<string, MemoryContext["entities"][number]>();

  // Fire every independent read at once. Each is individually fail-soft so a
  // single bad query can never reject the whole Promise.all.
  const safe = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

  const [keywordHits, preferenceEntities, userEntity] = await Promise.all([
    Promise.all(keywords.map((k) => safe(searchEntities(k, 3), []))),
    includePreferences ? safe(queryEntitiesByType("PREFERENCE" as EntityType, { limit: maxEntities }), []) : Promise.resolve([]),
    safe(findEntityByName("User"), null),
  ]);

  // Reserve one slot for the User entity's neighbourhood so personal context
  // is never entirely crowded out by keyword hits.
  const keywordSlots = Math.max(1, maxEntities - (includePreferences ? 1 : 0));

  const seed: Array<{ id: string; name: string; type: string; description: string | null; strength: number; pinned: boolean; relLimit: number }> = [];
  for (const results of keywordHits) {
    for (const r of results) {
      if (foundEntities.has(r.name) || seed.some((s) => s.name === r.name)) continue;
      seed.push({ ...r, relLimit: 5 });
      if (seed.length >= keywordSlots) break;
    }
    if (seed.length >= keywordSlots) break;
  }

  // The user's own graph — one traversal, then its strongest neighbours are
  // appended only if there is room.
  if (userEntity) {
    const connected = await safe(traverseGraph(userEntity.id, maxHops), []);
    for (const entity of connected) {
      if (entity.type === "PREFERENCE") continue;
      if (foundEntities.has(entity.name) || seed.some((s) => s.name === entity.name)) continue;
      seed.push({
        id: entity.id,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        strength: entity.strength,
        pinned: entity.pinned,
        relLimit: 3,
      });
      if (seed.length >= maxEntities) break;
    }
  }

  // Relationships for every selected entity, in parallel.
  const relsPerSeed = await Promise.all(
    seed.map((s) => safe(getEntityRelationships(s.id, { limit: s.relLimit }), []))
  );
  seed.forEach((s, i) => {
    foundEntities.set(s.name, {
      id: s.id,
      name: s.name,
      type: s.type,
      description: s.description,
      relationships: relationshipStringsFor(s.id, s.name, relsPerSeed[i] as never),
      strength: s.strength,
      pinned: s.pinned,
    });
  });

  // Preferences: only the ones the User actually prefers.
  if (includePreferences && preferenceEntities.length > 0) {
    const prefRels = await Promise.all(
      preferenceEntities.map((p) => safe(getEntityRelationships(p.id, { limit: 5 }), []))
    );
    preferenceEntities.forEach((pref, i) => {
      for (const rel of prefRels[i] as Array<{ type: string; source: { name: string } }>) {
        if (rel.type === "prefers" && rel.source.name === "User") {
          context.preferences.push(pref.name);
          break;
        }
      }
    });
  }

  context.entities = Array.from(foundEntities.values()).slice(0, maxEntities);
  context.entityIds = context.entities.map((e) => e.id);
  context.relevantFacts = generateRelevantFacts(context);

  // Store a snapshot; evict oldest once the cap is hit.
  if (retrievalCache.size >= RETRIEVAL_CACHE_MAX) {
    const oldest = retrievalCache.keys().next().value;
    if (oldest !== undefined) retrievalCache.delete(oldest);
  }
  retrievalCache.set(key, { at: Date.now(), value: context });

  return context;
}

function extractKeywords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/);
  const keywords = words.filter((w) => !STOP_WORDS.has(w) && w.length > 2);
  const properNouns = query.match(/\b[A-Z][a-z]+\b/g) || [];
  return Array.from(new Set([...keywords, ...properNouns]));
}

function reverseRelationship(type: string): string {
  const reverses: Record<string, string> = {
    works_at: "employs",
    client_of: "has_client",
    knows_about: "is_known_by",
    prefers: "is_preferred_by",
    friend_of: "friend_of",
    located_in: "contains",
    interested_in: "interest_of",
    created: "created_by",
    owns: "owned_by",
    manages: "managed_by",
  };
  return reverses[type] || `has_${type}`;
}

function generateRelevantFacts(context: MemoryContext): string[] {
  const facts: string[] = [];

  for (const entity of context.entities) {
    if (entity.description) {
      facts.push(`${entity.name}: ${entity.description}`);
    }
    if (entity.relationships.length > 0) {
      facts.push(`${entity.name} is connected to: ${entity.relationships.slice(0, 3).join(", ")}`);
    }
  }

  if (context.preferences.length > 0) {
    facts.push(`User preferences: ${context.preferences.join(", ")}`);
  }

  return facts;
}

export function formatMemoryContextAsPrompt(context: MemoryContext): string {
  const parts: string[] = [];

  if (context.entities.length > 0) {
    const entityStrings = context.entities.map((e) => {
      let s = `- ${e.name} (${e.type})`;
      if (e.description) s += `: ${e.description}`;
      if (e.relationships.length > 0) s += ` [${e.relationships.slice(0, 2).join(", ")}]`;
      return s;
    });
    parts.push(`Known entities:\n${entityStrings.join("\n")}`);
  }

  if (context.preferences.length > 0) {
    parts.push(`User preferences: ${context.preferences.join(", ")}`);
  }

  if (context.relevantFacts.length > 0) {
    parts.push(`Relevant facts:\n${context.relevantFacts.map((f) => `- ${f}`).join("\n")}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `\n--- Knowledge Graph Context ---\n${parts.join("\n")}\n--- End Context ---\n`;
}

export async function getAllEntitiesByType(type: EntityType): Promise<Array<{
  id: string;
  name: string;
  type: string;
  description: string | null;
}>> {
  const { queryEntitiesByType } = await import("./graph");
  return queryEntitiesByType(type, { limit: 100 });
}

export async function quickEntityLookup(name: string): Promise<{
  id: string;
  name: string;
  type: string;
  description: string | null;
  metadata?: Record<string, string>;
} | null> {
  const entity = await findEntityByName(name);
  if (!entity) return null;

  const { prisma } = await import("@/lib/db/queries");
  const fullEntity = await prisma.entity.findUnique({
    where: { id: entity.id },
  });

  if (!fullEntity) return null;

  let metadata: Record<string, string> | undefined;
  if (fullEntity.metadata) {
    try {
      const decrypted = await getDecryptedMetadata(entity.id);
      metadata = decrypted || undefined;
    } catch {
      metadata = JSON.parse(fullEntity.metadata);
    }
  }

  return {
    id: fullEntity.id,
    name: fullEntity.name,
    type: fullEntity.type,
    description: fullEntity.description,
    metadata,
  };
}
