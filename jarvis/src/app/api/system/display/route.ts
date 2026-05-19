import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Windows brightness control using PowerShell
async function getBrightness(): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      'powershell -Command "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness"'
    );
    const brightness = parseInt(stdout.trim());
    return isNaN(brightness) ? null : brightness;
  } catch {
    return null;
  }
}

async function setBrightness(level: number): Promise<{success: boolean; actualBrightness?: number; error?: string}> {
  // Clamp between 0 and 100
  const brightness = Math.max(0, Math.min(100, level));

  // Get current brightness before setting
  const before = await getBrightness();
  console.log("[Brightness] Before:", before, "Target:", brightness);

  try {
    // Use Windows brightness API
    const psCommand = `
      $monitor = Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue;
      if ($monitor) {
        $monitor.WmiSetBrightness(1, ${brightness});
        Write-Output \\"SUCCESS\\";
      } else {
        Write-Output \\"NO_MONITOR\\";
      }
    `.replace(/\r?\n/g, ' ');

    const { stdout } = await execAsync(`powershell -Command "${psCommand}"`);
    console.log("[Brightness] PowerShell result:", stdout.trim());

    // Wait a moment for the change to take effect
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify the change by reading brightness again
    const after = await getBrightness();
    console.log("[Brightness] After:", after);

    // Check if it actually changed
    if (stdout.trim().includes("NO_MONITOR")) {
      return { success: false, error: "Monitor doesn't support DDC/CI brightness control" };
    }

    if (after !== null && Math.abs(after - brightness) <= 15) {
      // Close enough (within 15% to account for hardware stepping)
      return { success: true, actualBrightness: after };
    }

    // It didn't change - try nircmd fallback
    console.log("[Brightness] WMI didn't work, trying nircmd...");
  } catch (error) {
    console.error("[Brightness] WMI error:", error);
  }

  // Fallback: Try using nircmd (if installed)
  try {
    await execAsync(`nircmd setbrightness ${brightness}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    const after = await getBrightness();
    if (after !== null && Math.abs(after - brightness) <= 10) {
      return { success: true, actualBrightness: after };
    }
  } catch {
    console.log("[Brightness] nircmd not available or failed");
  }

  // If we got here, nothing worked
  return {
    success: false,
    actualBrightness: before || undefined,
    error: "Monitor doesn't support software brightness control. Try using laptop function keys instead."
  };
}

export async function GET() {
  try {
    const brightness = await getBrightness();
    return NextResponse.json({
      success: true,
      brightness,
      canControl: brightness !== null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to get brightness", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, level, direction } = body;

    switch (action) {
      case "set": {
        if (typeof level !== "number") {
          return NextResponse.json({ error: "Level required" }, { status: 400 });
        }
        const result = await setBrightness(level);
        if (result.success) {
          return NextResponse.json({ success: true, brightness: result.actualBrightness || level });
        }
        return NextResponse.json(
          { error: result.error || "Failed to set brightness", actualBrightness: result.actualBrightness },
          { status: 500 }
        );
      }

      case "adjust": {
        const current = await getBrightness();
        if (current === null) {
          return NextResponse.json(
            { error: "Cannot read current brightness - monitor may not support DDC/CI" },
            { status: 500 }
          );
        }

        const delta = direction === "up" ? 10 : direction === "down" ? -10 : 0;
        const newLevel = Math.max(0, Math.min(100, current + delta));
        const result = await setBrightness(newLevel);

        if (result.success) {
          return NextResponse.json({
            success: true,
            previous: current,
            brightness: result.actualBrightness || newLevel,
          });
        }
        return NextResponse.json({ error: result.error || "Failed to adjust brightness" }, { status: 500 });
      }

      case "nightMode": {
        // Set lower brightness for night mode
        const result = await setBrightness(30);
        if (result.success) {
          return NextResponse.json({ success: true, mode: "night", brightness: result.actualBrightness || 30 });
        }
        return NextResponse.json({ error: result.error || "Failed to set night mode" }, { status: 500 });
      }

      case "dayMode": {
        // Set higher brightness for day mode
        const result = await setBrightness(80);
        if (result.success) {
          return NextResponse.json({ success: true, mode: "day", brightness: result.actualBrightness || 80 });
        }
        return NextResponse.json({ error: result.error || "Failed to set day mode" }, { status: 500 });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Display API error:", error);
    return NextResponse.json(
      { error: "Display command failed", details: String(error) },
      { status: 500 }
    );
  }
}
