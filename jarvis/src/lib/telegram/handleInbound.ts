// Telegram inbound dispatcher.
//
// Flow: inbound text from the bot user → loads conversation history from
// Prisma → calls the existing /api/chat endpoint (which streams an SSE
// response covering weather, LLM fallback, and inline Playwright automation
// for Zomato, Amazon, flights, Spotify, YouTube, etc.) → parses the SSE
// stream and sends chunks to Telegram → persists the round-trip.
//
// This module is the *brain connection* the existing send-only Telegram
// routes were missing. It is deliberately a pure function with explicit
// context dependencies so it can be unit-tested without real Telegram.

import {
  enqueueTelegramMessage,
  getRecentForChat,
  markFailed,
  markSent,
  type TelegramMessageRow,
} from "./queue";
import type {
  InlineKeyboardButton,
  ReplyOpts,
} from "./index";
import { buildSystemPrompt, type JARVISContext } from "@/lib/jarvis/personality";
import {
  routeCommand,
  formatRemindersList,
  formatWhereami,
  type ReplyPlan,
} from "./commands";
import {
  executeOsCommand,
  createDestructivePending,
  destructiveConfirmButtons,
} from "./osBridge";
import { getLastClipboard } from "./clipboard";
import { composeLocalBriefing, type BriefingKind } from "@/services/BriefingService";
import type { DayPhase } from "@/hooks/useAmbientContext";

// Use a relative fetch base so this works in both dev and prod.
const API_BASE = process.env.INTERNAL_API_URL || "http://localhost:3000";

// Suffix appended to whatever system prompt the chat route already has.
// Some free-tier models (Nemotron, Llama-3.x-Instruct) tend to emit
// their chain-of-thought as visible content — numbered "1. Analyze,
// 2. Identify, …" lists. Telling them not to in the system prompt is
// more reliable than trying to strip the leak from the output.
const NO_LEAK_SUFFIX =
  "\n\nImportant: respond with ONLY the final answer to the user. " +
  "Do not include step-by-step analysis, planning, reasoning, numbered " +
  "thinking lists, or meta-commentary about how you arrived at the " +
  "answer. Keep replies concise and suitable for a chat bubble.";

// Tell the model it's on Telegram and what the constraints are.
// Without this, free-tier models sometimes forget they're replying
// in a chat-bubble UI and emit markdown tables, code fences, or
// essays that get truncated mid-thought.
const TELEGRAM_CHANNEL_SUFFIX =
  "\n\n── RESPONSE CHANNEL ────────────────────────────\n" +
  "You are replying on Telegram (a chat-bubble messenger). The user " +
  "is reachable on their phone; your reply is rendered as a Telegram " +
  "message. Hard constraints:\n" +
  "  • No code fences, no markdown tables, no headings. Telegram's " +
  "    Markdown renderer can't handle them reliably and they'll look " +
  "    broken.\n" +
  "  • Inline emphasis with *bold* or _italic_ is fine, sparingly.\n" +
  "  • Aim for 2-5 sentences. Long essays get cut off mid-thought.\n" +
  "  • If you need to ask a question, keep it to one.\n" +
  "───────────────────────────────────────────────────";

/**
 * Build the system prompt the dispatcher sends to /api/chat.
 *
 * Three layers, in order:
 *   1. The canonical JARVIS persona from `lib/jarvis/personality.ts` —
 *      the same prompt the laptop's CommandBar uses, so the bot on
 *      Telegram and the bot on the laptop speak with one voice.
 *   2. A "you're on Telegram" channel suffix — markdown / length
 *      constraints specific to a chat-bubble UI.
 *   3. The "no reasoning leak" suffix — keeps free-tier models from
 *      emitting their chain-of-thought as visible content.
 *
 * The caller may override the persona prompt via the
 * `JARVIS_TELEGRAM_SYSTEM_PROMPT` env var; if so, only layers 2 and 3
 * are appended to the override.
 */
function buildTelegramSystemPrompt(): string {
  // Default user name matches the laptop's `Boss`. Override via env
  // if you want the bot to address you by a different name.
  const userName = process.env.JARVIS_TELEGRAM_USER_NAME?.trim() || "Boss";

  const jarvisContext: JARVISContext = {
    userName,
    currentTime: new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    memories: [],
    tasks: [],
    recentMessages: [],
  };

  const persona = buildSystemPrompt(jarvisContext);

  const base =
    process.env.JARVIS_TELEGRAM_SYSTEM_PROMPT?.trim() ||
    persona + TELEGRAM_CHANNEL_SUFFIX;

  // Always append the no-leak instruction — it's idempotent and
  // critical for stopping free-tier models from leaking reasoning.
  return `${base}${NO_LEAK_SUFFIX}`;
}

export interface InboundContext {
  chatId: number;
  /** The inbound row from the queue, used to link the outbound reply. */
  inboundRowId: string;
  /** Telegram message_id of the inbound message, used to sendChatAction etc. */
  inboundTelegramMsgId: number | null;
  sendTyping: () => Promise<void>;
  sendReply: (
    text: string,
    opts?: ReplyOpts
  ) => Promise<number[]>;
  sendVoice: (audioUrl: string, caption?: string) => Promise<void>;
  sendFile: (fileUrl: string, caption?: string) => Promise<void>;
  editLastProgress: (text: string) => Promise<void>;
}

export interface DispatchResult {
  ok: boolean;
  outboundRowId?: string;
  replyText?: string;
  error?: string;
}

/**
 * Build the messages array the chat route expects, pulling recent
 * context from Prisma so the LLM/automation has a sense of the
 * conversation.
 */
async function buildChatHistory(
  chatId: number,
  prompt: string
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const recent = await getRecentForChat(chatId, 20);
  // Only include rows that have completed (sent / failed / rejected).
  // We don't want to inject a half-finished reply into the context.
  const completed = recent.filter(
    (r) => r.status === "sent" || r.status === "failed"
  );

  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const row of completed) {
    // Skip offline / canned-fallback replies. They were generated
    // by the chat route's offline greeting path, not by an LLM,
    // and injecting them as the assistant's previous reply causes
    // the LLM to echo / continue the canned tone instead of
    // answering the user's actual question. We persist them with
    // `metadata.offline = true` exactly so this filter can drop
    // them.
    if (row.metadata?.offline === true) continue;

    if (row.direction === "inbound") {
      messages.push({ role: "user", content: row.text });
    } else if (row.direction === "outbound" && row.text) {
      messages.push({ role: "assistant", content: row.text });
    }
    // "system" direction rows are proactive pushes from other parts
    // of the codebase (scheduler, briefing, etc.). They're not part
    // of the user's chat history and would confuse the LLM if
    // injected as assistant turns.
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

interface ParsedChatResponse {
  text: string;
  buttons?: InlineKeyboardButton[][];
  audioUrl?: string;
  attachments?: string[];
}

/**
 * What the dispatcher learns from a /api/chat response besides the
 * raw text. The chat route sets `offline: true` when the LLM chain
 * is fully exhausted and the canned greeting was returned instead —
 * we use that flag to (a) stop sending the canned greeting back into
 * future context, and (b) tag it in the queue so the panel can show
 * a "fallback reply" badge.
 */
interface ParsedChatReply {
  text: string;
  offline: boolean;
  provider?: string;
  model?: string;
}

/**
 * Extract the assistant text from the /api/chat response.
 *
 * The chat route returns one of three shapes depending on whether an
 * LLM provider is reachable:
 *
 *   1. application/json, {content: "...", offline?: true, model?: "..."}
 *      — offline / rate-limited (or any JSON reply)
 *   2. text/event-stream, "data: {choices:[{delta:{content}}]}\n\n..."
 *      — real streaming success (browser fetch)
 *   3. The whole SSE stream buffered as one text/plain body (Next.js
 *      internal fetch often does this) — format is the same as #2
 *      but arrived as a single string.
 *
 * We try the JSON shape first, then fall back to parsing SSE lines,
 * then fall back to returning the raw text.
 */
async function readChatResponse(
  res: Response,
  onChunk: (text: string) => void
): Promise<ParsedChatReply> {
  // Read the entire body. This works for both JSON and "buffered SSE"
  // forms; for real streaming responses we still get chunks as they
  // arrive because res.text() awaits the stream.
  const raw = await res.text();

  // 1. JSON body?
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.content === "string" && parsed.content.length > 0) {
      onChunk(parsed.content);
      return {
        text: parsed.content,
        offline: parsed.offline === true,
        provider:
          typeof parsed.fallback === "string"
            ? parsed.fallback
            : undefined,
        model: typeof parsed.model === "string" ? parsed.model : undefined,
      };
    }
    if (typeof parsed?.error === "string") {
      return { text: `⚠️ ${parsed.error}`, offline: true };
    }
  } catch {
    // Not JSON — fall through to SSE parsing.
  }

  // 2. SSE body — split on lines, each "data: <json>" is a delta.
  const lines = raw.split(/\r?\n/);
  let full = "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload);
      const delta =
        parsed?.choices?.[0]?.delta?.content ??
        parsed?.choices?.[0]?.text ??
        parsed?.content;
      if (typeof delta === "string" && delta.length > 0) {
        full += delta;
        onChunk(delta);
      }
    } catch {
      // Skip non-JSON lines.
    }
  }

  // 3. If SSE parsing found nothing, return the raw text as-is.
  //    Could be plain text or a final chunk with no `data:` prefix.
  return { text: full || raw.trim(), offline: false };
}

/**
 * Strip reasoning traces from the LLM output before sending to
 * Telegram. We see three flavors of leak in the wild:
 *
 *   1. `<think ...>...</think>` XML blocks (Qwen, DeepSeek-distilled).
 *   2. "Here's a thinking process:\n\n..." intros.
 *   3. Numbered chain-of-thought lists at the start of the reply
 *      — common with Llama-3.x-Instruct and Nemotron. The model
 *      emits "1. **Analyze:**...\n2. **Identify:**...\n..." then
 *      a blank line, then the actual answer.
 *
 * For #3 we don't know how many numbered items there will be, so
 * the strategy is: drop everything from the start until the first
 * sequence of two consecutive newlines that's followed by content
 * that does NOT start with a numbered-step marker.
 */
function stripReasoning(text: string): string {
  if (!text) return text;
  let cleaned = text;

  // 1. <think ...>...</think> blocks (greedy across newlines).
  cleaned = cleaned.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");

  // 2. "Here's a thinking process:" intro (some models).
  cleaned = cleaned.replace(
    /^Here's a (?:thinking )?process:[\s\S]*?(?=\n\n|\r\n\r\n)/i,
    ""
  );

  // 3. Numbered chain-of-thought leak. A leading numbered list,
  //    "1. **Foo:**", "2. **Bar:**", … until the numbered pattern
  //    stops. We detect the start by checking that the first
  //    non-blank line begins with a `N. **` marker, and we drop
  //    everything from the start up to (but not including) the
  //    first blank line that follows the last numbered item.
  //
  //    Implementation: find the first `\n\n` after which the next
  //    line does NOT start with a numbered-step pattern. If such a
  //    boundary exists within the first 4000 chars, drop everything
  //    before it.
  const numberedStep = /^\s*\d+\.\s+\*\*/;
  const lines = cleaned.split(/\r?\n/);
  if (lines.length > 1 && numberedStep.test(lines[0])) {
    // Walk forward, tracking when we leave the numbered sequence.
    let lastNumberedIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (numberedStep.test(lines[i])) {
        lastNumberedIdx = i;
      } else if (lastNumberedIdx >= 0 && lines[i].trim() === "") {
        // We hit a blank line AFTER the last numbered step — that's
        // the boundary between the thinking block and the answer.
        const remaining = lines.slice(i + 1).join("\n").trimStart();
        if (remaining.length > 0) {
          cleaned = remaining;
        }
        break;
      }
    }
  }

  // 4. Trim any orphaned leading whitespace left by the stripping.
  cleaned = cleaned.replace(/^\s+/, "");
  return cleaned;
}

/**
 * Cap the user-visible reply. Telegram allows 4096 chars per message
 * and `sendReply` chunks at 4000. Keep the cap below that so a single
 * chunk is enough for the common case. Vision / document summaries
 * regularly run 2-3k chars, so the previous 1500 was cutting them off
 * mid-sentence.
 */
const TELEGRAM_USER_REPLY_CAP = 3500;
function capReplyLength(text: string): string {
  if (text.length <= TELEGRAM_USER_REPLY_CAP) return text;
  const truncated = text.slice(0, TELEGRAM_USER_REPLY_CAP);
  const lastBreak = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf(".\n"),
    truncated.lastIndexOf("\n\n"),
  );
  const cut = lastBreak > TELEGRAM_USER_REPLY_CAP * 0.6 ? lastBreak + 1 : TELEGRAM_USER_REPLY_CAP;
  return truncated.slice(0, cut).trimEnd() + "…";
}

function detectButtons(text: string): {
  cleaned: string;
  buttons?: InlineKeyboardButton[][];
} {
  // Lightweight convention: if the response ends with a fenced block
  // labelled `buttons` and a JSON array, render it as inline_keyboard.
  // Example trailing block:
  //   ```buttons
  //   [{"text":"Yes","callback_data":"yes"}, {"text":"No","callback_data":"no"}]
  //   ```
  const m = text.match(/```buttons\s*\n([\s\S]*?)\n```\s*$/);
  if (!m) return { cleaned: text };
  try {
    const arr = JSON.parse(m[1]) as InlineKeyboardButton[];
    if (!Array.isArray(arr) || arr.length === 0) return { cleaned: text };
    // Inline keyboards are arrays of rows; if the model returned a flat
    // array of buttons, wrap each in its own row.
    const looksLikeRows =
      Array.isArray(arr[0]) && (arr[0] as unknown[]).every(
        (b) => b && typeof b === "object" && "text" in (b as object) && "callback_data" in (b as object)
      );
    const rows: InlineKeyboardButton[][] = looksLikeRows
      ? (arr as unknown as InlineKeyboardButton[][])
      : [arr as InlineKeyboardButton[]];
    return { cleaned: text.slice(0, m.index!).trimEnd(), buttons: rows };
  } catch {
    return { cleaned: text };
  }
}

/**
 * Resolve a ReplyPlan into a side-effecting response. Used at the top
 * of `handleInboundMessage` to short-circuit slash-commands and
 * natural-language OS commands before the LLM is consulted.
 */
async function applyReplyPlan(
  plan: ReplyPlan,
  ctx: InboundContext
): Promise<DispatchResult> {
  if (plan.kind === "chat") {
    // Fall through — caller must use the LLM path.
    return { ok: false, error: "fallthrough" };
  }

  let replyText = plan.text ?? "";
  let opts: ReplyOpts = plan.opts ?? {};

  switch (plan.kind) {
    case "reply":
      // Already have replyText + opts.
      break;

    case "execute_os": {
      const command = plan.payload?.command as string;
      const params = (plan.payload?.params as Record<string, unknown>) ?? {};
      const result = await executeOsCommand(command, params);
      replyText = result.ok
        ? `✅ ${result.description ?? "Done."}`
        : `❌ ${result.error ?? "Action failed."}`;
      break;
    }

    case "confirm_destructive": {
      const action = plan.payload?.action as string;
      const params = (plan.payload?.params as Record<string, unknown>) ?? {};
      const pending = await createDestructivePending(
        ctx.chatId,
        action,
        params
      );
      replyText = `⚠️ Confirm ${action}? This affects the laptop immediately.`;
      opts = { ...opts, buttons: destructiveConfirmButtons(pending.shortId) };
      break;
    }

    case "create_reminder":
      // /remind was already resolved by commands.ts; replyText is set.
      break;

    case "cancel_reminder":
      // ditto.
      break;

    case "list_reminders":
      replyText = await formatRemindersList(ctx.chatId);
      break;

    case "location_whereami":
      replyText = await formatWhereami(ctx.chatId);
      break;

    case "brief":
      // Best-effort local brief. The full briefing path needs
      // weather/email/calendar which the dispatcher doesn't fetch.
      replyText = await composeBriefText();
      break;

    case "clip": {
      const text = getLastClipboard();
      replyText = text
        ? `📋 Latest clipboard:\n\n${text.slice(0, 3000)}`
        : "Clipboard is empty, Boss.";
      break;
    }

    case "tasks_list": {
      // Lazy import to avoid the Prisma deps on the cold path.
      const { prisma } = await import("@/lib/db/queries");
      const tasks = await prisma.task.findMany({
        where: { completed: false },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 20,
      });
      replyText = tasks.length === 0
        ? "Task list is empty, Boss."
        : tasks
            .map((t) => `• ${t.id.slice(0, 8)} — ${t.title}`)
            .join("\n");
      break;
    }

    case "tasks_add": {
      const title = (plan.payload?.title as string | undefined)?.trim();
      if (!title) {
        replyText = "Usage: /task <title>";
        break;
      }
      const { prisma } = await import("@/lib/db/queries");
      const t = await prisma.task.create({
        data: { title, priority: "normal" },
      });
      replyText = `📝 Task added: ${t.title}\n(id: ${t.id.slice(0, 8)})`;
      break;
    }

    case "tasks_done": {
      const id = (plan.payload?.id as string | undefined)?.trim();
      if (!id) {
        replyText = "Usage: /done <id>";
        break;
      }
      const { prisma } = await import("@/lib/db/queries");
      // Allow short IDs — find by prefix.
      const t = await prisma.task.findFirst({
        where: { id: { startsWith: id } },
      });
      if (!t) {
        replyText = `Couldn't find task ${id}.`;
        break;
      }
      await prisma.task.update({
        where: { id: t.id },
        data: { completed: true },
      });
      replyText = `✅ Marked done: ${t.title}`;
      break;
    }

    case "whoami":
      replyText = `Your chat_id is ${ctx.chatId}, Boss.`;
      break;

    case "help":
    case "start":
      // commands.ts already produced the reply text.
      break;

    default:
      return { ok: false, error: `unhandled plan: ${plan.kind}` };
  }

  if (!replyText) {
    replyText = "_(Jarvis had nothing to say — try rephrasing)_";
  }

  // Send the reply (single message — replaces the "thinking…" placeholder).
  await ctx.editLastProgress(replyText).catch(() => {});

  await enqueueTelegramMessage({
    chatId: ctx.chatId,
    direction: "outbound",
    text: replyText,
    status: "sent",
    replyToId: ctx.inboundRowId,
    metadata: {
      parseMode: "Markdown",
      commandPlan: plan.kind,
      ...(opts.buttons ? { buttons: opts.buttons } : {}),
    },
  });
  await markSent(ctx.inboundRowId);

  return { ok: true, replyText };
}

async function composeBriefText(): Promise<string> {
  // Best-effort: defer to composeLocalBriefing with synthetic ambient
  // context if the panel's ambient context isn't readily available here.
  // The full /api/briefing/generate path would require the panel's
  // ambient state — for v1 we emit a minimal greeting + task summary.
  try {
    const hour = new Date().getHours();
    const kind: BriefingKind =
      hour < 12 ? "morning" : hour < 18 ? "evening" : "weekly";
    const { prisma } = await import("@/lib/db/queries");
    const tasks = await prisma.task.findMany({
      where: { completed: false },
      take: 5,
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    });
    const ambient = {
      hour,
      dayPhase: (
        hour < 5 ? "night"
        : hour < 7 ? "dawn"
        : hour < 11 ? "morning"
        : hour < 14 ? "midday"
        : hour < 17 ? "afternoon"
        : hour < 19 ? "evening"
        : hour < 22 ? "dusk"
        : "night"
      ) as DayPhase,
      isWeekend: [0, 6].includes(new Date().getDay()),
      biometricsActive: false,
      activeAlerts: 0,
      isHeadphonesIn: false,
    };
    const brief = composeLocalBriefing(kind, {
      ambient,
      pendingTasks: tasks.map((t) => t.title),
      memoryHighlights: [],
      upcomingEvents: [],
      newsHeadlines: [],
      userName: process.env.JARVIS_TELEGRAM_USER_NAME?.trim() || "Boss",
    });
    return `${brief.greeting}\n\n${brief.body}`;
  } catch (err: any) {
    return `Brief unavailable right now, Boss: ${err?.message || err}`;
  }
}

/**
 * Main entry point. Called by the poll route and the boot-time replay.
 * Side-effects only: the inbound row is updated to "processing" before
 * this is called; we update it to "sent" or "failed" when done.
 */
export async function handleInboundMessage(
  rawText: string,
  ctx: InboundContext
): Promise<DispatchResult> {
  const text = rawText.trim();
  if (!text) {
    return { ok: false, error: "empty message" };
  }

  // 0. Command routing — short-circuit before LLM.
  //    Detects /commands, /remind, /clip, natural-language OS commands
  //    ("lock my laptop"), and pre-resolves them to a reply or action.
  const fromCallback =
    typeof ctx.inboundTelegramMsgId === "number" && ctx.inboundTelegramMsgId < 0;
  const plan = await routeCommand(ctx.chatId, text, { fromCallback });
  if (plan.kind !== "chat") {
    const result = await applyReplyPlan(plan, ctx);
    if (result.ok) return result;
    // If the plan was unhandled / fallthrough (shouldn't happen for
    // anything but `chat`), continue to the LLM path.
  }

  // 1. Continuous typing indicator (Telegram expires it after 5s).
  await ctx.sendTyping();
  const typingTimer = setInterval(() => {
    ctx.sendTyping().catch(() => {});
  }, 4500);
  // All progress updates route through `editLastProgress` — that
  // helper owns the message_id state, so we don't track it here.
  // Routing the first push through the wrapper (instead of calling
  // ctx.sendReply directly) ensures every subsequent update —
  // including the final reply — edits the SAME message in place.
  let lastProgressText = "🤖 *Jarvis* — thinking…";
  await ctx.editLastProgress(lastProgressText);

  try {
    const messages = await buildChatHistory(ctx.chatId, text);

    // 2. Call the chat route. It returns an SSE stream of text deltas;
    //    after the [DONE] marker, the body closes. We collect everything.
    const chatRes = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        // Use the canonical JARVIS persona + Telegram channel
        // constraints, so the bot speaks in the same voice as the
        // laptop version and respects Telegram's UI limits.
        systemPrompt: buildTelegramSystemPrompt(),
      }),
    });

    if (!chatRes.ok) {
      const errText = await chatRes.text().catch(() => "");
      throw new Error(
        `/api/chat returned ${chatRes.status}: ${errText.slice(0, 200)}`
      );
    }

    // Extract the reply text. Handles JSON, SSE, and buffered-SSE
    // shapes — see readChatResponse for the rationale. The JSON
    // path returns metadata (offline flag, provider) alongside the
    // text — collect everything in one place.
    let streamed = "";
    let offline = false;
    let provider: string | undefined;
    let model: string | undefined;
    const replyResult = await readChatResponse(chatRes, async (chunk) => {
      streamed += chunk;
      // Throttle progress edits: only update the placeholder every ~30
      // characters to avoid hitting Telegram's edit rate limits.
      // The preview is run through stripReasoning so we never flash
      // a chain-of-thought leak to the user mid-stream — without
      // this, the user sees "1. **Analyze User Input:**..." flash
      // for ~1s before the final sanitized answer overwrites it.
      if (streamed.length - lastProgressText.length > 40) {
        const preview = stripReasoning(streamed).slice(-200);
        if (preview) {
          // No Markdown wrapping: the previous `_${preview}_` italic
          // made replies render as truncated-at-the-last-`_` whenever
          // the final edit failed or was throttled. Plain text is the
          // safe default and Telegram still shows the 🤖 prefix as
          // a recognizable bot indicator.
          const next = `🤖 ${preview}`;
          await ctx.editLastProgress(next).catch(() => {});
          lastProgressText = next;
        }
      }
    });
    offline = replyResult.offline;
    provider = replyResult.provider;
    model = replyResult.model;
    // For the JSON path, onChunk only fires once with the full text
    // and the returned `text` is the same — but for the SSE path
    // streamed already holds the full text from delta chunks, while
    // replyResult.text is the same value. Trust `streamed` which is
    // what we just sent to the user via the progress placeholder.
    if (!streamed && replyResult.text) streamed = replyResult.text;

    // Diagnostic: log what we got so we can debug if the wrong path
    // is being taken (e.g. offline greeting showing up when an LLM
    // should respond).
    console.log(
      `[telegram/handleInbound] chat reply (${streamed.length} chars, offline=${offline}, provider=${provider ?? "-"}, model=${model ?? "-"}): ${streamed.slice(0, 200).replace(/\n/g, " ")}`
    );

    // Clean reasoning traces and cap length BEFORE looking for
    // buttons, since the ```buttons``` block convention is at the
    // very end and 1.5k is plenty of room for a real reply.
    const sanitized = capReplyLength(stripReasoning(streamed));

    const parsed: ParsedChatResponse = (() => {
      const { cleaned, buttons } = detectButtons(sanitized);
      const text = cleaned.trim();
      return {
        text: text || "_(Jarvis had nothing to say — try rephrasing)_",
        buttons,
      };
    })();

    // 3. Overwrite the progress placeholder with the final reply.
    //    `editLastProgress` is idempotent and tracks the message_id
    //    in its closure — every push (the initial "thinking…", each
    //    streaming preview, and this final write) edits the same
    //    Telegram message in place. No second message bubble.
    await ctx.editLastProgress(parsed.text).catch(() => {});

    // 4. Optional: send voice (TTS) or file attachments. Out of scope for v1
    //    until the user opts in — see the plan's "Out of scope" section.

    // 5. Persist outbound. Tag offline replies so the panel can
    //    show a "fallback" badge and `buildChatHistory` can filter
    //    them out of future LLM context (the canned greeting
    //    otherwise leaks back into future replies as the assistant's
    //    "previous" message).
    const outboundMetadata: Record<string, unknown> = {
      parseMode: "Markdown",
    };
    if (parsed.buttons) outboundMetadata.buttons = parsed.buttons;
    if (offline) outboundMetadata.offline = true;
    if (provider) outboundMetadata.provider = provider;
    if (model) outboundMetadata.model = model;

    const outbound = await enqueueTelegramMessage({
      chatId: ctx.chatId,
      direction: "outbound",
      text: parsed.text,
      status: "sent",
      replyToId: ctx.inboundRowId,
      metadata: outboundMetadata,
    });
    await markSent(ctx.inboundRowId);

    return {
      ok: true,
      outboundRowId: outbound.id,
      replyText: parsed.text,
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[telegram/handleInbound] error:", msg);
    await ctx
      .editLastProgress(`⚠️ _Error:_ ${msg.slice(0, 200)}`)
      .catch(() => {});
    await markFailed(ctx.inboundRowId, msg);
    return { ok: false, error: msg };
  } finally {
    clearInterval(typingTimer);
  }
}

/**
 * Higher-level helper: takes a queue row that has just been claimed,
 * builds the ctx, and dispatches. Used by the poll route and replay.
 */
export async function dispatchFromQueueRow(
  row: TelegramMessageRow,
  deps: {
    token: string;
    sendTyping: () => Promise<void>;
    sendReply: (text: string, opts?: ReplyOpts) => Promise<number[]>;
    sendVoice: (audioUrl: string, caption?: string) => Promise<void>;
    sendFile: (fileUrl: string, caption?: string) => Promise<void>;
  }
): Promise<DispatchResult> {
  // Media rows (photo, document, voice) carry pre-processed content in row.text:
  //   - photo:    the image description from the vision model
  //   - document: the extracted/summarised text from the document parser
  //   - voice:    the transcription from whisper/whisper-openai
  //
  // Fix: we MUST send this content back to the user on Telegram, otherwise
  // they receive nothing after uploading a file.
  //
  //   • Photos and documents → send the description/extract directly.
  //     There is no need to send them through the LLM again; the vision
  //     model already wrote a natural-language description.
  //   • Voice → run through the LLM so JARVIS can *respond* to what was
  //     said (e.g. if the user dictated "set a reminder for 6pm",
  //     JARVIS should honour the request).
  const mediaKind = (row.metadata as { kind?: string } | null)?.kind;

  if (mediaKind === "photo" || mediaKind === "document") {
    // Send the vision/document description directly to the user.
    const description = row.text?.trim() || "_(No description available)_";
    const label = mediaKind === "photo" ? "📸 *Image Analysis*" : "📄 *Document Summary*";
    try {
      await deps.sendReply(`${label}\n\n${description}`);
    } catch (sendErr: any) {
      console.error(
        `[telegram/dispatchFromQueueRow] failed to send ${mediaKind} description:`,
        sendErr?.message || sendErr
      );
    }
    // Persist the outbound reply in the queue so the panel renders it.
    await enqueueTelegramMessage({
      chatId: row.chatId,
      direction: "outbound",
      text: description,
      status: "sent",
      replyToId: row.id,
      metadata: { parseMode: "Markdown", mediaReply: mediaKind },
    });
    await markSent(row.id);
    return { ok: true, replyText: description };
  }

  // Voice: pass the transcript through the LLM so JARVIS can respond to it.
  // The row.text already holds the transcription text; we feed it as a user
  // prompt so slash-commands, reminders, and general chat all work.
  // (No early return here — fall through to the standard LLM path below.)

  let lastProgressId: number | null = null;
  const editLastProgress = async (text: string) => {
    if (lastProgressId == null) {
      const ids = await deps.sendReply(text);
      lastProgressId = ids[ids.length - 1] ?? null;
    } else {
      const { editMessageText } = await import("./index");
      await editMessageText(
        deps.token,
        row.chatId,
        lastProgressId,
        text
      );
    }
  };

  return handleInboundMessage(row.text, {
    chatId: row.chatId,
    inboundRowId: row.id,
    inboundTelegramMsgId: row.telegramMsgId,
    sendTyping: deps.sendTyping,
    sendReply: deps.sendReply,
    sendVoice: deps.sendVoice,
    sendFile: deps.sendFile,
    editLastProgress,
  });
}
