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

const OPENROUTER_TEXT_MODELS = [
  "google/gemma-3-27b-it:free",
  "google/gemma-4-26b-a4b-it:free",
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

const SENTINEL_TEXT_PROMPT = `You are JARVIS Sentinel Eyes, an AI desktop assistant.
The visual screen capture is unavailable, but you have been provided with a text-based snapshot of the user's desktop:
- The foreground window title and process
- A list of all visible windows
- Top running processes by CPU/memory

Analyze this information to understand what the user ("Boss") is currently doing.
Provide a sharp, observant 1-2 sentence comment in JARVIS's polite, witty assistant persona (addressing the user as 'Boss').
Also identify an optional proactive action (task, reminder, debug suggestion, or security risk).

You MUST reply with ONLY a raw valid JSON object in this exact schema:
{
  "proactive": true,
  "comment": "I see you have VS Code and Chrome open, Boss. Looks like a productive coding session.",
  "action": {
    "type": "task",
    "title": "Workspace monitoring",
    "details": "Desktop activity tracked via process analysis.",
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

/**
 * Text-based analysis fallback when screen capture returns black/empty.
 * Uses a text-only LLM to analyze active window/process info.
 */
async function tryTextAnalysis(desktopContext: string): Promise<string> {
  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY === "your-api-key-here") {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  for (const model of OPENROUTER_TEXT_MODELS) {
    try {
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
              content: `${SENTINEL_TEXT_PROMPT}\n\n--- DESKTOP SNAPSHOT ---\n${desktopContext}`,
            },
          ],
          max_tokens: 450,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(16000),
      });

      if (!res.ok) continue;

      const data = await res.json();
      const content = data.choices?.[0]?.message?.content?.trim();
      if (content) return content;
    } catch {
      continue;
    }
  }

  throw new Error("All text models failed");
}

function parseVisionResponse(rawText: string) {
  let cleaned = rawText.trim();

  // Try to find first JSON structure
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === "object") {
        const comment = parsed.comment?.trim();
        if (comment && comment.length > 3 && !comment.startsWith("```")) {
          return {
            proactive: true,
            comment,
            action: parsed.action || {
              type: "task",
              title: "Workspace Observation",
              details: "Screen analyzed and parameters recorded.",
              metadata: {},
            },
          };
        }
      }
    } catch {
      // Fall through to text cleanup
    }
  }

  // Strip code blocks, markdown ticks, thinking tags
  const withoutCodeBlocks = cleaned
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();

  const lines = withoutCodeBlocks
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("{") && !l.startsWith("}") && !l.startsWith('"'));

  const cleanComment =
    lines.find((l) => l.length > 10) ||
    "I have analyzed your active desktop, Boss. Everything appears in order.";

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
    const { imageBase64, desktopContext } = body;

    // If we have desktop context (text fallback from black screen), use text analysis
    if (desktopContext && !imageBase64) {
      console.log("[Sentinel] Using text-based analysis (screen capture unavailable)...");
      try {
        const rawOutput = await tryTextAnalysis(desktopContext);
        const result = parseVisionResponse(rawOutput);
        return NextResponse.json({
          success: true,
          proactive: true,
          comment: result.comment,
          action: result.action,
          modelUsed: "text-fallback",
          mode: "text",
        });
      } catch (textErr: any) {
        console.warn("[Sentinel] Text analysis failed:", textErr?.message);
        // Return a generic context-aware comment based on the raw context
        const fgMatch = desktopContext.match(/FOREGROUND_WINDOW:\s*(.+)/i);
        const fgProc = desktopContext.match(/FOREGROUND_PROCESS:\s*(.+)/i);
        const fgWindow = fgMatch?.[1]?.trim() || "your desktop";
        const fgApp = fgProc?.[1]?.trim() || "an application";

        return NextResponse.json({
          success: true,
          proactive: true,
          comment: `Boss, I can see you're working with ${fgApp}${fgWindow ? ` — "${fgWindow}"` : ""}. All systems nominal.`,
          action: {
            type: "task",
            title: "Desktop Monitoring",
            details: `Active application: ${fgApp}. Window: ${fgWindow}.`,
            metadata: {},
          },
          modelUsed: "context-fallback",
          mode: "text",
        });
      }
    }

    if (!imageBase64) {
      return NextResponse.json({ error: "Image or desktop context required" }, { status: 400 });
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
      mode: "vision",
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
