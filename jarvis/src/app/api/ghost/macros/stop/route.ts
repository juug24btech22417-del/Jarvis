import { NextRequest, NextResponse } from "next/server";
import { stopRecording, getActiveSessions } from "@/services/MacroRecorderService";

// POST /api/ghost/macros/stop — stop recording and save macro
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let { sessionId } = body;

    // Auto-find active session if no sessionId provided
    if (!sessionId) {
      const sessions = getActiveSessions();
      if (sessions.length > 0) {
        sessionId = sessions[0].sessionId;
      }
    }

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: "No active recording session found" },
        { status: 404 }
      );
    }

    const result = await stopRecording(sessionId);
    if (!result) {
      return NextResponse.json(
        { success: false, error: "Session not found or already stopped" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      macro: result.macro,
      totalSteps: result.totalSteps,
      message: `Recording stopped. ${result.totalSteps} steps captured and saved.`,
    });
  } catch (error: any) {
    console.error("[ghost/macros/stop] POST error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
