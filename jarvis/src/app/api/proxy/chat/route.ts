import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Ordered list of free models to try — falls back if one is rate-limited
const FREE_MODELS = [
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
];

const PROXY_CHAT_SYSTEM_PROMPT = `You are J.A.R.V.I.S., Tony Stark's extremely advanced, loyal, and witty AI assistant. 
You are assisting the user directly inside their active browser session. 
They are browsing a webpage, and you have access to their current URL and DOM page content.

Context:
- URL: {{url}}
- Page Content (DOM extract):
{{domContent}}

Instructions:
- Address the user's query directly using the page context provided.
- Maintain the JARVIS personality (eloquent, British, polite, slightly sarcastic but deeply helpful).
- If they ask to summarize the page, provide a bulleted summary of the most critical insights.
- If they ask to extract details, be precise.
- Keep your answers concise, readable, and structured.`;

// Helper to set CORS headers
function corsResponse(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE, PUT");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export async function OPTIONS() {
  const res = NextResponse.json({ success: true });
  return corsResponse(res);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { query, url, domContent } = body;

    if (!query) {
      return corsResponse(NextResponse.json({ success: false, error: "Query is required" }, { status: 400 }));
    }

    if (!OPENROUTER_API_KEY) {
      return corsResponse(NextResponse.json(
        { success: false, error: "OPENROUTER_API_KEY is not configured in environment." },
        { status: 500 }
      ));
    }

    const systemPrompt = PROXY_CHAT_SYSTEM_PROMPT
      .replace("{{url}}", url || "Unknown")
      .replace("{{domContent}}", (domContent || "No content extracted from page.").slice(0, 10000));

    let lastError: string = "All models failed";

    // Try each model in order until one works
    for (const model of FREE_MODELS) {
      try {
        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "JARVIS",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: query },
            ],
            temperature: 0.7,
            max_tokens: 800,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          lastError = errorData?.error?.message || `Model ${model} returned status ${response.status}`;
          console.warn(`[Proxy Chat] Model ${model} failed: ${lastError}`);
          continue; // try next model
        }

        const data = await response.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || "Apologies, Boss. I was unable to parse a response.";

        return corsResponse(NextResponse.json({ success: true, response: reply, model }));
      } catch (modelErr: any) {
        lastError = modelErr?.message || String(modelErr);
        console.warn(`[Proxy Chat] Model ${model} threw: ${lastError}`);
      }
    }

    // All models failed
    throw new Error(lastError);
  } catch (error: any) {
    console.error("[Proxy Chat Error]:", error);
    return corsResponse(NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    ));
  }
}
