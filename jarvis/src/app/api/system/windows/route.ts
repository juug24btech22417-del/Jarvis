import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Window management using PowerShell and Windows API
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, processName } = body;

    switch (action) {
      case "minimize": {
        // Minimize all windows or specific process
        if (processName) {
          const psCommand = `
            Get-Process -Name "${processName}" -ErrorAction SilentlyContinue | ForEach-Object {
              $hwnd = $_.MainWindowHandle
              if ($hwnd -ne 0) {
                Add-Type @"
                  using System;
                  using System.Runtime.InteropServices;
                  public class WinAPI {
                    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                  }
"@
                [WinAPI]::ShowWindow($hwnd, 6) # 6 = minimize
              }
            }
          `;
          await execAsync(`powershell -Command "${psCommand}"`);
        } else {
          // Minimize all
          await execAsync('powershell -Command "$shell = New-Object -ComObject Shell.Application; $shell.MinimizeAll()"');
        }
        return NextResponse.json({ success: true, action: "minimize" });
      }

      case "maximize": {
        if (processName) {
          const psCommand = `
            Get-Process -Name "${processName}" -ErrorAction SilentlyContinue | ForEach-Object {
              $hwnd = $_.MainWindowHandle
              if ($hwnd -ne 0) {
                Add-Type @"
                  using System;
                  using System.Runtime.InteropServices;
                  public class WinAPI {
                    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                  }
"@
                [WinAPI]::ShowWindow($hwnd, 3) # 3 = maximize
              }
            }
          `;
          await execAsync(`powershell -Command "${psCommand}"`);
        }
        return NextResponse.json({ success: true, action: "maximize" });
      }

      case "restore": {
        if (processName) {
          const psCommand = `
            Get-Process -Name "${processName}" -ErrorAction SilentlyContinue | ForEach-Object {
              $hwnd = $_.MainWindowHandle
              if ($hwnd -ne 0) {
                Add-Type @"
                  using System;
                  using System.Runtime.InteropServices;
                  public class WinAPI {
                    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
                  }
"@
                [WinAPI]::ShowWindow($hwnd, 9) # 9 = restore
              }
            }
          `;
          await execAsync(`powershell -Command "${psCommand}"`);
        }
        return NextResponse.json({ success: true, action: "restore" });
      }

      case "close": {
        if (processName) {
          try {
            await execAsync(`taskkill /IM "${processName}.exe" /F`);
          } catch (killError) {
            console.log(`[Windows Close] taskkill failed or process not found: ${processName}`);
          }
          return NextResponse.json({ success: true, action: "close", process: processName });
        }
        return NextResponse.json({ error: "Process name required" }, { status: 400 });
      }

      case "focus": {
        if (processName) {
          const psCommand = `
            Add-Type @"
              using System;
              using System.Runtime.InteropServices;
              public class WinAPI {
                [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
                [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
                [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
              }
"@
            $proc = Get-Process -Name "${processName}" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($proc -and $proc.MainWindowHandle -ne 0) {
              if ([WinAPI]::IsIconic($proc.MainWindowHandle)) {
                [WinAPI]::ShowWindowAsync($proc.MainWindowHandle, 9) | Out-Null
              }
              [WinAPI]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
            }
          `;
          await execAsync(`powershell -Command "${psCommand}"`);
          return NextResponse.json({ success: true, action: "focus", process: processName });
        }
        return NextResponse.json({ error: "Process name required" }, { status: 400 });
      }

      case "list": {
        const { stdout } = await execAsync(
          'powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object ProcessName,MainWindowTitle,Id | Format-Table -AutoSize"'
        );
        const lines = stdout.trim().split('\n').slice(2); // Skip header
        const windows = lines
          .map(line => line.trim())
          .filter(line => line)
          .map(line => {
            const parts = line.split(/\s{2,}/);
            return {
              process: parts[0],
              title: parts[1] || '',
              pid: parseInt(parts[2]) || 0,
            };
          });
        return NextResponse.json({ success: true, windows });
      }

      case "tile": {
        // Tile windows side by side
        const psCommand = `
          $shell = New-Object -ComObject Shell.Application
          $shell.TileHorizontally()
        `;
        await execAsync(`powershell -Command "${psCommand}"`);
        return NextResponse.json({ success: true, action: "tile" });
      }

      case "cascade": {
        // Cascade windows
        const psCommand = `
          $shell = New-Object -ComObject Shell.Application
          $shell.CascadeWindows()
        `;
        await execAsync(`powershell -Command "${psCommand}"`);
        return NextResponse.json({ success: true, action: "cascade" });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Window management error:", error);
    return NextResponse.json(
      { error: "Window command failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const { stdout } = await execAsync(
      'powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -First 10 ProcessName,MainWindowTitle | Format-Table -AutoSize"'
    );
    return NextResponse.json({ success: true, windows: stdout });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list windows", details: String(error) },
      { status: 500 }
    );
  }
}
