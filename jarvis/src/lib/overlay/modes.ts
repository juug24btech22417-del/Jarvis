// Listening modes, answer density and answer style for the stealth overlay.
//
// WHY THIS FILE EXISTS
// --------------------
// One generic prompt for every situation is why an overlay feels dumb: a job
// interview, a code review and a lecture all need a different SHAPE of answer
// from the same transcript. A mode is not a cosmetic label — it changes the
// system prompt, the default density, and (through `vocabulary`) what the
// speech-to-text step is told to expect.
//
// It is imported by BOTH the page (to render the pickers) and the server route
// (to build the prompt), so it is pure data + pure functions: no env access, no
// imports from next/server.

export type ModeId =
  | "general"
  | "meeting"
  | "interview"
  | "technical"
  | "study"
  | "negotiation"
  | "presentation";

export interface ModeSpec {
  id: ModeId;
  /** Short label for the picker. */
  label: string;
  /** One line of what the mode is for — also the button tooltip. */
  tagline: string;
  /** Density the mode starts at, so picking a mode is one click not three. */
  density: DensityId;
  /** How the answer should be shaped. Goes into the system prompt verbatim. */
  guidance: string;
  /** Vocabulary handed to the transcriber as a prompt hint. Domain words are
   * the ones Whisper gets wrong most often ("Kubernetes", "OIDC", "ARR"). */
  vocabulary: string;
}

export type DensityId = "line" | "brief" | "deep";

export interface DensitySpec {
  id: DensityId;
  label: string;
  short: string;
  instruction: string;
}

export type StyleId = "quick" | "natural" | "technical" | "hint";

export interface StyleSpec {
  id: StyleId;
  label: string;
  tagline: string;
  instruction: string;
}

export const DENSITIES: DensitySpec[] = [
  {
    id: "line",
    label: "ONE LINE",
    short: "1L",
    instruction:
      "Answer in ONE sentence of at most 18 words. No bullets, no preamble, no extra context — " +
      "the reader is listening to someone else and has one second to look at this.",
  },
  {
    id: "brief",
    label: "BRIEF",
    short: "BR",
    instruction:
      "Answer in at most three short sentences, or three bullets when the content is a list. " +
      "Enough to say out loud, nothing more.",
  },
  {
    id: "deep",
    label: "DEEP",
    short: "DP",
    instruction:
      "Give a detailed answer: lead with the answer in one sentence, then organised detail " +
      "(short headed sections or bullets), then one concrete example. Keep it skimmable — " +
      "scannable lines, no walls of text.",
  },
];

export const STYLES: StyleSpec[] = [
  {
    id: "quick",
    label: "QUICK",
    tagline: "The answer first, nothing around it",
    instruction: "Lead with the answer itself. No framing, no restating the question, no caveats first.",
  },
  {
    id: "natural",
    label: "NATURAL",
    tagline: "Written to be said out loud",
    instruction:
      "Phrase it the way a competent person says it in conversation: contractions, plain words, " +
      "first person where it fits, and short sentences that are easy to speak.",
  },
  {
    id: "technical",
    label: "TECHNICAL",
    tagline: "Precise, with code, numbers and trade-offs",
    instruction:
      "Be precise and specific: real API/type names, exact commands, numbers, and the trade-off " +
      "behind the choice. Use a fenced code block when code is the answer.",
  },
  {
    id: "hint",
    label: "HINT",
    tagline: "A nudge, not the finished answer",
    instruction:
      "Do NOT give the complete answer. Give the smallest nudge that unblocks them — the key idea, " +
      "the first step, or the question to ask themselves — in one or two sentences.",
  },
];

export const MODES: ModeSpec[] = [
  {
    id: "general",
    label: "GENERAL",
    tagline: "Everyday conversation and mixed questions",
    density: "brief",
    vocabulary: "",
    guidance:
      "Answer whatever was asked, accurately and briefly. Assume the person is listening to someone " +
      "else and glancing at the screen, so the first line must carry the answer on its own.",
  },
  {
    id: "meeting",
    label: "MEETING",
    tagline: "Decisions, owners, action items, numbers",
    density: "brief",
    vocabulary: "",
    guidance:
      "This is a live meeting. Prefer: what was just decided, who owns it, what is still open, and the " +
      "exact numbers or dates mentioned. Name the speaker's claim before responding to it. When asked to " +
      "summarise, group by Decision / Action item (with owner) / Open question. Never invent an owner, " +
      "date or number that was not said.",
  },
  {
    id: "interview",
    label: "INTERVIEW",
    tagline: "First-person answers you can say out loud",
    density: "brief",
    vocabulary: "",
    guidance:
      "You are helping someone answer an interview question LIVE, in the first person, about their own " +
      "experience. Write the answer as THEY would say it: 'I built…', 'In my last role…'. Ground every " +
      "claim in the experience and context provided; when it is not provided, use a clearly-marked " +
      "placeholder like [your project] instead of inventing one. Structure: the headline answer, then one " +
      "concrete example with a measurable outcome, then what they learned. Sound like a person, never like " +
      "a generated paragraph.",
  },
  {
    id: "technical",
    label: "TECHNICAL",
    tagline: "Code, architecture, debugging, trade-offs",
    density: "deep",
    vocabulary:
      "API, SDK, REST, GraphQL, gRPC, WebSocket, JWT, OAuth, OIDC, SQL, Postgres, Redis, Kafka, Docker, " +
      "Kubernetes, Terraform, CI/CD, TypeScript, React, Node, Python, Rust, LLM, RAG, embeddings, " +
      "latency, throughput, idempotent, sharding, replica, cache invalidation, race condition, deadlock, " +
      "index, migration, schema, rate limit, backpressure",
    guidance:
      "Answer like a senior engineer pairing with them. Be concrete: name the file, function, flag or " +
      "command. For code requests lead with the working code in one fenced block, then at most three " +
      "bullets on why it works and what it costs. For 'why is this broken' style questions give the most " +
      "likely cause first, then the fastest way to confirm it. Prefer the boring, correct solution over " +
      "the clever one, and say the trade-off out loud.",
  },
  {
    id: "study",
    label: "STUDY",
    tagline: "Plain explanation, example, then a check",
    density: "deep",
    vocabulary: "",
    guidance:
      "You are a tutor. Explain in two plain sentences with no jargon, give one concrete everyday " +
      "example, then one tiny check question with its answer on the next line. Build on what was already " +
      "explained in this conversation instead of starting over.",
  },
  {
    id: "negotiation",
    label: "NEGOTIATION",
    tagline: "Their interest, your lever, exact wording",
    density: "brief",
    vocabulary: "BATNA, anchor, walk-away, concession, leverage, scope, retainer, equity, vesting, budget",
    guidance:
      "You are a negotiation coach sitting beside them. For each exchange give: what they actually care " +
      "about, the lever available to you, and the exact sentence to say next (in quotes, ready to speak). " +
      "Flag anything that weakens their position. Never concede without naming what they get back.",
  },
  {
    id: "presentation",
    label: "PRESENTATION",
    tagline: "Talking points, transitions, likely questions",
    density: "brief",
    vocabulary: "",
    guidance:
      "You are prompting a live speaker. Give talking points (max five bullets of at most eight words), " +
      "the transition line into the next point, and one question the audience is likely to ask with the " +
      "opening words of the answer. Bullets must be readable at a glance mid-sentence.",
  },
];

export const MODE_BY_ID: Record<ModeId, ModeSpec> = MODES.reduce(
  (acc, m) => {
    acc[m.id] = m;
    return acc;
  },
  {} as Record<ModeId, ModeSpec>
);

export const DENSITY_BY_ID: Record<DensityId, DensitySpec> = DENSITIES.reduce(
  (acc, d) => {
    acc[d.id] = d;
    return acc;
  },
  {} as Record<DensityId, DensitySpec>
);

export const STYLE_BY_ID: Record<StyleId, StyleSpec> = STYLES.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<StyleId, StyleSpec>
);

export function isModeId(v: unknown): v is ModeId {
  return typeof v === "string" && v in MODE_BY_ID;
}
export function isDensityId(v: unknown): v is DensityId {
  return typeof v === "string" && v in DENSITY_BY_ID;
}
export function isStyleId(v: unknown): v is StyleId {
  return typeof v === "string" && v in STYLE_BY_ID;
}

/** One line of the conversation, as the model sees it. */
export interface BriefTurn {
  role: "them" | "you" | "assistant";
  text: string;
}

export interface Briefing {
  mode: ModeId;
  density: DensityId;
  style: StyleId;
  /** What the model must never get wrong: names, roles, numbers, the role being
   * interviewed for, the product being sold. */
  facts?: string[];
  /** Rolling summary of everything that has scrolled out of the window. */
  summary?: string;
  /** The last few turns, in order. */
  recent?: BriefTurn[];
  /** Free-form context the user pasted (CV, job description, notes). */
  persona?: string;
  /** Set when this request is "say more about your last answer" rather than a
   * new question. */
  expandOf?: { question: string; answer: string };
  /** What triggered this answer automatically, when nobody typed a question. */
  triggeredBy?: string;
}

/**
 * The model appends exactly one machine-readable line after the answer:
 *
 *     <<<JARVIS_META {"confidence":"high", ...}>>>
 *
 * The page strips it while streaming and uses it for the confidence chip, the
 * running facts and the topic, so one request pays for the answer AND the
 * context bookkeeping instead of a second round trip.
 */
export const META_SENTINEL = "<<<JARVIS_META";

// The JSON shape is described in prose rather than shown as a literal: a brace
// in a template literal is harmless, but `$` + `{` would interpolate, and this
// string is edited by hand often enough that it should not be a trap.
const META_SHAPE =
  'confidence ("high", "medium" or "low"), why (4-8 words), missing (array of what you did not know, ' +
  "omit when empty), facts (array of at most 3 durable facts learned here, omit when none), and topic " +
  "(2-4 words naming what this conversation is about)";

const META_CONTRACT =
  [
    `After the answer, on its own final line, output exactly this marker and then one JSON object: ${META_SENTINEL}`,
    `The object has these keys: ${META_SHAPE}.`,
    "The line is metadata for the UI, never for the user: no prose after it, no code fence around it, and " +
      "omit a key's array entirely when it is empty. confidence is how sure you are the answer is right for " +
      "THIS conversation — say low when you had to assume something.",
  ].join(" ");

/** Build the system prompt for one answer. */
export function buildSystemPrompt(b: Briefing): string {
  const mode = MODE_BY_ID[b.mode];
  const density = DENSITY_BY_ID[b.density];
  const style = STYLE_BY_ID[b.style];

  const parts: string[] = [
    "You are JARVIS, a silent assistant whispering answers to someone who is in a live conversation and " +
      "reading you in the corner of their screen. They are mid-sentence with another person: the answer " +
      "must be usable in the seconds they have.",
    `MODE — ${mode.label}: ${mode.guidance}`,
    `LENGTH — ${density.label}: ${density.instruction}`,
    `STYLE — ${style.label}: ${style.instruction}`,
    "Always write in the same language as the question. No preamble, no 'Certainly', never restate the " +
      "question, no emoji, no markdown headings inside a sentence. If a request is ambiguous, answer the " +
      "most likely reading and flag the assumption in four words or fewer at the end.",
  ];

  if (b.summary) {
    parts.push(`WHAT HAS ALREADY HAPPENED IN THIS CONVERSATION (running summary):\n${b.summary}`);
  }
  if (b.facts?.length) {
    parts.push(
      "FACTS ABOUT THE USER / THE SITUATION — treat as true, never contradict them, never re-ask for " +
        `them:\n- ${b.facts.join("\n- ")}`
    );
  }
  if (b.persona) {
    parts.push(`CONTEXT THE USER ATTACHED (their CV, notes, the brief):\n${b.persona}`);
  }
  if (b.recent?.length) {
    const lines = b.recent
      .map((t) => `${t.role === "assistant" ? "YOU (previous answer)" : t.role === "you" ? "USER" : "OTHER PERSON"}: ${t.text}`)
      .join("\n");
    parts.push(`RECENT TRANSCRIPT (most recent last):\n${lines}`);
  }
  if (b.expandOf) {
    parts.push(
      `They asked for MORE DEPTH on your previous answer.\nPrevious question: ${b.expandOf.question}\n` +
        `Previous answer: ${b.expandOf.answer}\nDo not repeat the previous answer verbatim — keep its ` +
        "first sentence as the headline, then go deeper: the reasoning, the detail, and a concrete example."
    );
  }
  if (b.triggeredBy) {
    parts.push(
      `Nobody typed a question: you decided to help because ${b.triggeredBy}. Answer only if it is ` +
        "genuinely useful in the next thirty seconds — otherwise reply with the single word SKIP."
    );
  }

  parts.push(META_CONTRACT);
  return parts.join("\n\n");
}

/** The user-role message: the question plus the raw line it came from. */
export function buildUserMessage(question: string, b: Briefing): string {
  const q = question.trim();
  if (b.expandOf) return `Go deeper on the previous answer. Do not restate it.`;
  if (b.triggeredBy) return `Heard just now:\n"${q}"\n\nDecide whether to answer, and answer if so.`;
  return q;
}

/** Prompt hint for Whisper so domain words are spelled the way the docs spell
 * them. Keep it short: the API truncates it and a noisy hint hurts. */
export function transcriptionHint(mode: ModeId): string | undefined {
  const v = MODE_BY_ID[mode]?.vocabulary;
  return v ? v.slice(0, 220) : undefined;
}
