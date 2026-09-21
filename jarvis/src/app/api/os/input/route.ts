import { NextRequest, NextResponse } from "next/server";

// OS input control — drives the real Windows cursor/keyboard for the
// browser-side MediaPipe tracker (air-mouse, gestures) and the phone
// arc-remote (trackpad, keyboard tab).
// GET  → cursor position + screen metrics (used to calibrate scaling)
// POST actions:
//   move      { nx, ny }           absolute cursor move, normalized 0..1
//   move-rel  { dx, dy }           relative cursor move in pixels (trackpad)
//   click     { button? }          left (default) | right
//   down/up   { button? }          press & hold / release (drag)
//   scroll    { dy, dx? }          wheel notches (±120 each)
//   key       { keys }             chord, e.g. "ctrl+shift+esc", "alt+tab"
//   type      { text }             unicode typing into the focused window
//
// The browser only ever sends normalized 0..1 gaze/hand coords or small
// relative deltas; absolute pixel mapping happens here so the server is
// the single source of truth.

type InputModule = {
  moveMouse: (x: number, y: number) => { x: number; y: number };
  moveMouseRelative: (dx: number, dy: number) => { dx: number; dy: number };
  getMouseState: () => { x: number; y: number; screenWidth: number; screenHeight: number };
  clickMouse: (button?: string) => { clicked: string };
  mouseDown: (button?: string) => { down: string };
  mouseUp: (button?: string) => { up: string };
  scrollWheel: (dy: number, dx?: number) => { dy: number; dx: number };
  keyChord: (keys: string) => { keys: string };
  typeText: (text: string) => { chars: number };
};

let mod: InputModule | null = null;
function loadInput(): InputModule {
  if (!mod) {
    // Lazy require — .cjs native FFI module, Windows-only.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require("@/lib/os/input.cjs") as InputModule;
  }
  return mod;
}

export async function GET() {
  try {
    const input = loadInput();
    return NextResponse.json({ success: true, ...input.getMouseState() });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "OS input unavailable", details: String(err) },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const input = loadInput();

    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) ? v : null;

    if (body.action === "move") {
      const state = input.getMouseState();
      const nx = num(body.nx); // normalized 0..1
      const ny = num(body.ny);
      if (nx === null || ny === null) {
        return NextResponse.json({ error: "nx and ny (0..1) required" }, { status: 400 });
      }
      const x = Math.max(0, Math.min(1, nx)) * (state.screenWidth - 1);
      const y = Math.max(0, Math.min(1, ny)) * (state.screenHeight - 1);
      const r = input.moveMouse(x, y);
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "move-rel") {
      const dx = num(body.dx);
      const dy = num(body.dy);
      if (dx === null || dy === null) {
        return NextResponse.json({ error: "dx and dy required" }, { status: 400 });
      }
      // Clamp runaway deltas (broken touch clients).
      const r = input.moveMouseRelative(
        Math.max(-500, Math.min(500, dx)),
        Math.max(-500, Math.min(500, dy))
      );
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "click") {
      const r = input.clickMouse(body.button === "right" ? "right" : "left");
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "down") {
      const r = input.mouseDown(body.button === "right" ? "right" : "left");
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "up") {
      const r = input.mouseUp(body.button === "right" ? "right" : "left");
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "scroll") {
      const dy = num(body.dy);
      if (dy === null) {
        return NextResponse.json({ error: "dy (wheel notches) required" }, { status: 400 });
      }
      const dx = num(body.dx) ?? 0;
      const r = input.scrollWheel(
        Math.max(-20, Math.min(20, dy)),
        Math.max(-20, Math.min(20, dx))
      );
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "key") {
      if (typeof body.keys !== "string" || !body.keys.trim()) {
        return NextResponse.json({ error: "keys (chord string) required" }, { status: 400 });
      }
      const r = input.keyChord(body.keys);
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "type") {
      if (typeof body.text !== "string") {
        return NextResponse.json({ error: "text required" }, { status: 400 });
      }
      const r = input.typeText(body.text.slice(0, 1000));
      return NextResponse.json({ success: true, ...r });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: "Input command failed", details: String(err) },
      { status: 500 }
    );
  }
}
