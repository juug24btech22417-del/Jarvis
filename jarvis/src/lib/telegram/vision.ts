// Telegram image description via OpenRouter's free Gemini 2.0 Flash
// vision endpoint. Takes the raw bytes and a caption / user prompt and
// returns the model's text reply (single-shot, no streaming).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.0-flash-exp:free";

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

  const dataUrl = `data:${mime};base64,${buff.toString("base64")}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000); // 25s cap

  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "JARVIS Telegram Vision",
      },
      body: JSON.stringify({
        model: opts.model ?? DEFAULT_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt || "Describe this image in detail." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 600,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new Error(
      `OpenRouter vision fetch failed: ${e?.name || ""} ${e?.message || e}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`OpenRouter vision ${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("OpenRouter vision returned empty content");
  }
  return text;
}
