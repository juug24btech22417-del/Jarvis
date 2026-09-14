import { NextRequest, NextResponse } from "next/server";
import { replayMacro } from "@/services/MacroRecorderService";
import { getMacro } from "@/lib/ghost/macroStore";

// POST /api/ghost/macros/replay — replay a macro
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { macroId, headed = true, stopOnFirstError = false, keepOpen = true, vars } = body;

    if (!macroId) {
      return NextResponse.json(
        { success: false, error: "macroId is required" },
        { status: 400 }
      );
    }

    // Ask the user for unfilled {{variables}} instead of replaying blanks
    const macro = await getMacro(macroId);
    if (macro?.variables?.length) {
      const missing = macro.variables.filter(
        (v) => !(vars?.[v.name] ?? "").toString().trim() && !v.defaultValue
      );
      if (missing.length) {
        return NextResponse.json({
          success: false,
          needsVars: true,
          variables: macro.variables,
          missing: missing.map((v) => v.name),
          error: `This macro needs input: ${missing.map((v) => v.name).join(", ")}`,
        });
      }
    }
    const resolvedVars: Record<string, string> = {};
    for (const v of macro?.variables || []) {
      resolvedVars[v.name] = (vars?.[v.name] ?? v.defaultValue ?? "").toString();
    }

    console.log(`[ghost/macros/replay] Replaying macro ${macroId} (keepOpen=${keepOpen})...`);

    const result = await replayMacro(macroId, {
      headed,
      stopOnFirstError,
      keepOpen,
      vars: resolvedVars,
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
