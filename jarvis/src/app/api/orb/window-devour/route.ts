import { NextRequest, NextResponse } from "next/server";
import {
  buildDevourPrompt,
  devourSuggestions,
  parseWindowTitle,
} from "@/lib/orb/windowDevour";

export const runtime = "nodejs";

/**
 * Window Devourer — turns a swallowed window into a dossier.
 *
 * No model call on purpose. The capture already arrives as pixels, and the
 * orb hands those to the normal assistant pipeline; a second LLM hop here
 * would only add a second of lag to the one moment that has to feel instant.
 * Everything below is read from the title the OS reported.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const title = String(body?.title ?? body?.target?.title ?? "").trim();

    if (!title) {
      return NextResponse.json(
        { ok: false, error: "A window title is required — nothing was swallowed." },
        { status: 400 }
      );
    }

    const id = parseWindowTitle(title);
    const blank = Boolean(body?.blank);
    const hasFrame = Boolean(body?.hasFrame);

    return NextResponse.json({
      ok: true,
      raw: id.raw,
      app: id.app,
      document: id.document,
      kind: id.kind,
      dirty: id.dirty,
      blank,
      hasFrame,
      context: buildDevourPrompt(id, { blank }),
      suggestions: devourSuggestions(id),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Devour analysis failed", details: String(error) },
      { status: 500 }
    );
  }
}
