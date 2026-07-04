// Knowledge Graph Library with AES-256 Encryption
// Manages entities and relationships for JARVIS long-term memory

import { prisma } from "@/lib/db/queries";
import { encryptWithKey, decryptWithKey, generateMasterKey } from "@/lib/security/encryption";
import { applyReinforcement, shouldArchive, ARCHIVE_THRESHOLD } from "./decay";

// Master key for encrypting graph metadata (in production, store this securely)
let MASTER_KEY: string | null = null;

async function getMasterKey(): Promise<string> {
  if (!MASTER_KEY) {
    // Check if we have a stored key
    const stored = typeof window !== "undefined" ? localStorage.getItem("jarvis_graph_master_key") : null;
    if (stored) {
      MASTER_KEY = stored;
    } else {
      MASTER_KEY = await generateMasterKey();
      if (typeof window !== "undefined") {
        localStorage.setItem("jarvis_graph_master_key", MASTER_KEY);
      }
    }
  }
  return MASTER_KEY;
}

// Entity types (SQLite uses strings)
export type EntityType =
  | "PERSON"
  | "COMPANY"
  | "PROJECT"
  | "CONCEPT"
  | "LOCATION"
  | "SKILL"
  | "PREFERENCE"
  | "EVENT";

export interface EntityData {
  name: string;
  type: EntityType | string;
  description?: string;
  category?: string;
  metadata?: Record<string, string>; // Unencrypted metadata like email, phone
  encryptedMetadata?: Record<string, string>; // Sensitive data to encrypt
}

export interface RelationshipData {
  sourceId: string;
  targetId: string;
  type: string; // works_at, client_of, knows_about, prefers, etc.
  strength?: number;
  metadata?: Record<string, string>;
  encryptedMetadata?: Record<string, string>;
}

export interface QueryOptions {
  limit?: number;
  includeTypes?: EntityType[];
  excludeTypes?: EntityType[];
}

/**
 * Add a new entity to the knowledge graph
 */
export async function addEntity(data: EntityData): Promise<string> {
  const masterKey = await getMasterKey();

  // Merge and encrypt sensitive metadata
  let metadataJson: string | null = null;
  const mergedMetadata: Record<string, string> = { ...(data.metadata || {}) };

  // Encrypt sensitive fields
  if (data.encryptedMetadata && Object.keys(data.encryptedMetadata).length > 0) {
    const encrypted = await encryptWithKey(JSON.stringify(data.encryptedMetadata), masterKey);
    mergedMetadata["_encrypted"] = JSON.stringify(encrypted);
  }

  if (Object.keys(mergedMetadata).length > 0) {
    metadataJson = JSON.stringify(mergedMetadata);
  }

  const entity = await prisma.entity.create({
    data: {
      name: data.name,
      type: data.type,
      description: data.description,
      metadata: metadataJson,
    },
  });

  return entity.id;
}

/**
 * Add a relationship between two entities
 */
export async function addRelationship(data: RelationshipData): Promise<string> {
  const masterKey = await getMasterKey();

  // Merge and encrypt sensitive metadata
  let metadataJson: string | null = null;
  const mergedMetadata: Record<string, string> = { ...(data.metadata || {}) };

  if (data.encryptedMetadata && Object.keys(data.encryptedMetadata).length > 0) {
    const encrypted = await encryptWithKey(JSON.stringify(data.encryptedMetadata), masterKey);
    mergedMetadata["_encrypted"] = JSON.stringify(encrypted);
  }

  if (Object.keys(mergedMetadata).length > 0) {
    metadataJson = JSON.stringify(mergedMetadata);
  }

  const relationship = await prisma.relationship.create({
    data: {
      sourceId: data.sourceId,
      targetId: data.targetId,
      type: data.type,
      strength: data.strength ?? 1.0,
      metadata: metadataJson,
    },
  });

  return relationship.id;
}

/**
 * Find an entity by name (case-insensitive)
 */
export async function findEntityByName(name: string): Promise<{ id: string; name: string; type: EntityType } | null> {
  const entity = await prisma.entity.findFirst({
    where: {
      name: {
        contains: name,
      },
    },
  });

  if (!entity) return null;

  return {
    id: entity.id,
    name: entity.name,
    type: entity.type as EntityType,
  };
}

/**
 * Get all relationships for an entity (both incoming and outgoing)
 */
export async function getEntityRelationships(
  entityId: string,
  options?: QueryOptions
): Promise<Array<{
  id: string;
  type: string;
  strength: number;
  source: { id: string; name: string; type: string };
  target: { id: string; name: string; type: string };
}>> {
  const relationships = await prisma.relationship.findMany({
    where: {
      OR: [{ sourceId: entityId }, { targetId: entityId }],
    },
    include: {
      source: true,
      target: true,
    },
    take: options?.limit,
  });

  return relationships.map((r) => ({
    id: r.id,
    type: r.type,
    strength: r.strength,
    source: { id: r.source.id, name: r.source.name, type: r.source.type },
    target: { id: r.target.id, name: r.target.name, type: r.target.type },
  }));
}

/**
 * Query entities by type
 */
export async function queryEntitiesByType(
  type: EntityType,
  options?: QueryOptions
): Promise<Array<{ id: string; name: string; type: string; description: string | null }>> {
  const entities = await prisma.entity.findMany({
    where: { type },
    take: options?.limit,
  });

  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
  }));
}

/**
 * Find entities connected to a given entity through relationships
 * Example: Find all companies where a person works
 *
 * Tier 1A: order results by relationship strength (strongest edges first),
 * and prune edges weaker than 0.2 (effectively forgotten).
 */
export async function findConnectedEntities(
  entityId: string,
  relationshipType?: string, // Filter by relationship type (e.g., "works_at")
  options?: QueryOptions
): Promise<Array<{
  id: string;
  name: string;
  type: string;
  relationship: string;
  relationshipStrength: number;
}>> {
  const where: Record<string, unknown> = {
    OR: [{ sourceId: entityId }, { targetId: entityId }],
    strength: { gte: 0.2 },
  };

  if (relationshipType) {
    where.type = relationshipType;
  }

  const relationships = await prisma.relationship.findMany({
    where,
    include: {
      source: true,
      target: true,
    },
    orderBy: { strength: "desc" },
    take: options?.limit,
  });

  return relationships
    .map((r) => {
      const isSource = r.sourceId === entityId;
      const connected = isSource ? r.target : r.source;
      return {
        id: connected.id,
        name: connected.name,
        type: connected.type,
        relationship: r.type,
        relationshipStrength: r.strength,
      };
    })
    .filter((e) => {
      if (options?.includeTypes && !options.includeTypes.includes(e.type as EntityType)) return false;
      if (options?.excludeTypes && options.excludeTypes.includes(e.type as EntityType)) return false;
      return true;
    });
}

/**
 * Traverse the graph from a starting entity (BFS)
 * Returns all entities within N hops
 *
 * Tier 1A: skip archived entities and edges with strength < 0.2.
 */
export async function traverseGraph(
  startEntityId: string,
  maxHops: number = 2
): Promise<Array<{
  id: string;
  name: string;
  type: string;
  description: string | null;
  hops: number;
  path: string[]; // Relationship types traversed
  strength: number;
  pinned: boolean;
}>> {
  const visited = new Set<string>([startEntityId]);
  const queue: Array<{ entityId: string; hops: number; path: string[] }> = [
    { entityId: startEntityId, hops: 0, path: [] },
  ];
  const results: Array<{ id: string; name: string; type: string; description: string | null; hops: number; path: string[]; strength: number; pinned: boolean }> = [];

  while (queue.length > 0) {
    const { entityId, hops, path } = queue.shift()!;

    if (hops > 0) {
      // Get entity details (skip archived)
      const entity = await prisma.entity.findUnique({
        where: { id: entityId },
      });
      if (entity && !entity.archived) {
        results.push({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          description: entity.description,
          hops,
          path,
          strength: entity.strength,
          pinned: entity.pinned,
        });
      } else if (!entity) {
        continue; // deleted entity, don't expand from it
      }
    }

    if (hops >= maxHops) continue;

    // Get all relationships for this entity, ordered by strength, pruned at threshold
    const relationships = await prisma.relationship.findMany({
      where: {
        OR: [{ sourceId: entityId }, { targetId: entityId }],
        strength: { gte: 0.2 },
      },
      include: {
        source: true,
        target: true,
      },
      orderBy: { strength: "desc" },
    });

    for (const rel of relationships) {
      const isSource = rel.sourceId === entityId;
      const connectedEntity = isSource ? rel.target : rel.source;
      const relationshipType = rel.type;

      if (!visited.has(connectedEntity.id)) {
        visited.add(connectedEntity.id);
        queue.push({
          entityId: connectedEntity.id,
          hops: hops + 1,
          path: [...path, relationshipType],
        });
      }
    }
  }

  return results;
}

/**
 * Get decrypted metadata for an entity
 */
export async function getDecryptedMetadata(entityId: string): Promise<Record<string, string> | null> {
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
  });

  if (!entity || !entity.metadata) return null;

  const metadata: Record<string, string> = JSON.parse(entity.metadata);
  const encryptedData = metadata["_encrypted"];

  if (!encryptedData) {
    delete metadata["_encrypted"];
    return metadata;
  }

  const masterKey = await getMasterKey();
  const encrypted: { encrypted: string; iv: string } = JSON.parse(encryptedData);
  const decrypted = await decryptWithKey(encrypted.encrypted, masterKey, encrypted.iv);
  const decryptedData: Record<string, string> = JSON.parse(decrypted);

  delete metadata["_encrypted"];
  return { ...metadata, ...decryptedData };
}

/**
 * Search entities by name (fuzzy match)
 *
 * Tier 1A: pin first, then by strength desc, then most recently accessed.
 * Archived entities are excluded.
 */
export async function searchEntities(query: string, limit: number = 10): Promise<Array<{
  id: string;
  name: string;
  type: string;
  description: string | null;
  strength: number;
  pinned: boolean;
}>> {
  const entities = await prisma.entity.findMany({
    where: {
      AND: [
        { archived: false },
        {
          OR: [
            { name: { contains: query } },
            { description: { contains: query } },
          ],
        },
      ],
    },
    orderBy: [
      { pinned: "desc" },
      { strength: "desc" },
      { lastAccessed: "desc" },
    ],
    take: limit,
  });

  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    strength: e.strength,
    pinned: e.pinned,
  }));
}

/**
 * Delete an entity and its relationships
 */
export async function deleteEntity(entityId: string): Promise<void> {
  await prisma.entity.delete({
    where: { id: entityId },
  });
}

/**
 * Delete a relationship
 */
export async function deleteRelationship(relationshipId: string): Promise<void> {
  await prisma.relationship.delete({
    where: { id: relationshipId },
  });
}

/**
 * Get graph statistics
 */
export async function getGraphStats(): Promise<{
  entityCount: number;
  relationshipCount: number;
  entitiesByType: Record<string, number>;
}> {
  const entityCount = await prisma.entity.count();
  const relationshipCount = await prisma.relationship.count();

  const entitiesByTypeRaw = await prisma.entity.groupBy({
    by: ["type"],
    _count: true,
  });

  const entitiesByType: Record<string, number> = {};
  entitiesByTypeRaw.forEach((row) => {
    entitiesByType[row.type] = (row._count as unknown as number) || 0;
  });

  return {
    entityCount,
    relationshipCount,
    entitiesByType,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tier 1A — Forgetting curve helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Reinforcement signal: bump a memory's base strength and lastAccessed.
 * Used by chat (after a successful retrieval), explicit thumbs-up, and Discuss.
 */
export async function bumpUsage(
  ids: string[],
  delta: number = 0.15
): Promise<{ updated: number }> {
  if (ids.length === 0) return { updated: 0 };

  // Fetch current so we can clamp per-row (SQLite can't clamp on UPDATE).
  const entities = await prisma.entity.findMany({
    where: { id: { in: ids } },
    select: { id: true, baseStrength: true },
  });

  const now = new Date();
  let updated = 0;

  // Sequential writes; small batch — keeps it simple. Switch to a transaction
  // if this becomes a hotspot.
  for (const e of entities) {
    const newBase = applyReinforcement(e.baseStrength, delta);
    await prisma.entity.update({
      where: { id: e.id },
      data: {
        baseStrength: newBase,
        strength: newBase, // bumped memories jump back to vivid immediately
        lastAccessed: now,
        accessCount: { increment: 1 },
      },
    });
    updated++;
  }

  return { updated };
}

/**
 * Pin / unpin a memory so it never decays and floats to the top of search.
 */
export async function pinEntity(id: string, pinned: boolean): Promise<void> {
  await prisma.entity.update({
    where: { id },
    data: { pinned },
  });
}

/**
 * Set the cue — a user-phrased question that should trigger this memory.
 * Helps future retrieval match user wording even when the entity name differs.
 */
export async function setCue(id: string, cue: string | null): Promise<void> {
  await prisma.entity.update({
    where: { id },
    data: { cue },
  });
}

/**
 * Walk every non-pinned entity and archive those whose strength has fallen
 * below ARCHIVE_THRESHOLD. Intended to be called on a cron / low-frequency
 * interval — not on every read.
 *
 * Returns counts so the caller can log/notify.
 */
export async function archiveStale(): Promise<{
  scanned: number;
  archived: number;
}> {
  const candidates = await prisma.entity.findMany({
    where: { pinned: false, archived: false },
    select: {
      id: true,
      baseStrength: true,
      lastAccessed: true,
      createdAt: true,
      pinned: true,
    },
  });

  const toArchive = candidates
    .filter((e) =>
      shouldArchive({
        baseStrength: e.baseStrength,
        lastAccessed: e.lastAccessed,
        createdAt: e.createdAt,
        pinned: e.pinned,
      })
    )
    .map((e) => e.id);

  if (toArchive.length > 0) {
    await prisma.entity.updateMany({
      where: { id: { in: toArchive } },
      data: { archived: true },
    });
  }

  return { scanned: candidates.length, archived: toArchive.length };
}

/**
 * One-shot recompute of every entity's cached `strength` field from
 * `baseStrength`, age, lastAccessed, and pinned. Call after batch operations
 * (imports, restores) or from a low-frequency cron.
 */
export async function recomputeAllStrengths(): Promise<{
  updated: number;
  archived: number;
}> {
  const entities = await prisma.entity.findMany({
    select: {
      id: true,
      baseStrength: true,
      lastAccessed: true,
      createdAt: true,
      pinned: true,
    },
  });

  let updated = 0;
  let archived = 0;
  const now = new Date();

  // Lazy import to break any cycle (decay is already imported above).
  const { computeStrength } = await import("./decay");

  for (const e of entities) {
    const s = computeStrength({
      baseStrength: e.baseStrength,
      lastAccessed: e.lastAccessed,
      createdAt: e.createdAt,
      pinned: e.pinned,
      now,
    });
    const shouldArchiveNow =
      !e.pinned && s < ARCHIVE_THRESHOLD;

    await prisma.entity.update({
      where: { id: e.id },
      data: {
        strength: s,
        archived: shouldArchiveNow,
      },
    });
    updated++;
    if (shouldArchiveNow) archived++;
  }

  return { updated, archived };
}

/**
 * Aggregate decay stats for the StatusHUD / Patterns surface.
 */
export async function getDecayStats(): Promise<{
  total: number;
  pinned: number;
  archived: number;
  byTier: { vivid: number; fresh: number; fading: number; dim: number };
  avgStrength: number;
}> {
  const all = await prisma.entity.findMany({
    select: { strength: true, pinned: true, archived: true },
  });

  const byTier = { vivid: 0, fresh: 0, fading: 0, dim: 0 };
  let pinned = 0;
  let archived = 0;
  let totalStrength = 0;

  for (const e of all) {
    if (e.pinned) pinned++;
    if (e.archived) {
      archived++;
      continue;
    }
    totalStrength += e.strength;
    if (e.strength >= 0.9) byTier.vivid++;
    else if (e.strength >= 0.6) byTier.fresh++;
    else if (e.strength >= 0.3) byTier.fading++;
    else byTier.dim++;
  }

  const active = all.length - archived;
  return {
    total: all.length,
    pinned,
    archived,
    byTier,
    avgStrength: active > 0 ? totalStrength / active : 0,
  };
}
