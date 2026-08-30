import { NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/memory/patterns";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, query } = body;

    if (!image) {
      return NextResponse.json({ error: "Base64 image is required" }, { status: 400 });
    }

    // Strip prefix if present in the base64 string
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    const systemPrompt = query
      ? `You are JARVIS, a highly intelligent AI assistant. Analyze this screenshot of the user's active screen and answer their query: "${query}". Provide a direct, smart, and helpful response. Keep it concise (around 40-70 words) in your signature sophisticated assistant style.`
      : `You are JARVIS, a highly intelligent AI assistant. Analyze this screenshot of the user's active screen and describe what you observe. Be conversational, polite, and highlight any notable code, website, document, or active task. Keep it around 40-60 words in your signature sophisticated assistant style.`;

    let responseText = "";
    let provider = "";

    // 1. Try NVIDIA API (llama-3.2-90b-vision-instruct)
    if (NVIDIA_API_KEY) {
      try {
        console.log("[Screenshot API] Sending request to NVIDIA...");
        const response = await fetch(NVIDIA_API_URL, {
          method: "POST",
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
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${base64Data}`,
                    },
                  },
                ],
              },
            ],
            max_tokens: 512,
            temperature: 0.2,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          responseText = data.choices?.[0]?.message?.content?.trim() || "";
          provider = "NVIDIA";
        } else {
          const errorMsg = await response.text();
          console.warn("[Screenshot API] NVIDIA failed with status:", response.status, errorMsg);
        }
      } catch (nvidiaErr) {
        console.warn("[Screenshot API] NVIDIA error:", nvidiaErr);
      }
    }

    // 2. Try GROQ API (llama-3.2-11b-vision-preview) as fallback
    if (!responseText && GROQ_API_KEY) {
      try {
        console.log("[Screenshot API] Falling back/Sending request to GROQ...");
        const response = await fetch(GROQ_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: "llama-3.2-11b-vision-preview",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: systemPrompt },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${base64Data}`,
                    },
                  },
                ],
              },
            ],
            max_tokens: 512,
            temperature: 0.2,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          responseText = data.choices?.[0]?.message?.content?.trim() || "";
          provider = "GROQ";
        } else {
          const errorMsg = await response.text();
          console.warn("[Screenshot API] GROQ failed with status:", response.status, errorMsg);
        }
      } catch (groqErr) {
        console.warn("[Screenshot API] GROQ error:", groqErr);
      }
    }

    if (!responseText) {
      return NextResponse.json(
        { error: "Failed to generate screenshot analysis using configured vision providers" },
        { status: 500 }
      );
    }

    console.log(`[Screenshot API] Successfully analyzed with ${provider}:`, responseText);

    // Record the analysis event in Jarvis Memory database
    await recordEvent("screenshot_analysis", {
      provider,
      query: query || null,
      analysis: responseText,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      provider,
      analysis: responseText,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Screenshot API] Server error:", error);
    return NextResponse.json(
      { error: "Internal server error analyzing screenshot", details: String(error) },
      { status: 500 }
    );
  }
}
