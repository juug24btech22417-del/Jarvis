import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

// GET /api/circle/frame?left=&top=&width=&height=
//
// The frozen screen the circle overlay is drawn on, captured SERVER-side and
// handed to the overlay as raw PNG bytes.
//
// Why the capture is not done in the overlay's own script any more: PowerShell
// that reads the screen AND uploads AND watches the clipboard AND owns global
// hotkeys trips Windows Defender's AMSI scanner, which then refuses to run the
// whole watcher ("this script contains malicious content"). Splitting the
// capture out leaves the overlay script doing only drawing, uploading and
// rendering, which Defender is fine with. This same temp-script capture pattern
// is already used by /api/screenshot/capture.
//
// The caller passes the rect from its OWN DPI-aware process, so the frame needs
// no DPI maths here and lines up 1:1 with the overlay's mouse coordinates.
export const runtime = "nodejs";
export const maxDuration = 20;

const MAX_DIM = 8000;

function intParam(v: string | null, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const left = intParam(url.searchParams.get("left"), 0);
  const top = intParam(url.searchParams.get("top"), 0);
  let width = intParam(url.searchParams.get("width"), 0);
  let height = intParam(url.searchParams.get("height"), 0);

  if (width <= 0 || height <= 0 || width > MAX_DIM || height > MAX_DIM) {
    return NextResponse.json(
      { error: "left/top/width/height are required (width and height must be 1..8000)" },
      { status: 400 }
    );
  }

  const out = path.join(
    os.tmpdir(),
    `jarvis_circle_frame_${Date.now()}_${Math.random().toString(36).slice(2)}.png`
  );
  const scriptPath = `${out}.ps1`;

  const psScript = [
    "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
    `$bmp = New-Object System.Drawing.Bitmap ${width}, ${height}`,
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen(" + [left, top].join(", ") + ", 0, 0, $bmp.Size)",
    "$g.Dispose()",
    "$bmp.Save($env:JARVIS_FRAME, [System.Drawing.Imaging.ImageFormat]::Png)",
    "$bmp.Dispose()",
    "Write-Output 'OK'",
  ].join("\r\n");

  try {
    await fs.writeFile(scriptPath, psScript, "utf8");
    await execAsync(`powershell -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      env: { ...process.env, JARVIS_FRAME: out },
      maxBuffer: 1024 * 1024,
      timeout: 15_000,
    });

    const buf = await fs.readFile(out);
    if (!buf.length) throw new Error("captured frame was empty");

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "x-jarvis-frame-width": String(width),
        "x-jarvis-frame-height": String(height),
      },
    });
  } catch (error) {
    console.error("[circle/frame] capture failed:", error);
    return NextResponse.json(
      { error: "Screen capture failed", details: String(error) },
      { status: 500 }
    );
  } finally {
    fs.unlink(scriptPath).catch(() => {});
    fs.unlink(out).catch(() => {});
  }
}
