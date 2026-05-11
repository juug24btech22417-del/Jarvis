import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Download and use nircmd if available, otherwise use PowerShell
async function setWindowsVolume(level: number): Promise<boolean> {
  const volume = Math.max(0, Math.min(100, level));
  const normalizedVolume = Math.round((volume / 100) * 65535);

  try {
    // Try nircmd first (most reliable)
    await execAsync(`nircmd setsysvolume ${normalizedVolume}`);
    return true;
  } catch {
    // Fallback to PowerShell volume keys approach
    try {
      const psScript = `
$wsh = New-Object -ComObject WScript.Shell;
# First send many volume down keys to ensure we're at 0
1..50 | ForEach-Object { $wsh.SendKeys([char]174); Start-Sleep -Milliseconds 5 }
# Calculate number of volume up presses needed (each press is ~2%)
$presses = [Math]::Ceiling(${volume} / 2)
1..$presses | ForEach-Object { $wsh.SendKeys([char]175); Start-Sleep -Milliseconds 5 }
`;
      await execAsync(`powershell -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`);
      return true;
    } catch (error) {
      console.error("Volume control failed:", error);
      return false;
    }
  }
}

async function toggleMute(mute: boolean): Promise<boolean> {
  try {
    // Try nircmd first
    await execAsync(`nircmd mutesysvolume ${mute ? 1 : 0}`);
    return true;
  } catch {
    // Fallback to mute key
    try {
      const psScript = `
$wsh = New-Object -ComObject WScript.Shell;
$wsh.SendKeys([char]173)
`;
      await execAsync(`powershell -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`);
      return true;
    } catch (error) {
      console.error("Mute control failed:", error);
      return false;
    }
  }
}

// Set system alarm using Windows Task Scheduler
async function setSystemAlarm(time: string, label: string): Promise<boolean> {
  try {
    // Parse time (format: "5:00" or "14:30")
    const [hours, minutes] = time.split(":").map(Number);
    if (!hours || isNaN(minutes)) {
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
