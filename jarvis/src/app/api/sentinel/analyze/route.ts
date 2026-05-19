import { NextRequest, NextResponse } from "next/server";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

const SENTINEL_PROMPT = `You are JARVIS, Tony Stark's advanced AI. You are performing passive observation of the user's screen.
Observe the provided screenshot and identify any noteworthy context:
1. Coding errors or bugs visible in an editor.
2. Interesting news, products, or information the user is browsing.
3. Potential improvements to the user's current task.
4. Security risks (e.g., exposed keys, though keep it brief).

CRITICAL RULES:
- If nothing important or noteworthy is happening, respond ONLY with the word "PASS".
- If you see something interesting, provide a brief, witty, and helpful comment in the personality of JARVIS (polite, British, slightly sarcastic but loyal).
- Keep your comment under 20 words.
- Do NOT repeat yourself.

Current observation mode: Passive Sentinel.`;

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

    // Call NVIDIA API with vision (Llama-3.2-90b-vision is great for this)
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
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content?.trim() || "PASS";

    // If the model is being talkative despite the prompt, check for "PASS"
    if (analysis.toUpperCase().includes("PASS") && analysis.length < 10) {
      return NextResponse.json({ success: true, proactive: false });
    }

    return NextResponse.json({
      success: true,
      proactive: true,
      comment: analysis,
    });
  } catch (error) {
    console.error("Sentinel analysis error:", error);
    return NextResponse.json(
      { error: "Analysis failed", details: String(error) },
      { status: 500 }
    );
  }
}
