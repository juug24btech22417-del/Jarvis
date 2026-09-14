import { NextResponse } from "next/server";
import { getAudioMeterStatus } from "@/services/SystemAudioMeterService";

// GET /api/system/audio — live system-audio meter snapshot
// { available, level, musicPlaying, reactivity, samples }
export async function GET() {
  try {
    return NextResponse.json({ success: true, ...getAudioMeterStatus() });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error?.message || String(error) },
      { status: 500 }
    );
  }
}
