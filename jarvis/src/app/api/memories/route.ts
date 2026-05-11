import { NextResponse } from "next/server";

// Skip database during build
const isBuildTime = process.env.NODE_ENV === "production" && process.env.NEXT_PHASE === "phase-production-build";

export async function GET() {
  // Return empty during build
  if (isBuildTime) {
    return NextResponse.json([]);
  }

  try {
    // Dynamically import to avoid build-time issues
    const { getMemories } = await import("@/lib/db/queries");
    const memories = await getMemories(undefined, 10);
    return NextResponse.json(memories);
  } catch (error) {
    console.error("Error fetching memories:", error);
    return NextResponse.json(
      { error: "Failed to fetch memories" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (isBuildTime) {
    return NextResponse.json({ id: "mock", content: "", category: "" });
  }

  try {
    const { content, category, source } = await request.json();
    const { addMemory } = await import("@/lib/db/queries");
    const memory = await addMemory(content, category, source);
    return NextResponse.json(memory);
  } catch (error) {
    console.error("Error creating memory:", error);
    return NextResponse.json(
      { error: "Failed to create memory" },
      { status: 500 }
    );
  }
}
