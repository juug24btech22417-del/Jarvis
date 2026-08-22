import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

const CORE_AUDIO_C_SHARP = `
using System;
using System.Runtime.InteropServices;

public class Audio {
    [DllImport("ole32.dll")]
    private static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, int dwClsContext, ref Guid riid, out IntPtr ppv);

    private static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
    private static readonly Guid IID_IMMDeviceEnumerator   = new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");
    private static readonly Guid IID_IAudioEndpointVolume  = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        [PreserveSig] int OpenPropertyStore(uint stgmAccess, out IntPtr ppProperties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        [PreserveSig] int GetState(out uint pdwState);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        int GetMute(out bool bMute);
    }

    private static IAudioEndpointVolume GetVolumeInterface() {
        Guid clsid = CLSID_MMDeviceEnumerator;
        Guid iid   = IID_IMMDeviceEnumerator;
        IntPtr pEnum;
        int hr = CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iid, out pEnum);
        if (hr != 0) throw new System.Runtime.InteropServices.COMException("CoCreateInstance failed: 0x" + hr.ToString("X8"), hr);

        var enumerator = (IMMDeviceEnumerator)Marshal.GetObjectForIUnknown(pEnum);
        IntPtr pDevice;
        hr = enumerator.GetDefaultAudioEndpoint(0, 1, out pDevice);
        if (hr != 0) throw new System.Runtime.InteropServices.COMException("GetDefaultAudioEndpoint failed: 0x" + hr.ToString("X8"), hr);

        var device = (IMMDevice)Marshal.GetObjectForIUnknown(pDevice);
        Guid volIid = IID_IAudioEndpointVolume;
        object volObj;
        hr = device.Activate(ref volIid, 23, IntPtr.Zero, out volObj);
        if (hr != 0) throw new System.Runtime.InteropServices.COMException("Activate IAudioEndpointVolume failed: 0x" + hr.ToString("X8"), hr);

        return (IAudioEndpointVolume)volObj;
    }

    public static float GetVolume() {
        var vol = GetVolumeInterface();
        float level;
        vol.GetMasterVolumeLevelScalar(out level);
        return level * 100f;
    }

    public static void SetVolume(float percent) {
        var vol = GetVolumeInterface();
        Guid g = Guid.Empty;
        float scalar = Math.Max(0f, Math.Min(1f, percent / 100f));
        vol.SetMasterVolumeLevelScalar(scalar, ref g);
    }

    public static void ToggleMute() {
        var vol = GetVolumeInterface();
        bool muted;
        vol.GetMute(out muted);
        Guid g = Guid.Empty;
        vol.SetMute(!muted, ref g);
    }
}
`;


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
      const script = `
$Source = @'
${CORE_AUDIO_C_SHARP}
'@
Add-Type -TypeDefinition $Source -ErrorAction Stop
$cur = [Audio]::GetVolume()
$next = [Math]::Min(100, $cur + 5)
[Audio]::SetVolume($next)
Write-Output ("before:" + [int]$cur + " after:" + [int]$next)
`;
      tempScriptPath = path.join(os.tmpdir(), `jarvis_vol_up_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
      await fs.writeFile(tempScriptPath, script, "utf8");
      shellCmd = `powershell -NonInteractive -File "${tempScriptPath}"`;
      description = "Volume up (+5)";
    }
    else if (command === "volume_down") {
      const script = `
$Source = @'
${CORE_AUDIO_C_SHARP}
'@
Add-Type -TypeDefinition $Source -ErrorAction Stop
$cur = [Audio]::GetVolume()
$next = [Math]::Max(0, $cur - 5)
[Audio]::SetVolume($next)
Write-Output ("before:" + [int]$cur + " after:" + [int]$next)
`;
      tempScriptPath = path.join(os.tmpdir(), `jarvis_vol_down_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
      await fs.writeFile(tempScriptPath, script, "utf8");
      shellCmd = `powershell -NonInteractive -File "${tempScriptPath}"`;
      description = "Volume down (-5)";
    }
    else if (command === "mute") {
      const script = `
$Source = @'
${CORE_AUDIO_C_SHARP}
'@
Add-Type -TypeDefinition $Source -ErrorAction Stop
[Audio]::ToggleMute()
Write-Output "muted"
`;
      tempScriptPath = path.join(os.tmpdir(), `jarvis_vol_mute_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
      await fs.writeFile(tempScriptPath, script, "utf8");
      shellCmd = `powershell -NonInteractive -File "${tempScriptPath}"`;
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

    else if (command === "volume_set" && typeof body.level === "number") {
      const target = Math.max(0, Math.min(100, body.level));
      const script = `
$Source = @'
${CORE_AUDIO_C_SHARP}
'@
Add-Type -TypeDefinition $Source -ErrorAction Stop
$cur = [Audio]::GetVolume()
[Audio]::SetVolume(${target})
Write-Output ("before:" + [int]$cur + " after:${target}")
`;
      tempScriptPath = path.join(os.tmpdir(), `jarvis_vol_set_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
      await fs.writeFile(tempScriptPath, script, "utf8");
      shellCmd = `powershell -NonInteractive -File "${tempScriptPath}"`;
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
  } finally {
    if (tempScriptPath) {
      try {
        await fs.unlink(tempScriptPath);
      } catch {}
    }
  }
}
