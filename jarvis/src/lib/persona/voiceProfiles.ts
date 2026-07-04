// Tier 3B — Voice + tone profiles per persona.
// The TTS engine reads `lang` / `voice` / `rate` / `pitch` from these.

export type PersonaId = "stark" | "tactical" | "whisper" | "dev";

export interface VoiceProfile {
  id: PersonaId;
  label: string;
  description: string;
  lang: string;
  /** Browser voice-name preference; will pick the first match. */
  voiceHint: string;
  rate: number;
  pitch: number;
  /** Prefix prepended to spoken text (e.g. "Commander. "). */
  prefix: string;
  /** Reactor hue when this persona is active. */
  hue: "cyan" | "gold" | "red" | "dim";
  /** Panel highlight accent for status chips. */
  accentClass: string;
}

export const VOICE_PROFILES: Record<PersonaId, VoiceProfile> = {
  stark: {
    id: "stark",
    label: "Stark",
    description: "Default. Quippy, terse, dry humor. British inflection.",
    lang: "en-GB",
    voiceHint: "Google UK English Male",
    rate: 1.05,
    pitch: 1.0,
    prefix: "",
    hue: "cyan",
    accentClass: "text-reactor-core",
  },
  tactical: {
    id: "tactical",
    label: "Tactical",
    description: "Full briefings. No jokes. Military format. Slower, lower pitch.",
    lang: "en-US",
    voiceHint: "Google US English",
    rate: 0.95,
    pitch: 0.85,
    prefix: "Commander. ",
    hue: "gold",
    accentClass: "text-accent-amber",
  },
  whisper: {
    id: "whisper",
    label: "Whisper",
    description: "Late-night. Soft voice. Dimmer reactor. For quiet hours.",
    lang: "en-GB",
    voiceHint: "Google UK English Female",
    rate: 0.85,
    pitch: 0.7,
    prefix: "",
    hue: "dim",
    accentClass: "text-text-secondary/70",
  },
  dev: {
    id: "dev",
    label: "Dev",
    description: "Debug companion. Code-first responses, keyboard-forward.",
    lang: "en-US",
    voiceHint: "Google US English",
    rate: 1.0,
    pitch: 1.0,
    prefix: "",
    hue: "cyan",
    accentClass: "text-accent-green",
  },
};

export const PERSONA_ORDER: PersonaId[] = ["stark", "tactical", "whisper", "dev"];

/**
 * Pick the best available browser voice for a profile.
 * Tries exact match on `voiceHint`, then lang prefix, then first available English voice.
 */
export function pickVoice(
  profile: VoiceProfile,
  availableVoices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null {
  if (!availableVoices.length) return null;

  // 1. Exact name match.
  const exact = availableVoices.find((v) => v.name === profile.voiceHint);
  if (exact) return exact;

  // 2. Partial name match.
  const partial = availableVoices.find((v) =>
    v.name.toLowerCase().includes(profile.voiceHint.toLowerCase())
  );
  if (partial) return partial;

  // 3. Lang match.
  const langMatch = availableVoices.find((v) => v.lang === profile.lang);
  if (langMatch) return langMatch;

  // 4. Lang prefix match.
  const langPrefix = availableVoices.find((v) =>
    v.lang.toLowerCase().startsWith(profile.lang.toLowerCase().slice(0, 2))
  );
  if (langPrefix) return langPrefix;

  return null;
}