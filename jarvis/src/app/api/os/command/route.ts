import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

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
    const { command, app, url, query } = body as {
      command?: string;
      app?: string;
      url?: string;
      query?: string;
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

    // 4. System controls
    else if (command === "volume_up") {
      // Use nircmd if available, else PowerShell
      shellCmd = `powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"`;
      description = "Volume up";
    }
    else if (command === "volume_down") {
      shellCmd = `powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"`;
      description = "Volume down";
    }
    else if (command === "mute") {
      shellCmd = `powershell -Command "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"`;
      description = "Toggle mute";
    }
    else if (command === "screenshot") {
      shellCmd = `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('%{PRTSC}')"`;
      description = "Taking screenshot";
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
