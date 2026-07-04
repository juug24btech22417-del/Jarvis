// Tier 1B — Memory conversations
// Given a memory (entity) and a user question, answer grounded in the entity +
// 1-hop neighbors. Save the Q&A as a new linked Memory row. Reinforce cited
// entities.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { getEntityRelationships, bumpUsage } from "@/lib/memory/graph";
import { addMemory } from "@/lib/db/queries";

// OpenRouter fallback (per memory: NVIDIA NIM is currently slow/broken).
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

interface DiscussRequestBody {
  memoryId: string;
  question: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DiscussRequestBody;
    const { memoryId, question } = body;

    if (!memoryId || !question?.trim()) {
      return NextResponse.json(
        { error: "memoryId and question required" },
        { status: 400 }
      );
    }

    // 1. Fetch the source entity + 1-hop neighbors.
    const entity = await prisma.entity.findUnique({ where: { id: memoryId } });
    if (!entity) {
      return NextResponse.json({ error: "memory not found" }, { status: 404 });
    }

    const relationships = await getEntityRelationships(memoryId, { limit: 20 });

    // Build a strict prompt — answer using ONLY the provided memories, cite names.
    const contextLines = [
      `Source memory: ${entity.name} (${entity.type})${
        entity.description ? ` — ${entity.description}` : ""
      }`,
      ...relationships.map((r) => {
        const isSource = r.source.id === memoryId;
        const other = isSource ? r.target : r.source;
        return `  ↳ ${other.name} (${other.type}) via "${r.type}" (strength ${r.strength})`;
      }),
    ];

    const systemPrompt = `You are JARVIS's Memory Module. The user is asking about a specific memory in their personal knowledge graph.

Answer ONLY using the memories provided below. If the answer isn't in the provided memories, say so clearly — do not invent. Cite the names of any memories you reference in [square brackets].

Be concise (3-6 sentences). Speak as JARVIS, addressing the user as "Boss" only when natural. No bullet lists unless truly needed.`;

    const userPrompt = `MEMORIES ABOUT "${entity.name}":
${contextLines.join("\n")}

QUESTION: ${question.trim()}

Answer in JARVIS's voice, grounded only in the memories above. Cite memory names in [brackets].`;

    // 2. Call OpenRouter with a hard timeout (no NVIDIA NIM — known slow).
    const apiKey = process.env.OPENROUTER_API_KEY;
    let answer = "";
    if (apiKey && apiKey.trim() !== "" && apiKey !== "your-api-key-here") {
      try {
        const response = await fetchWithTimeout(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "JARVIS Memory Discuss",
            },
            body: JSON.stringify({
              model: "openai/gpt-oss-120b:free",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              max_tokens: 512,
              temperature: 0.5,
            }),
          },
          8000
        );

        if (response.ok) {
          const data = await response.json();
          answer = data.choices?.[0]?.message?.content?.trim() || "";
        } else {
          console.warn(
            "[Discuss] OpenRouter returned",
            response.status,
            "— falling back to offline answer"
          );
        }
      } catch (err: any) {
        console.error("[Discuss] OpenRouter fetch failed:", err?.name || err?.message);
      }
    }

    // 3. Offline fallback — summarize the linked memories ourselves.
    if (!answer) {
      const linkedNames = relationships
        .map((r) => (r.source.id === memoryId ? r.target.name : r.source.name))
        .slice(0, 5);
      answer = `I don't have live LLM access right now, Boss. From your memory graph: ${entity.name} (${entity.type})${
        entity.description ? ` — ${entity.description}` : ""
      }${
        linkedNames.length > 0
          ? `. Connected to: ${linkedNames.join(", ")}.`
          : "."
      } The question you asked: "${question.trim()}". Add an OpenRouter API key to enable deep Q&A.`;
    }

    // 4. Extract cited memory names from the answer (e.g. "[Prisma]") and reinforce them.
    const citedNames = Array.from(
      new Set(
        Array.from(answer.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1].trim())
      )
    );

    let citedIds: string[] = [];
    if (citedNames.length > 0) {
      const citedEntities = await prisma.entity.findMany({
        where: { name: { in: citedNames } },
        select: { id: true },
      });
      citedIds = citedEntities.map((e) => e.id);
    }

    // Reinforce the source memory + any cited neighbors.
    const reinforceIds = Array.from(new Set([entity.id, ...citedIds]));
    if (reinforceIds.length > 0) {
      bumpUsage(reinforceIds, 0.2).catch((err) => {
        console.error("[Discuss] bumpUsage failed:", err);
      });
    }

    // 5. Persist the Q&A as a new linked Memory row (category="conversation").
    const qaContent = `Q (about ${entity.name}): ${question.trim()}\n\nA: ${answer}`;
    const savedMemory = await addMemory(qaContent, "conversation", `discuss:${entity.id}`, {
      linkedEntityId: entity.id,
    });

    return NextResponse.json({
      success: true,
      answer,
      citedMemoryIds: citedIds,
      qaMemoryId: savedMemory.id,
      sourceEntity: {
        id: entity.id,
        name: entity.name,
        type: entity.type,
      },
    });
  } catch (error) {
    console.error("[Discuss] POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}