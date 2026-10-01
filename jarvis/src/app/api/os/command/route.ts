import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";

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

// Volume is handled by the native multi-path module (Core Audio -> winmm ->
// hardware keys) so it keeps working even where the Core Audio COM activation
// is rejected. Lazy require: native FFI .cjs must not be bundled.
type VolumeModule = {
  getMasterVolume: () => number;
  setMasterVolume: (level: number) => { before: number; after: number; method: string };
  toggleMute: () => { muted: boolean; method: string };
};
let volMod: VolumeModule | null = null;
function volume(): VolumeModule {
  if (!volMod) volMod = require("@/lib/os/volume.cjs") as VolumeModule;
  return volMod;
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
  // Declared outside try so the finally block can access them for cleanup.
  let tempScriptPath: string | null = null;
  let filePath: string | undefined;
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

    // 4. System controls — volume via @/lib/os/volume.cjs, which tries Core
    //    Audio then winmm (waveOutSetVolume, no COM needed, ships with every
    //    Windows install) then hardware volume keys. One broken rail can never
    //    take volume control down.
    // FFI calls (no shell) — return immediately rather than falling through to execAsync.
    else if (command === "volume_up" || command === "volume_down") {
      const delta = command === "volume_up" ? 5 : -5;
      const r = volume().setMasterVolume(volume().getMasterVolume() + delta);
      return cors(
        NextResponse.json({
          success: true,
          description: `Volume ${delta > 0 ? "+" : ""}${delta}% (now ${r.after}% via ${r.method})`,
          ...r,
        })
      );
    }
    else if (command === "mute") {
      const r = volume().toggleMute();
      return cors(NextResponse.json({ success: true, description: r.muted ? "Muted" : "Unmuted", ...r }));
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

    // 6. Kill a process by name with alias support
    else if (command === "kill_app" && app) {
      const clean = app.trim().toLowerCase().replace(/\.exe$/i, "");
      const ALIASES: Record<string, string> = {
        zoom: "Zoom",
        chrome: "chrome",
        googlechrome: "chrome",
        code: "Code",
        vscode: "Code",
        node: "node",
        spotify: "Spotify",
        teams: "ms-teams",
        discord: "Discord",
        notion: "Notion",
        firefox: "firefox",
        edge: "msedge",
      };
      const exeName = (ALIASES[clean] || clean) + ".exe";
      shellCmd = `taskkill /IM "${exeName}" /F`;
      description = `Terminating process: ${exeName}`;
    }

    // 6b. PC Telemetry / Status (CPU, RAM, Battery, Foreground window)
    else if (command === "pc_status" || command === "telemetry") {
      const script = [
        "$cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average",
        "$os = Get-CimInstance Win32_OperatingSystem",
        "$totalMem = [math]::Round($os.TotalVisibleMemorySize / 1024, 0)",
        "$freeMem = [math]::Round($os.FreePhysicalMemory / 1024, 0)",
        "$usedMem = $totalMem - $freeMem",
        "$memPercent = [math]::Round(($usedMem / $totalMem) * 100, 1)",
        "$batt = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue",
        "$battPercent = if ($batt) { [int]$batt.EstimatedChargeRemaining } else { -1 }",
        "$battCharging = if ($batt) { [bool]($batt.BatteryStatus -eq 2) } else { $false }",
        "$procs = Get-Process | Sort-Object CPU -Descending | Select-Object -First 3 ProcessName",
        "$data = @{",
        "  cpuPercent = [int]$cpu",
        "  totalMemMb = [int]$totalMem",
        "  usedMemMb = [int]$usedMem",
        "  memPercent = $memPercent",
        "  batteryPercent = $battPercent",
        "  isCharging = $battCharging",
        "  topProcesses = ($procs.ProcessName -join ', ')",
        "}",
        "$data | ConvertTo-Json -Compress",
      ].join("\r\n");

      tempScriptPath = path.join(
        os.tmpdir(),
        `jarvis_status_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`
      );
      await fs.writeFile(tempScriptPath, script, "utf8");
      shellCmd = `powershell -NonInteractive -ExecutionPolicy Bypass -File "${tempScriptPath}"`;
      description = "PC telemetry status collected";
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

    // Security siren — rising two-tone loop for ~6s. Loud on purpose.
    else if (command === "siren") {
      shellCmd = `powershell -Command "1..6 | ForEach-Object { [console]::beep(880,300); [console]::beep(1245,300) }"`;
      description = "Security siren (~6s)";
    }

    // Spoken warning via Windows SAPI — security escalation TTS.
    else if (command === "speak" && typeof body.text === "string" && body.text.trim()) {
      const text = body.text.trim().slice(0, 300).replace(/["\r\n]/g, " ");
      shellCmd = `powershell -Command "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${text}')"`;
      description = "Spoken warning";
    }

    else if (command === "volume_set" && typeof body.level === "number") {
      const r = volume().setMasterVolume(Number(body.level));
      return cors(
        NextResponse.json({ success: true, description: `Volume set to ${r.after}% (via ${r.method})`, ...r })
      );
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
  } finally {
    if (tempScriptPath) {
      try {
        await fs.unlink(tempScriptPath);
      } catch {}
    }
  }
}
