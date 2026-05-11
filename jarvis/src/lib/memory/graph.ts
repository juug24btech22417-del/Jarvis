// Knowledge Graph Library with AES-256 Encryption
// Manages entities and relationships for JARVIS long-term memory

import { PrismaClient } from "@prisma/client";
import { encryptWithKey, decryptWithKey, generateMasterKey } from "@/lib/security/encryption";

const prisma = new PrismaClient();

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
        mode: "insensitive",
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
}>> {
  const where: Record<string, unknown> = {
    OR: [{ sourceId: entityId }, { targetId: entityId }],
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
 */
export async function traverseGraph(
  startEntityId: string,
  maxHops: number = 2
): Promise<Array<{
  id: string;
  name: string;
  type: string;
  hops: number;
  path: string[]; // Relationship types traversed
}>> {
  const visited = new Set<string>([startEntityId]);
  const queue: Array<{ entityId: string; hops: number; path: string[] }> = [
    { entityId: startEntityId, hops: 0, path: [] },
  ];
  const results: Array<{ id: string; name: string; type: string; hops: number; path: string[] }> = [];

  while (queue.length > 0) {
    const { entityId, hops, path } = queue.shift()!;

    if (hops > 0) {
      // Get entity details
      const entity = await prisma.entity.findUnique({
        where: { id: entityId },
      });
      if (entity) {
        results.push({
          id: entity.id,
          name: entity.name,
          type: entity.type,
          hops,
          path,
        });
      }
    }

    if (hops >= maxHops) continue;

    // Get all relationships for this entity
    const relationships = await prisma.relationship.findMany({
      where: {
        OR: [{ sourceId: entityId }, { targetId: entityId }],
      },
      include: {
        source: true,
        target: true,
      },
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
 */
export async function searchEntities(query: string, limit: number = 10): Promise<Array<{
  id: string;
  name: string;
  type: string;
  description: string | null;
}>> {
  const entities = await prisma.entity.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    },
    take: limit,
  });

  return entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
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
