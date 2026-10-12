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
import { callJsonLlm } from "@/lib/llm/fastJson";
import { USER_PROFILE, emailSignature, identityPromptLine } from "@/lib/userProfile";

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

${identityPromptLine()}

Recipient: ${input.toEmail}${input.toName ? ` (${input.toName})` : ""}
Topic: ${input.about}${hint}

Output format (strict, no other text):
SUBJECT: <one-line subject, max 80 chars>
BODY:
<the email body, plain text, 3-5 short paragraphs>

Do NOT use Markdown headings, bullet points, or code fences. Plain text only.
End with your final sentence: do NOT write a closing or signature block. No
"Best regards", no name, no phone, no job title, no company — the signature is
added for you afterwards. Never emit placeholder brackets like [Your Name],
[Your title], [Company name] or [Contact info].`;

  // JSON first. The SUBJECT:/BODY: text format below is kept as a fallback,
  // but a model that thinks out loud tore it apart: the "body" that went out
  // was the model's own working — "No extra text. Let's craft. … We must not
  // include any placeholder … Now produce final answer." — wrapped around a
  // quoted draft. Asking for one JSON object, and rejecting a body that looks
  // like reasoning, is what keeps the mail readable.
  try {
    const viaJson = await composeViaJson(input, greeting, hint);
    if (viaJson) return { ...viaJson, tone: input.tone };
  } catch (e) {
    console.warn(
      `[composio/email] JSON compose failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }

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
      // A parsed result is not automatically a good one: reject a body that
      // contains the model's reasoning (or a second SUBJECT:/BODY: header).
      if (parsed && !looksLikeReasoningLeak(parsed.body)) {
        return { ...parsed, tone: input.tone };
      }
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
  // something richer. Signed with the user's real identity.
  const subject = `Re: ${input.about.slice(0, 60)}`.trim();
  const body = `${greeting}\n\nI wanted to follow up regarding ${input.about}.\n\nPlease let me know your thoughts when you have a moment.\n\n${emailSignature()}`;
  return { subject, body, tone: input.tone };
}

// Placeholder lines the models invent: [Your Name] / [Your title] /
// [Company name] / [Contact info] / {{name}} / <Your Name>. One source string,
// compiled twice — a /g regex used with .test() carries lastIndex between
// calls, and a non-/g regex given to .replace() only clears the first hit.
const PLACEHOLDER_SRC = String.raw`^\s*[\[\{<]\s*(?:your|my|the)?\s*(?:full\s+)?(?:name|title|job\s*title|position|role|company|company\s*name|organisation|organization|contact|contact\s*info|phone|email|address|date)\s*[\]\}>]\s*[:.]?\s*$`;
const PLACEHOLDER_RE = new RegExp(PLACEHOLDER_SRC, "im");
const PLACEHOLDER_RE_G = new RegExp(PLACEHOLDER_SRC, "gim");

const EMAIL_JSON_SYSTEM = `You write short, natural emails on behalf of a real person.

Reply with STRICT JSON only, no prose around it:
{ "subject": "<one line, max 80 chars>", "body": "<the email>" }

Rules for "body":
- Plain text with a greeting line, then 2-4 short paragraphs. Separate paragraphs with \\n\\n.
- No Markdown, no bullet points, no code fences, no headings.
- Do NOT write any closing or signature: no "Best regards", no name, no phone
  number, no job title, no company. The signature is appended automatically.
- Never emit placeholder brackets such as [Your Name], [Your title],
  [Company name] or [Contact info].
- Never explain yourself, never restate these rules, never describe what you are
  about to write. Output the email itself and nothing else.`;

/**
 * Reasons the composed body is the model's working, not an email. Seen in the
 * wild on free models: "No extra text. Let's craft. … We must not include any
 * placeholder. Now produce final answer."
 */
function looksLikeReasoningLeak(body: string): boolean {
  return (
    /^\s*(?:no extra text|let'?s craft|now produce|okay[,.]?\s+let|we must not|the format|first,?\s+i'?ll)/im.test(
      body
    ) ||
    /\b(?:we must not|as strict json|the output format|now produce final answer|make sure no extra blank lines)\b/i.test(
      body
    ) ||
    // A second SUBJECT:/BODY: header inside the body = the format leaked through.
    /^\s*(?:subject|body)\s*:\s*$/im.test(body) ||
    /["“][\s\S]{0,80}Hi[,!]/i.test(body.trim()) // a quoted draft sitting in the body
  );
}

/** Strip wrapping quotes a model sometimes puts around the whole body. */
function unwrapQuotes(body: string): string {
  let out = body.trim();
  for (let i = 0; i < 3; i++) {
    const first = out[0];
    const last = out[out.length - 1];
    if ((first === '"' || first === "'") && last === first) {
      out = out.slice(1, -1).trim();
    } else {
      break;
    }
  }
  return out
    .replace(/\\n/g, "\n")
    .replace(/\\"|\\'/g, (m) => (m === '\\"' ? '"' : "'"))
    .trim();
}

/**
 * Ask for the whole email as one JSON object. Returns null (never throws) when
 * no provider answered or the answer does not look like an email — the caller
 * then falls back to the text format, then to the deterministic skeleton.
 */
async function composeViaJson(
  input: ComposeInput,
  greeting: string,
  hint: string
): Promise<{ subject: string; body: string } | null> {
  const raw = await callJsonLlm<{ subject?: string; body?: string; email?: string; text?: string }>({
    system: EMAIL_JSON_SYSTEM,
    user: `Tone: ${input.tone} — ${TONE_GUIDANCE[input.tone]}\n\n${identityPromptLine()}\n\nRecipient: ${input.toEmail}${input.toName ? ` (${input.toName})` : ""}\nTopic: ${input.about}${hint}\n\nWrite the email now as strict JSON.`,
    maxTokens: 700,
    temperature: 0.4,
    timeoutMs: 12_000,
    label: "EmailCompose",
  });
  if (!raw) return null;

  const subject = String(raw.subject ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .slice(0, 200);
  let body = String(raw.body ?? raw.email ?? raw.text ?? "").trim();
  if (!subject || !body) return null;

  body = unwrapQuotes(body);
  if (looksLikeReasoningLeak(body)) return null;
  if (PLACEHOLDER_RE.test(body)) body = body.replace(PLACEHOLDER_RE_G, "");

  // Keep one greeting, and only one.
  const lines = body.split(/\r?\n/);
  if (lines.length && !/^\s*(?:hi\b|dear\b|hello\b|hey\b)/i.test(lines[0])) {
    lines.unshift(greeting);
  }
  return { subject, body: lines.join("\n").trim() };
}

/**
 * Guarantee the composed body ends with EXACTLY ONE signature, and that it is
 * the user's real one.
 *
 * The failure this exists to prevent: free models, told to "sign off
 * appropriately", emit a template sign-off —
 *
 *   Best regards,
 *   [Your title]
 *   [Company name]
 *   [Contact info]
 *
 * — and the old code only APPENDED the real signature when the first name was
 * missing, so the placeholders went out in the mail alongside it. The user saw
 * literal brackets in a real email.
 *
 * So: (1) drop any bracketed placeholder line anywhere in the body, (2) cut the
 * model's own closing/signature block off the end, (3) append the canonical
 * signature from USER_PROFILE — name + contact only. No title, no company, and
 * never a placeholder.
 */
export function applyIdentity(subject: string, body: string): { subject: string; body: string } {
  let fixed = body
    // Placeholder lines the models like to invent, anywhere in the body.
    // Covers [Your Name] / [Your title] / [Company name] / [Contact info] /
    // {{name}} / <Your Name> style fills.
    .replace(PLACEHOLDER_RE_G, "")
    .replace(/\{\{\s*(?:name|title|company|contact)\s*\}\}/gim, "")
    // A phone number the model invented (we only allow the real one through).
    .replace(/\b\d{10}\b/g, USER_PROFILE.phone);

  fixed = stripSignatureBlock(fixed);
  return { subject, body: `${fixed.trim()}\n\n${emailSignature()}` };
}

// The closing phrases a model uses to sign off. Matched as a STANDALONE LINE
// only — that is what separates a signature from prose. A regex that glued the
// phrase to following lines swallowed an entire email the moment a body said
// "Thanks for the update yesterday …" in the middle: the whole message, prose
// included, disappeared and only the signature was sent.
const CLOSING_LINE_RE =
  /^(?:best\s+regards|kind\s+regards|warm\s+regards|regards|sincerely(?:\s+yours)?|yours\s+(?:truly|sincerely|faithfully)|thanks(?:\s+(?:and\s+regards|a\s+lot|so\s+much))?|thank\s+you|many\s+thanks|cheers|best|respectfully|warmly)\s*[,!.]?$/i;

/** Cut the model's own sign-off, and only when it sits in the last few lines. */
function stripSignatureBlock(body: string): string {
  const lines = body.split(/\r?\n/);
  const filled = lines.map((line, i) => ({ line, i })).filter(({ line }) => line.trim() !== "");
  const tailStart = Math.max(0, filled.length - 8);
  for (let k = tailStart; k < filled.length; k++) {
    if (CLOSING_LINE_RE.test(filled[k].line.trim())) {
      return lines.slice(0, filled[k].i).join("\n");
    }
  }
  return body;
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