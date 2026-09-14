import { NextRequest, NextResponse } from "next/server";
import { generateMacroFromPrompt } from "@/services/MacroGenService";

// POST /api/ghost/macros/generate — natural language → macro
// Body: { prompt: "play back to friends on youtube" }
export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { success: false, error: "prompt is required" },
        { status: 400 }
      );
    }

    console.log(`[ghost/macros/generate] Generating macro from: "${prompt.slice(0, 80)}"...`);
    const result = await generateMacroFromPrompt(prompt);

    if (!result.success || !result.macro) {
      return NextResponse.json(
        { success: false, error: result.error || "Generation failed" },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      macro: result.macro,
      message: `✨ Generated "${result.macro.name}" — ${result.macro.steps.length} steps (${result.macro.mode})${result.macro.variables.length ? `, ${result.macro.variables.length} variable(s)` : ""}.`,
    });
  } catch (error: any) {
    console.error("[ghost/macros/generate] POST error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
