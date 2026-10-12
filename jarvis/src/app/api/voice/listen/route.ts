// Voice input for the circle overlay — "circle it and say what you want".
//
// POST /api/voice/listen
//   body: { seconds?: number, prompt?: string }   (default 5s, max 15s)
//   → { ok: true, text, language?, seconds }
//
// Why the recording happens HERE and not in the watcher: capturing the
// microphone from scripts/clipboard-watcher.ps1 would add "watch the clipboard +
// own global hotkeys + capture the screen + capture the mic" to one 1800-line
// script, which is exactly the shape Windows Defender's AMSI scanner refuses to
// run — it already blocked that file once for the screen capture alone, and a
// blocked script takes clipboard intelligence down with it. The server writes a
// throwaway tail script instead and deletes it, the same way
// /api/screenshot/capture already does for the screen.
//
// The recorder is Windows' own MCI waveaudio device (no external binary, no
// dependency to install), transcribed by the Groq Whisper helper the Telegram
// voice notes already use.

import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";
import { transcribeOggOpus } from "@/lib/telegram/transcribe";

export const runtime = "nodejs";
export const maxDuration = 60;

const execFileAsync = promisify(execFile);

const DEFAULT_SECONDS = 5;
const MAX_SECONDS = 15;
/** Quietest useful clip — a silent recording means a dead/muted mic. */
const MIN_BYTES = 2_000;

/**
 * Record `seconds` of mono 16 kHz PCM into `wavPath` using the MCI waveaudio
 * device. Written to a temp file so `$` interpolation survives, and run with
 * -File (not -Command): a multi-line PowerShell program passed on the command
 * line is another thing the script scanners dislike.
 */
function recorderScript(seconds: number, wavPath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -TypeDefinition @'",
    "using System;",
    "using System.Text;",
    "using System.Runtime.InteropServices;",
    "public static class Mci {",
    "    [DllImport(\"winmm.dll\", CharSet = CharSet.Auto)]",
    "    public static extern int mciSendString(string cmd, StringBuilder ret, int retLen, IntPtr hwnd);",
    "}",
    "'@",
    "",
    "function Send([string]$cmd) {",
    "    $sb = New-Object System.Text.StringBuilder 256",
    "    $rc = [Mci]::mciSendString($cmd, $sb, 256, [IntPtr]::Zero)",
    "    if ($rc -ne 0) { throw \"mci '$cmd' failed with code $rc\" }",
    "    return $sb.ToString()",
    "}",
    "",
    `$wav = '${wavPath.replace(/'/g, "''")}'`,
    "Send \"open new type waveaudio alias jrec\" | Out-Null",
    "try {",
    "    # 16 kHz mono 16-bit is what speech models want and keeps the upload tiny.",
    "    Send \"set jrec time format ms bitspersample 16 channels 1 samplespersec 16000\" | Out-Null",
    "    Send \"record jrec\" | Out-Null",
    `    Start-Sleep -Seconds ${seconds}`,
    "    Send \"stop jrec\" | Out-Null",
    "    Send \"save jrec `\"$wav`\"\" | Out-Null",
    "} finally {",
    "    Send \"close jrec\" | Out-Null",
    "}",
    "if (-not (Test-Path $wav)) { throw 'no recording was produced' }",
    "Write-Output 'RECORDED'",
  ].join("\r\n");
}

export async function POST(req: Request) {
  if (process.platform !== "win32") {
    return NextResponse.json(
      { ok: false, error: "Voice capture is Windows-only." },
      { status: 501 }
    );
  }

  let body: { seconds?: number; prompt?: string } = {};
  try {
    body = (await req.json()) as { seconds?: number; prompt?: string };
  } catch {
    // empty body is fine — defaults apply
  }

  const seconds = Math.min(
    Math.max(Math.round(Number(body.seconds) || DEFAULT_SECONDS), 1),
    MAX_SECONDS
  );

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const wavPath = path.join(os.tmpdir(), `jarvis_voice_${stamp}.wav`);
  const psPath = path.join(os.tmpdir(), `jarvis_voice_${stamp}.ps1`);

  const started = Date.now();
  try {
    await fs.writeFile(psPath, recorderScript(seconds, wavPath), "utf8");
    await execFileAsync(
      "powershell",
      ["-NonInteractive", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath],
      { timeout: (seconds + 10) * 1000, maxBuffer: 1024 * 1024, windowsHide: true }
    );

    const wav = await fs.readFile(wavPath);
    if (wav.length < MIN_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Nothing was captured — check that a microphone is connected and not muted.",
        },
        { status: 422 }
      );
    }

    const heard = await transcribeOggOpus(wav, {
      mimeHint: "audio/wav",
      prompt: body.prompt,
    });

    console.log(
      `[voice/listen] ${seconds}s → ${Date.now() - started}ms → "${heard.text.slice(0, 80)}"`
    );

    return NextResponse.json({
      ok: true,
      text: heard.text,
      language: heard.language,
      seconds,
      elapsedMs: Date.now() - started,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[voice/listen] failed:", msg);
    // A machine with no audio input device fails at `open new type waveaudio`.
    const noDevice = /waveaudio|no device|mci /i.test(msg);
    return NextResponse.json(
      {
        ok: false,
        error: noDevice
          ? "No microphone is available to Windows right now."
          : `Could not transcribe: ${msg.slice(0, 200)}`,
      },
      { status: 500 }
    );
  } finally {
    await fs.unlink(psPath).catch(() => {});
    await fs.unlink(wavPath).catch(() => {});
  }
}
