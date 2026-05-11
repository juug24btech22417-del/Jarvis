import { NextRequest, NextResponse } from "next/server";

const TODOIST_API_BASE = "https://api.todoist.com/api/v1";

export async function POST(req: NextRequest) {
  try {
    const todoistToken = process.env.TODOIST_API_TOKEN;

    if (!todoistToken) {
      return NextResponse.json(
        {
          error: "Todoist token not configured",
          setup: {
            step1: "Go to https://todoist.com/app/settings/integrations",
            step2: "Scroll to 'API token' section",
            step3: "Copy your API token",
            step4: "Add to .env.local: TODOIST_API_TOKEN=your_token",
          },
        },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { content, description, dueString, priority = 1, projectId, labels = [] } = body;

    if (!content) {
      return NextResponse.json(
        { error: "Task content required" },
        { status: 400 }
      );
    }

    const response = await fetch(`${TODOIST_API_BASE}/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${todoistToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        ...(description && { description }),
        ...(dueString && { due_string: dueString }),
        priority: Math.min(Math.max(priority, 1), 4), // 1-4 range
        ...(projectId && { project_id: projectId }),
        ...(labels.length > 0 && { labels }),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: "Todoist API error", details: error },
        { status: 500 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      taskId: data.id,
      content: data.content,
      url: data.url,
      due: data.due,
      message: "Task added to Todoist",
    });
  } catch (error) {
    console.error("Todoist API error:", error);
    return NextResponse.json(
      { error: "Failed to add task", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const todoistToken = process.env.TODOIST_API_TOKEN;

    if (!todoistToken) {
      return NextResponse.json({
        success: true,
        status: "not_configured",
        setup: {
          step1: "Go to https://todoist.com/app/settings/integrations",
          step2: "Find 'API token' section",
          step3: "Copy token and add to .env.local",
          usage: "TODOIST_API_TOKEN=your_token_here",
        },
      });
    }

    // Test connection by fetching projects
    const response = await fetch(`${TODOIST_API_BASE}/projects`, {
      headers: {
        Authorization: `Bearer ${todoistToken}`,
      },
    });

    if (response.ok) {
      const data = await response.json();
      const projects = data.results || [];
      return NextResponse.json({
        success: true,
        status: "connected",
        projects: projects.slice(0, 5).map((p: any) => ({
          id: p.id,
          name: p.name,
        })),
      });
    }

    return NextResponse.json({
      success: false,
      status: "error",
      message: "Could not connect to Todoist",
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      status: "error",
      details: String(error),
    });
  }
}
