import { NextRequest, NextResponse } from "next/server";
import { transcribeOggOpus } from "@/lib/telegram/transcribe";
import { isModeId, transcriptionHint } from "@/lib/overlay/modes";
import { cleanTranscript, speakerLabel } from "@/lib/overlay/transcript";

// Speech-to-text for the stealth overlay.
//
//   POST /api/overlay/transcribe   multipart/form-data
//     file  — one self-contained audio round (webm/opus)
//     mode  — listening mode; its vocabulary is passed to Whisper as a prompt
//             hint so domain words ("Kubernetes", "ARR", "OIDC") are spelled the
//             way the docs spell them instead of phonetically
//     kind  — "system" | "mic", so the transcript can say WHO said it
//
//   → { success, text, speaker, filtered, language }
//
// `filtered: true` means the chunk was a Whisper artefact ("Thank you.",
// "[BLANK_AUDIO]", a looped phrase) rather than speech. The client VAD already
// refuses to upload silent rounds; this is the second gate, for rounds that had
// *some* noise in them. Nothing filtered is ever shown or answered.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 20 * 1024 * 1024; // Groq caps uploads well under this

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ success: false, error: "expected multipart/form-data" }, { status: 400 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ success: false, error: "no audio provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ success: false, error: "audio chunk too large" }, { status: 413 });
    }

    const rawMode = String(form.get("mode") || "");
    const mode = isModeId(rawMode) ? rawMode : "general";
    const kind = form.get("kind") === "mic" ? "mic" : "system";

    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "audio/webm";
    const result = await transcribeOggOpus(buffer, {
      mimeHint: mime,
      prompt: transcriptionHint(mode),
    });

    const cleaned = cleanTranscript(result.text);
    return NextResponse.json({
      success: true,
      text: cleaned.text,
      speaker: speakerLabel(kind),
      kind,
      filtered: cleaned.filtered,
      language: result.language,
      duration: result.duration,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A missing key is a setup problem, not a crash — say so plainly.
    const status = /GROQ_API_KEY/.test(message) ? 400 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
