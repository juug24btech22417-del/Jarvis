import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const OPENROUTER_VISION_MODELS = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "inclusionai/ling-3.0-flash-vl:free",
  "openrouter/free",
];

const SENTINEL_SYSTEM_PROMPT = `You are JARVIS Sentinel Eyes, an AI desktop assistant.
Analyze the provided screenshot of the user's computer screen.
Identify the active window, app, code editor, website, or document.
Provide a sharp, observant 1-2 sentence comment in JARVIS's polite, witty assistant persona (addressing the user as 'Boss').
Also identify an optional proactive action (task, reminder, debug suggestion, or security risk).

You MUST reply with ONLY a raw valid JSON object in this exact schema:
{
  "proactive": true,
  "comment": "I see you're working in Antigravity IDE on the Jarvis codebase, Boss. All sub-processes are compiling smoothly.",
  "action": {
    "type": "task",
    "title": "Review active workspace",
    "details": "Active window observation and workspace verification complete.",
    "metadata": {}
  }
}`;

async function tryOpenRouterVision(imageBase64: string, model: string): Promise<string> {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === "your-api-key-here") {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://jarvis.local",
      "X-Title": "JARVIS Sentinel",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: SENTINEL_SYSTEM_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 450,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(16000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenRouter (${model}) status ${res.status}: ${errText.slice(0, 150)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`Empty response from ${model}`);
  }
  return content;
}

async function tryNvidiaVision(imageBase64: string): Promise<string> {
  if (!NVIDIA_API_KEY || NVIDIA_API_KEY === "your-api-key-here") {
    throw new Error("NVIDIA_API_KEY not configured");
  }

  const res = await fetch(NVIDIA_URL, {
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
            { type: "text", text: SENTINEL_SYSTEM_PROMPT },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      max_tokens: 300,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(6000), // Strict timeout to prevent freezing
  });

  if (!res.ok) {
    throw new Error(`NVIDIA status ${res.status}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Empty NVIDIA response");
  return content;
}

function parseVisionResponse(rawText: string) {
  // Strip code blocks if present
  let cleaned = rawText.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Find first JSON structure
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        proactive: true,
        comment:
          parsed.comment ||
          "I have observed your active screen environment, Boss.",
        action: parsed.action || {
          type: "task",
          title: "Workspace Observation",
          details: "Screen analyzed and parameters recorded.",
          metadata: {},
        },
      };
    } catch {
      // Fall through to plain text extraction
    }
  }

  // Plain text response fallback: Clean up model thinking or preamble
  const lines = cleaned
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const cleanComment = lines[0] || "I have analyzed your screen, Boss. Everything appears in order.";

  return {
    proactive: true,
    comment: cleanComment,
    action: {
      type: "task",
      title: "Screen Checked",
      details: cleanComment,
      metadata: {},
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { imageBase64 } = body;

    if (!imageBase64) {
      return NextResponse.json({ error: "Image required" }, { status: 400 });
    }

    let rawOutput: string | null = null;
    let successfulModel = "";

    // 1. Try OpenRouter vision models in priority order
    for (const model of OPENROUTER_VISION_MODELS) {
      try {
        console.log(`[Sentinel] Attempting analysis with ${model}...`);
        rawOutput = await tryOpenRouterVision(imageBase64, model);
        successfulModel = model;
        console.log(`[Sentinel] Success with ${model}`);
        break;
      } catch (err: any) {
        console.warn(`[Sentinel] Model ${model} failed:`, err?.message || err);
      }
    }

    // 2. If OpenRouter models failed, try NVIDIA NIM as secondary fallback
    if (!rawOutput && NVIDIA_API_KEY) {
      try {
        console.log("[Sentinel] Attempting fallback to NVIDIA NIM...");
        rawOutput = await tryNvidiaVision(imageBase64);
        successfulModel = "nvidia-nim";
      } catch (nimErr: any) {
        console.warn("[Sentinel] NVIDIA NIM failed:", nimErr?.message || nimErr);
      }
    }

    if (!rawOutput) {
      return NextResponse.json(
        {
          success: false,
          error: "All vision models unavailable or rate-limited",
        },
        { status: 503 }
      );
    }

    const result = parseVisionResponse(rawOutput);

    return NextResponse.json({
      success: true,
      proactive: true,
      comment: result.comment,
      action: result.action,
      modelUsed: successfulModel,
    });
  } catch (error) {
    console.error("[Sentinel] Unexpected route error:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Sentinel analysis failed",
        details: String(error),
      },
      { status: 500 }
    );
  }
}
