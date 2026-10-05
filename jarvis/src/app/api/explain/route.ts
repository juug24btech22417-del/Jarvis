import { NextRequest, NextResponse } from "next/server";
import { analyzeSnippet } from "@/lib/agent/explainSnippet";

// Mode-aware "explain this" endpoint. Auto-detects whether the copied text is
// a question, code, an error, or an instruction, and actually DOES the right
// thing (answer / write code / fix / explain) instead of always explaining.
export async function POST(req: NextRequest) {
  try {
    const { text, context } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const analysis = await analyzeSnippet(text, typeof context === "string" ? context : undefined);
    return NextResponse.json({ success: true, ...analysis });
  } catch (err: any) {
    console.error("[Explain API] Fatal error:", err);
    return NextResponse.json({ error: err.message || "Failed to analyze text" }, { status: 500 });
  }
}
