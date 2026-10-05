import { NextRequest, NextResponse } from "next/server";
import { INTENT_SYSTEM_PROMPT } from "@/lib/jarvis/personality";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || process.env.NEXT_PUBLIC_NVIDIA_API_KEY;

// 2.5s timeout — the intent parse is a convenience, not a gate.
function fetchWithTimeout(url: string, opts: RequestInit, ms = 2500) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();

    if (!text) {
      return NextResponse.json(
        { error: "Text is required" },
        { status: 400 }
      );
    }

    // 1) Primary: Groq qwen/qwen3.8-27b (takes ~200-300ms)
    if (GROQ_API_KEY && GROQ_API_KEY.trim() !== "" && GROQ_API_KEY !== "your-api-key-here") {
      try {
        const response = await fetchWithTimeout(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${GROQ_API_KEY}`,
            },
            body: JSON.stringify({
              model: "qwen/qwen3.8-27b",
              messages: [
                { role: "system", content: INTENT_SYSTEM_PROMPT },
                { role: "user", content: text },
              ],
              temperature: 0.1,
              max_tokens: 128,
              response_format: { type: "json_object" },
            }),
          },
          1500
        );

        if (response.ok) {
          const data = await response.json();
          const content = data.choices?.[0]?.message?.content || "";
          try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object") {
              return NextResponse.json({
                intent: parsed.intent || "chat",
                params: parsed.params || { message: text },
              });
            }
          } catch {}
        }
      } catch (err: any) {
        console.warn("[Intent API] Groq intent parse failed:", err?.message || err);
      }
    }

    // 2) Fallback: Gemini 2.5 Flash
    if (GEMINI_API_KEY && GEMINI_API_KEY.trim() !== "" && GEMINI_API_KEY !== "your-api-key-here") {
      try {
        const response = await fetchWithTimeout(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: text }] }],
              systemInstruction: { parts: [{ text: INTENT_SYSTEM_PROMPT }] },
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 128,
                responseMimeType: "application/json",
              },
            }),
          },
          1800
        );

        if (response.ok) {
          const data = await response.json();
          const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
          try {
            const parsed = JSON.parse(content);
            if (parsed && typeof parsed === "object") {
              return NextResponse.json({
                intent: parsed.intent || "chat",
                params: parsed.params || { message: text },
              });
            }
          } catch {}
        }
      } catch (err: any) {
        console.warn("[Intent API] Gemini intent parse failed:", err?.message || err);
      }
    }

    // Fast fallback to chat
    return NextResponse.json({
      intent: "chat",
      params: { message: text },
      fallback: true,
    });
  } catch (error) {
    console.error("[Intent API] Error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
