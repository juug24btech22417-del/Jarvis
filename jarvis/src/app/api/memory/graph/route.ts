// Knowledge Graph API - CRUD operations for entities and relationships
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import {
  addEntity,
  addRelationship,
  findEntityByName,
  getEntityRelationships,
  findConnectedEntities,
  traverseGraph,
  searchEntities,
  queryEntitiesByType,
  deleteEntity,
  deleteRelationship,
  getGraphStats,
  bumpUsage,
  pinEntity,
  setCue,
  archiveStale,
  recomputeAllStrengths,
  getDecayStats,
  EntityType,
} from "@/lib/memory/graph";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    // Get graph statistics
    if (action === "stats") {
      const stats = await getGraphStats();
      return NextResponse.json(stats);
    }

    // Search entities
    if (action === "search") {
      const query = searchParams.get("q") || "";
      const limit = parseInt(searchParams.get("limit") || "10");
      const results = await searchEntities(query, limit);
      return NextResponse.json({ results });
    }

    // Get entities by type
    if (action === "by-type") {
      const type = searchParams.get("type") as EntityType;
      const limit = parseInt(searchParams.get("limit") || "50");
      if (!type) {
        return NextResponse.json({ error: "type parameter required" }, { status: 400 });
      }
      const entities = await queryEntitiesByType(type, { limit });
      return NextResponse.json({ entities });
    }

    // Get entity by name
    if (action === "entity") {
      const name = searchParams.get("name") || "";
      if (!name) {
        return NextResponse.json({ error: "name parameter required" }, { status: 400 });
      }
      const entity = await findEntityByName(name);
      if (!entity) {
        return NextResponse.json({ error: "Entity not found" }, { status: 404 });
      }
      return NextResponse.json({ entity });
    }

    // Get relationships for an entity
    if (action === "relationships") {
      const entityId = searchParams.get("id") || "";
      const limit = parseInt(searchParams.get("limit") || "20");
      if (!entityId) {
        return NextResponse.json({ error: "id parameter required" }, { status: 400 });
      }
      const relationships = await getEntityRelationships(entityId, { limit });
      return NextResponse.json({ relationships });
    }

    // Find connected entities
    if (action === "connected") {
      const entityId = searchParams.get("id") || "";
      const relationshipType = searchParams.get("type") || undefined;
      if (!entityId) {
        return NextResponse.json({ error: "id parameter required" }, { status: 400 });
      }
      const connected = await findConnectedEntities(entityId, relationshipType, { limit: 20 });
      return NextResponse.json({ connected });
    }

    // Traverse graph from an entity
    if (action === "traverse") {
      const entityId = searchParams.get("id") || "";
      const maxHops = parseInt(searchParams.get("hops") || "2");
      if (!entityId) {
        return NextResponse.json({ error: "id parameter required" }, { status: 400 });
      }
      const results = await traverseGraph(entityId, maxHops);
      return NextResponse.json({ results });
    }

    // Tier 1A: decay stats (vivid / fresh / fading / dim / archived)
    if (action === "decay-stats") {
      const stats = await getDecayStats();
      return NextResponse.json(stats);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Graph API] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, entity, relationship, entityId, relationshipId } = body;

    // Add new entity
    if (action === "add-entity") {
      const { name, type, description, metadata, encryptedMetadata } = entity;
      if (!name || !type) {
        return NextResponse.json({ error: "name and type required" }, { status: 400 });
      }
      const id = await addEntity({ name, type, description, metadata, encryptedMetadata });
      return NextResponse.json({ success: true, id, message: `Entity "${name}" created` });
    }

    // Add relationship
    if (action === "add-relationship") {
      const { sourceId, targetId, type, strength, metadata, encryptedMetadata } = relationship;
      if (!sourceId || !targetId || !type) {
        return NextResponse.json({ error: "sourceId, targetId, and type required" }, { status: 400 });
      }
      const id = await addRelationship({ sourceId, targetId, type, strength, metadata, encryptedMetadata });
      return NextResponse.json({ success: true, id, message: `Relationship created` });
    }

    // Delete entity
    if (action === "delete-entity") {
      if (!entityId) {
        return NextResponse.json({ error: "entityId required" }, { status: 400 });
      }
      await deleteEntity(entityId);
      return NextResponse.json({ success: true, message: "Entity deleted" });
    }

    // Delete relationship
    if (action === "delete-relationship") {
      if (!relationshipId) {
        return NextResponse.json({ error: "relationshipId required" }, { status: 400 });
      }
      await deleteRelationship(relationshipId);
      return NextResponse.json({ success: true, message: "Relationship deleted" });
    }

    // Tier 1A: bulk reinforcement (used by chat after a successful retrieval)
    if (action === "bump-usage") {
      const { ids, delta } = body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: "ids array required" }, { status: 400 });
      }
      const result = await bumpUsage(ids, typeof delta === "number" ? delta : 0.15);
      return NextResponse.json({ success: true, ...result });
    }

    // Tier 1A: pin / unpin
    if (action === "pin") {
      const { id, pinned } = body;
      if (!id || typeof pinned !== "boolean") {
        return NextResponse.json({ error: "id and pinned required" }, { status: 400 });
      }
      await pinEntity(id, pinned);
      return NextResponse.json({ success: true });
    }

    // Tier 1A: set retrieval cue
    if (action === "set-cue") {
      const { id, cue } = body;
      if (!id) {
        return NextResponse.json({ error: "id required" }, { status: 400 });
      }
      await setCue(id, typeof cue === "string" ? cue : null);
      return NextResponse.json({ success: true });
    }

    // Tier 1A: archive a single entity
    if (action === "archive") {
      const { id } = body;
      if (!id) {
        return NextResponse.json({ error: "id required" }, { status: 400 });
      }
      await prisma.entity.update({
        where: { id },
        data: { archived: true },
      });
      return NextResponse.json({ success: true });
    }

    // Tier 1A: sweep all stale entities (intended for cron)
    if (action === "archive-stale") {
      const result = await archiveStale();
      return NextResponse.json({ success: true, ...result });
    }

    // Tier 1A: recompute every entity's cached strength (after imports/restores)
    if (action === "recompute-strengths") {
      const result = await recomputeAllStrengths();
      return NextResponse.json({ success: true, ...result });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Graph API] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
