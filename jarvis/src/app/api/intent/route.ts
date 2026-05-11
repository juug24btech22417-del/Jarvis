import { NextRequest, NextResponse } from "next/server";
import { INTENT_SYSTEM_PROMPT } from "@/lib/jarvis/personality";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || process.env.NEXT_PUBLIC_NVIDIA_API_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!NVIDIA_API_KEY) {
      return NextResponse.json(
        { error: "NVIDIA API key not configured" },
        { status: 500 }
      );
    }

    const { text } = await req.json();

    if (!text) {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
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
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Intent API] LLM error:", response.status, errorText);
      return NextResponse.json(
        { error: "LLM request failed", details: errorText },
        { status: 500 }
      );
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
