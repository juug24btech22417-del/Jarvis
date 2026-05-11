import { NextResponse } from "next/server";

// ElevenLabs is disabled due to free tier restrictions
// Using browser TTS with British English voice

export async function POST(request: Request) {
  // Always use browser TTS - ElevenLabs free tier is disabled
  return NextResponse.json(
    { useBrowser: true, message: "Using browser TTS with British voice" },
    { status: 200 }
  );
}
