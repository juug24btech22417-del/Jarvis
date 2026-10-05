import { NextRequest, NextResponse } from "next/server";
import { callJsonLlm } from "@/lib/llm/fastJson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/whatsapp/nlp
 *
 * Body: { text: string }
 *
 * Returns:
 * {
 *   intent: "send_message" | "compose_message" | "not_whatsapp",
 *   recipient?: string,   // name or phone number
 *   isNumber?: boolean,   // true if recipient is a phone number
 *   message?: string,     // the composed/extracted message
 *   confidence?: number,  // 0-1
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ success: false, error: "text is required" }, { status: 400 });
    }

    const result = await callJsonLlm<{
      intent: string;
      recipient?: string;
      isNumber?: boolean;
      message?: string;
      confidence?: number;
      reason?: string;
    }>({
      system: `You are a WhatsApp intent parser for JARVIS AI assistant. Parse the user's natural language input and extract WhatsApp messaging intent.

Return STRICT JSON only — no prose:
{
  "intent": "send_message" | "compose_message" | "not_whatsapp",
  "recipient": "<name or phone number if present>",
  "isNumber": true | false,
  "message": "<the exact message to send, OR a smart composed message from context>",
  "confidence": 0.0-1.0,
  "reason": "<brief reason if not_whatsapp>"
}

Rules:
- "send_message": user clearly wants to send a specific message to someone (even if phrased loosely: "tell John hi", "msg 9606571200 that I'm on the way", "send hi to mom", "text Sarah happy birthday")
- "compose_message": user gives context but no exact message ("message mom I'll be late for dinner" → compose a polite short message)
- "not_whatsapp": not a messaging intent at all
- Extract the recipient from names ("mom", "John", "Sarah") OR phone numbers (with/without country code)
- If recipient is all digits (possibly with + or country code), set isNumber: true
- For phone numbers, keep them exactly as given (don't add country code)
- Compose a SHORT (1-2 sentence), natural, human message when needed — JARVIS-quality, not robotic
- If message is already explicit ("send hi"), use exactly that
- Set confidence 0.9+ when very clear, 0.6-0.9 when inferred, <0.6 when ambiguous`,
      user: `Parse this input: "${text}"`,
      maxTokens: 300,
      temperature: 0.1,
      label: "WhatsAppNLP",
      timeoutMs: 8000,
    });

    if (!result) {
      return NextResponse.json({ success: false, error: "NLP parse failed" }, { status: 500 });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[WhatsApp NLP Error]:", err);
    return NextResponse.json({ success: false, error: err?.message || "Parse error" }, { status: 500 });
  }
}
