import { NextResponse } from "next/server";
import { getAudioMeterStatus } from "@/services/SystemAudioMeterService";

// GET /api/system/audio — live system-audio meter snapshot
// { available, level, musicPlaying, reactivity, samples,
//   envelope, envelopeT, envelopeDt }
//
// envelope/envelopeT are the raw ~40Hz peak history the reactor
// interpolates into its circular equalizer — a pre-smoothed scalar would
// alias at any poll rate, so the raw samples travel with their timestamps.
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
