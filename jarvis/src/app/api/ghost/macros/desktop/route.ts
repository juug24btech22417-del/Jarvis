import { NextRequest, NextResponse } from "next/server";
import {
  startDesktopRecording,
  addDesktopStep,
  stopDesktopRecording,
  getDesktopRecordingStatus,
  getActiveDesktopSessions,
  replayDesktopMacro,
  refreshDesktopScreenshot,
  detectForegroundWindow,
  listOpenWindows,
  uiaDescribePoint,
  describeUiaTarget,
} from "@/services/DesktopRecorderService";

// POST /api/ghost/macros/desktop — start, add step, stop, status, or replay
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "start": {
        const result = await startDesktopRecording();
        return NextResponse.json({ success: true, ...result });
      }

      case "addStep": {
        const { sessionId, step } = body;
        if (!sessionId || !step) {
          return NextResponse.json(
            { success: false, error: "sessionId and step are required" },
            { status: 400 }
          );
        }
        const result = await addDesktopStep(sessionId, step);
        return NextResponse.json({ success: result.success, screenshotBase64: result.screenshotBase64 });
      }

      case "stop": {
        const { sessionId } = body;
        if (!sessionId) {
          return NextResponse.json(
            { success: false, error: "sessionId is required" },
            { status: 400 }
          );
        }
        const result = await stopDesktopRecording(sessionId);
        if (!result) {
          return NextResponse.json(
            { success: false, error: "Session not found" },
            { status: 404 }
          );
        }
        return NextResponse.json({
          success: true,
          macro: result.macro,
          totalSteps: result.totalSteps,
        });
      }

      case "status": {
        const { sessionId: sid } = body;
        const sessions = sid
          ? getDesktopRecordingStatus(sid)
            ? [getDesktopRecordingStatus(sid)]
            : []
          : getActiveDesktopSessions();
        return NextResponse.json({ success: true, sessions });
      }

      case "detectForeground": {
        const processName = await detectForegroundWindow();
        return NextResponse.json({ success: true, processName });
      }

      case "listWindows": {
        const windows = await listOpenWindows();
        return NextResponse.json({ success: true, windows });
      }

      // UIA: identify the semantic element at a screen point (recorder)
      case "describePoint": {
        const { x, y } = body;
        if (typeof x !== "number" || typeof y !== "number") {
          return NextResponse.json(
            { success: false, error: "x and y (screen coords) are required" },
            { status: 400 }
          );
        }
        const uia = await uiaDescribePoint(x, y);
        return NextResponse.json({
          success: true,
          uia,
          description: uia ? describeUiaTarget(uia) : null,
        });
      }

      case "refreshScreenshot": {
        const { sessionId: rsid } = body;
        if (!rsid) {
          return NextResponse.json(
            { success: false, error: "sessionId is required" },
            { status: 400 }
          );
        }
        const screenshotBase64 = await refreshDesktopScreenshot(rsid);
        return NextResponse.json({ success: true, screenshotBase64 });
      }

      case "replay": {
        const { macroId } = body;
        if (!macroId) {
          return NextResponse.json(
            { success: false, error: "macroId is required" },
            { status: 400 }
          );
        }
        console.log(`[ghost/macros/desktop] Replaying desktop macro ${macroId}...`);
        const result = await replayDesktopMacro(macroId);
        return NextResponse.json({
          success: result.success,
          result,
          message: result.success
            ? `✅ Desktop macro "${result.macroName}" completed! ${result.stepsCompleted}/${result.totalSteps} steps in ${Math.round(result.durationMs / 1000)}s.`
            : `⚠️ Desktop macro "${result.macroName}" had errors: ${result.stepsFailed}/${result.totalSteps} steps failed.`,
        });
      }

      default:
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("[ghost/macros/desktop] POST error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}

// GET /api/ghost/macros/desktop — list active desktop sessions
export async function GET() {
  try {
    const sessions = getActiveDesktopSessions();
    return NextResponse.json({ success: true, sessions });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
