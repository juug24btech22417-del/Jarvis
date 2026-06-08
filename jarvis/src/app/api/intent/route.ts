import { NextRequest, NextResponse } from "next/server";
import { INTENT_SYSTEM_PROMPT } from "@/lib/jarvis/personality";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || process.env.NEXT_PUBLIC_NVIDIA_API_KEY;

// 4s timeout — the intent parse is a convenience, not a gate.
// If NVIDIA is rate-limited or slow, fall through to "chat" so the
// /api/chat path still serves the user.
function fetchWithTimeout(url: string, opts: RequestInit, ms = 4000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

export async function POST(req: NextRequest) {
  try {
    if (!NVIDIA_API_KEY) {
      // No key — don't 500, just route everything to the chat path.
      return NextResponse.json({
        intent: "chat",
        params: { message: "" },
        fallback: true,
        reason: "no_api_key",
      });
    }

    const { text } = await req.json();

    if (!text) {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${NVIDIA_API_KEY}`,
          },
          body: JSON.stringify({
            model: "meta/llama-3.1-8b-instruct",
            messages: [
              { role: "system", content: INTENT_SYSTEM_PROMPT },
              { role: "user", content: text },
            ],
            temperature: 0.1,
            max_tokens: 256,
          }),
        },
        4000
      );
    } catch (e: any) {
      // Timeout or network error — fall through to chat. The user
      // should never see a 10-minute hang because the intent parse is stuck.
      console.warn("[Intent API] NVIDIA unreachable/timeout — falling back to chat:", e?.name || e?.message);
      return NextResponse.json({
        intent: "chat",
        params: { message: text },
        fallback: true,
        reason: e?.name === "AbortError" ? "timeout" : "network",
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Intent API] LLM error:", response.status, errorText);
      // 429/5xx — same fallback. Don't 500 the caller.
      return NextResponse.json({
        intent: "chat",
        params: { message: text },
        fallback: true,
        reason: `http_${response.status}`,
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";

    // Extract JSON from response
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          intent: parsed.intent || "chat",
          params: parsed.params || { message: text },
        });
      }
    } catch {
      console.error("[Intent API] Failed to parse LLM response:", content);
    }

    // Fallback to chat if parsing fails
    return NextResponse.json({
      intent: "chat",
      params: { message: text },
    });

  } catch (error) {
    console.error("[Intent API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
