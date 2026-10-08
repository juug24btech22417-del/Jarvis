// Vision path for copied IMAGES.
//
// The OS clipboard watcher can grab a bitmap (screenshot, chart, meme, photo
// of a whiteboard). Text-only providers can do nothing with that, so this
// helper calls Gemini's multimodal endpoint directly with the image inline
// and asks for the same JSON shape the text clipboard actions return, keeping
// both surfaces rendering through one code path.
//
// If no key is configured, or the provider refuses, it resolves `null` and the
// caller degrades to an honest message instead of an error.
import { parseJsonLoose } from "@/lib/llm/fastJson";

const VISION_MODELS = [
  process.env.GEMINI_JSON_MODEL,
  "gemini-2.5-flash",
  "gemini-flash-latest",
].filter(Boolean) as string[];

function geminiKey(): string | null {
  const k = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!k || !k.trim() || k.trim() === "your-api-key-here") return null;
  return k.trim();
}

export interface ImageAnalysisRequest {
  /** Raw base64 (no data-URL prefix) or a full data URL. */
  image: string;
  /** Which action the user picked ("Analyze", "Extract text", "Explain"). */
  actionLabel: string;
  instruction: string;
}

const SYSTEM = `You are JARVIS's clipboard assistant and you are looking at an image the user just copied. Do exactly the requested action. Return STRICT JSON only, no fences:
{
  "summary": "one sentence, max 200 chars, the headline finding",
  "answer": "the finished result in markdown — describe what is in the image, transcribe text verbatim when asked, explain diagrams/charts/code screenshots in detail",
  "code": "if the image contains code or a command worth reproducing, the full cleaned-up version; otherwise \\"\\"",
  "language": "language of that code, or \\"\\"",
  "soundbite": "one punchy sentence under 90 chars"
}
Be concrete: read every visible label, number and line. Never guess at content you cannot actually see — say what is unclear instead.`;

/**
 * Analyse a copied image with a multimodal model.
 * Resolves `null` when vision is unavailable — never throws.
 */
export async function analyzeImage(
  req: ImageAnalysisRequest
): Promise<Record<string, any> | null> {
  const key = geminiKey();
  if (!key) {
    console.warn("[visionSnippet] no GEMINI_API_KEY — image analysis unavailable");
    return null;
  }

  const base64 = req.image.replace(/^data:image\/\w+;base64,/, "");
  const mime = /^data:(image\/\w+);base64,/.exec(req.image)?.[1] ?? "image/png";
  if (!base64) return null;

  const prompt = [
    `Requested action: ${req.actionLabel}`,
    `Instruction: ${req.instruction}`,
    "",
    "Look at the attached image and respond with the strict JSON object now.",
  ].join("\n");

  for (const model of VISION_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM }] },
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
              maxOutputTokens: 1600,
              thinkingConfig: { thinkingBudget: 0 },
            },
            contents: [
              {
                role: "user",
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: mime, data: base64 } },
                ],
              },
            ],
          }),
        }
      );
      if (!res.ok) {
        console.warn(`[visionSnippet] ${model} HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const raw: string | undefined = data?.candidates?.[0]?.content?.parts
        ?.map((p: { text?: string }) => p.text ?? "")
        .join("");
      if (!raw) continue;
      const parsed = parseJsonLoose<Record<string, any>>(raw);
      if (parsed) return parsed;
    } catch (e) {
      console.warn("[visionSnippet] failed:", (e as Error)?.name ?? (e as Error)?.message);
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
