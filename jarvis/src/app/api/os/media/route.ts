import { NextRequest, NextResponse } from "next/server";

// Media transport via hardware media keys (user32.keybd_event).
// Works on Spotify FREE — no Web Playback SDK / Premium needed — because the
// keys are consumed by whatever app currently owns media focus (Spotify,
// YouTube tab, VLC, system SMTC chain).
//
// POST { action: "play-pause" | "next" | "prev" | "stop" | "mute" | "volume-up" | "volume-down" }

type InputModule = {
  sendMediaKey: (action: string) => { action: string; ok: boolean };
};

let mod: InputModule | null = null;
function loadInput(): InputModule {
  if (!mod) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("@/lib/os/input.cjs") as InputModule;
  }
  return mod;
}

const VALID = new Set([
  "play-pause",
  "next",
  "prev",
  "stop",
  "mute",
  "volume-up",
  "volume-down",
]);

export async function POST(req: NextRequest) {
  try {
    const { action } = await req.json();
    if (!action || !VALID.has(action)) {
      return NextResponse.json(
        { success: false, error: `action must be one of: ${[...VALID].join(", ")}` },
        { status: 400 }
      );
    }
    const r = loadInput().sendMediaKey(action);
    return NextResponse.json({ success: true, ...r });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Media key failed", details: String(err) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    actions: [...VALID],
    note: "Hardware media keys — control Spotify Free, YouTube, VLC without Premium",
  });
}
