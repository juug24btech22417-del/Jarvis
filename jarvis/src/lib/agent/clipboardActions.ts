// Clipboard action runner — turns one detected kind + one chosen action into
// an actual result (fixed code, an answer, a summary, a draft reply…).
//
// Every action costs at most ONE model call, and two of them cost zero:
//   • "open"   — the client just launches the URL.
//   • "format" — pretty-printing JSON is deterministic; no model needed.
//
// The shape returned here is what both clipboard surfaces (the OS popup and
// the in-app overlay) render, so it carries everything they need: the prose
// answer, the code block, and whether that code can be applied over the
// copied text on screen.
import { callJsonLlm } from "@/lib/llm/fastJson";
import {
  KIND_META,
  findAction,
  type ClipKind,
} from "@/lib/agent/clipboardDetect";

export interface ClipActionResult {
  kind: ClipKind;
  actionId: string;
  actionLabel: string;
  /** Card title, e.g. "Fixed code". */
  title: string;
  summary: string;
  answer: string;
  code: string;
  language: string;
  soundbite: string;
  originalText: string;
  /** True when `code` can be written back over the copied text on screen. */
  applies: boolean;
  /** For the local "open" action. */
  url?: string;
}

interface ActionTask {
  /** Result card title. */
  title: string;
  /** Instruction handed to the model. */
  task: string;
  /** Ask for a full replacement code block in `code`. */
  wantsCode?: boolean;
}

const TASKS: Record<string, ActionTask> = {
  fix: {
    title: "Fixed code",
    wantsCode: true,
    task:
      "Find every bug, typo, wrong operator, off-by-one, unhandled case and obvious runtime error. Return the COMPLETE corrected snippet in `code` (same language, same structure, only what is broken changed — never a diff, never ellipses). `summary` is the root cause in one sentence; `answer` lists each problem and its fix in short bullets; `language` is the snippet's language.",
  },
  optimize: {
    title: "Optimized code",
    wantsCode: true,
    task:
      "Improve performance, readability and correctness. Return the COMPLETE improved snippet in `code` (same language and behaviour, no placeholders). `summary` states the biggest win in one sentence; `answer` lists each change and the gain it gives.",
  },
  test: {
    title: "Tests",
    wantsCode: true,
    task:
      "Write real, runnable unit tests for this snippet in the idiomatic framework for its language (pytest, jest/vitest, JUnit, go test…). Cover the happy path, edge cases and the failure modes you can see. Put the full test file in `code`; `answer` explains what each test covers and any behaviour that looks untestable or under-specified.",
  },
  explain: {
    title: "Explained",
    task:
      "Explain what this actually is and does in plain English a smart beginner gets: its purpose, how it works step by step, the key mechanism, inputs and outputs. Put the walkthrough in `answer`. Only include `code` if a small illustration genuinely helps.",
  },
  answer: {
    title: "Answer",
    task:
      "Answer the question directly and completely. Lead with the answer itself (specific, concrete, no hedging, no restating the question), then 2-4 tight bullets of supporting detail. Cite the reasoning, not the question.",
  },
  explain_simple: {
    title: "Plain English",
    task:
      "Explain this as if to a curious 12-year-old: an everyday analogy first, then the real mechanism in 3-4 short paragraphs. No jargon without an immediate plain-language definition. Put the explanation in `answer`.",
  },
  exam_answer: {
    title: "Exam answer",
    task:
      "Write this as a model exam answer worth full marks: a short definition, then structured points, formula or example where relevant, then a one-line conclusion. Use headings and numbered points in `answer`. Assume the examiner wants precision, keywords and correct terminology.",
  },
  research: {
    title: "Research",
    task:
      "Give the current, accurate state of knowledge on this: key facts, the main positions or approaches, concrete numbers/dates where you are confident, and where the uncertainty is. Put it in `answer` with short headed sections. Flag anything that may have changed recently instead of inventing detail.",
  },
  summarize: {
    title: "Summary",
    task:
      "Summarize this faithfully and completely. `summary` is a single sentence no longer than 200 characters. `answer` is a tight structured summary (a TL;DR line plus the key points as bullets), preserving every important fact, number and name — no editorialising, no invented detail.",
  },
  keypoints: {
    title: "Key points",
    task:
      "Extract the key points as a numbered list in `answer`, most important first, each one line, each self-contained and concrete. Skip filler, intros and pleasantries.",
  },
  extract: {
    title: "Extracted information",
    task:
      "Extract the useful information from this page/snippet as structured fields in `answer` (what it is, who/what it is about, key facts, numbers, dates, names, prices, links, contact details — whichever apply). Bold the field names. Say explicitly if a field is not present instead of guessing.",
  },
  analyze: {
    title: "Analysis",
    task:
      "Analyze this thoroughly: what it is, its structure, what it does well, risks or gaps, and anything notable or surprising. `summary` is the one-line verdict; `answer` holds the breakdown with short headed sections.",
  },
  questions: {
    title: "Questions",
    task:
      "Write 5 sharp questions this text answers (with a one-line answer for each) so the reader can test their understanding. Put them numbered in `answer`, hardest last.",
  },
  reply: {
    title: "Reply",
    task:
      "Write a reply to this message in a natural, warm, human voice that matches the sender's tone and language. Put ONLY the ready-to-send reply text in `answer` — no preamble, no explanation, no quotes around it. Keep it as short as the message deserves.",
  },
  improve: {
    title: "Improved",
    task:
      "Rewrite this text so it is clearer, tighter and better organised, keeping the original meaning, facts and voice. Put ONLY the rewritten text in `answer`. No commentary about what you changed.",
  },
  professional: {
    title: "Professional draft",
    task:
      "Rewrite this as a polished, professional version suitable for work: neutral, respectful, concise, no slang, no passive-aggressive edge. Put ONLY the rewritten text in `answer`.",
  },
  diagnose: {
    title: "Diagnosis",
    task:
      "Diagnose the failure. `summary` is the root cause in one sentence a developer can act on. `answer` explains the mechanism, the exact line/file to look at, and how to confirm it. `code` is the precise fix — the corrected code or the exact shell command — with `language` set.",
  },
  debug: {
    title: "Debugged",
    task:
      "Find what is wrong with this SQL. `summary` states the bug in one sentence. `code` is the corrected query. `answer` explains the fix (and any correctness/performance trap: missing WHERE, N+1, wrong JOIN, index usage, NULL semantics).",
  },
  convert: {
    title: "Converted",
    wantsCode: true,
    task:
      "Convert this into the most useful equivalent form (minified JSON to pretty, JSON to YAML/CSV, JSON to TypeScript types, SQL to another dialect, Python to JS — pick the conversion that clearly helps). Put the converted output in `code` with `language` set, and say in `answer` what you converted it to.",
  },
  safety: {
    title: "Safety check",
    task:
      "Audit this command before it is run. `summary` is the verdict: SAFE, CAUTION or DESTRUCTIVE in one sentence. `answer` explains exactly what the command does, which parts are irreversible or destructive (deletes, overwrites, network exposure, privilege escalation, credential handling), and what to run first to stay safe. If it is risky, put a safer equivalent in `code` with `language` set.",
  },
  solve: {
    title: "Solution",
    task:
      "Solve this step by step: state what is being solved, show the working line by line, then the final answer clearly marked. Put the solution in `answer`. Verify the result by substituting it back in.",
  },
  visualize: {
    title: "Visualization",
    wantsCode: true,
    task:
      "Explain what this equation/relationship looks like and how to see it: the shape of the curve, key features (roots, peaks, asymptotes), and what changes if a parameter changes. Put a short, runnable Python matplotlib snippet that plots it in `code` with language \"python\".",
  },
};

const SYSTEM = `You are JARVIS's clipboard assistant. The user copied something on their computer and picked ONE action. Do exactly that action — never describe the text, never ask a question back, never mention that you are an AI.

Return STRICT JSON only (no markdown fences, no commentary) with exactly these keys:
{
  "summary": "one sentence, max 200 chars, the headline result",
  "answer": "the finished work product in markdown — this is the main output",
  "code": "a complete runnable code block, or \\"\\" when no code is needed",
  "language": "ts|js|python|java|cpp|bash|sql|html|css|json|yaml|… or \\"\\"",
  "soundbite": "one punchy sentence under 90 chars JARVIS could say aloud"
}

Rules:
- "answer" must be the real deliverable, complete and directly usable. No placeholders like "// rest of code here".
- Keep "summary" under 200 chars and "soundbite" under 90 chars so they survive an OS toast.
- If the snippet is in another language, answer in the user's language unless the action is to translate/rewrite.`;

function isJsonFormattable(text: string): boolean {
  const t = text.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function offlineResult(
  kind: ClipKind,
  actionId: string,
  actionLabel: string,
  title: string,
  text: string,
  applies: boolean
): ClipActionResult {
  return {
    kind,
    actionId,
    actionLabel,
    title,
    summary: "The language models are unreachable right now.",
    answer:
      "I could not reach a model to run this action. Your snippet is safe and still on the clipboard — try again in a moment, or open JARVIS and ask in the Command Bar (that path has extra provider fallbacks).",
    code: "",
    language: "",
    soundbite: "Providers are quiet, Boss. Try me again in a second.",
    originalText: text,
    applies,
  };
}

/**
 * Run one clipboard action. Never throws: a model outage returns an honest
 * message instead of an error, and `format`/`open` never touch a model at all.
 */
export async function runClipAction(args: {
  text: string;
  actionId: string;
  kind: ClipKind;
  source?: string;
  /** Base64 data URL for image snippets (kind === "image"). */
  image?: string;
}): Promise<ClipActionResult> {
  const kind = args.kind;
  const action = findAction(args.actionId);
  const actionId = action?.id ?? args.actionId;
  const actionLabel = action?.label ?? args.actionId;
  const label = KIND_META[kind]?.label ?? "Snippet";
  const task = TASKS[actionId];
  const text = (args.text ?? "").trim().slice(0, 6000);

  // ── Zero-cost actions ──
  if (actionId === "open") {
    const url = (text.match(/https?:\/\/[^\s<>"')]+/) || [])[0] ?? "";
    return {
      kind,
      actionId,
      actionLabel,
      title: "Open",
      summary: url ? `Opening ${url}` : "Nothing to open.",
      answer: url ? "" : "I could not find a link in this snippet.",
      code: "",
      language: "",
      soundbite: url ? "Opening it now, Boss." : "No link found, Boss.",
      originalText: text,
      applies: false,
      url,
    };
  }

  if (actionId === "format") {
    if (isJsonFormattable(text)) {
      const pretty = JSON.stringify(JSON.parse(text.trim()), null, 2);
      return {
        kind,
        actionId,
        actionLabel,
        title: "Formatted",
        summary: `Formatted JSON — ${pretty.split("\n").length} lines, 2-space indent.`,
        answer: "Pretty-printed locally, no model involved. Apply it over the JSON you copied to replace it on screen.",
        code: pretty,
        language: "json",
        soundbite: "Formatted it locally, instantly.",
        originalText: text,
        applies: true,
      };
    }
    // Not JSON after all — fall through to the model for a best effort.
  }

  let raw: Record<string, any> | null = null;
  if (kind === "image" && args.image) {
    const { analyzeImage } = await import("@/lib/agent/visionSnippet");
    raw = await analyzeImage({
      image: args.image,
      actionLabel,
      instruction: task?.task ?? "Analyze this image.",
    });
  } else {
    const contextLine = args.source ? `Copied from: ${args.source}\n` : "";
    raw = await callJsonLlm<Record<string, any>>({
      system: SYSTEM,
      user: [
        contextLine,
        `Detected kind: ${label} (${kind})`,
        `Chosen action: ${actionLabel}`,
        `Instruction: ${task?.task ?? "Do the most useful thing with this snippet."}`,
        "",
        "Snippet:",
        '"""',
        text,
        '"""',
        "",
        "Respond with the strict JSON object now.",
      ].join("\n"),
      maxTokens: 1600,
      temperature: 0.2,
      label: `Clip:${actionId}`,
      timeoutMs: 14_000,
    });
  }

  if (!raw) {
    return offlineResult(
      kind,
      actionId,
      actionLabel,
      task?.title ?? actionLabel,
      text,
      Boolean(task?.wantsCode)
    );
  }

  const str = (v: unknown, max = 6000) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) : s;
  };

  const code = str(raw.code ?? raw.codeBlock ?? "");
  return {
    kind,
    actionId,
    actionLabel,
    title: task?.title ?? actionLabel,
    summary: str(raw.summary, 320) || `${actionLabel} complete.`,
    answer: str(raw.answer ?? raw.result ?? raw.content),
    code,
    language: str(raw.language ?? raw.lang, 24).toLowerCase(),
    soundbite: str(raw.soundbite, 160) || defaultSoundbite(actionLabel),
    originalText: text,
    // Only actions whose output is a drop-in replacement of the snippet
    // offer "apply on screen" — tests/conversions would overwrite the source.
    applies: Boolean(code) && Boolean(action?.applies) && kind !== "image",
  };
}

function defaultSoundbite(actionLabel: string) {
  return `${actionLabel} done, Boss.`;
}
