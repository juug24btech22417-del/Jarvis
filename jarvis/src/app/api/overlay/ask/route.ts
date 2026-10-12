import { NextRequest, NextResponse } from "next/server";
import { agentLlm } from "@/lib/agent/llm";
import { streamLlm } from "@/lib/agent/llmStream";
import {
  buildSystemPrompt,
  buildUserMessage,
  isDensityId,
  isModeId,
  isStyleId,
  MODE_BY_ID,
  type BriefTurn,
  type Briefing,
} from "@/lib/overlay/modes";

// The overlay's answer engine.
//
//   POST /api/overlay/ask
//     { question, mode, density, style, facts?, summary?, recent?, persona?,
//       expandOf?, triggeredBy?, noStream? }
//
//   → newline-delimited JSON (see src/lib/overlay/stream.ts):
//       {"type":"start","provider":"groq/…","firstTokenMs":180}
//       {"type":"delta","text":"…"}                     (repeats)
//       {"type":"done","text":"<full>","meta":{…},"provider":"…","ms":1234}
//       {"type":"skip"}                                 (the model declined)
//       {"type":"error","message":"…"}
//
// WHY STREAMING
// -------------
// The overlay's whole value is being readable in the half-second the user has
// while the other person is still talking. A buffered completion puts nothing
// on screen until it is finished; streamed, the first sentence is legible in a
// few hundred ms and the rest lands underneath it.
//
// The metadata line (`<<<JARVIS_META {…}>>>`) is appended by the model in the
// SAME completion — confidence, new facts and the topic ride along instead of
// costing a second request. The route forwards the raw text and the page strips
// the tail (splitStreamingAnswer), so the sentinel can never reach the screen
// even mid-arrival.
//
// `noStream: true` returns the plain JSON shape ({success, answer}) — used by
// curl and by the shell's offline self-test.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AskPayload {
  question?: string;
  mode?: string;
  density?: string;
  style?: string;
  facts?: unknown;
  summary?: string;
  recent?: unknown;
  persona?: string;
  expandOf?: { question?: string; answer?: string };
  triggeredBy?: string;
  noStream?: boolean;
}

function brief(body: AskPayload): Briefing {
  const mode = isModeId(body.mode) ? body.mode : "general";
  const spec = MODE_BY_ID[mode];
  const density = isDensityId(body.density) ? body.density : spec.density;
  const style = isStyleId(body.style) ? body.style : "quick";

  const facts = Array.isArray(body.facts)
    ? body.facts.filter((f): f is string => typeof f === "string").slice(0, 12)
    : undefined;

  const recent = Array.isArray(body.recent)
    ? (body.recent as Array<{ role?: string; text?: string }>)
        .filter((t) => t && typeof t.text === "string" && t.text.trim())
        .map(
          (t): BriefTurn => ({
            role: t.role === "assistant" ? "assistant" : t.role === "you" ? "you" : "them",
            text: String(t.text).slice(0, 1200),
          })
        )
        .slice(-10)
    : undefined;

  const expandOf =
    body.expandOf && typeof body.expandOf.question === "string" && typeof body.expandOf.answer === "string"
      ? { question: body.expandOf.question.slice(0, 400), answer: body.expandOf.answer.slice(0, 1600) }
      : undefined;

  return {
    mode,
    density: expandOf && density === "line" ? "deep" : density,
    style,
    facts,
    summary: typeof body.summary === "string" ? body.summary.slice(0, 2000) : undefined,
    recent,
    persona: typeof body.persona === "string" ? body.persona.slice(0, 3000) : undefined,
    expandOf,
    triggeredBy: typeof body.triggeredBy === "string" ? body.triggeredBy.slice(0, 120) : undefined,
  };
}

export async function POST(req: NextRequest) {
  let payload: AskPayload;
  try {
    payload = (await req.json()) as AskPayload;
  } catch {
    return NextResponse.json({ success: false, error: "invalid JSON body" }, { status: 400 });
  }

  const question = (payload.question || "").trim();
  if (!question) {
    return NextResponse.json({ success: false, error: "question is required" }, { status: 400 });
  }

  const briefing = brief(payload);
  const system = buildSystemPrompt(briefing);
  const user = buildUserMessage(question, briefing);

  // ── Buffered path ────────────────────────────────────────────────────────
  if (payload.noStream) {
    try {
      const answer = await agentLlm({
        system,
        user,
        maxTokens: 900,
        temperature: 0.2,
        timeoutMs: 30_000,
        label: "overlay-ask",
      });
      return NextResponse.json({ success: true, answer, mode: briefing.mode, density: briefing.density });
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  // ── Streamed path ────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const started = Date.now();
  let stream: Awaited<ReturnType<typeof streamLlm>> | null = null;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* the client went away mid-answer — nothing to do */
        }
      };
      void (async () => {
        try {
          stream = await streamLlm({
            system,
            user,
            maxTokens: briefing.density === "deep" ? 1100 : 650,
            temperature: briefing.style === "hint" ? 0.5 : 0.25,
            timeoutMs: 40_000,
            label: "overlay-ask",
          });
          send({ type: "start", provider: stream.provider, firstTokenMs: stream.firstTokenMs });

          let full = "";
          for await (const delta of stream.deltas) {
            full += delta;
            send({ type: "delta", text: delta });
          }
          stream.close();

          const trimmed = full.trim();
          // A proactive (unasked) answer may be declined outright; the page
          // shows nothing rather than a placeholder.
          if (briefing.triggeredBy && /^skip\b/i.test(trimmed) && trimmed.length < 20) {
            send({ type: "skip" });
            return;
          }
          send({ type: "done", text: trimmed, ms: Date.now() - started, provider: stream.provider });
        } catch (error) {
          send({
            type: "error",
            message: error instanceof Error ? error.message : String(error),
            ms: Date.now() - started,
          });
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
      // The user moved on (newer question, cleared, or the window closed):
      // stop paying for the answer nobody will read.
      stream?.abort();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
