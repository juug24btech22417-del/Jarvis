// Telegram voice-note transcription via Groq's OpenAI-compatible
// Whisper endpoint. Free tier, `whisper-large-v3-turbo` model. Audio
// arrives from Telegram as `.ogg` (Opus codec); we forward the raw
// bytes — Groq accepts ogg/opus/mp4/wav/webm.

const GROQ_ENDPOINT =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export async function transcribeOggOpus(
  buff: Buffer,
  opts: { model?: string; mimeHint?: string } = {}
): Promise<TranscriptionResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === "your_groq_api_key_here") {
    throw new Error("GROQ_API_KEY not set");
  }

  const form = new FormData();
  // Convert Buffer → Uint8Array so Blob's underlying typing accepts
  // it across Node and browser-style FormData implementations.
  const blob = new Blob([new Uint8Array(buff)], {
    type: opts.mimeHint || "audio/ogg",
  });
  form.append("file", blob, "voice.ogg");
  form.append("model", opts.model ?? DEFAULT_MODEL);
  form.append("response_format", "verbose_json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000); // 30s cap

  let res: Response;
  try {
    res = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: controller.signal,
    });
  } catch (e: any) {
    throw new Error(
      `Groq transcription fetch failed: ${e?.name || ""} ${e?.message || e}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Groq transcription ${res.status}: ${errBody.slice(0, 200)}`
    );
  }

  const data = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
  };
  const text = (data.text ?? "").trim();
  if (!text) {
    throw new Error("Groq returned empty transcription");
  }
  return {
    text,
    language: data.language,
    duration: data.duration,
  };
}
