import { NextResponse } from "next/server";

// Screen Narrator — "What am I doing?" → caption of what's on screen.
// Pipeline: screenshot/capture (PowerShell) → HuggingFace image-to-text
// (BLIP). No HF key? Falls back to the desktop-context heuristic (foreground
// window + process list), which is still a useful description.
//
// The caller (useScreenNarrator) speaks the returned sentence via edge-tts.

const HF_KEY = process.env.HUGGINGFACE_API_KEY;
const HF_MODEL = process.env.HF_SCREEN_CAPTION_MODEL || "Salesforce/blip-image-captioning-large";

interface CaptureResponse {
  success: boolean;
  image: string | null;
  desktopContext?: string;
  fallback?: boolean;
}

async function captureScreen(contextOnly = false): Promise<CaptureResponse> {
  const res = await fetch(
    `http://localhost:3000/api/screenshot/capture${contextOnly ? "?context=1" : ""}`,
    {
      // Route-internal fetch; cache: no-store to always get a fresh frame.
      cache: "no-store",
    }
  );
  if (!res.ok) throw new Error(`screenshot/capture failed: ${res.status}`);
  return res.json();
}

async function captionImage(base64: string): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  const res = await fetch(`https://api-inference.huggingface.co/models/${HF_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_KEY}`,
      "Content-Type": "application/octet-stream",
    },
    body: buffer,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HF caption error ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  // BLIP returns [{ generated_text }] or { generated_text }
  return data?.[0]?.generated_text || data?.generated_text || "something I couldn't quite make out";
}

function describeFromContext(ctx: string): string {
  // Pull the foreground window line out of the PowerShell context dump.
  const fg = ctx.split("\n").find((l) => l.startsWith("FOREGROUND_WINDOW:"));
  const proc = ctx.split("\n").find((l) => l.startsWith("FOREGROUND_PROCESS:"));
  const window = fg?.replace("FOREGROUND_WINDOW:", "").trim();
  const process = proc?.replace("FOREGROUND_PROCESS:", "").trim();
  if (window && process) return `You're in ${window} (${process})`;
  if (window) return `Your active window is ${window}`;
  return "I couldn't read the screen clearly, Boss";
}

export async function POST() {
  try {
    // No HF key → go straight for the zero-key context path.
    if (!HF_KEY) {
      const ctx = await captureScreen(true);
      if (ctx.desktopContext) {
        return NextResponse.json({
          success: true,
          source: "context",
          caption: describeFromContext(ctx.desktopContext),
        });
      }
      return NextResponse.json(
        { success: false, error: "No image and no context available" },
        { status: 502 }
      );
    }

    const capture = await captureScreen();

    // Primary path: real visual caption via BLIP.
    if (capture.image) {
      try {
        const caption = await captionImage(capture.image);
        return NextResponse.json({
          success: true,
          source: "vision",
          caption,
        });
      } catch (err) {
        console.warn("[screen/describe] HF caption failed, using context:", err);
      }
    }

    // Fallback: window/process context (works with zero API keys).
    if (capture.desktopContext) {
      return NextResponse.json({
        success: true,
        source: "context",
        caption: describeFromContext(capture.desktopContext),
      });
    }
    // Image but no context (e.g. capture succeeded cleanly) → fetch it.
    const ctx = await captureScreen(true);
    if (ctx.desktopContext) {
      return NextResponse.json({
        success: true,
        source: "context",
        caption: describeFromContext(ctx.desktopContext),
      });
    }

    return NextResponse.json(
      { success: false, error: "No image and no context available" },
      { status: 502 }
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Describe failed", details: String(err) },
      { status: 500 }
    );
  }
}
