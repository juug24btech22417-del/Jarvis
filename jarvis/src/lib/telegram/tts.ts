// Telegram TTS — synthesize speech via edge-tts (Microsoft Edge's free
// TTS service) and cache the result by sha1 of normalized text. The bot
// uses `en-GB-RyanNeural` by default — a British voice that fits the
// JARVIS persona. We don't ship a fallback to ElevenLabs in v1 because
// edge-tts has been reliable on the laptop; if it ever fails we'll fall
// back to text-only with a 1-line note rather than scramble for another
// TTS provider mid-dispatch.

import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

// Edge-tts is a CJS package but exposes a default class. Lazy-load via
// dynamic import so the module-load cost isn't paid on cold start when
// voice replies are off.
type EdgeTTSConstructor = new (opts?: unknown) => {
  ttsPromise: (text: string, voice: string, opts?: unknown) => Promise<Buffer>;
};

let edgeTTSModulePromise: Promise<EdgeTTSConstructor> | null = null;

function loadEdgeTTS(): Promise<EdgeTTSConstructor> {
  if (!edgeTTSModulePromise) {
    edgeTTSModulePromise = import("edge-tts/out/index.js").then((mod: any) => {
      // The package exports both a default class and named helpers; the
      // simplest cross-version API is `new EdgeTTS().ttsPromise(...)`.
      const EdgeTTS = mod?.default ?? mod?.EdgeTTS ?? mod;
      if (typeof EdgeTTS !== "function") {
        throw new Error(
          `edge-tts: could not locate EdgeTTS class (got ${typeof EdgeTTS})`
        );
      }
      return EdgeTTS as EdgeTTSConstructor;
    });
  }
  return edgeTTSModulePromise;
}

const DEFAULT_VOICE = process.env.TELEGRAM_TTS_VOICE?.trim() || "en-GB-RyanNeural";
const FALLBACK_VOICE = "en-US-GuyNeural";

const TTS_DIR =
  process.env.JARVIS_TMP_DIR?.trim() ||
  path.join(os.tmpdir(), "jarvis-tts");

async function ensureTtsDir(): Promise<string> {
  await fs.mkdir(TTS_DIR, { recursive: true });
  return TTS_DIR;
}

function sha1Hex(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

export interface TtsOpts {
  voice?: string;
  rate?: string;   // "+0%", "-10%", etc.
  pitch?: string;  // "+0Hz", "-2Hz", etc.
}

/**
 * Synthesize `text` to an MP3 file and return its absolute path.
 *
 * Cache key is sha1 of (normalized text + voice + rate + pitch) so
 * repeated replies for the same question don't re-hit the TTS endpoint.
 *
 * Caps the input at 1500 chars to keep voice duration under Telegram's
 * 50MB sendVoice limit; for longer replies the caller should split or
 * skip the voice.
 */
export async function synthesizeSpeech(
  text: string,
  opts: TtsOpts = {}
): Promise<string> {
  const capped = text.length > 1500 ? text.slice(0, 1500) + "…" : text;
  const voice = opts.voice || DEFAULT_VOICE;
  const rate = opts.rate ?? "+0%";
  const pitch = opts.pitch ?? "+0Hz";

  const dir = await ensureTtsDir();
  const key = sha1Hex(`${voice}|${rate}|${pitch}|${capped}`);
  const outPath = path.join(dir, `${key}.mp3`);

  // Cache hit.
  try {
    const stat = await fs.stat(outPath);
    if (stat.isFile() && stat.size > 0) return outPath;
  } catch {
    // file doesn't exist yet — fall through to synthesize.
  }

  const EdgeTTS = await loadEdgeTTS();

  // Primary voice; on failure fall back once to a different voice before
  // giving up.
  for (const tryVoice of [voice, voice === DEFAULT_VOICE ? FALLBACK_VOICE : null]) {
    if (!tryVoice) break;
    try {
      const tts = new EdgeTTS();
      const buf = await tts.ttsPromise(capped, tryVoice, {
        rate,
        pitch,
        // Some versions accept outputFormat; harmless to ignore.
      });
      if (!buf || buf.length === 0) throw new Error("empty tts buffer");
      await fs.writeFile(outPath, buf);
      return outPath;
    } catch (err: any) {
      console.warn(
        `[telegram/tts] edge-tts failed for voice=${tryVoice}:`,
        err?.message || err
      );
      // Try the fallback voice.
    }
  }

  throw new Error("TTS synthesis failed for all voices");
}

/**
 * Best-effort: synthesize + return null on failure (caller can drop
 * the voice reply silently rather than surface the error to the user).
 */
export async function trySynthesizeSpeech(
  text: string,
  opts: TtsOpts = {}
): Promise<string | null> {
  try {
    return await synthesizeSpeech(text, opts);
  } catch (err: any) {
    console.error("[telegram/tts] silent fail:", err?.message || err);
    return null;
  }
}
