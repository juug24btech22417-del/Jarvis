// Tier 3D — Optional LLM polish for briefings. Local briefing is the
// fallback if this route errors or no API key is set.

import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "meta-llama/llama-3.1-8b-instruct:free";

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function POST(req: NextRequest) {
  let body: { kind?: string; draft?: { greeting?: string; body?: string; short?: string } } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const draft = body.draft;
  if (!draft?.body) {
    return NextResponse.json({ error: "Missing draft" }, { status: 400 });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ body: draft.body });
  }

  const systemPrompt = [
    "You are JARVIS, Tony Stark's AI butler — composed, dry humor, concise.",
    "Rewrite the user's draft briefing so it reads like a natural spoken JARVIS line-up.",
    "Keep every concrete fact (numbers, names, events) from the draft.",
    "Be brief: 1-3 short sentences. British inflection. No emoji.",
  ].join(" ");

  try {
    const response = await fetchWithTimeout(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Draft greeting: "${draft.greeting ?? ""}"\nDraft body: "${draft.body}"\nRewrite concisely.`,
          },
        ],
        max_tokens: 220,
        temperature: 0.6,
      }),
    }, 8000);

    if (!response.ok) {
      return NextResponse.json({ body: draft.body });
    }

    const data = await response.json();
    const polished = data?.choices?.[0]?.message?.content?.trim?.();
    return NextResponse.json({ body: polished || draft.body });
  } catch {
    return NextResponse.json({ body: draft.body });
  }
}