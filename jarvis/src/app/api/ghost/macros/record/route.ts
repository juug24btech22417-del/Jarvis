import { NextRequest, NextResponse } from "next/server";
import {
  startRecording,
  stopRecording,
  getRecordingStatus,
  getActiveSessions,
} from "@/services/MacroRecorderService";

// POST /api/ghost/macros/record — start recording or get status
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, url, sessionId, headed = false } = body;

    if (action === "start") {
      if (!url) {
        return NextResponse.json(
          { success: false, error: "URL is required to start recording" },
          { status: 400 }
        );
      }

      const result = await startRecording(url, { headed });
      return NextResponse.json({
        success: true,
        sessionId: result.sessionId,
        macroId: result.macroId,
        message: "Recording started. Interact with the page — JARVIS is watching.",
      });
    }

    if (action === "status") {
      if (sessionId) {
        const status = getRecordingStatus(sessionId);
        if (!status) {
          return NextResponse.json(
            { success: false, error: "Session not found" },
            { status: 404 }
          );
        }
        return NextResponse.json({ success: true, ...status });
      }
      // List all active sessions
      const sessions = getActiveSessions();
      return NextResponse.json({ success: true, sessions });
    }

    return NextResponse.json(
      { success: false, error: "Unknown action. Use 'start' or 'status'." },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[ghost/macros/record] POST error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
