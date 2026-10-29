// Meeting bot — visual capture pipeline (pure helpers).
//
// These cover the judgement calls that decide whether a lecture ends up with a
// useful gallery of diagrams or a pile of near-identical frames: perceptual
// dedupe, byte-level fallback dedupe, region clipping, transcript context and
// the visual index handed to the summariser.
//
// All pure: no browser, no network, no Next runtime.
//
// Run with:  npx tsx tests/meetingVisuals.test.ts

import {
  FINGERPRINT_GRID_SIZE,
  buildVisualPromptIndex,
  byteDiffRatio,
  clampRegionToViewport,
  extractJsonObject,
  fingerprintDistance,
  isDistinctFingerprint,
  isDistinctFrameBytes,
  sampleEvenly,
  visualCaptionContext,
  visualClock,
  visualFileName,
  visualImageUrl,
  visualTypeLabel,
} from "../src/lib/meeting/visualFrames";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  \u2713 ${name}`);
  } else {
    failed++;
    console.error(`  \u2717 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}`);
}

const CELLS = FINGERPRINT_GRID_SIZE * FINGERPRINT_GRID_SIZE;

function flat(value: number): number[] {
  return new Array(CELLS).fill(value);
}

/* ------------------------- perceptual frame dedupe ------------------------- */

section("fingerprints — is this the same slide?");

{
  const a = flat(120);
  const b = flat(120);
  check("identical fingerprints have zero distance", fingerprintDistance(a, b) === 0);

  check("the first frame of a session is always kept", isDistinctFingerprint(null, a) === true);
  check("the same slide twice is not a new frame", isDistinctFingerprint(a, b) === false);

  // A cursor blink / one changed pixel region: 3 luminance steps of drift.
  const drifted = flat(120).map((_, i) => (i < 40 ? 123 : 120));
  check(
    "tiny drift (cursor, video noise) is treated as the same slide",
    isDistinctFingerprint(a, drifted) === false
  );

  // The lecturer switched from a diagram to an equation.
  const changed = flat(120).map((_, i) => (i < CELLS / 2 ? 30 : 210));
  check("a real content change is a new frame", isDistinctFingerprint(a, changed) === true);

  check(
    "a malformed/short fingerprint never counts as 'same slide'",
    isDistinctFingerprint(a, [120, 120]) === true
  );
  check(
    "an empty fingerprint is not compared as identical",
    fingerprintDistance([], []) === Number.POSITIVE_INFINITY
  );
}

section("byte fallback dedupe (no <video>/<canvas> to fingerprint)");

{
  const a = new Uint8Array(4096).fill(7);
  const b = new Uint8Array(4096).fill(7);
  const c = new Uint8Array(4096).fill(9);

  check("identical byte streams diff at ratio 0", byteDiffRatio(a, b) === 0);
  check("no previous frame → keep", isDistinctFrameBytes(null, a) === true);
  check("identical frames are dropped", isDistinctFrameBytes(a, b) === false);
  check("a completely different frame is kept", isDistinctFrameBytes(a, c) === true);
  check("a sweep of change below the threshold is dropped", isDistinctFrameBytes(a, b, 0.5) === false);
}

section("region clipping");

{
  const viewport = { width: 1280, height: 800 };
  const clipped = clampRegionToViewport({ x: -30, y: -10, width: 700, height: 500 }, viewport);
  check("negative offsets are clipped to 0", clipped?.x === 0 && clipped?.y === 0, JSON.stringify(clipped));
  check("size shrinks with the clip", clipped?.width === 670 && clipped?.height === 490, JSON.stringify(clipped));

  const overflowing = clampRegionToViewport({ x: 1000, y: 600, width: 600, height: 400 }, viewport);
  check(
    "a stage dragged off-screen is clamped to the viewport",
    overflowing?.width === 280 && overflowing?.height === 200,
    JSON.stringify(overflowing)
  );

  check(
    "a webcam-tile-sized region is rejected",
    clampRegionToViewport({ x: 10, y: 10, width: 120, height: 90 }, viewport) === null
  );
  check("no region stays null (whole-window fallback)", clampRegionToViewport(null, viewport) === null);
}

/* ----------------------------- capture metadata ----------------------------- */

section("frame files, clocks and captions");

{
  check("frame files are zero-padded for stable sorting", visualFileName(7) === "frame-007.png");
  check(
    "image URLs point at the public capture folder",
    visualImageUrl("session-abc", 3) === "/meeting-captures/session-abc/frame-003.png"
  );
  check(
    "clock reads as HH:MM:SS",
    /^\d{2}:\d{2}:\d{2}$/.test(visualClock("2026-10-02T10:32:11")),
    visualClock("2026-10-02T10:32:11")
  );
  check("visual type labels are human readable", visualTypeLabel("equation") === "Equation");
  check("unknown types still label", visualTypeLabel("hologram") === "Visual");
}

{
  const at = "2026-10-02T10:00:30.000Z";
  const context = visualCaptionContext(
    [
      { speaker: "Prof", text: "one minute ago", timestamp: "2026-10-02T09:59:30.000Z" },
      { speaker: "Prof", text: "here the capacitor", timestamp: "2026-10-02T10:00:20.000Z" },
      { speaker: "Ali", text: "and the resistor", timestamp: "2026-10-02T10:00:26.000Z" },
    ],
    at
  );
  check("only the words around the capture are used", !context.includes("one minute ago"), context);
  check("speakers are kept with their line", context.includes("Prof: here the capacitor"), context);
  check("lines are joined for prompt context", context.includes("| Ali: and the resistor"), context);

  const many = Array.from({ length: 10 }, (_, i) => ({
    speaker: "S",
    text: `line ${i}`,
    timestamp: new Date(Date.parse("2026-10-02T10:00:00.000Z") + i * 1000).toISOString(),
  }));
  const capped = visualCaptionContext(many, at, 60_000);
  check("context is capped to the last four lines", capped.split(" | ").length === 4, capped);
  check("empty transcript yields empty context", visualCaptionContext([], at) === "");
}

/* --------------------------- selecting the visuals -------------------------- */

section("sampleEvenly — spread the kept frames across the session");

{
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  check("a short list is returned untouched", sampleEvenly([1, 2], 12).length === 2);
  const spread = sampleEvenly(items, 4);
  check("a long list is capped", spread.length === 4, JSON.stringify(spread));
  check("the first frame survives", spread[0] === 1);
  check("the last frame survives", spread[spread.length - 1] === 10);
  check("max of 1 keeps a single frame", sampleEvenly(items, 1).length === 1);
  check("max of 0 keeps nothing", sampleEvenly(items, 0).length === 0);
}

section("the visual index handed to the summariser");

{
  check("no visuals → no index text", buildVisualPromptIndex([]) === "");

  const index = buildVisualPromptIndex([
    {
      id: "v1",
      clock: "10:05:03",
      type: "diagram",
      title: "Half-wave rectifier",
      description: "Diode, 1kΩ load resistor, 12V AC source.",
      transcriptContext: "Prof: here the diode blocks the negative half",
    },
  ]);
  check("the clock is included", index.includes("[10:05:03]"));
  check("the type is included", index.includes("(diagram)"));
  check("the title and description are included", index.includes("Half-wave rectifier") && index.includes("12V AC source"));
  check("what was said is included", index.includes("diode blocks the negative half"));
  check("the model is told to cite visuals", index.includes("(see Visual #1)"));
}

/* ------------------------------- JSON parsing ------------------------------- */

section("extractJsonObject — vision replies wrapped in prose");

{
  const plain = extractJsonObject<{ items: unknown[] }>('{"items":[]}');
  check("plain JSON parses", Array.isArray(plain?.items));

  const fenced = extractJsonObject<{ items: Array<{ index: number }> }>(
    'Here you go:\n```json\n{"items":[{"index":2}]}\n```\nHope that helps!'
  );
  check("fenced JSON parses", fenced?.items?.[0]?.index === 2);

  check("garbage returns null", extractJsonObject("not json at all") === null);
  check("empty input returns null", extractJsonObject("") === null);
}

/* ---------------------------------- summary --------------------------------- */

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
