import { NextRequest, NextResponse } from "next/server";
import { agentLlm, parseJsonLoose } from "@/lib/agent/llm";
import { streamLlm } from "@/lib/agent/llmStream";
import { isModeId, MODE_BY_ID, type ModeId } from "@/lib/overlay/modes";

// Two jobs, one endpoint, because both are "turn the conversation into
// something smaller":
//
//   1. intent:"summary"  (user-facing, streamed, Ctrl+Shift+S)
//      What has been decided, who owns what, what is still open. This is the
//      thing you read after coming back from a screen-share, or mid-meeting when
//      you lost the thread.
//
//   2. intent:"compact"  (background, JSON, never blocks an answer)
//      Folds the turns that have scrolled out of the rolling window into a
//      summary and a short list of durable facts, so a two-hour call keeps a
//      bounded prompt instead of an ever-growing transcript.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Payload {
  intent?: "summary" | "compact";
  mode?: string;
  turns?: Array<{ role?: string; text?: string; at?: number }>;
  exchanges?: Array<{ question?: string; answer?: string }>;
  summary?: string;
  facts?: unknown;
}

/** How a summary should be organised, per listening mode. */
const SUMMARY_SHAPE: Record<ModeId, string> = {
  meeting:
    "Organise as: DECISIONS (one line each, past tense), ACTION ITEMS (what — who, when said), " +
    "OPEN QUESTIONS, and NUMBERS & NAMES (exact, quoted). If a category is empty, omit it.",
  interview:
    "Organise as: WHAT THEY ASKED (the questions, in order), WHAT YOU SAID (one line each), and " +
    "WHAT TO STRENGTHEN (the weak or rushed answers).",
  technical:
    "Organise as: PROBLEM (as stated), CANDIDATES CONSIDERED, DECISION + why, UNKNOWNS, and the exact " +
    "commands, files or APIs named.",
  study:
    "Organise as: CONCEPTS COVERED (one line each), WHAT IS STILL UNCLEAR, and the three things worth " +
    "reviewing next.",
  negotiation:
    "Organise as: THEIR POSITION, YOUR LEVERS, CONCESSIONS MADE (by whom), and WHAT IS STILL OPEN.",
  presentation:
    "Organise as: POINTS COVERED, QUESTIONS FROM THE ROOM (and whether they were answered), and the " +
    "points still to make.",
  general:
    "Organise as: TOPIC, WHAT WAS SAID (max five lines), and WHAT IS UNRESOLVED.",
};

const SUMMARY_SYSTEM = (mode: ModeId, shape: string) =>
  [
    "You are JARVIS, writing a briefing for someone who is currently IN this conversation and has one " +
      "minute to read it.",
    `Listening mode: ${MODE_BY_ID[mode].label}. ${shape}`,
    "Rules: use only what is in the transcript — never invent a decision, owner, date or number. Quote " +
      "exact names, figures and dates where they were said. Short lines, no headings with markdown " +
      "symbols, no preamble, no closing remark, no emoji. Maximum 200 words.",
  ].join("\n");

const COMPACT_SYSTEM =
  "You maintain the rolling memory of a live conversation assistant. Given the older part of a " +
  "transcript, produce a JSON object with exactly: \"summary\" (at most 120 words, plain text, what " +
  "matters for answering the NEXT question — decisions, roles, numbers, the current subject) and " +
  "\"facts\" (0-6 short durable facts about the user or the situation, each under 100 characters, e.g. " +
  "the role they are interviewing for, the stack, the budget, their target date). Do not include " +
  "small talk. Reply with JSON only.";

function flatten(payload: Payload): string {
  const parts: string[] = [];
  if (Array.isArray(payload.turns)) {
    for (const t of payload.turns.slice(-60)) {
      const text = String(t?.text ?? "").trim();
      if (!text) continue;
      parts.push(`${t?.role === "them" ? "OTHER" : "USER"}: ${text}`);
    }
  }
  if (Array.isArray(payload.exchanges)) {
    for (const e of payload.exchanges.slice(-12)) {
      const q = String(e?.question ?? "").trim();
      const a = String(e?.answer ?? "").trim();
      if (q || a) parts.push(`QUESTION: ${q}\nANSWER: ${a.slice(0, 600)}`);
    }
  }
  return parts.join("\n").slice(-9000);
}

export async function POST(req: NextRequest) {
  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ success: false, error: "invalid JSON body" }, { status: 400 });
  }

  const mode: ModeId = isModeId(payload.mode) ? payload.mode : "general";
  const transcript = flatten(payload);
  if (transcript.trim().length < 20) {
    return NextResponse.json({ success: false, error: "nothing to summarise yet" }, { status: 400 });
  }

  // ── Background compaction: JSON, one shot, no streaming ──────────────────
  if (payload.intent === "compact") {
    try {
      const answer = await agentLlm({
        system: COMPACT_SYSTEM,
        user: `Earlier conversation:\n${transcript}\n\nExisting summary (update it, do not repeat it verbatim):\n${
          payload.summary || "(none yet)"
        }`,
        maxTokens: 500,
        temperature: 0.2,
        timeoutMs: 25_000,
        label: "overlay-compact",
        json: true,
      });
      const parsed = parseJsonLoose<{ summary?: string; facts?: unknown }>(answer);
      const facts = Array.isArray(parsed?.facts)
        ? parsed.facts.filter((f): f is string => typeof f === "string").slice(0, 6)
        : [];
      return NextResponse.json({ success: true, summary: parsed?.summary || "", facts });
    } catch (error) {
      // Compaction is best-effort: failing it must never surface as an error in
      // the HUD, it just means the window stays as it is.
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : String(error) },
        { status: 200 }
      );
    }
  }

  // ── User-facing summary: streamed like an answer ─────────────────────────
  const encoder = new TextEncoder();
  const started = Date.now();
  let stream: Awaited<ReturnType<typeof streamLlm>> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* client gone */
        }
      };
      void (async () => {
        try {
          stream = await streamLlm({
            system: SUMMARY_SYSTEM(mode, SUMMARY_SHAPE[mode]),
            user: `${transcript}${payload.summary ? `\n\nEarlier summary:\n${payload.summary}` : ""}`,
            maxTokens: 700,
            temperature: 0.2,
            timeoutMs: 40_000,
            label: "overlay-summary",
          });
          send({ type: "start", provider: stream.provider, firstTokenMs: stream.firstTokenMs });
          let full = "";
          for await (const delta of stream.deltas) {
            full += delta;
            send({ type: "delta", text: delta });
          }
          stream.close();
          send({ type: "done", text: full.trim(), ms: Date.now() - started, provider: stream.provider, summary: true });
        } catch (error) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
    cancel() {
      stream?.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
