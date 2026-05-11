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
    const { getTasks } = await import("@/lib/db/queries");
    const tasks = await getTasks(false);
    return NextResponse.json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  if (isBuildTime) {
    return NextResponse.json({ id: "mock", title: "" });
  }

  try {
    const data = await request.json();
    const { createTask } = await import("@/lib/db/queries");
    const task = await createTask(data);
    return NextResponse.json(task);
  } catch (error) {
    console.error("Error creating task:", error);
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  if (isBuildTime) {
    return NextResponse.json({ id: "mock", completed: true });
  }

  try {
    const { id } = await request.json();
    const { toggleTaskCompletion } = await import("@/lib/db/queries");
    const task = await toggleTaskCompletion(id);
    return NextResponse.json(task);
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json(
      { error: "Failed to update task" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  if (isBuildTime) {
    return NextResponse.json({ success: true });
  }

  try {
    const { id } = await request.json();
    const { deleteTask } = await import("@/lib/db/queries");
    await deleteTask(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting task:", error);
    return NextResponse.json(
      { error: "Failed to delete task" },
      { status: 500 }
    );
  }
}
