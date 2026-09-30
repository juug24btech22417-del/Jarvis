// Second Brain — memory graph API.
//
// GET  ?includeArchived=1&limit=1200 → { nodes, links, stats }
// POST { action: "pin"|"unpin"|"forget"|"restore"|"reinforce"|"cue", id, cue? }
//
// "forget" is a soft archive (the memory leaves the constellation and stops
// decaying into your prompts) — nothing is deleted, so it stays restorable.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { bumpUsage, pinEntity, setCue } from "@/lib/memory/graph";

export async function GET(req: NextRequest) {
  const includeArchived = req.nextUrl.searchParams.get("includeArchived") === "1";
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 1200, 50), 3000);

  try {
    const entities = await prisma.entity.findMany({
      where: includeArchived ? {} : { archived: false },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        strength: true,
        pinned: true,
        archived: true,
        accessCount: true,
        createdAt: true,
      },
      orderBy: [{ pinned: "desc" }, { strength: "desc" }],
      take: limit,
    });

    const ids = new Set(entities.map((e) => e.id));
    const relationships = await prisma.relationship.findMany({
      where: { strength: { gte: 0.1 } },
      select: { sourceId: true, targetId: true, type: true, strength: true },
      take: 6000,
    });

    const links = relationships
      .filter((r) => ids.has(r.sourceId) && ids.has(r.targetId))
      .map((r) => ({ source: r.sourceId, target: r.targetId, type: r.type, strength: r.strength }));

    const byType: Record<string, number> = {};
    for (const e of entities) byType[e.type] = (byType[e.type] ?? 0) + 1;
    // Forgotten memories are filtered out of the node list, so count them
    // straight from the table for an honest stat.
    const archivedCount = await prisma.entity.count({ where: { archived: true } });

    return NextResponse.json({
      nodes: entities.map((e) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        description: e.description,
        strength: e.strength,
        pinned: e.pinned,
        archived: e.archived,
        accessCount: e.accessCount,
        createdAt: e.createdAt.getTime(),
      })),
      links,
      stats: {
        total: entities.length,
        links: links.length,
        pinned: entities.filter((e) => e.pinned).length,
        archived: archivedCount,
        byType,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    switch (action) {
      case "pin":
        await pinEntity(id, true);
        break;
      case "unpin":
        await pinEntity(id, false);
        break;
      case "reinforce":
        await bumpUsage([id], 0.25);
        break;
      case "cue": {
        const cue = typeof body.cue === "string" ? body.cue.slice(0, 200) : null;
        await setCue(id, cue);
        break;
      }
      case "forget": {
        // Soft archive: gone from the constellation, restorable, and it stops
        // being surfaced in retrieval.
        await prisma.entity.update({
          where: { id },
          data: { archived: true, strength: 0.05, pinned: false },
        });
        break;
      }
      case "restore":
        await prisma.entity.update({
          where: { id },
          data: { archived: false, strength: 0.6, lastAccessed: new Date() },
        });
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    return NextResponse.json({ ok: true, action, id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
