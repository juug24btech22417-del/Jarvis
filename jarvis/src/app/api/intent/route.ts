import { NextRequest, NextResponse } from "next/server";
import { INTENT_SYSTEM_PROMPT, detectBrowserTask } from "@/lib/jarvis/personality";

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || process.env.NEXT_PUBLIC_NVIDIA_API_KEY;

// The intent parse is a convenience, not a gate — but the timeout has to leave
// room for the global fetch retry (see lib/net/fetchRetry.ts) to recover from a
// transient DNS failure. A 1.5s ceiling killed the retry mid-flight and silently
// degraded every command to "chat".
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

    // 1) Primary: Groq. The catalog prompt costs ~4k prompt tokens, and Groq's
    // free tier rate-limits PER MODEL — so one 429 on the preferred model used
    // to send every following command down the fallback and silently turn it
    // into "chat" (which is why commands appeared to stop acting on things).
    // A second model with its own quota keeps the parser alive.
    if (GROQ_API_KEY && GROQ_API_KEY.trim() !== "" && GROQ_API_KEY !== "your-api-key-here") {
      const models = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b"];
      for (const model of models) {
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
                model,
                messages: [
                  { role: "system", content: INTENT_SYSTEM_PROMPT },
                  { role: "user", content: text },
                ],
                temperature: 0.1,
                max_tokens: 128,
                response_format: { type: "json_object" },
              }),
            },
            2600
          );

          if (!response.ok) {
            // Non-OK used to fall through in total silence, which hid a hard
            // rate limit behind an endless run of "fallback: true" replies.
            const detail = await response.text().catch(() => "");
            console.warn(
              `[Intent API] Groq ${model} HTTP ${response.status}: ${detail.slice(0, 200)}`
            );
            continue;
          }

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
          } catch {
            console.warn(`[Intent API] Groq ${model} returned unparseable JSON`);
          }
        } catch (err: any) {
          console.warn(`[Intent API] Groq ${model} failed:`, err?.message || err);
        }
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
          2600
        );

        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          console.warn(
            `[Intent API] Gemini HTTP ${response.status}: ${detail.slice(0, 200)}`
          );
        }

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

    // Both providers are unreachable. Before giving up on the expensive part of
    // the request, check whether the wording itself is an unmistakable browser
    // errand — otherwise "go to wikipedia and tell me X" gets answered from
    // memory instead of actually browsing, which is the whole point of JARVIS.
    const browse = detectBrowserTask(text);
    if (browse) {
      return NextResponse.json({
        intent: "browser_task",
        params: { task: browse.task, ...(browse.url ? { url: browse.url } : {}) },
        fallback: true,
      });
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
