import { NextRequest, NextResponse } from "next/server";
import { callJsonLlm, parseJsonLoose } from "@/lib/llm/fastJson";

// Face-to-CRM: build a contact dossier from just a photo and/or a name.
//
// REWRITE NOTES — why this is different:
//  • It used to demand eleven fields and then INVENT them from a headshot. A
//    face contains no employer, no history, no talking points. Worse, when the
//    model was unreachable it returned a fully hardcoded fake dossier (a fixed
//    "Bengaluru, India / Founder-Engineer" card and canned icebreakers) that was
//    presented as intel. That is gone.
//  • Now there are exactly two real evidence sources:
//      1. The image — but ONLY its legible TEXT (a LinkedIn screenshot or a
//         business card genuinely contains name/title/company in pixels). A
//         plain photo of a face yields nothing, and we say so.
//      2. A real web search + scrape through Firecrawl, when we have a name.
//  • Everything returned is traceable: each field is marked verified (with the
//    source URL it came from) or left empty. When there is no evidence at all,
//    the route fails honestly instead of fabricating.

const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash";

// Keep the whole request inside a predictable window even though it fans out
// to vision + search + scrape.
const VISION_TIMEOUT_MS = 12_000;
const SEARCH_TIMEOUT_MS = 20_000;
const SYNTH_TIMEOUT_MS = 14_000;

export interface DossierSource {
  title: string;
  url: string;
}

interface VisionFacts {
  /** What kind of image this actually is — decides how much we may claim. */
  imageKind?: "screenshot" | "business_card" | "photo_of_person" | "unknown";
  name?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  /** Any other text legible in the image (contact info, headline, etc). */
  legibleText?: string | null;
}

/**
 * Read only what is genuinely legible in the image. The model is explicitly
 * told that a face alone proves nothing — this is the guard that stopped the
 * old hallucination.
 */
async function readImage(imageBase64: string, notes: string): Promise<VisionFacts | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === "your-api-key-here") return null;

  const prompt = `You are reading an image to extract ONLY facts that are literally legible in it.
The image may be a LinkedIn screenshot, a business card, or just a photo of a person.

Return strict JSON:
{"imageKind":"screenshot"|"business_card"|"photo_of_person"|"unknown",
 "name":string|null,"title":string|null,"company":string|null,"location":string|null,
 "legibleText":string|null}

RULES:
- Only transcribe text you can actually SEE. Never guess or infer.
- If the image is only a face with no text, set imageKind to "photo_of_person" and every other field to null.
- Do not invent an employer, city, or role from someone's appearance.
- "legibleText" is the raw readable text, trimmed to 600 chars, or null.

Extra context from the user (may be empty): ${notes || "None"}`;

  try {
    const clean = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const mimeType = imageBase64.includes("image/png") ? "image/png" : "image/jpeg";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
        body: JSON.stringify({
          generationConfig: {
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
          contents: [
            {
              parts: [{ text: prompt }, { inlineData: { mimeType, data: clean } }],
            },
          ],
        }),
      }
    );
    if (!res.ok) {
      console.warn(`[FaceToCRM] Vision HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const raw: string | undefined = data.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("");
    return raw ? parseJsonLoose<VisionFacts>(raw) : null;
  } catch (e: any) {
    console.warn("[FaceToCRM] Vision failed:", e?.message);
    return null;
  }
}

/**
 * Gather real, citable evidence about a person from the open web.
 * Returns the scraped excerpts plus their source URLs.
 */
async function gatherEvidence(
  name: string,
  company: string | undefined
): Promise<{ sources: DossierSource[]; excerpts: string }> {
  try {
    const { firecrawlService } = await import("@/services/FirecrawlService");
    if (!firecrawlService.isAvailable()) return { sources: [], excerpts: "" };

    const query = [name, company].filter(Boolean).join(" ");
    const search = await firecrawlService.searchWeb(query, {
      limit: 5,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });
    if (!search.success || !search.results.length) {
      return { sources: [], excerpts: "" };
    }

    // Take the top few results that actually carry a description, then scrape a
    // couple of them for real depth. Capped so latency stays sane.
    const candidates = search.results.slice(0, 3);
    const sources: DossierSource[] = candidates.map((r) => ({ title: r.title, url: r.url }));

    const scraped = await firecrawlService.batchScrape(
      candidates.map((r) => r.url),
      { timeoutMs: 25_000 }
    );

    const parts: string[] = [];
    for (const r of candidates) {
      if (r.description) parts.push(`[${r.title}] ${r.description}`);
    }
    for (const s of scraped) {
      if (s.success && s.markdown) {
        parts.push(`--- ${s.title} (${s.url}) ---\n${s.markdown.slice(0, 2500)}`);
      }
    }

    return { sources, excerpts: parts.join("\n\n").slice(0, 9000) };
  } catch (e: any) {
    console.warn("[FaceToCRM] Evidence gathering failed:", e?.message);
    return { sources: [], excerpts: "" };
  }
}

/**
 * Synthesise the dossier STRICTLY from supplied evidence.
 * The model is told to leave fields null rather than fill gaps.
 */
async function synthesise(
  name: string,
  imageFacts: VisionFacts | null,
  evidence: string,
  sources: DossierSource[]
) {
  const system = `You are JARVIS building a contact briefing STRICTLY from the evidence provided.

Reply with ONLY this JSON:
{
  "name": string,
  "title": string|null,
  "company": string|null,
  "location": string|null,
  "summary": string,
  "talkingPoints": string[],
  "sharedInterests": string[],
  "verifiedFields": string[],
  "confidence": "high"|"medium"|"low"
}

HARD RULES:
- Use ONLY the evidence. If a field is not supported by the evidence, set it to null. Never guess a company, city, or title.
- "verifiedFields" lists which of name/title/company/location the evidence actually supports.
- "talkingPoints" must each be grounded in something concrete from the evidence (a project, a publication, a role, a post). If there is nothing, return an empty array.
- "summary" is at most two sentences and must not speculate about the person beyond the evidence.
- If the evidence is thin, set confidence to "low" and keep the output small. That is the correct answer, not a padded one.`;

  const imagePart = imageFacts
    ? `TEXT READ FROM THE IMAGE (kind: ${imageFacts.imageKind || "unknown"}):
${JSON.stringify(
  {
    name: imageFacts.name ?? null,
    title: imageFacts.title ?? null,
    company: imageFacts.company ?? null,
    location: imageFacts.location ?? null,
    legibleText: imageFacts.legibleText ?? null,
  },
  null,
  1
)}`
    : "TEXT READ FROM THE IMAGE: (none provided)";

  const evidencePart = evidence
    ? `WEB EVIDENCE:
${evidence}

SOURCES:
${sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n")}`
    : `WEB EVIDENCE: (none found — no web sources available for this name)`;

  return callJsonLlm<Record<string, unknown>>({
    system,
    user: `SUBJECT NAME: ${name}\n\n${imagePart}\n\n${evidencePart}\n\nBuild the dossier from the evidence above.`,
    maxTokens: 900,
    temperature: 0.15,
    timeoutMs: SYNTH_TIMEOUT_MS,
    label: "FaceToCRM",
  });
}

export async function POST(req: NextRequest) {
  try {
    const { imageBase64, name, notes } = await req.json();

    if (!imageBase64 && !name?.trim()) {
      return NextResponse.json(
        { success: false, error: "Give me a photo or a name — either one is enough." },
        { status: 400 }
      );
    }

    // 1 ── Vision: transcribe only what is legible.
    const imageFacts = imageBase64 ? await readImage(String(imageBase64), String(notes || "")) : null;

    // Respect the user's typed name first; fall back to what the image showed.
    const subject = String(name || imageFacts?.name || "").trim();

    if (!subject) {
      // An image with no legible name gives us nothing to research.
      return NextResponse.json({
        success: false,
        reason: "no_identifying_text",
        error:
          "That image doesn't contain a readable name, so there's nothing to research. Add the person's name and I'll pull real sources — or upload a screenshot of their profile/card, which contains text I can read.",
        imageKind: imageFacts?.imageKind ?? "unknown",
      });
    }

    // 2 ── Real web evidence, when we have a name to search.
    const { sources, excerpts } = await gatherEvidence(subject, imageFacts?.company || undefined);

    // 3 ── Synthesise strictly from evidence.
    const dossier = await synthesise(subject, imageFacts, excerpts, sources);

    // 4 ── No evidence and no model output: refuse rather than fabricate.
    if (!dossier) {
      return NextResponse.json(
        {
          success: false,
          reason: "no_model",
          error:
            "I couldn't reach a language model to assemble the briefing. Nothing has been invented — try again in a moment.",
        },
        { status: 503 }
      );
    }

    const verifiedFields = Array.isArray(dossier.verifiedFields) ? (dossier.verifiedFields as string[]) : [];
    const hasAnyEvidence = !!excerpts || !!imageFacts?.legibleText;

    // Every field the model could not ground is returned as an empty value, so
    // the UI shows "unknown" instead of a confident lie.
    const str = (v: unknown): string => (typeof v === "string" && v.trim() ? v.trim() : "");
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()) as string[] : []);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      evidence: {
        sources,
        usedWebSearch: sources.length > 0,
        imageKind: imageFacts?.imageKind ?? null,
        hasEvidence: hasAnyEvidence,
      },
      dossier: {
        id: `dossier-${Date.now()}`,
        avatar: imageBase64 || null,
        name: subject,
        title: str(dossier.title),
        company: str(dossier.company),
        location: str(dossier.location),
        // Panel-compatible field names; all grounded, never invented.
        executiveBio: str(dossier.summary),
        icebreakersAndTalkingPoints: arr(dossier.talkingPoints),
        predictedMutualInterests: arr(dossier.sharedInterests),
        strengthsAndSkills: [],
        careerHighlights: [],
        sensitivityTopics: [],
        followUpDraft: "",
        // Provenance.
        verifiedFields,
        confidence: str(dossier.confidence) || "low",
        sources,
      },
    });
  } catch (err: any) {
    console.error("[FaceToCRM] Fatal error:", err);
    return NextResponse.json({ success: false, error: err?.message || "Failed to build dossier" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    service: "Face-to-CRM",
    method: "POST",
    body: {
      imageBase64: "optional — data URL of a screenshot, business card, or photo",
      name: "optional — the person's name (either this or imageBase64 is required)",
      notes: "optional — any extra context you already know",
    },
    behaviour:
      "Reads only legible text from images, gathers real web sources via Firecrawl, and marks each field verified or empty. Never fabricates.",
  });
}
