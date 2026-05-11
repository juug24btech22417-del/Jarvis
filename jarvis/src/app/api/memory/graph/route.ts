// Knowledge Graph API - CRUD operations for entities and relationships
import { NextResponse } from "next/server";
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

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[Graph API] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
