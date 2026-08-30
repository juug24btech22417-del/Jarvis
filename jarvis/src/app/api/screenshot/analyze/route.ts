import { NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/memory/patterns";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// Allow this route up to 90 seconds — vision models on large images can be slow
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, query, mode = "analyze" } = body;

    if (!image) {
      return NextResponse.json({ error: "Base64 image is required" }, { status: 400 });
    }

    // Strip data URI prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    let systemPrompt = "";
    if (mode === "ocr") {
      systemPrompt =
        "Extract all readable text from this image. Do not add any conversational text, description, explanation, or greeting. Output ONLY the raw extracted text as is, preserving line structure.";
    } else if (query) {
      systemPrompt = `You are JARVIS, a highly intelligent AI assistant. Analyze this screenshot of the user's active screen and answer their query: "${query}". Provide a direct, smart, and helpful response. Keep it concise (around 40-70 words) in your signature sophisticated assistant style.`;
    } else {
      systemPrompt = `You are JARVIS, a highly intelligent AI assistant. Analyze this screenshot of the user's active screen and describe what you observe. Be conversational, polite, and highlight any notable code, website, document, or active task. Keep it around 40-60 words in your signature sophisticated assistant style. If you see a terminal command execution error, crash log, compilation error, or system warning, determine the exact shell/terminal command needed to fix it and append 'FIX_COMMAND: <command>' on a new line at the very end of your response (e.g., FIX_COMMAND: npm install lodash).`;
    }

    let responseText = "";
    let provider = "";

    // ── Provider 1: Google Gemini (FREE tier — 1500 req/day, 15 req/min) ──────────
    // Get GEMINI_API_KEY from https://aistudio.google.com/app/apikey (free, no CC)
    if (!responseText && GEMINI_API_KEY) {
      try {
        console.log("[Screenshot API] Trying Gemini 2.0 Flash...");
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(geminiUrl, {
          method: "POST",
          signal: AbortSignal.timeout(30_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: systemPrompt },
                  { inline_data: { mime_type: "image/jpeg", data: base64Data } },
                ],
              },
            ],
            generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          responseText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          if (responseText) provider = "Gemini";
          else console.warn("[Screenshot API] Gemini returned empty content");
        } else {
          const err = await res.text();
          console.warn("[Screenshot API] Gemini failed:", res.status, err.slice(0, 200));
        }
      } catch (geminiErr) {
        console.warn("[Screenshot API] Gemini error:", geminiErr);
      }
    }

    // ── Provider 2: NVIDIA NIM (llama-3.2-90b) — 3s timeout so we fail fast ──────
    if (!responseText && NVIDIA_API_KEY) {
      try {
        console.log("[Screenshot API] Trying NVIDIA...");
        const res = await fetch(NVIDIA_API_URL, {
          method: "POST",
          signal: AbortSignal.timeout(3_000),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${NVIDIA_API_KEY}`,
          },
          body: JSON.stringify({
            model: "meta/llama-3.2-90b-vision-instruct",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: systemPrompt },
                  { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Data}` } },
                ],
              },
            ],
            max_tokens: 512,
            temperature: 0.2,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          responseText = data.choices?.[0]?.message?.content?.trim() || "";
          if (responseText) provider = "NVIDIA";
        } else {
          console.warn("[Screenshot API] NVIDIA failed:", res.status);
        }
      } catch (nvidiaErr) {
        console.warn("[Screenshot API] NVIDIA error:", nvidiaErr);
      }
    }

    // ── Provider 3: OpenRouter (free shared models) — last resort ─────────────────
    if (!responseText && OPENROUTER_API_KEY) {
      try {
        console.log("[Screenshot API] Trying OpenRouter fallback...");
        const { describeImage } = await import("@/lib/telegram/vision");
        const buffer = Buffer.from(base64Data, "base64");
        responseText = await describeImage(buffer, "image/jpeg", systemPrompt);
        if (responseText) provider = "OpenRouter";
      } catch (orErr) {
        console.warn("[Screenshot API] OpenRouter failed:", orErr);
      }
    }

    if (!responseText) {
      return NextResponse.json(
        {
          error: "All vision providers failed. Add GEMINI_API_KEY to .env.local (free at aistudio.google.com/app/apikey)",
          providers_tried: [
            GEMINI_API_KEY ? "Gemini" : "Gemini (no key)",
            NVIDIA_API_KEY ? "NVIDIA" : "NVIDIA (no key)",
            OPENROUTER_API_KEY ? "OpenRouter" : "OpenRouter (no key)",
          ],
        },
        { status: 500 }
      );
    }

    console.log(`[Screenshot API] ✅ Success via ${provider}`);

    // Fire-and-forget DB log — never let this fail the response
    recordEvent("screenshot_analysis", {
      provider,
      mode,
      query: query || null,
      analysis: responseText,
      timestamp: new Date().toISOString(),
    }).catch((err) => console.warn("[Screenshot API] recordEvent failed (non-fatal):", err));

    return NextResponse.json({
      success: true,
      provider,
      analysis: responseText,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Screenshot API] Unhandled error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
