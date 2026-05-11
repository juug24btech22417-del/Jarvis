// Memory Retriever - Fetches relevant memories for chat context
// Uses graph traversal and semantic search to find related information

import {
  findEntityByName,
  getEntityRelationships,
  findConnectedEntities,
  traverseGraph,
  searchEntities,
  getDecryptedMetadata,
  EntityType,
} from "./graph";

export interface MemoryContext {
  entities: Array<{
    name: string;
    type: string;
    description: string | null;
    relationships: string[];
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

/**
 * Retrieve relevant memories based on a query
 * Used to inject context into chat responses
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

  const context: MemoryContext = {
    entities: [],
    preferences: [],
    relevantFacts: [],
  };

  const keywords = extractKeywords(query);
  const foundEntities = new Map<string, MemoryContext["entities"][number]>();

  for (const keyword of keywords) {
    if (foundEntities.size >= maxEntities) break;

    const results = await searchEntities(keyword, 3);
    for (const result of results) {
      if (foundEntities.has(result.name)) continue;

      const rels = await getEntityRelationships(result.id, { limit: 5 });
      const relationshipStrings = rels.map((r) => {
        const isSource = r.source.id === result.id;
        const other = isSource ? r.target : r.source;
        return `${other.name} ${isSource ? r.type : reverseRelationship(r.type)} ${result.name}`;
      });

      foundEntities.set(result.name, {
        name: result.name,
        type: result.type,
        description: result.description,
        relationships: relationshipStrings,
      });
    }
  }

  if (includePreferences) {
    const preferenceEntities = await searchEntities("", maxEntities);
    const preferences = preferenceEntities.filter((e) => e.type === "PREFERENCE");

    for (const pref of preferences) {
      const rels = await getEntityRelationships(pref.id, { limit: 5 });
      for (const rel of rels) {
        if (rel.type === "prefers" && rel.source.name === "User") {
          context.preferences.push(pref.name);
        }
      }
    }
  }

  const userEntity = await findEntityByName("User");
  if (userEntity) {
    const connected = await traverseGraph(userEntity.id, maxHops);
    for (const entity of connected.slice(0, maxEntities - foundEntities.size)) {
      if (foundEntities.has(entity.name)) continue;
      if (entity.type === "PREFERENCE") continue;

      const rels = await getEntityRelationships(entity.id, { limit: 3 });
      const relationshipStrings = rels.map((r) => {
        const isSource = r.source.id === entity.id;
        const other = isSource ? r.target : r.source;
        return `${other.name} ${isSource ? r.type : reverseRelationship(r.type)} ${entity.name}`;
      });

      foundEntities.set(entity.name, {
        name: entity.name,
        type: entity.type,
        description: entity.description,
        relationships: relationshipStrings,
      });
    }
  }

  context.entities = Array.from(foundEntities.values());
  context.relevantFacts = generateRelevantFacts(context);

  return context;
}

function extractKeywords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/);
  const keywords = words.filter((w) => !STOP_WORDS.has(w) && w.length > 2);
  const properNouns = query.match(/\b[A-Z][a-z]+\b/g) || [];
  return [...new Set([...keywords, ...properNouns])];
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

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const fullEntity = await prisma.entity.findUnique({
    where: { id: entity.id },
  });

  if (!fullEntity) return null;

  let metadata: Record<string, string> | undefined;
  if (fullEntity.metadata) {
    try {
      metadata = await getDecryptedMetadata(entity.id);
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
