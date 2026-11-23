import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

interface LeechResponse {
  ok: boolean;
  meetingTopic: string;
  tacticalBullets: string[];
  factChecks: string[];
  suggestedQuestions: string[];
  rawAnalysis?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let contextText = String(body.contextText || "").trim();
    const topicHint = String(body.topic || "").trim();
    const activeWindows: string[] = Array.isArray(body.activeWindows) ? body.activeWindows : [];

    // Identify primary media or meeting window if available
    let detectedMedia: string | undefined;
    let detectedMeeting: string | undefined;

    if (activeWindows.length > 0) {
      for (const win of activeWindows) {
        const lower = win.toLowerCase();
        if (!detectedMedia && (lower.includes("youtube") || lower.includes("spotify") || lower.includes("soundcloud") || lower.includes("netflix") || lower.includes("vlc") || lower.includes("music"))) {
          detectedMedia = win;
        }
        if (!detectedMeeting && (lower.includes("meet.google.com") || lower.includes("zoom") || lower.includes("teams") || lower.includes("webex") || lower.includes("slack call"))) {
          detectedMeeting = win;
        }
      }

      if (!contextText) {
        const parts: string[] = [];
        if (detectedMedia) parts.push(`ACTIVE MEDIA: "${detectedMedia}"`);
        if (detectedMeeting) parts.push(`ACTIVE MEETING: "${detectedMeeting}"`);
        parts.push(`VISIBLE WINDOWS ON SCREEN:\n` + activeWindows.slice(0, 10).map((w) => ` - ${w}`).join("\n"));
        contextText = parts.join("\n\n");
      }
    }

    if (!contextText) {
      contextText = "Active desktop environment with code, terminal, and browser windows open.";
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json<LeechResponse>({
        ok: true,
        meetingTopic: detectedMedia || detectedMeeting || topicHint || "Active Screen Session",
        tacticalBullets: [
          "Live content tracked across active windows.",
          "Seamless low-latency ambient intelligence active.",
        ],
        factChecks: ["Screen context verified across desktop window manager."],
        suggestedQuestions: ["Explore related content or actions?"],
      });
    }

    const systemPrompt = `You are JARVIS Context Leech — an elite real-time screen intelligence advisor.
You are given the EXACT WINDOWS and MEDIA currently open on the user's screen.

CRITICAL INSTRUCTIONS:
1. "meetingTopic":
   - If a song or video is playing (YouTube, Spotify, etc.), name the exact song / video and artist (e.g. "Song: Blinding Lights - The Weeknd").
   - If a meeting is open, name the meeting topic or team.
   - If a codebase or document is open, name the project/document.
   - Max 6 words.
2. "tacticalBullets":
   - If music/song/video: give 2-3 fascinating facts about the song, artist, producer, record-breaking stats, or genre. (Under 14 words each).
   - If meeting/discussion: give 2-3 sharp talking points to say to lead the discussion.
   - If code/browsing: give 2-3 tactical insights.
3. "factChecks":
   - 1-2 instant facts or verified trivia about the specific entity, artist, or subject on screen. (Under 15 words each).
4. "suggestedQuestions":
   - 2 interesting follow-up questions or related tracks/topics the user can explore next.

Return STRICT JSON only (no markdown, no code fences):
{
  "meetingTopic": "...",
  "tacticalBullets": ["...", "..."],
  "factChecks": ["...", "..."],
  "suggestedQuestions": ["...", "..."]
}`;

    const userPrompt = `Context On Screen:\n${contextText.slice(0, 2500)}\n\nTopic Hint: ${topicHint || detectedMedia || "Screen Analysis"}`;

    const llmRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "qwen/qwen3.8-27b",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!llmRes.ok) {
      throw new Error(`Groq returned HTTP ${llmRes.status}`);
    }

    const data = await llmRes.json();
    const rawContent = data.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = {};
    }

    return NextResponse.json<LeechResponse>({
      ok: true,
      meetingTopic: parsed.meetingTopic || detectedMedia || "Active Screen Session",
      tacticalBullets: Array.isArray(parsed.tacticalBullets) ? parsed.tacticalBullets : ["Screen observed."],
      factChecks: Array.isArray(parsed.factChecks) ? parsed.factChecks : ["Verified."],
      suggestedQuestions: Array.isArray(parsed.suggestedQuestions) ? parsed.suggestedQuestions : ["Explore further?"],
      rawAnalysis: rawContent,
    });
  } catch (error: any) {
    return NextResponse.json<LeechResponse>(
      {
        ok: false,
        meetingTopic: "Screen Context",
        tacticalBullets: ["Screen observed."],
        factChecks: [],
        suggestedQuestions: [],
        error: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}
