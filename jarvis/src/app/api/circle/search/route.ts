import { NextRequest, NextResponse } from "next/server";
import {
  circleSearch,
  KIND_LABEL,
  selectSurface,
  buildSearchUrl,
  type CircleKind,
} from "@/lib/agent/circleSearch";
import { recordEvent } from "@/lib/memory/patterns";

// Circle to Search.
//
// The OS overlay (scripts/clipboard-watcher.ps1) freezes the screen the moment
// the user presses the hotkey, lets them draw a freehand loop around anything,
// and POSTs the crop here. This route looks at the crop with a multimodal
// model, decides what was circled, searches the matching Google surface
// through Serper, and returns ONE card payload the OS popup renders next to
// the cursor.
//
// Body: { image: "data:image/png;base64,…", question?: string, maxItems?: number }
//   or: raw image bytes with Content-Type: image/jpeg  (?question=, ?maxItems=)
//       The OS overlay uses this one: posting the encoded JPEG directory is a
//       third smaller than base64, and it keeps the PowerShell side free of
//       "capture the screen, base64 it, POST it" code, which Windows Defender's
//       AMSI scanner blocks as a whole-script pattern.
// GET  → the kind catalog (badge labels + the Google surface each one maps to)
//        so any client can render the same vocabulary without duplicating it.
export const runtime = "nodejs";
export const maxDuration = 60;

/** Base64 ceiling (~8 MB of PNG) — bigger than any crop we ever take. */
const MAX_IMAGE_CHARS = Number(process.env.CIRCLE_MAX_IMAGE_CHARS ?? 8_000_000);

export function GET() {
  const kinds = Object.keys(KIND_LABEL) as CircleKind[];
  return NextResponse.json({
    success: true,
    endpoint: "circle/search",
    kinds: kinds.map((kind) => ({
      kind,
      label: KIND_LABEL[kind],
      surface: selectSurface(kind),
      example: buildSearchUrl("example", kind),
    })),
  });
}

export async function POST(req: NextRequest) {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  let image = "";
  let question = "";
  let maxItems = Number(process.env.CIRCLE_MAX_RESULTS ?? 4);

  if (contentType.startsWith("image/")) {
    // Raw encoded image body (what the OS overlay sends).
    const mime = contentType.split(";")[0].trim() || "image/jpeg";
    const buf = Buffer.from(await req.arrayBuffer());
    if (!buf.length) {
      return NextResponse.json({ error: "Empty image body" }, { status: 400 });
    }
    image = `data:${mime};base64,${buf.toString("base64")}`;
    const url = new URL(req.url);
    question = (url.searchParams.get("question") ?? "").slice(0, 300);
    const mi = Number(url.searchParams.get("maxItems"));
    if (Number.isFinite(mi) && mi > 0) maxItems = mi;
  } else {
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    image = typeof body?.image === "string" ? body.image : "";
    question = typeof body?.question === "string" ? body.question.slice(0, 300) : "";
    const mi = Number(body?.maxItems ?? process.env.CIRCLE_MAX_RESULTS ?? 4);
    if (Number.isFinite(mi) && mi > 0) maxItems = mi;
  }

  if (!image) {
    return NextResponse.json({ error: "An image is required" }, { status: 400 });
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return NextResponse.json(
      { error: "Circle crop too large", limit: MAX_IMAGE_CHARS },
      { status: 413 }
    );
  }

  try {
    const result = await circleSearch({ image, question, maxItems });

    // Fire-and-forget log — never let the DB fail the answer.
    recordEvent("circle_search", {
      kind: result.kind,
      query: result.query,
      surface: result.surface,
      provider: result.provider,
      items: result.items.length,
      confidence: result.confidence,
      visionFailed: result.visionFailed,
      elapsedMs: result.elapsedMs,
      timestamp: new Date().toISOString(),
    }).catch((err) => console.warn("[circle/search] recordEvent failed (non-fatal):", err));

    console.log(
      `[circle/search] ${result.elapsedMs}ms ${result.kind} "${result.query}" via ${result.provider} (${result.items.length} results)${result.visionFailed ? " [vision unavailable]" : ""}`
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[circle/search] Unhandled error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}
