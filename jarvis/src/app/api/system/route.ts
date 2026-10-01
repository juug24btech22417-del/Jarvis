import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Volume is handled by the native multi-path module (Core Audio -> winmm ->
// hardware keys) so it keeps working even on machines where the Core Audio COM
// activation is rejected. Loaded lazily because it is a native FFI .cjs module
// that must not be bundled.
type VolumeModule = {
  getMasterVolume: () => number;
  setMasterVolume: (level: number) => { before: number; after: number; method: string };
  setMute: (mute: boolean) => { muted: boolean; method: string };
  toggleMute: () => { muted: boolean; method: string };
};
let volMod: VolumeModule | null = null;
function volume(): VolumeModule {
  if (!volMod) volMod = require("@/lib/os/volume.cjs") as VolumeModule;
  return volMod;
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
    await execAsync(`powershell -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, " ")}"`);
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
          const level = volume().getMasterVolume();
          return NextResponse.json({ success: true, action: "getVolume", level });
        } catch (error) {
          return NextResponse.json({ success: false, action: "getVolume", error: String(error) }, { status: 500 });
        }
      }
      case "setVolume": {
        const result = volume().setMasterVolume(Number(value));
        return NextResponse.json({ success: true, action: "setVolume", level: result.after, method: result.method });
      }
      case "mute": {
        const r = volume().setMute(true);
        return NextResponse.json({ success: true, action: "mute", muted: r.muted, method: r.method });
      }
      case "unmute": {
        const r = volume().setMute(false);
        return NextResponse.json({ success: true, action: "unmute", muted: r.muted, method: r.method });
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
