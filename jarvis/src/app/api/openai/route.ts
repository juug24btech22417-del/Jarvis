import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OpenRouter API key not configured" },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { messages, model = "openai/gpt-oss-120b:free", temperature = 0.7, max_tokens = 1000 } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "JARVIS AI Assistant",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("[OpenRouter] Error:", response.status, errorData);
      return NextResponse.json(
        { error: "Failed to generate response", details: errorData },
        { status: response.status }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      content: data.choices?.[0]?.message?.content || "",
      usage: data.usage,
      model: data.model,
    });

  } catch (error: any) {
    console.error("[OpenRouter] Error:", error);
    return NextResponse.json(
      { error: "Failed to process request", details: error.message },
      { status: 500 }
    );
  }
}

// Health check endpoint
export async function GET(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      configured: false,
      message: "Add OPENROUTER_API_KEY to .env.local",
    });
  }

  // Try a quick test call
  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b:free",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
    });

    if (response.ok) {
      return NextResponse.json({
        configured: true,
        status: "connected",
        model: "openai/gpt-oss-120b:free",
      });
    } else {
      const error = await response.json().catch(() => ({}));
      return NextResponse.json({
        configured: true,
        status: "error",
        error: error.error?.message || "Connection failed",
      });
    }
  } catch (e: any) {
    return NextResponse.json({
      configured: true,
      status: "error",
      error: e.message,
    });
  }
}
