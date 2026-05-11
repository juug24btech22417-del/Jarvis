import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Windows PC Lock/Unlock controls
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "lock": {
        // Lock the workstation
        try {
          await execAsync("rundll32.exe user32.dll,LockWorkStation");
          return NextResponse.json({ success: true, message: "Workstation locked" });
        } catch (error) {
          console.error("Lock error:", error);
          return NextResponse.json(
            { error: "Failed to lock workstation" },
            { status: 500 }
          );
        }
      }

      case "logoff": {
        // Log off (use with caution!)
        try {
          await execAsync("shutdown /l");
          return NextResponse.json({ success: true, message: "Logging off" });
        } catch (error) {
          console.error("Logoff error:", error);
          return NextResponse.json(
            { error: "Failed to log off" },
            { status: 500 }
          );
        }
      }

      case "sleep": {
        // Put computer to sleep
        try {
          await execAsync("powercfg -h off"); // Disable hibernate to ensure sleep
          await execAsync("rundll32.exe powrprof.dll,SetSuspendState 0,1,0");
          return NextResponse.json({ success: true, message: "Entering sleep mode" });
        } catch (error) {
          console.error("Sleep error:", error);
          return NextResponse.json(
            { error: "Failed to enter sleep mode" },
            { status: 500 }
          );
        }
      }

      case "hibernate": {
        // Hibernate (if enabled)
        try {
          await execAsync("rundll32.exe powrprof.dll,SetSuspendState 1,1,0");
          return NextResponse.json({ success: true, message: "Entering hibernation" });
        } catch (error) {
          console.error("Hibernate error:", error);
          return NextResponse.json(
            { error: "Failed to hibernate (may be disabled)" },
            { status: 500 }
          );
        }
      }

      case "shutdown": {
        // Shutdown (requires confirmation - commented out for safety)
        // await execAsync("shutdown /s /t 0");
        return NextResponse.json(
          { error: "Shutdown requires manual confirmation for safety" },
          { status: 400 }
        );
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Lock API error:", error);
    return NextResponse.json(
      { error: "Lock command failed", details: String(error) },
      { status: 500 }
    );
  }
}
