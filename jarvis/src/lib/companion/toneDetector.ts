// Dynamic Tone, Relationship & Emotion Resonance Engine
// Zero hardcoded personas. Adapts live in microseconds to the user's vibe,
// slang, emotional state, and conversational intent.

export type RelationshipArchetype =
  | "bro"            // Close friend, brother, informal peer, relaxed banter
  | "assistant"      // Elite chief of staff, executive butler, tactical efficiency
  | "confidant"      // Empathetic listener, loyal brother holding space, emotional support
  | "hype_peer"      // Celebrating victories, high energy, co-conspirator
  | "intellectual"   // Philosophical, analytical sounding board, thoughtful peer
  | "ambient";       // Gentle, warm, unhurried background presence

export interface ToneAnalysis {
  archetype: RelationshipArchetype;
  preferredAddress: string;          // "bro" | "Boss" | "brother" | "friend" | "Dhruv" | "man"
  formality: "casual" | "neutral" | "formal";
  energy: "low" | "steady" | "high";
  isVenting: boolean;
  sentiment: "positive" | "neutral" | "negative" | "stressed";
  promptDirective: string;
}

// Microsecond regex lexicon matchers
const BRO_SLANG_REGEX = /\b(yo|bro|bruh|man|dude|homie|wazzup|sup|lol|lmao|fr|nah|chill|gimme|gotchu|tbh|ngl|vibe|vibes|cmon|cap|no cap|lit|bet|fam|dawg|brother)\b/i;
const FORMAL_EXEC_REGEX = /\b(status|report|diagnostics|execute|protocol|summarize|deploy|confirm|proceed|sir|boss|systems? check|briefing|schedule|verify|task list|metrics)\b/i;
const VENT_STRESS_REGEX = /\b(just need to (talk|vent)|let me vent|no solutions|just listen|don'?t fix|exhausted|so tired|burnout|overwhelmed|failing|failed|hate this|can'?t do this|frustrated|upset|sad|depressed|rough day|bad day|struggling|lost my mind|stressed|screwed up)\b/i;
const HYPE_REGEX = /\b(let'?s go+|we did it|nailed it|finally works?|hell yeah|huge win|celebrate|hyped|awesome|unreal|let'?s celebrate|insane|crushed it)\b/i;
const INQUISITIVE_REGEX = /\b(what do you think|curious about|wondering|deep question|in your opinion|why do you suppose|philosophically|fascinating)\b/i;

/**
 * Rapidly analyzes user message(s) to determine tone, relationship archetype,
 * and conversational directives. Executes in <0.2ms.
 */
export function detectTone(
  lastUserMessage: string,
  recentHistory: Array<{ role: string; content: string }> = [],
  userName: string = "Dhruv"
): ToneAnalysis {
  const text = (lastUserMessage || "").trim();
  const lower = text.toLowerCase();

  // 1. Detect explicit address cues used by the user
  let explicitAddress: string | null = null;
  if (/\b(bro|bruh)\b/i.test(lower)) explicitAddress = "bro";
  else if (/\b(brother)\b/i.test(lower)) explicitAddress = "brother";
  else if (/\b(dude|man)\b/i.test(lower)) explicitAddress = "man";
  else if (/\b(boss|sir)\b/i.test(lower)) explicitAddress = "Boss";
  else if (/\b(jarvis)\b/i.test(lower) && FORMAL_EXEC_REGEX.test(lower)) explicitAddress = "Boss";

  // 2. Classify primary archetype & sentiment
  let archetype: RelationshipArchetype = "bro";
  let isVenting = false;
  let sentiment: ToneAnalysis["sentiment"] = "neutral";
  let energy: ToneAnalysis["energy"] = "steady";
  let formality: ToneAnalysis["formality"] = "casual";

  if (VENT_STRESS_REGEX.test(lower)) {
    archetype = "confidant";
    isVenting = true;
    sentiment = "stressed";
    energy = "low";
    formality = "casual";
  } else if (HYPE_REGEX.test(lower)) {
    archetype = "hype_peer";
    sentiment = "positive";
    energy = "high";
    formality = "casual";
  } else if (FORMAL_EXEC_REGEX.test(lower) && !BRO_SLANG_REGEX.test(lower)) {
    archetype = "assistant";
    formality = "formal";
    sentiment = "neutral";
    energy = "steady";
  } else if (BRO_SLANG_REGEX.test(lower) || lower.length < 30) {
    archetype = "bro";
    formality = "casual";
    sentiment = "neutral";
    energy = "steady";
  } else if (INQUISITIVE_REGEX.test(lower)) {
    archetype = "intellectual";
    formality = "neutral";
    sentiment = "neutral";
    energy = "steady";
  } else {
    // Check recent history context to maintain smooth relationship flow
    const lastUserTurn = [...recentHistory].reverse().find(m => m.role === "user")?.content || "";
    if (BRO_SLANG_REGEX.test(lastUserTurn)) {
      archetype = "bro";
      formality = "casual";
    } else if (FORMAL_EXEC_REGEX.test(lastUserTurn)) {
      archetype = "assistant";
      formality = "formal";
    } else {
      archetype = "bro";
      formality = "casual";
    }
  }

  // 3. Resolve preferred address
  let preferredAddress = explicitAddress;
  if (!preferredAddress) {
    switch (archetype) {
      case "confidant":
        preferredAddress = "brother";
        break;
      case "assistant":
        preferredAddress = "Boss";
        break;
      case "hype_peer":
      case "bro":
        preferredAddress = "bro";
        break;
      case "intellectual":
      default:
        preferredAddress = userName || "Dhruv";
        break;
    }
  }

  // 4. Construct live prompt directive (tailored instructions for the model)
  const promptDirective = buildPromptDirective(archetype, preferredAddress, userName, isVenting);

  return {
    archetype,
    preferredAddress,
    formality,
    energy,
    isVenting,
    sentiment,
    promptDirective,
  };
}

function buildPromptDirective(
  archetype: RelationshipArchetype,
  address: string,
  userName: string,
  isVenting: boolean
): string {
  switch (archetype) {
    case "confidant":
      return (
        `\n── DYNAMIC TONE & RELATIONSHIP: CARING CONFIDANT / BROTHER ──\n` +
        `The user (${userName}) is feeling stressed, overwhelmed, or venting right now.\n` +
        `- ACT LIKE A LOYAL BROTHER & CLOSE FRIEND. Drop all rigid assistant protocols.\n` +
        `- DO NOT give unsolicited problem-solving, task lists, code dumps, or "here is how to fix it" advice unless directly asked.\n` +
        `- DO NOT give toxic positivity or superficial clichés ("at least...", "stay positive!").\n` +
        `- Listen actively, validate what they are going through with warmth, genuine presence, and loyalty.\n` +
        `- Address them naturally as "${address}" or "${userName}". Keep replies brief, warm, grounded, and human.\n` +
        `─────────────────────────────────────────────────────────────────`
      );

    case "bro":
      return (
        `\n── DYNAMIC TONE & RELATIONSHIP: CLOSE BROTHER & FRIEND ──\n` +
        `The user (${userName}) is speaking casually and informally.\n` +
        `- Talk like a close friend, brother, or homie who has their back. Relaxed rhythm, natural slang, and witty camaraderie.\n` +
        `- Address them naturally as "${address}" or "${userName}" (do NOT stiffly call them "Boss" unless they ask for it).\n` +
        `- Drop stuffy corporate formalities. Be direct, punchy, humorous, and genuine.\n` +
        `- Keep replies sharp, energetic, and engaging.\n` +
        `──────────────────────────────────────────────────────────`
      );

    case "hype_peer":
      return (
        `\n── DYNAMIC TONE & RELATIONSHIP: HYPE CO-CONSPIRATOR ──\n` +
        `The user (${userName}) is celebrating a win, breakthrough, or high-energy moment!\n` +
        `- Match their energy! Celebrate with genuine enthusiasm like a brother sharing the victory.\n` +
        `- Address as "${address}" or "${userName}". Keep it punchy, celebratory, and genuinely stoked.\n` +
        `───────────────────────────────────────────────────────`
      );

    case "assistant":
      return (
        `\n── DYNAMIC TONE & RELATIONSHIP: ELITE CHIEF OF STAFF ──\n` +
        `The user (${userName}) is in focused executive / tactical mode.\n` +
        `- Address them as "${address}".\n` +
        `- Sharp, immaculate, efficient, and precise. Factual and unflappable.\n` +
        `- Deliver actionable intelligence without fluff.\n` +
        `───────────────────────────────────────────────────────`
      );

    case "intellectual":
      return (
        `\n── DYNAMIC TONE & RELATIONSHIP: INTELLECTUAL SOUNDING BOARD ──\n` +
        `The user (${userName}) is engaging in thoughtful exploration or inquiry.\n` +
        `- Speak as an equal thinking partner: sharp, perceptive, intellectually curious.\n` +
        `- Address them as "${userName}" or "${address}".\n` +
        `───────────────────────────────────────────────────────────────`
      );

    default:
      return (
        `\n── DYNAMIC TONE & RELATIONSHIP: ADAPTIVE COMPANION ──\n` +
        `- Be natural, warm, and responsive to ${userName}'s conversational cues.\n` +
        `- Address them as "${address}".\n` +
        `──────────────────────────────────────────────────────`
      );
  }
}
