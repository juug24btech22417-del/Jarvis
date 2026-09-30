// Memory Extractor — turns what you say into knowledge-graph nodes and edges.
//
// Runs after every chat turn (deferred, so it never delays a reply). It reads
// the user's message plus a little context and extracts only DURABLE facts:
// people you mention, where you live, what you're building, what you prefer.
// Known entities are *upgraded* (description merged, strength refreshed,
// un-archived) rather than skipped, so the constellation keeps growing richer
// instead of filling up with near-duplicates.
//
// Uses the shared provider chain (Gemini → Groq → OpenRouter → NVIDIA), so it
// survives any single provider being down or rate limited.

import { agentLlm, parseJsonLoose } from "@/lib/agent/llm";
import { shouldExtract } from "./learn";
import {
  addEntity,
  findEntityExactly,
  reinforceEntity,
  upsertRelationship,
  type EntityType,
} from "./graph";

export { shouldExtract };

const ENTITY_TYPES: EntityType[] = [
  "PERSON",
  "COMPANY",
  "PROJECT",
  "CONCEPT",
  "LOCATION",
  "SKILL",
  "PREFERENCE",
  "EVENT",
];

/** Trim an LLM string to something a node can hold. */
function clean(v: unknown, max = 120): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanType(v: unknown): EntityType | null {
  const t = clean(v, 24).toUpperCase();
  return (ENTITY_TYPES as string[]).includes(t) ? (t as EntityType) : null;
}

// Entity extraction prompt
const EXTRACTION_PROMPT = `You are the long-term memory of JARVIS, a personal AI assistant.
Read the user's latest message (plus a little context) and extract the DURABLE facts worth remembering for months.

Return ONLY JSON:
{
  "entities": [{"name": string, "type": "PERSON|COMPANY|PROJECT|CONCEPT|LOCATION|SKILL|PREFERENCE|EVENT", "description": string}],
  "relationships": [{"source": string, "target": string, "type": string}]
}

What to extract:
1. People the user mentions (friends, family, classmates, colleagues) as PERSON.
2. Personal facts about the user: their name, city, college, employer, health, relationships, goals, deadlines, habits, likes and dislikes.
3. Companies/organisations as COMPANY, projects/products as PROJECT, topics as CONCEPT, places as LOCATION, abilities as SKILL, tastes as PREFERENCE, dated happenings as EVENT.
4. Anything the user explicitly asks you to remember ("remember that …", "note that …").

How to write:
- description = ONE short sentence stating the durable fact in third person, e.g. "Ananya is Dhruv's sister", "Dhruv studies computer science at RV College", "Dhruv's deadline for the DBMS project is 12 October".
- Always create a "User" entity for facts about the user and relate it (lives_in, studies_at, works_at, owns, prefers, knows, friend_of, sibling_of, …).
- If the fact refines something already listed under Known context, reuse that exact name so it updates instead of duplicating.

Never extract:
- greetings, small talk, questions, or one-off commands ("open youtube", "set a timer"),
- transient state (the weather, today's prices, what's on screen),
- passwords, OTPs, card or account numbers, API keys, or anything the user marks private.

If nothing durable was said, return {"entities": [], "relationships": []}.

Return ONLY the JSON, no explanation.`;

interface ExtractedEntity {
  name: string;
  type: EntityType;
  description?: string;
  metadata?: Record<string, string>;
}

interface ExtractedRelationship {
  source: string;
  target: string;
  type: string;
}

interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
}

/**
 * Extract entities and relationships from a conversation message.
 * Never throws — an unreachable model simply yields nothing to learn.
 */
export async function extractMemoriesFromMessage(
  message: string,
  context?: string,
  known?: string
): Promise<ExtractionResult> {
  const text = (message || "").trim().slice(0, 4000);
  if (!text) return { entities: [], relationships: [] };

  const user = [
    context ? `Conversation context:\n${context.slice(0, 1200)}` : "",
    known ? `Known context (reuse these exact names when they match):\n${known.slice(0, 800)}` : "",
    `User's latest message:\n${text}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const raw = await agentLlm({
      system: EXTRACTION_PROMPT,
      user,
      maxTokens: 900,
      temperature: 0.2,
      timeoutMs: 14_000,
      label: "memory",
      json: true,
    });
    const parsed = parseJsonLoose<{ entities?: unknown; relationships?: unknown }>(raw);
    if (!parsed) {
      console.warn("[MemoryExtractor] Could not parse extraction JSON");
      return { entities: [], relationships: [] };
    }

    const entities: ExtractedEntity[] = (Array.isArray(parsed.entities) ? parsed.entities : [])
      .map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        const name = clean(o.name, 80);
        const type = cleanType(o.type);
        if (!name || !type) return null;
        const description = clean(o.description, 400);
        return { name, type, ...(description ? { description } : {}) };
      })
      .filter((e): e is ExtractedEntity => e !== null)
      .slice(0, 12);

    const relationships: ExtractedRelationship[] = (Array.isArray(parsed.relationships) ? parsed.relationships : [])
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        const source = clean(o.source, 80);
        const target = clean(o.target, 80);
        const type = clean(o.type, 40).toLowerCase().replace(/\s+/g, "_");
        if (!source || !target || !type || source.toLowerCase() === target.toLowerCase()) return null;
        return { source, target, type };
      })
      .filter((r): r is ExtractedRelationship => r !== null)
      .slice(0, 16);

    return { entities, relationships };
  } catch (error) {
    console.warn("[MemoryExtractor] Extraction skipped:", (error as Error)?.message?.slice(0, 140));
    return { entities: [], relationships: [] };
  }
}

/**
 * Process extracted entities and add them to the knowledge graph.
 *
 * Known names are upgraded in place: the description learns the new nuance,
 * the memory gets stronger and more recently recalled, and a forgotten one is
 * brought back. Relationships are upserted so repeating a fact deepens an edge
 * instead of duplicating it.
 */
export async function processExtraction(extraction: ExtractionResult): Promise<{
  created: string[];
  updated: string[];
  links: string[];
  skipped: string[];
}> {
  const created: string[] = [];
  const updated: string[] = [];
  const links: string[] = [];
  const skipped: string[] = [];
  const ids = new Map<string, string>(); // name(lower) -> entityId

  const resolve = async (name: string): Promise<string | null> => {
    const key = clean(name, 80).toLowerCase();
    if (!key) return null;
    if (ids.has(key)) return ids.get(key)!;
    const found = await findEntityExactly(name).catch(() => null);
    if (found) {
      ids.set(key, found.id);
      return found.id;
    }
    return null;
  };

  for (const entity of extraction.entities) {
    try {
      const existingId = await resolve(entity.name);
      if (existingId) {
        const res = await reinforceEntity(existingId, { description: entity.description, type: entity.type });
        (res.updated ? updated : skipped).push(entity.name);
      } else {
        const id = await addEntity({
          name: entity.name,
          type: entity.type,
          description: entity.description,
        });
        ids.set(entity.name.toLowerCase(), id);
        created.push(entity.name);
      }
    } catch (error) {
      console.error("[MemoryExtractor] Failed to store entity:", entity.name, error);
      skipped.push(entity.name);
    }
  }

  for (const rel of extraction.relationships) {
    try {
      const sourceId = await resolve(rel.source);
      const targetId = await resolve(rel.target);
      if (!sourceId || !targetId || sourceId === targetId) {
        skipped.push(`${rel.source} -> ${rel.target}`);
        continue;
      }
      await upsertRelationship({ sourceId, targetId, type: rel.type });
      links.push(`${rel.source} -> ${rel.type} -> ${rel.target}`);
    } catch (error) {
      console.error("[MemoryExtractor] Failed to store relationship:", rel, error);
      skipped.push(`${rel.source} -> ${rel.target}`);
    }
  }

  return { created, updated, links, skipped };
}

/**
 * High-level function: extract and store memories from a user message.
 * Called (deferred) after every chat turn, so the graph upgrades itself from
 * conversation — mention a person or a personal detail and it lands here.
 */
export async function extractAndStoreMemories(
  userMessage: string,
  conversationContext?: string,
  knownContext?: string
): Promise<{
  success: boolean;
  addedEntities: string[];
  addedRelationships: string[];
  updatedEntities: string[];
  message?: string;
}> {
  const empty = { success: true, addedEntities: [], addedRelationships: [], updatedEntities: [] };

  if (!shouldExtract(userMessage)) {
    return { ...empty, message: "Nothing durable to learn" };
  }

  const extraction = await extractMemoriesFromMessage(userMessage, conversationContext, knownContext);
  if (extraction.entities.length === 0 && extraction.relationships.length === 0) {
    return { ...empty, message: "No new information to learn" };
  }

  const result = await processExtraction(extraction);

  if (result.created.length + result.updated.length + result.links.length === 0) {
    return { ...empty, message: "Information already known" };
  }

  console.log(
    `[MemoryExtractor] learned ${result.created.length} new, upgraded ${result.updated.length}, linked ${result.links.length}`
  );

  const parts: string[] = [];
  if (result.created.length) parts.push(`Learned ${result.created.length} new fact(s): ${result.created.join(", ")}`);
  if (result.updated.length) parts.push(`Sharpened ${result.updated.length} known memory(ies)`);
  if (result.links.length) parts.push(`${result.links.length} new connection(s)`);

  return {
    success: true,
    addedEntities: result.created,
    addedRelationships: result.links,
    updatedEntities: result.updated,
    message: parts.join(" · ") || "Nothing to change",
  };
}

/**
 * Extract a specific preference from a user statement.
 * Example: "I prefer dark mode" -> PREFERENCE entity owned by User.
 */
export async function extractPreference(
  statement: string
): Promise<{ success: boolean; entityId?: string; message?: string }> {
  const text = (statement || "").trim();
  if (!text) return { success: false, message: "Nothing to extract" };

  try {
    const raw = await agentLlm({
      system:
        'Extract the user\'s durable preference from the statement. Return ONLY JSON: {"preference": string, "category": "ui|behavior|content|other"}. If there is no clear preference, return {"preference": ""}.',
      user: text.slice(0, 600),
      maxTokens: 200,
      temperature: 0.1,
      timeoutMs: 10_000,
      label: "memory-preference",
      json: true,
    });
    const parsed = parseJsonLoose<{ preference?: unknown; category?: unknown }>(raw);
    const preference = clean(parsed?.preference, 80);
    if (!preference) return { success: false, message: "No preference found" };

    let userId = await findEntityExactly("User");
    if (!userId) {
      userId = {
        id: await addEntity({ name: "User", type: "PERSON", description: "The user of JARVIS" }),
        name: "User",
        type: "PERSON" as EntityType,
      };
    }

    const existing = await findEntityExactly(preference);
    const preferenceId = existing
      ? existing.id
      : await addEntity({
          name: preference,
          type: "PREFERENCE",
          description: `The user prefers ${preference}`,
          metadata: { category: clean(parsed?.category, 24) || "other" },
        });

    await upsertRelationship({ sourceId: userId.id, targetId: preferenceId, type: "prefers" });
    return { success: true, entityId: preferenceId, message: `Remembered: user prefers ${preference}` };
  } catch (error) {
    console.warn("[MemoryExtractor] Preference extraction failed:", (error as Error)?.message?.slice(0, 120));
    return { success: false, message: "Failed to extract preference" };
  }
}
