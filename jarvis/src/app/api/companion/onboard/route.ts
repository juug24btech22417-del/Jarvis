// Onboarding API — the one-time "get to know you" interview.
//
//   GET   /api/companion/onboard   → has onboarding been done?
//   POST  /api/companion/onboard   → save answers into the memory graph
//
// Answers become graph entities + relationships (PERSON/GOAL/PREFERENCE
// etc.) so the existing retriever injects them into every future chat —
// JARVIS "just knows" from the first real conversation onward.
// The completion marker is a Memory row (category "onboarding") which
// also means the answers live inside the normal memory system.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/queries";
import { addEntity, addRelationship, findEntityByName } from "@/lib/memory/graph";

const USER_NODE = "Dhruv"; // the central PERSON node everything links to

export async function GET() {
  try {
    const marker = await prisma.memory.findFirst({
      where: { category: "onboarding" },
    });
    const personCount = await prisma.entity.count({
      where: { type: "PERSON", archived: false },
    });
    return NextResponse.json({
      ok: true,
      onboarded: !!marker,
      personCount,
    });
  } catch {
    // DB unhappy → treat as not onboarded; the UI flow is harmless to redo.
    return NextResponse.json({ ok: false, onboarded: false, personCount: 0 });
  }
}

interface OnboardAnswers {
  name?: string;
  work?: string;        // what they do: study/work, where
  goals?: string;       // current main goals (free text)
  callHim?: string;     // preferred address: Boss / Sir / name
  people?: string;      // important people (free text, comma separated)
  interests?: string;   // hobbies / interests
}

async function ensureUserNode(): Promise<string> {
  const existing = await findEntityByName(USER_NODE);
  if (existing) return existing.id;
  return addEntity({
    name: USER_NODE,
    type: "PERSON",
    description: "The user. JARVIS's person.",
  });
}

async function linkFact(
  userId: string,
  name: string,
  type: string,
  description: string,
  relType: string
): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  let entityId: string;
  const existing = await findEntityByName(clean);
  if (existing) {
    entityId = existing.id;
    // refresh description if we got something new
    await prisma.entity.update({
      where: { id: entityId },
      data: { description: description.slice(0, 300) },
    }).catch(() => {});
  } else {
    entityId = await addEntity({
      name: clean,
      type,
      description: description.slice(0, 300),
    });
  }
  await addRelationship({
    sourceId: userId,
    targetId: entityId,
    type: relType,
    strength: 1.5, // onboarding facts start strong
  }).catch(() => {});
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as OnboardAnswers;

    const userId = await ensureUserNode();
    const facts: string[] = [];

    if (body.name?.trim()) {
      facts.push(`Name: ${body.name.trim()}`);
      // Rename the user node if they gave a real name.
      if (body.name.trim() !== USER_NODE) {
        await prisma.entity.updateMany({
          where: { name: USER_NODE },
          data: { name: body.name.trim() },
        }).catch(() => {});
      }
    }
    if (body.work?.trim()) {
      await linkFact(userId, body.work.trim().slice(0, 40), "CONCEPT", `${body.work.trim()}`, "works_at");
      facts.push(`Work/study: ${body.work.trim()}`);
    }
    if (body.goals?.trim()) {
      await linkFact(userId, body.goals.trim().slice(0, 40), "GOAL", `${body.goals.trim()}`, "pursuing");
      facts.push(`Current goals: ${body.goals.trim()}`);
    }
    if (body.callHim?.trim()) {
      await linkFact(userId, "preferred address", "PREFERENCE", `Wants to be addressed as "${body.callHim.trim()}"`, "prefers");
      facts.push(`Preferred address: ${body.callHim.trim()}`);
    }
    if (body.interests?.trim()) {
      await linkFact(userId, body.interests.trim().slice(0, 40), "CONCEPT", `Interested in ${body.interests.trim()}`, "knows_about");
      facts.push(`Interests: ${body.interests.trim()}`);
    }
    if (body.people?.trim()) {
      // Comma separated: "dad, Rahul, Ananya"
      const people = body.people.split(",").map((p) => p.trim()).filter(Boolean).slice(0, 8);
      for (const p of people) {
        await linkFact(userId, p, "PERSON", `Important person in ${body.name?.trim() || USER_NODE}'s life.`, "close_to");
      }
      if (people.length) facts.push(`Important people: ${people.join(", ")}`);
    }

    // Completion marker (also acts as a plain-text backup of the answers).
    await prisma.memory.create({
      data: {
        content: `Onboarding profile — ${facts.join(" | ")}`,
        category: "onboarding",
        source: "explicit",
        strength: 3.0,
        pinned: true,
      },
    });

    return NextResponse.json({ ok: true, saved: facts.length });
  } catch (e) {
    console.warn("[Onboard] POST failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: "onboard failed" }, { status: 200 });
  }
}
