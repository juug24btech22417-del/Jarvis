// Circle to Act — say what you want, and JARVIS does it to the thing you circled.
//
// POST /api/circle/act
//   body: { image: "data:image/jpeg;base64,…",
//           instruction: "email this to rahul and ask for a quote",
//           question?: string, maxItems?: number }
//
// This is deliberately NOT a menu. There is no "add to cart" branch, no "save
// to memory" branch and no intent list to keep in sync with reality: the crop is
// described by a vision model, the description plus the user's own words become
// the goal, and the same ReAct agent that drives every other JARVIS task picks
// the real tool (browser.act, email.send, text.translate, memory.save,
// maps/web/github/whatsapp) and runs it. A capability the agent gains later is
// automatically available here.
//
// Returns one card payload: what it understood, what it actually did (the step
// trail), and the answer to show.

import { NextRequest, NextResponse } from "next/server";
import { circleSearch, type CircleResult } from "@/lib/agent/circleSearch";
import { runAutonomousTask, type AgentEvent } from "@/lib/agent/toolRunner";
import { recordEvent } from "@/lib/memory/patterns";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Keep the crop ceiling identical to the search route. */
const MAX_IMAGE_CHARS = Number(process.env.CIRCLE_MAX_IMAGE_CHARS ?? 8_000_000);

/** A screen selection is an interactive moment — stay inside a few rounds. */
const MAX_ROUNDS = Number(process.env.CIRCLE_ACT_MAX_ROUNDS ?? 5);
const DECIDE_TIMEOUT_MS = Number(process.env.CIRCLE_ACT_DECIDE_MS ?? 10_000);

interface Body {
  image?: string;
  instruction?: string;
  question?: string;
  maxItems?: number;
}

export async function POST(req: NextRequest) {
  let body: Body = {};
  const raw = (req.headers.get("content-type") ?? "").toLowerCase();

  if (raw.startsWith("image/")) {
    // Raw encoded image body — what the OS overlay sends. Posting the JPEG
    // directly is a third smaller than base64 and keeps the PowerShell side
    // free of "capture, encode, upload" code, which Windows Defender's AMSI
    // scanner blocks as a whole-script pattern.
    const mime = raw.split(";")[0].trim() || "image/jpeg";
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) return NextResponse.json({ error: "Empty image body" }, { status: 400 });
    body = {
      image: `data:${mime};base64,${buf.toString("base64")}`,
      instruction: new URL(req.url).searchParams.get("instruction") ?? "",
    };
  } else {
    try {
      body = (await req.json()) as Body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const image = typeof body.image === "string" ? body.image : "";
  const instruction = (body.instruction ?? "").trim().slice(0, 400);
  if (!image) return NextResponse.json({ error: "An image is required" }, { status: 400 });
  if (image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json(
      { error: "Circle crop too large", limit: MAX_IMAGE_CHARS },
      { status: 413 }
    );
  }
  if (!instruction) {
    return NextResponse.json({ error: "An instruction is required" }, { status: 400 });
  }

  const started = Date.now();

  // 1. What is the user looking at? Reuse the search pipeline's vision step so
  //    the subject description is identical to what the search card shows.
  let subject: CircleResult | null = null;
  try {
    // describeOnly: identify the region, skip the Google search leg — the
    // act path has no use for result rows and the round trip costs latency.
    subject = await circleSearch({ image, question: "", describeOnly: true });
  } catch (e) {
    console.warn("[circle/act] describe failed (continuing):", (e as Error)?.message);
  }

  const described = subject?.title || subject?.query || "an unidentified thing on the user's screen";
  const screenText = subject?.summary || subject?.answer || "";

  // 2. Say what the user wants, in their words. Nothing here maps words to
  //    actions — the agent reads the goal and picks a real tool.
  const goal =
    `The user selected a region of their screen with a freehand circle.\n` +
    `What is in that region: ${described}.\n` +
    (screenText ? `Text read from the region: ${screenText.slice(0, 400)}.\n` : "") +
    `What the user wants done with it, in their own words: "${instruction}"\n\n` +
    `Carry this out for real. If the request cannot be completed end-to-end, do the ` +
    `part that can be done and say plainly what is left.`;

  const trail: AgentEvent[] = [];
  const result = await runAutonomousTask(
    goal,
    (e) => {
      // Keep the trail bounded — this becomes the card payload.
      if (trail.length < 40) trail.push(e);
    },
    { maxRounds: MAX_ROUNDS, decideTimeoutMs: DECIDE_TIMEOUT_MS }
  );

  const actions = result.steps
    .filter((s) => s.ok)
    .map((s) => ({ tool: s.tool, detail: s.detail, output: s.output.slice(0, 600) }));
  const failures = result.steps.filter((s) => !s.ok).map((s) => `${s.tool}: ${s.output.slice(0, 200)}`);

  // A pure translation is the one case where the card should show the text
  // itself, and the overlay can paint it back over the circled region.
  const translation = actions.find((a) => a.tool === "text.translate")?.output ?? "";

  const elapsedMs = Date.now() - started;

  void recordEvent("circle_act", {
    instruction,
    subject: described.slice(0, 200),
    tools: actions.map((a) => a.tool),
    ok: result.ok,
    elapsedMs,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  console.log(
    `[circle/act] ${elapsedMs}ms ok=${result.ok} tools=[${actions.map((a) => a.tool).join(", ")}] "${instruction.slice(0, 60)}"`
  );

  return NextResponse.json({
    success: true,
    kind: subject?.kind ?? "thing",
    kindLabel: subject?.kindLabel ?? "Screen selection",
    subject: described,
    title: instruction,
    summary: result.summary,
    actions,
    failures,
    translation: translation || undefined,
    ok: result.ok,
    elapsedMs,
    trail: trail.slice(-12),
  });
}
