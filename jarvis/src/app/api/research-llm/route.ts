import { NextRequest } from "next/server";
import { runLlmChainAsResponse } from "@/services/LlmChain";

/**
 * Internal LLM proxy used by the Research/Oracle pipeline. Accepts a
 * single { prompt } and returns the model content. Uses the shared
 * NVIDIA -> OpenRouter -> Groq fallback chain (see LlmChain.ts) so
 * a 429 on one model/provider doesn't take down the research flow.
 *
 * Response shape:
 *   { success: true, content: string, provider: string, model: string }
 *
 *   provider = "nvidia" | "openrouter" | "groq"
 */
export async function POST(req: NextRequest) {
  try {
    const { prompt, maxTokens, temperature } = await req.json();
    if (!prompt) {
      return Response.json({ error: "Prompt is required" }, { status: 400 });
    }
    return runLlmChainAsResponse(prompt, {
      maxTokens: typeof maxTokens === "number" ? maxTokens : undefined,
      temperature: typeof temperature === "number" ? temperature : undefined,
    });
  } catch (error: any) {
    console.error("[Research LLM] Error:", error);
    return Response.json(
      { error: "Internal server error", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
