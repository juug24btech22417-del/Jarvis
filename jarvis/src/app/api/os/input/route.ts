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
    mod = require("@/lib/os/input.cjs") as InputModule;
  }
  return mod;
}

// ─── Screen metrics cache ─────────────────────────────────────────────
// getMouseState() makes THREE native FFI calls (GetCursorPos + two
// GetSystemMetrics) and was called on EVERY cursor move — but only the
// cursor position varies, and moves don't even use it. Screen size can't
// change mid-session. Caching turns a 4-call move into a 1-call move —
// the visible lag in live mode (practice mode skips this path entirely,
// which is exactly why it felt smooth while live felt sluggish).
let screenMetrics: { screenWidth: number; screenHeight: number } | null = null;
function getScreenMetrics(): { screenWidth: number; screenHeight: number } {
  if (!screenMetrics) {
    const s = loadInput().getMouseState();
    screenMetrics = { screenWidth: s.screenWidth, screenHeight: s.screenHeight };
  }
  return screenMetrics;
}

// ─── Staleness guard (anti-replay) ───────────────────────────────────
// Vision clients tag every request with a per-session monotonic seq. If a
// newer move has already been applied, any OLDER move that trickles in
// afterwards (queued during a network/tab hiccup) must be dropped —
// otherwise the cursor replays the user's stale trajectory minutes later.
// Discrete actions (click/down/up/key) are never dropped: they are events,
// not state, and always carry intent.
const lastSeqBySid = new Map<string, number>();
function isStaleMove(sid: unknown, seqNum: unknown): boolean {
  if (typeof sid !== "string" || sid.length === 0) return false;
  if (typeof seqNum !== "number" || !Number.isFinite(seqNum)) return false;
  const last = lastSeqBySid.get(sid) ?? -1;
  if (seqNum <= last) return true;
  lastSeqBySid.set(sid, seqNum);
  // Simple hygiene: never let the map grow unbounded.
  if (lastSeqBySid.size > 500) {
    for (const k of Array.from(lastSeqBySid.keys()).slice(0, 250)) lastSeqBySid.delete(k);
  }
  return false;
}

export async function GET() {
  try {
    const input = loadInput();
    const state = input.getMouseState();
    screenMetrics = { screenWidth: state.screenWidth, screenHeight: state.screenHeight };
    return NextResponse.json({ success: true, ...state });
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
      // Anti-replay: drop moves older than the newest applied one.
      if (isStaleMove(body.sid, body.seq)) {
        return NextResponse.json({ success: true, stale: true });
      }
      const nx = num(body.nx); // normalized 0..1
      const ny = num(body.ny);
      if (nx === null || ny === null) {
        return NextResponse.json({ error: "nx and ny (0..1) required" }, { status: 400 });
      }
      const m = getScreenMetrics();
      const x = Math.max(0, Math.min(1, nx)) * (m.screenWidth - 1);
      const y = Math.max(0, Math.min(1, ny)) * (m.screenHeight - 1);
      const r = input.moveMouse(x, y);
      return NextResponse.json({ success: true, ...r });
    }

    if (body.action === "move-rel") {
      if (isStaleMove(body.sid, body.seq)) {
        return NextResponse.json({ success: true, stale: true });
      }
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
