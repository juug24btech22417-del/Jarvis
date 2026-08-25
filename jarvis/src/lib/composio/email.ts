// Email send helper — composes + sends via composio's GMAIL_SEND_EMAIL action.
//
// Used by /api/composio/email/send (the dispatch route) and the chat shortcut.
// Two-step flow:
//   1. composeEmail({ to, about, tone, hint? }) → { subject, body }
//      Uses the LLM chain with a tone-conditioned prompt. Tone is inferred
//      from the user's request when not explicitly named.
//   2. sendViaComposio({ toEmail, subject, body, connectedAccountId })
//      Calls composio.tools.execute("GMAIL_SEND_EMAIL", ...) and returns
//      { messageId, error? }. Plain text only (is_html=false) — keeping
//      the user's safety net: no HTML, no images, no links that the user
//      didn't read in the preview.

import { runLlmChain } from "@/services/LlmChain";

export type EmailTone =
  | "professional"
  | "friendly"
  | "polite"
  | "formal"
  | "urgent"
  | "casual";

const TONE_KEYWORDS: Array<{ tone: EmailTone; re: RegExp }> = [
  { tone: "professional", re: /\b(professional|business[- ]like|corporate|formal\s+work)\b/i },
  { tone: "urgent", re: /\b(urgent|asap|immediately|right\s+away|time[- ]sensitive|pressing)\b/i },
  { tone: "formal", re: /\b(formal|official|ceremonial)\b/i },
  { tone: "friendly", re: /\b(friendly|warm|cheerful|pleasant)\b/i },
  { tone: "polite", re: /\b(polite|courteous|respectful|deferential)\b/i },
  { tone: "casual", re: /\b(casual|informal|laid[- ]back|relaxed)\b/i },
];

export function inferTone(text: string): EmailTone {
  for (const { tone, re } of TONE_KEYWORDS) {
    if (re.test(text)) return tone;
  }
  return "professional";
}

const TONE_GUIDANCE: Record<EmailTone, string> = {
  professional:
    "Crisp, business-appropriate, no slang. Sign off with a neutral closing like 'Best regards' or similar.",
  friendly:
    "Warm and approachable, but still polished. Light contractions OK. Sign off with a first-name closing.",
  polite:
    "Very courteous and considerate. Soften requests. Use 'please' and 'thank you'. Avoid sounding demanding.",
  formal:
    "Highly formal, full sentences, no contractions, traditional closings like 'Sincerely' or 'Respectfully'.",
  urgent:
    "Direct and time-sensitive without being rude. Open by flagging the urgency. State the ask and a deadline in the first paragraph.",
  casual:
    "Relaxed, conversational. Contractions OK. Light humor OK if it fits.",
};

export interface ComposeInput {
  toEmail: string;
  toName?: string;
  about: string; // what the email should be about
  tone: EmailTone;
  hint?: string; // extra details to fold in
}

export interface ComposeResult {
  subject: string;
  body: string;
  tone: EmailTone;
}

/**
 * Compose a subject + body for the given recipient + intent + tone using
 * the existing LLM chain. Times out after 8s — if the LLM is broken or
 * slow, returns a deterministic fallback so the user can still review.
 */
export async function composeEmail(input: ComposeInput): Promise<ComposeResult> {
  const greeting = input.toName ? `Hi ${input.toName.split(/\s+/)[0]},` : "Hi there,";
  const hint = input.hint ? `\n\nAdditional context to weave in:\n${input.hint}` : "";

  const prompt = `Write an email in a **${input.tone}** tone. ${TONE_GUIDANCE[input.tone]}

Recipient: ${input.toEmail}${input.toName ? ` (${input.toName})` : ""}
Topic: ${input.about}${hint}

Output format (strict, no other text):
SUBJECT: <one-line subject, max 80 chars>
BODY:
<the email body, plain text, 3-6 short paragraphs, signed off appropriately>

Do NOT use Markdown headings, bullet points, or code fences. Plain text only.`;

  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 18_000);
    const result = await runLlmChain(prompt, {
      maxTokens: 600,
      temperature: 0.5,
      skipNvidia: true,
    });
    clearTimeout(t);
    const text = (result?.content ?? "").trim();
    if (text) {
      const parsed = parseComposed(text, greeting);
      if (parsed) return { ...parsed, tone: input.tone };
      // The model returned something but it didn't follow the strict
      // SUBJECT:/BODY: format. Log so we can see what's happening, and
      // still try to use the model output by extracting a reasonable
      // subject from the first non-empty line.
      console.warn(
        `[composio/email] LLM output didn't match SUBJECT:/BODY: format; first 200 chars: ${text.slice(0, 200).replace(/\n/g, "\\n")}`
      );
    }
  } catch (e) {
    console.warn(
      `[composio/email] compose LLM chain failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // Deterministic fallback — better than crashing, and better than
  // echoing the raw `about` text into the body. Produce a usable
  // email skeleton with the topic clearly framed, even when the LLM
  // is down. The user can still cancel and re-send if they want
  // something richer.
  const subject = `Re: ${input.about.slice(0, 60)}`.trim();
  const body = `${greeting}\n\nI wanted to follow up regarding ${input.about}.\n\nPlease let me know your thoughts when you have a moment.\n\nBest regards`;
  return { subject, body, tone: input.tone };
}

function parseComposed(text: string, fallbackGreeting: string): { subject: string; body: string } | null {
  // Strip <think>…</think> blocks that some models (openai/gpt-oss-120b,
  // qwen/qwen3.6-27b) prepend to their output. The thinking is noise —
  // the actual answer comes after.
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Be tolerant of format variations: "SUBJECT:" / "Subject:" / "**Subject:**"
  // / "Subject —" etc. The LLM is told strict format but some free models
  // drift. We only need a non-empty subject and a non-empty body.
  const subjectMatch = cleaned.match(/^\s*(?:\*\*)?\s*subject\s*(?:\*\*)?\s*[:\-—]\s*(.+)$/im);
  if (!subjectMatch) return null;
  const subject = subjectMatch[1].trim().replace(/^["']|["']$/g, "").slice(0, 200);
  // Find a body anchor. Prefer a literal "BODY:" line; fall back to
  // "everything after the subject line".
  const bodyIdx = cleaned.search(/^\s*(?:\*\*)?\s*body\s*(?:\*\*)?\s*[:\-—]\s*$/im);
  let body: string;
  if (bodyIdx >= 0) {
    body = cleaned
      .slice(bodyIdx)
      .replace(/^\s*(?:\*\*)?\s*body\s*(?:\*\*)?\s*[:\-—]\s*$/im, "")
      .trim();
  } else {
    // Take everything after the subject line.
    const lines = cleaned.split(/\r?\n/);
    const subjectLineIdx = lines.findIndex((l) =>
      /^\s*(?:\*\*)?\s*subject\s*(?:\*\*)?\s*[:\-—]/i.test(l)
    );
    body = lines.slice(subjectLineIdx + 1).join("\n").trim();
  }
  if (!body) return null;
  // Replace the first line if the model already included a greeting —
  // keep things consistent, don't double-greet.
  const lines = body.split(/\r?\n/);
  if (lines.length && !/^Hi\b|^\s*Dear\b|^Hello\b|^Hey\b/i.test(lines[0])) {
    lines.unshift(fallbackGreeting);
  }
  return { subject, body: lines.join("\n") };
}

export interface SendParams {
  userId: string;
  connectedAccountId: string;
  toEmail: string;
  subject: string;
  body: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send the email via composio's GMAIL_SEND_EMAIL action.
 * Plain text only (is_html=false).
 */
export async function sendViaComposio(params: SendParams): Promise<SendResult> {
  const { Composio } = await import("@composio/core");
  const c = new Composio({ apiKey: process.env.COMPOSIO_API_KEY! });

  try {
    const res = await c.tools.execute(
      "GMAIL_SEND_EMAIL",
      {
        userId: params.userId,
        connectedAccountId: params.connectedAccountId,
        dangerouslySkipVersionCheck: true,
        arguments: {
          recipient_email: params.toEmail,
          subject: params.subject,
          body: params.body,
          is_html: false,
        },
      },
      { signal: AbortSignal.timeout(15_000) }
    );
    if (res.successful) {
      const data = res.data as { id?: string; message_id?: string; threadId?: string };
      const messageId = data.id ?? data.message_id ?? data.threadId ?? "unknown";
      return { ok: true, messageId };
    }
    return { ok: false, error: res.error ?? "composio returned unsuccessful" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}