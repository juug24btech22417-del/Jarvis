import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface TranscriptionResult {
  id: string;
  text: string;
  segments: {
    start: number;
    end: number;
    text: string;
    speaker?: string;
  }[];
  language: string;
  duration: number;
  createdAt: string;
}

// In-memory storage (replace with database in production)
let savedTranscriptions: TranscriptionResult[] = [];

// Whisper API transcription
async function transcribeWithWhisper(
  audioBuffer: Buffer,
  filename: string
): Promise<TranscriptionResult | null> {
  if (!OPENAI_API_KEY) {
    console.log("OpenAI API key not configured");
    return null;
  }

  try {
    // Create temp file
    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `whisper-${Date.now()}-${filename}`);
    fs.writeFileSync(tempFile, audioBuffer);

    try {
      // Create form data
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: "audio/webm" });
      formData.append("file", blob, filename);
      formData.append("model", "whisper-1");
      formData.append("response_format", "verbose_json");
      formData.append("timestamp_granularities[]", "segment");

      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        console.error("Whisper API error:", error);
        return null;
      }

      const data = await response.json();

      return {
        id: `trans-${Date.now()}`,
        text: data.text,
        segments: data.segments?.map((seg: any) => ({
          start: seg.start,
          end: seg.end,
          text: seg.text.trim(),
        })) || [],
        language: data.language || "en",
        duration: data.duration || 0,
        createdAt: new Date().toISOString(),
      };
    } finally {
      // Cleanup temp file
      try {
        fs.unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    console.error("Transcription error:", error);
    return null;
  }
}

// Generate demo transcription
function generateDemoTranscription(): TranscriptionResult {
  const demoText = `Welcome everyone to the weekly team meeting. Let's start with updates from each department.

Sarah from Engineering: We've completed the authentication refactor and all tests are passing. The new system is much more secure.

Mike from Design: The mobile app redesign is 80% complete. We're on track for the Friday demo.

Alex from Product: We have three new feature requests from the enterprise clients. I'll share the requirements doc after this meeting.

Any questions or blockers? Great, let's move to action items.`;

  const segments = [
    { start: 0, end: 5, text: "Welcome everyone to the weekly team meeting." },
    { start: 5, end: 8, text: "Let's start with updates from each department." },
    { start: 8, end: 12, text: "Sarah from Engineering: We've completed the authentication refactor." },
    { start: 12, end: 16, text: "All tests are passing and the new system is much more secure." },
    { start: 16, end: 20, text: "Mike from Design: The mobile app redesign is 80% complete." },
    { start: 20, end: 24, text: "We're on track for the Friday demo." },
    { start: 24, end: 28, text: "Alex from Product: We have three new feature requests from enterprise clients." },
    { start: 28, end: 32, text: "I'll share the requirements doc after this meeting." },
    { start: 32, end: 35, text: "Any questions or blockers?" },
    { start: 35, end: 38, text: "Great, let's move to action items." },
  ];

  return {
    id: `demo-trans-${Date.now()}`,
    text: demoText,
    segments: segments.map((s, i) => ({
      ...s,
      speaker: i < 2 ? "Host" : i < 4 ? "Sarah" : i < 6 ? "Mike" : i < 8 ? "Alex" : "Host",
    })),
    language: "en",
    duration: 38,
    createdAt: new Date().toISOString(),
  };
}

// GET - List saved transcriptions
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const transcription = savedTranscriptions.find((t) => t.id === id);
      if (!transcription) {
        return NextResponse.json(
          { error: "Transcription not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, transcription });
    }

    return NextResponse.json({
      success: true,
      transcriptions: savedTranscriptions.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
      count: savedTranscriptions.length,
      demo: !OPENAI_API_KEY,
    });
  } catch (error) {
    console.error("GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch transcriptions" },
      { status: 500 }
    );
  }
}

// POST - Transcribe audio or save/delete transcription
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // Handle file upload for transcription
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File;

      if (!file) {
        return NextResponse.json(
          { error: "No audio file provided" },
          { status: 400 }
        );
      }

      // Check file size (max 25MB for Whisper)
      if (file.size > 25 * 1024 * 1024) {
        return NextResponse.json(
          { error: "File too large (max 25MB)" },
          { status: 400 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await transcribeWithWhisper(buffer, file.name);

      if (!result) {
        // Return demo transcription if API not configured
        const demoResult = generateDemoTranscription();
        return NextResponse.json({
          success: true,
          transcription: demoResult,
          demo: true,
          message: "Demo transcription (OpenAI API not configured)",
        });
      }

      return NextResponse.json({
        success: true,
        transcription: result,
      });
    }

    // Handle JSON actions
    const body = await req.json();
    const { action, transcription } = body;

    if (action === "save" && transcription) {
      const newTranscription: TranscriptionResult = {
        ...transcription,
        id: transcription.id || `trans-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      savedTranscriptions.push(newTranscription);

      // Keep only last 50 transcriptions
      if (savedTranscriptions.length > 50) {
        savedTranscriptions = savedTranscriptions.slice(-50);
      }

      return NextResponse.json({
        success: true,
        transcription: newTranscription,
      });
    }

    if (action === "delete" && transcription?.id) {
      savedTranscriptions = savedTranscriptions.filter(
        (t) => t.id !== transcription.id
      );
      return NextResponse.json({ success: true });
    }

    if (action === "demo") {
      const demoResult = generateDemoTranscription();
      savedTranscriptions.push(demoResult);
      return NextResponse.json({
        success: true,
        transcription: demoResult,
        demo: true,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("POST error:", error);
    return NextResponse.json(
      { error: "Failed to process request", details: String(error) },
      { status: 500 }
    );
  }
}
