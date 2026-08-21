import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";

const execAsync = promisify(exec);

// ─── CORS helpers ──────────────────────────────────────────────────────────
function cors(res: NextResponse) {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return res;
}
export async function OPTIONS() {
  return cors(NextResponse.json({ ok: true }));
}

// ─── Known app aliases → Windows command ──────────────────────────────────
const APP_MAP: Record<string, string> = {
  // Browsers
  chrome:    "start chrome",
  firefox:   "start firefox",
  edge:      "start msedge",
  // Editors
  vscode:    "start code",
  notepad:   "start notepad",
  // System
  terminal:  "start wt",           // Windows Terminal
  powershell:"start powershell",
  calculator:"start calc",
  explorer:  "start explorer",
  taskmanager: "start taskmgr",
  // Media
  spotify:   "start spotify",
  vlc:       "start vlc",
  // Office / comms
  teams:     "start ms-teams:",
  outlook:   "start outlook",
  word:      "start winword",
  excel:     "start excel",
};

// ─── Route handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { command, app, url, query, level } = body as {
      command?: string;
      app?: string;
      url?: string;
      query?: string;
      level?: number;
      percent?: number;
    };

    let shellCmd: string | null = null;
    let description = "";
    let filePath: string | undefined;

    // 1. Open a specific URL in the default browser
    if (command === "open_url" && url) {
      shellCmd = `start "" "${url}"`;
      description = `Opening ${url}`;
    }

    // 2. Open a named application
    else if (command === "open_app" && app) {
      const key = app.toLowerCase().replace(/\s+/g, "");
      const mapped = APP_MAP[key];
      if (mapped) {
        shellCmd = mapped;
        description = `Launching ${app}`;
      } else {
        // Generic fallback — try ShellExecute via start
        shellCmd = `start "" "${app}"`;
        description = `Attempting to launch ${app}`;
      }
    }

    // 3. Web search (opens in default browser)
    else if (command === "web_search" && query) {
      const encoded = encodeURIComponent(query);
      shellCmd = `start "" "https://www.google.com/search?q=${encoded}"`;
      description = `Searching the web for: ${query}`;
    }

    // 4. System controls — volume via winmm.dll!waveOutSetVolume.
    //    This is the only API that ACTUALLY changes the OS master
    //    volume (verified end-to-end: read 100%, write 50%, read
    //    back 50%; persists across calls; reflects in the Windows
    //    volume slider).
    //
    //    SAPI.SpVoice.Volume looked tempting but only changes SAPI's
    //    own TTS volume (reverts when the COM object is released).
    //    IAudioEndpointVolume / IMMDeviceEnumerator COM binding
    //    fails with REGDB_E_CLASSNOTREG on this machine's audio
    //    stack. winmm.dll ships with every Windows install and
    //    works without registration.
    //
    //    waveOutSetVolume takes a uint32 with bits 0-15 = left
    //    channel, 16-31 = right channel, in 0-65535 scale.
    //    waveOutGetVolume(IntPtr.Zero) reads the first device's
    //    volume (== the default waveOut endpoint = the master).
    else if (command === "volume_up") {
      shellCmd =
        `powershell -NonInteractive -Command "` +
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
        `public class W{[DllImport(\"winmm.dll\")]public static extern int waveOutGetVolume(IntPtr h, out uint v);` +
        `[DllImport(\"winmm.dll\")]public static extern int waveOutSetVolume(IntPtr h, uint v);}';` +
        `$cur = 0;$null = [W]::waveOutGetVolume([IntPtr]::Zero, [ref]$cur);` +
        `$curPct = [int](($cur -band 0xFFFF) * 100 / 65535);` +
        `$next = [Math]::Min(100, $curPct + 5);` +
        `$raw = [uint32]([Math]::Round(65535 * $next / 100));` +
        `$both = [uint32](($raw -shl 16) -bor $raw);` +
        `[void][W]::waveOutSetVolume([IntPtr]::Zero, $both);` +
        `Write-Output ('before:' + $curPct + ' after:' + $next)` +
        `"`;
      description = "Volume up (+5)";
    }
    else if (command === "volume_down") {
      shellCmd =
        `powershell -NonInteractive -Command "` +
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
        `public class W{[DllImport(\"winmm.dll\")]public static extern int waveOutGetVolume(IntPtr h, out uint v);` +
        `[DllImport(\"winmm.dll\")]public static extern int waveOutSetVolume(IntPtr h, uint v);}';` +
        `$cur = 0;$null = [W]::waveOutGetVolume([IntPtr]::Zero, [ref]$cur);` +
        `$curPct = [int](($cur -band 0xFFFF) * 100 / 65535);` +
        `$next = [Math]::Max(0, $curPct - 5);` +
        `$raw = [uint32]([Math]::Round(65535 * $next / 100));` +
        `$both = [uint32](($raw -shl 16) -bor $raw);` +
        `[void][W]::waveOutSetVolume([IntPtr]::Zero, $both);` +
        `Write-Output ('before:' + $curPct + ' after:' + $next)` +
        `"`;
      description = "Volume down (-5)";
    }
    else if (command === "mute") {
      shellCmd =
        `powershell -NonInteractive -Command "` +
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
        `public class W{[DllImport(\"winmm.dll\")]public static extern int waveOutSetVolume(IntPtr h, uint v);}';` +
        `[void][W]::waveOutSetVolume([IntPtr]::Zero, [uint32]0);` +
        `Write-Output 'muted'` +
        `"`;
      description = "Muting system volume";
    }
    else if (command === "screenshot") {
      filePath = path.join(os.tmpdir(), `jarvis_ss_${Date.now()}.png`);
      const fp = filePath.replace(/\\/g, "\\\\");
      shellCmd =
        `powershell -NonInteractive -Command ` +
        `"Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
        `$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
        `$bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); ` +
        `$g=[System.Drawing.Graphics]::FromImage($bmp); ` +
        `$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); ` +
        `$bmp.Save('${fp}'); ` +
        `$g.Dispose(); $bmp.Dispose()"`;
      description = "Screenshot captured";
    }
    else if (command === "lock") {
      shellCmd = `rundll32.exe user32.dll,LockWorkStation`;
      description = "Locking workstation";
    }
    else if (command === "sleep") {
      shellCmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false)"`;
      description = "Putting system to sleep";
    }
    else if (command === "shutdown") {
      shellCmd = `shutdown /s /t 30`;
      description = "Shutdown scheduled in 30 seconds";
    }
    else if (command === "cancel_shutdown") {
      shellCmd = `shutdown /a`;
      description = "Shutdown cancelled";
    }

    // 5. File explorer at a path
    else if (command === "open_path" && url) {
      shellCmd = `start explorer "${url}"`;
      description = `Opening folder: ${url}`;
    }

    // 6. Kill a process by name
    else if (command === "kill_app" && app) {
      shellCmd = `taskkill /IM "${app}.exe" /F`;
      description = `Killing process: ${app}`;
    }

    // 7. Wake screen — mouse-move + power request. The mouse-jiggle
    // forces Windows to push focus to the foreground even when locked,
    // which wakes the display backlight on most hardware.
    else if (command === "wake_screen") {
      shellCmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $p = [System.Windows.Forms.Cursor]::Position; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($p.X+1, $p.Y); [System.Windows.Forms.Cursor]::Position = $p"`;
      description = "Waking the screen";
    }

    // 8. Play a short beep — used by /wake and any "make a sound"
    //    command. ~500ms tone at 800Hz is audible but not annoying.
    else if (command === "play_sound") {
      shellCmd = `powershell -Command "[console]::beep(800,500)"`;
      description = "Beep";
    }

    // 9. Volume set to N (0-100) — sets the system master volume
    //    via winmm.dll!waveOutSetVolume. See the block above (volume_up
    //    / volume_down / mute) for why this is the only API that
    //    actually works on this machine — SAPI.SpVoice.Volume is
    //    per-instance only and IMMDeviceEnumerator fails with
    //    REGDB_E_CLASSNOTREG.
    else if (command === "volume_set" && typeof body.level === "number") {
      const target = Math.max(0, Math.min(100, body.level));
      shellCmd =
        `powershell -NonInteractive -Command "` +
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;` +
        `public class W{[DllImport(\"winmm.dll\")]public static extern int waveOutGetVolume(IntPtr h, out uint v);` +
        `[DllImport(\"winmm.dll\")]public static extern int waveOutSetVolume(IntPtr h, uint v);}';` +
        `$cur = 0;$null = [W]::waveOutGetVolume([IntPtr]::Zero, [ref]$cur);` +
        `$curPct = [int](($cur -band 0xFFFF) * 100 / 65535);` +
        `$raw = [uint32]([Math]::Round(65535 * ${target} / 100));` +
        `$both = [uint32](($raw -shl 16) -bor $raw);` +
        `[void][W]::waveOutSetVolume([IntPtr]::Zero, $both);` +
        `Write-Output ('before:' + $curPct + ' after:${target}')` +
        `"`;
      description = `Setting volume to ${target}%`;
    }

    // 10. Brightness up (+10) via Windows WMI (laptop internal display only).
    //     Uses Get-WmiObject WmiMonitorBrightness to read current level,
    //     then WmiMonitorBrightnessMethods.WmiSetBrightness to apply the new value.
    //     Works on all modern Windows laptops; desktop monitors with no WMI
    //     driver will return a non-fatal error that we swallow gracefully.
    else if (command === "brightness_up") {
      shellCmd =
        `powershell -NonInteractive -Command "` +
        `$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness;` +
        `if ($cur -eq $null) { Write-Output 'wmi_not_supported'; exit 0 };` +
        `$next = [Math]::Min(100, [int]$cur + 10);` +
        `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$next);` +
        `Write-Output ('before:' + $cur + ' after:' + $next)` +
        `"`;
      description = "Brightness up (+10)";
    }

    // 11. Brightness down (-10)
    else if (command === "brightness_down") {
      shellCmd =
        `powershell -NonInteractive -Command "` +
        `$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness;` +
        `if ($cur -eq $null) { Write-Output 'wmi_not_supported'; exit 0 };` +
        `$next = [Math]::Max(0, [int]$cur - 10);` +
        `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$next);` +
        `Write-Output ('before:' + $cur + ' after:' + $next)` +
        `"`;
      description = "Brightness down (-10)";
    }

    // 12. Brightness set to N (0-100)
    else if (command === "brightness_set") {
      const raw = body.level ?? body.percent;
      const target = Math.max(0, Math.min(100, Number(raw ?? 50)));
      shellCmd =
        `powershell -NonInteractive -Command "` +
        `$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness;` +
        `if ($cur -eq $null) { Write-Output 'wmi_not_supported'; exit 0 };` +
        `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${target});` +
        `Write-Output ('before:' + $cur + ' after:${target}')` +
        `"`;
      description = `Setting brightness to ${target}%`;
    }

    if (!shellCmd) {
      return cors(
        NextResponse.json(
          { success: false, error: `Unknown command or missing parameters: ${JSON.stringify(body)}` },
          { status: 400 }
        )
      );
    }

    console.log(`[OS-Command] Executing: ${shellCmd}`);
    const { stdout, stderr } = await execAsync(shellCmd, { timeout: 8000 }).catch((e) => ({
      stdout: "",
      stderr: e.message,
    }));

    return cors(
      NextResponse.json({
        success: true,
        description,
        command: shellCmd,
        stdout: stdout.trim().slice(0, 500),
        stderr: stderr ? stderr.trim().slice(0, 200) : undefined,
        ...(filePath ? { filePath } : {}),
      })
    );
  } catch (err: any) {
    console.error("[OS-Command Error]:", err);
    return cors(
      NextResponse.json(
        { success: false, error: err?.message || String(err) },
        { status: 500 }
      )
    );
  }
}
