import { NextRequest, NextResponse } from "next/server";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const SENTINEL_PROMPT = `Analyze the provided image and describe its visual contents in detail.
Identify the main active window, website, app, or document visible.

Provide a helpful, detailed observation (around 30-50 words) describing what the user is doing or looking at (e.g., social media browsing, code development, reading articles, shopping).

You MUST respond with a single JSON object:
{
  "proactive": true,
  "comment": "A detailed, descriptive comment in a polite, smart assistant tone (JARVIS persona) explaining what is visible and any interesting context.",
  "action": {
    "type": "task" or "reminder" or "debug" or "security_risk",
    "title": "Short actionable title based on the active screen content",
    "details": "A detailed explanation of the task, reminder, or suggestion based on the screen content",
    "metadata": {}
  }
}

Respond ONLY with the JSON object. No preamble, no postscript.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageBase64 } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "Image required" }, { status: 400 });
    }

    if (!NVIDIA_API_KEY) {
      return NextResponse.json(
        { error: "NVIDIA API key not configured" },
        { status: 500 }
      );
    }

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
              { type: "text", text: SENTINEL_PROMPT },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 512,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content?.trim() || "";

    console.log("[Sentinel] Raw VLM output:", rawContent.slice(0, 300));

    // Strip markdown fences if present
    let cleaned = rawContent;
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();

    // Extract first JSON object from content
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[Sentinel] No JSON found in VLM output, forcing proactive anyway.");
      return NextResponse.json({ 
        success: true, 
        proactive: true, 
        comment: rawContent.slice(0, 100) || "Checking screen...", 
        action: { type: "task", title: "General Observation", details: "No specific JSON found.", metadata: {} } 
      });
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return NextResponse.json({
        success: true,
        proactive: true, // Force to true as requested by user
        comment: parsed.comment || "I've analyzed your screen.",
        action: parsed.action || {
          type: "task",
          title: "Screen Checked",
          details: "Nothing major found, but keeping an eye out.",
          metadata: {}
        },
      });
    } catch (parseError) {
      console.warn("[Sentinel] JSON parse failed:", jsonMatch[0].slice(0, 200));
      return NextResponse.json({ 
        success: true, 
        proactive: true, 
        comment: "Found something, but couldn't parse it clearly.", 
        action: { type: "task", title: "Parsing Error", details: "JSON was malformed.", metadata: {} } 
      });
    }
  } catch (error) {
    console.error("[Sentinel] Analysis error:", error);
    return NextResponse.json(
      { success: false, error: "Analysis failed", details: String(error) },
      { status: 500 }
    );
  }
}
