// Smart snippet assistant — the brain behind both the in-app "explain this"
// overlay and the system-wide clipboard watcher.
//
// The old version only ever *explained* whatever was highlighted, which is
// useless when the copied text is a question ("what is X?"), a broken stack
// trace, or an instruction ("write a regex that…"). This one first DECIDES
// what the user actually needs and then does it: answers questions, writes
// code, fixes errors, translates, or explains as a last resort.
import { callJsonLlm } from "@/lib/llm/fastJson";

export type AssistMode =
  | "answer" // a question / request for information → answer it
  | "code" // code, or a request for code → write / complete / fix it
  | "error" // an error, log, or stack trace → diagnose + fix
  | "task" // an instruction ("draft…", "summarize…", "translate…") → do it
  | "explain"; // anything else → plain-English breakdown

export interface SnippetBullet {
  title: string;
  desc: string;
}

export interface SnippetAnalysis {
  mode: AssistMode;
  category: string;
  urgency: "safe" | "caution" | "critical";
  /** One-line headline shown first in the UI and in the OS toast. */
  summary: string;
  /** The actual answer / generated result. Markdown allowed. May be empty. */
  answer: string;
  /** A runnable code block or shell fix. Empty when not relevant. */
  code: string;
  /** Language for `code` (ts, python, bash…). Empty when `code` is empty. */
  language: string;
  bullets: SnippetBullet[];
  /** One punchy 10-word line to whisper / toast. */
  soundbite: string;
  originalText: string;
}

const VALID_MODES: AssistMode[] = ["answer", "code", "error", "task", "explain"];

const SYSTEM = `You are JARVIS's universal clipboard assistant. You receive a snippet the user copied ANYWHERE on their computer — a question, code, an error, a legal clause, an article, a message. Decide what they actually need and DO IT. Never just describe the text.

STEP 1 — pick exactly one "mode":
- "answer": the snippet asks a question or wants a fact/opinion ("what is…", "why…", "which is better…", "solve 2x+3=11").
- "code": the snippet IS code, or asks for code ("write a function that…", "add a regex for…", "convert this to python"). Complete, fix, or produce the code.
  IMPORTANT: ALWAYS fill "answer" as well. If the copied snippet is already COMPLETE, working code, "answer" must say what the code actually does (its job, inputs, outputs) and flag any bug, edge case, security issue, or slow path you notice - then put the code (the original if it is fine, or the improved version) in "code". Never leave "answer" empty and never just paste the snippet back as the whole response.
- "error": the snippet is an error message, stack trace, exception, or failing log. Diagnose the root cause and give the fix.
- "task": the snippet is an instruction to produce something non-code ("draft a reply", "summarize this", "translate this to Hindi", "rewrite professionally").
- "explain": none of the above — just a passage/clause/idea the user wants understood.

STEP 2 — fill the fields for that mode:
- "answer": the REAL answer, complete and directly useful (markdown ok). Be specific — dates, numbers, names. NEVER reply "this is a question" or restate it.
- "code": the full, runnable code or the exact corrected version. No placeholders like "// rest here". "language" = ts|js|python|java|cpp|bash|sql|html|css|json|… (empty if no code). For an already-working snippet this may be the snippet itself, but "answer" must still explain it.
- "error": "summary" = root cause in one sentence; "code" = the exact fix (patched code or command); "answer" = what to do and why.
- "task": "answer" = the finished work product (the draft, summary, or translation), not advice about it.
- "explain": "summary" + "answer" = a crisp plain-English breakdown a smart 12-year-old gets.

Always also provide:
- "category": "Legal" | "Code" | "Financial" | "Technical" | "Medical" | "Academic" | "General"
- "urgency": "safe" | "caution" | "critical" (critical = security risk, data loss, legal trap)
- "bullets": EXACTLY 3 short cards with keys "title" and "desc":
  1. "Core Meaning" — what this really is/does.
  2. "Key Insight" — the single most useful thing to know (for errors: the root cause; for questions: the crux).
  3. "Next Step" — one concrete action.
- "soundbite": one punchy ≤10-word sentence JARVIS can speak.

Keep "summary" under 220 chars and "soundbite" under 90 chars so they survive an OS toast. Output STRICT JSON only, no markdown fences around the object, no commentary.`;

function coerceMode(v: unknown): AssistMode {
  const s = String(v ?? "").trim().toLowerCase();
  return (VALID_MODES as string[]).includes(s) ? (s as AssistMode) : "explain";
}

function coerceUrgency(v: unknown): SnippetAnalysis["urgency"] {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "critical" || s === "caution" ? (s as SnippetAnalysis["urgency"]) : "safe";
}

function coerceString(v: unknown, max = 6000): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max) : s;
}

function coerceBullets(v: unknown): SnippetBullet[] {
  if (!Array.isArray(v)) return [];
  return v
    .slice(0, 3)
    .map((b: any) => ({
      title: coerceString(b?.title ?? b?.heading ?? "", 80),
      desc: coerceString(b?.desc ?? b?.description ?? b?.text ?? "", 700),
    }))
    .filter((b) => b.title || b.desc);
}

/**
 * Analyse a copied snippet and produce a mode-appropriate result.
 * Never throws and never returns a provider error — a deterministic
 * fallback keeps the feature usable offline.
 */
export async function analyzeSnippet(
  text: string,
  context?: string
): Promise<SnippetAnalysis> {
  const trimmed = text.trim().slice(0, 6000);
  const contextLine = context ? `Extra context from the app: ${context}\n` : "";

  const raw = await callJsonLlm<Record<string, any>>({
    system: SYSTEM,
    user: `${contextLine}Copied snippet:\n"""\n${trimmed}\n"""\n\nRespond with the strict JSON object now.`,
    maxTokens: 1200,
    temperature: 0.2,
    label: "Assist",
    timeoutMs: 12000,
  });

  if (!raw) {
    return {
      mode: "explain",
      category: "General",
      urgency: "safe",
      summary: `Copied text (${trimmed.length} chars): "${trimmed.slice(0, 140)}${trimmed.length > 140 ? "…" : ""}"`,
      answer:
        "JARVIS's language models are unreachable right now, so I can't analyse this copy. Paste it into the Command Bar and ask directly — that path has extra fallbacks.",
      code: "",
      language: "",
      bullets: [
        { title: "Core Meaning", desc: trimmed.slice(0, 300) },
        { title: "Key Insight", desc: "Analysis unavailable — providers did not respond." },
        { title: "Next Step", desc: "Retry in a moment, or ask in the Command Bar." },
      ],
      soundbite: "Providers are quiet, Boss. I'll retry the moment they answer.",
      originalText: trimmed,
    };
  }

  const mode = coerceMode(raw.mode);
  return {
    mode,
    category: coerceString(raw.category, 40) || "General",
    urgency: coerceUrgency(raw.urgency),
    summary: coerceString(raw.summary, 320) || `Analysis of "${trimmed.slice(0, 100)}…"`,
    answer: coerceString(raw.answer ?? raw.result ?? raw.content, 6000),
    code: coerceString(raw.code ?? raw.codeBlock ?? "", 6000),
    language: coerceString(raw.language ?? raw.lang, 24).toLowerCase(),
    bullets: coerceBullets(raw.bullets).length
      ? coerceBullets(raw.bullets)
      : [
          { title: "Core Meaning", desc: coerceString(raw.summary, 300) },
          { title: "Key Insight", desc: "" },
          { title: "Next Step", desc: "" },
        ],
    soundbite: coerceString(raw.soundbite, 160) || "Clipboard analysed, Boss.",
    originalText: trimmed,
  };
}

/** Human label + verb for the pill / toast, per mode. */
export const MODE_LABELS: Record<AssistMode, { verb: string; badge: string; icon: string }> = {
  answer: { verb: "ANSWERED", badge: "ANSWER", icon: "🧠" },
  code: { verb: "CODE READY", badge: "CODE", icon: "⌨️" },
  error: { verb: "FIX READY", badge: "FIX", icon: "🛠️" },
  task: { verb: "DONE", badge: "TASK", icon: "✅" },
  explain: { verb: "EXPLAINED", badge: "EXPLAIN", icon: "📖" },
};
