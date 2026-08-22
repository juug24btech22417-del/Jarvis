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

    public static void SetMute(bool bMute) {
        var vol = GetVolumeInterface();
        Guid g = Guid.Empty;
        vol.SetMute(bMute, ref g);
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

// Helper to run PowerShell via temporary script files for safety & reliability
async function runVolumeScript(scriptBody: string): Promise<string> {
  const script = `$Source = @'\n${CORE_AUDIO_C_SHARP}\n'@\nAdd-Type -TypeDefinition $Source -ErrorAction Stop\n${scriptBody}`;
  const tempScriptPath = path.join(os.tmpdir(), `jarvis_system_vol_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  
  await fs.writeFile(tempScriptPath, script, "utf8");
  try {
    const { stdout } = await execAsync(`powershell -NonInteractive -File "${tempScriptPath}"`);
    return stdout.trim();
  } finally {
    try {
      await fs.unlink(tempScriptPath);
    } catch {}
  }
}

async function setWindowsVolume(level: number): Promise<boolean> {
  const volume = Math.max(0, Math.min(100, level));
  try {
    await runVolumeScript(`[Audio]::SetVolume(${volume})`);
    return true;
  } catch (error) {
    console.error("Volume control failed:", error);
    return false;
  }
}

async function toggleMute(mute: boolean): Promise<boolean> {
  try {
    const boolStr = mute ? "$true" : "$false";
    await runVolumeScript(`[Audio]::SetMute(${boolStr})`);
    return true;
  } catch (error) {
    console.error("Mute control failed:", error);
    return false;
  }
}

// Set system alarm using Windows Task Scheduler
async function setSystemAlarm(time: string, label: string): Promise<boolean> {
  try {
    // Parse time (format: "5:00" or "14:30")
    const [hours, minutes] = time.split(":").map(Number);
    if (hours === undefined || isNaN(minutes)) {
      throw new Error("Invalid time format. Use HH:MM");
    }

    // Create a unique task name
    const taskName = `JARVIS_Alarm_${Date.now()}`;

    // Use PowerShell to create a scheduled task
    const psScript = `
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-Command \\"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${label}', 'JARVIS Alarm', 'OK', 'Information')\\""
$trigger = New-ScheduledTaskTrigger -Daily -At "${hours}:${minutes.toString().padStart(2, "0")}"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "${taskName}" -Action $action -Trigger $trigger -Settings $settings -Force
`;
    await execAsync(`powershell -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\"').replace(/\n/g, " ")}"`);
    return true;
  } catch (error) {
    console.error("Alarm setup failed:", error);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, value, time, label } = body;

    switch (action) {
      case "getVolume": {
        try {
          const result = await runVolumeScript(`Write-Output ([int][Audio]::GetVolume())`);
          const level = parseInt(result, 10);
          return NextResponse.json({ success: true, action: "getVolume", level: isNaN(level) ? 0 : level });
        } catch (error) {
          return NextResponse.json({ success: false, action: "getVolume", error: String(error) }, { status: 500 });
        }
      }
      case "setVolume": {
        const success = await setWindowsVolume(value);
        return NextResponse.json({ success, action: "setVolume", level: value });
      }
      case "mute": {
        const success = await toggleMute(true);
        return NextResponse.json({ success, action: "mute" });
      }
      case "unmute": {
        const success = await toggleMute(false);
        return NextResponse.json({ success, action: "unmute" });
      }
      case "setAlarm": {
        const success = await setSystemAlarm(time, label || "JARVIS Alarm");
        return NextResponse.json({ success, action: "setAlarm", time });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("System control error:", error);
    return NextResponse.json(
      { error: "Failed to execute system command", details: String(error) },
      { status: 500 }
    );
  }
}
