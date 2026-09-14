import { NextRequest, NextResponse } from "next/server";
import { replayMacro } from "@/services/MacroRecorderService";

// POST /api/ghost/macros/replay — replay a macro
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { macroId, headed = true, stopOnFirstError = false, keepOpen = true } = body;

    if (!macroId) {
      return NextResponse.json(
        { success: false, error: "macroId is required" },
        { status: 400 }
      );
    }

    console.log(`[ghost/macros/replay] Replaying macro ${macroId} (keepOpen=${keepOpen})...`);

    const result = await replayMacro(macroId, {
      headed,
      stopOnFirstError,
      keepOpen,
    });

    return NextResponse.json({
      success: result.success,
      result,
      message: result.success
        ? `✅ Macro "${result.macroName}" completed! ${result.stepsCompleted}/${result.totalSteps} steps done in ${Math.round(result.durationMs / 1000)}s.`
        : `⚠️ Macro "${result.macroName}" had errors: ${result.stepsFailed}/${result.totalSteps} steps failed.`,
    });
  } catch (error: any) {
    console.error("[ghost/macros/replay] POST error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
