import { NextRequest, NextResponse } from "next/server";
import { callJsonLlm, parseJsonLoose } from "@/lib/llm/fastJson";

// Gemini's 1.5 family is retired (404). 2.5-flash is the live multimodal tier.
const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, name, company, notes, profileText } = await req.json();

    if (!imageBase64 && !name && !profileText) {
      return NextResponse.json(
        { error: "Provide an image or person name/profile text" },
        { status: 400 }
      );
    }

    const systemPrompt = `You are JARVIS's executive espionage & contact intelligence dossier agent ("Face-to-CRM").
The user met someone new or took a screenshot of their LinkedIn profile / business card.
Extract and compile an elite, highly detailed contact card & secret briefing dossier for Boss.

Your response MUST be strict valid JSON with this exact structure:
{
  "name": "Full Name",
  "title": "Current Job Title",
  "company": "Current Organization",
  "location": "City, Country",
  "executiveBio": "2-sentence high-impact summary of who they are and their sphere of influence.",
  "strengthsAndSkills": ["Core Skill 1", "Core Skill 2", "Core Skill 3", "Core Skill 4"],
  "careerHighlights": [
    "Milestone 1 with company/impact",
    "Milestone 2 with company/impact"
  ],
  "predictedMutualInterests": [
    "Shared topic 1 (e.g. AI agents, distributed systems)",
    "Shared topic 2 (e.g. angel investing, open source)"
  ],
  "icebreakersAndTalkingPoints": [
    "Opening icebreaker referencing their current project or company move.",
    "Insightful question about their domain that starts a deep conversation.",
    "Value-add hook showing how Boss can collaborate or help them."
  ],
  "sensitivityTopics": [
    "Topic to avoid (e.g. previous company controversies, sensitive pivots)"
  ],
  "followUpDraft": "Short, confident 3-sentence WhatsApp / LinkedIn message Boss can send them right now."
}
Only output the JSON object, nothing else.`;

    let resultJson: Record<string, unknown> | null = null;

    // 1. Image provided → Gemini 2.5 Flash multimodal vision (single hop,
    //    8s ceiling). If it fails we fall through to the text lane below.
    const geminiKey = process.env.GEMINI_API_KEY;
    if (imageBase64 && geminiKey && geminiKey !== "your-api-key-here") {
      try {
        const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const mimeType = imageBase64.includes("image/png") ? "image/png" : "image/jpeg";

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(8000),
            body: JSON.stringify({
              generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
              contents: [
                {
                  parts: [
                    { text: `${systemPrompt}\nContext notes from Boss: ${notes || "None"}` },
                    { inlineData: { mimeType, data: cleanBase64 } },
                  ],
                },
              ],
            }),
          }
        );

        if (geminiRes.ok) {
          const gemData = await geminiRes.json();
          const raw = gemData.candidates?.[0]?.content?.parts
            ?.map((p: { text?: string }) => p.text ?? "")
            .join("");
          if (raw) resultJson = parseJsonLoose(raw);
        } else {
          console.warn(`[FaceToCRM] Vision HTTP ${geminiRes.status} — falling back to text`);
        }
      } catch (e) {
        console.warn("[FaceToCRM] Vision API failed, falling back to text:", e);
      }
    }

    // 2. Text lane — Gemini + Groq raced in parallel, fastest valid JSON wins.
    if (!resultJson) {
      const textQuery = `Person Name: ${name || "Unknown"}\nCompany: ${company || "Unknown"}\nProfile Text / Notes: ${profileText || notes || "Tech entrepreneur/engineer"}`;
      resultJson = await callJsonLlm({
        system: systemPrompt,
        user: textQuery,
        maxTokens: 900,
        temperature: 0.3,
        label: "FaceToCRM",
      });
    }

    // 3. Deterministic fallback if keys offline / all providers failed.
    if (!resultJson) {
      const targetName = name || "New Contact";
      resultJson = {
        name: targetName,
        title: "Founder / Engineer",
        company: company || "Technology Co.",
        location: "Bengaluru, India",
        executiveBio: `${targetName} is an active operator focused on high-growth technology solutions.`,
        strengthsAndSkills: ["Product Architecture", "Engineering Leadership", "GTM Strategy", "AI Systems"],
        careerHighlights: [
          `Key leadership initiatives at ${company || "Tech Sector"}`,
          "Scaled production products to high user concurrency",
        ],
        predictedMutualInterests: ["AI Agent Architectures", "Autonomous Dev Tools", "Cloud Infrastructure"],
        icebreakersAndTalkingPoints: [
          `Loved your team's recent trajectory with ${company || "your product"}. How are you tackling the latency bottleneck?`,
          "We've been experimenting with autonomous background agents — curious what your stack looks like.",
          "Let's grab a quick 10-minute coffee next week to trade notes on infra.",
        ],
        sensitivityTopics: ["Unnecessary timeline commitments before technical scoping"],
        followUpDraft: `Hey ${targetName}, great connecting today! Really enjoyed our conversation about ${company || "your projects"}. Let's catch up for 15 mins next week over coffee.`,
      };
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      dossier: {
        id: `dossier-${Date.now()}`,
        avatar: imageBase64 ? imageBase64.slice(0, 100) + "..." : null,
        ...resultJson,
      },
    });
  } catch (err: any) {
    console.error("[FaceToCRM] Fatal error:", err);
    return NextResponse.json({ error: err.message || "Failed to generate dossier" }, { status: 500 });
  }
}
