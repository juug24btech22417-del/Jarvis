// Telegram image description.
//
// Single working free-tier vision model on OpenRouter (verified
// 2026-08-13): `nvidia/nemotron-nano-12b-v2-vl:free`. The previous
// chain of paid Gemini / Llama-VL models returned 404 for this user —
// their OpenRouter key has no credits. We try the free model first
// and only fall back to the paid Gemini if the user opts in by
// setting `TELEGRAM_VISION_MODEL` in env.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_VISION_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";

export async function describeImage(
  buff: Buffer,
  mime: string,
  prompt: string,
  opts: { model?: string } = {}
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "your-api-key-here") {
    throw new Error("OPENROUTER_API_KEY not set");
  }

  // Caller override > env var > default free model.
  const preferredModel =
    opts.model ||
    process.env.TELEGRAM_VISION_MODEL ||
    DEFAULT_VISION_MODEL;

  const modelsToTry = [
    preferredModel,
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "openrouter/free"
  ];

  let lastError: any = null;
  for (const currentModel of modelsToTry) {
    try {
      console.log(`[telegram/vision] attempting description using model: ${currentModel}`);
      const text = await tryOpenRouter(currentModel, buff, mime, prompt);
      return text;
    } catch (err: any) {
      console.warn(`[telegram/vision] model ${currentModel} failed:`, err?.message || err);
      lastError = err;
    }
  }

  throw lastError || new Error("All vision models failed");
}

// ───────────────────────── provider helpers ─────────────────────────

async function tryOpenRouter(
  model: string,
  buff: Buffer,
  mime: string,
  prompt: string
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === "your-api-key-here") {
    throw new Error("OPENROUTER_API_KEY not set");
  }

  const dataUrl = `data:${mime};base64,${buff.toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000); // 25s cap per attempt since we have fallbacks

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "JARVIS Telegram Vision",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt || "Describe this image in detail." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        // Generous token budget so descriptions don't truncate mid-word.
        // 4000 tokens ≈ 3k words; the free model supports this.
        max_tokens: 4000,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`OpenRouter vision ${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = (await res.json()) as any;
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("OpenRouter vision returned empty content");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
