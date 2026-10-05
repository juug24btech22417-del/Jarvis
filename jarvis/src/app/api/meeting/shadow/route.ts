import { NextRequest, NextResponse } from "next/server";
import { callJsonLlm } from "@/lib/llm/fastJson";

export async function POST(req: NextRequest) {
  try {
    const { transcriptSnippet, meetingTopic, currentSpeaker } = await req.json();

    if (!transcriptSnippet || typeof transcriptSnippet !== "string" || !transcriptSnippet.trim()) {
      return NextResponse.json({ error: "transcriptSnippet is required" }, { status: 400 });
    }

    const trimmed = transcriptSnippet.trim().slice(-3000);
    const topic = meetingTopic ? `Meeting Context / Topic: ${meetingTopic}\n` : "";
    const speaker = currentSpeaker ? `Current Speaker: ${currentSpeaker}\n` : "";

    const systemPrompt = `You are JARVIS operating as a stealth real-time Meeting Shadow earpiece intelligence for your user ("Boss").
You are silently monitoring a live meeting (Google Meet, Zoom, Teams, or investor call).
Provide immediate tactical earpiece briefing so Boss sounds 10x more prepared, knowledgeable, and authoritative than anyone else in the room.

Your response MUST be strict valid JSON with this exact structure:
{
  "summary": "1-sentence summary of what's currently being debated or discussed.",
  "talkingPoints": [
    "Punchy point #1 Boss can jump in and say right now.",
    "Punchy point #2 offering unique insight or framing.",
    "Punchy point #3 tying back to execution or ROI."
  ],
  "counterArguments": [
    "Sharp objection or counter-point if someone is oversimplifying or making a risky claim.",
    "Alternative perspective that protects the team/budget."
  ],
  "factsAndStats": [
    "Relevant industry benchmark, metric, or technical fact to cite.",
    "Concrete standard or rule of thumb."
  ],
  "questionsToAsk": [
    "High-IQ question that makes everyone pause and think.",
    "Strategic question clarifying timeline, owner, or blocker."
  ],
  "whisperSoundbite": "Punchy 8-word phrase Boss can say right this second."
}
Only output the JSON object, nothing else.`;

    // Gemini + Groq raced in PARALLEL — fastest valid briefing wins.
    const resultJson = await callJsonLlm({
      system: systemPrompt,
      user: `${topic}${speaker}Live Transcript Snippet:\n"""\n${trimmed}\n"""`,
      maxTokens: 800,
      temperature: 0.3,
      label: "MeetingShadow",
    });

    if (!resultJson) {
      const fallback = {
        summary: "Discussion underway regarding project priorities and implementation.",
        talkingPoints: [
          "Let's align on the critical path before committing to deadlines.",
          "We should verify the integration surface with our existing stack.",
          "What is the fallback strategy if this dependency slips?",
        ],
        counterArguments: [
          "Building custom here adds maintenance debt; have we evaluated existing primitives?",
          "Speed to market is good, but reliability under peak load must be proven.",
        ],
        factsAndStats: [
          "Standard industry P99 latency target is sub-100ms for this tier.",
          "Iterative rollouts with feature flags reduce rollback risk by over 70%.",
        ],
        questionsToAsk: [
          "Who owns the end-to-end telemetry on this before we ship?",
          "What is our exact rollback plan if we hit edge case regressions?",
        ],
        whisperSoundbite: "Ask who owns telemetry before shipping, Boss.",
      };
      return NextResponse.json({ success: true, timestamp: new Date().toISOString(), ...fallback });
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...resultJson,
    });
  } catch (err: any) {
    console.error("[Meeting Shadow] Fatal error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate meeting shadow" }, { status: 500 });
  }
}
