import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

/**
 * Captures the active window list and foreground app info as a text-based fallback
 * when visual screen capture returns a black/empty image.
 */
async function getDesktopContext(): Promise<string> {
  try {
    const psScript = [
      "Add-Type @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "using System.Text;",
      "public class WinAPI {",
      "    [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow();",
      "    [DllImport(\"user32.dll\", SetLastError=true)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);",
      "    [DllImport(\"user32.dll\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);",
      "}",
      "'@",
      "",
      "$fg = [WinAPI]::GetForegroundWindow()",
      "$sb = New-Object System.Text.StringBuilder 256",
      "[WinAPI]::GetWindowText($fg, $sb, 256) | Out-Null",
      "$fgTitle = $sb.ToString()",
      "$pid2 = 0",
      "[WinAPI]::GetWindowThreadProcessId($fg, [ref]$pid2) | Out-Null",
      "$fgProc = if ($pid2 -gt 0) { (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName } else { 'unknown' }",
      "",
      "Write-Output \"FOREGROUND_WINDOW: $fgTitle\"",
      "Write-Output \"FOREGROUND_PROCESS: $fgProc\"",
      "",
      "# List visible windows",
      "$windows = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 15 ProcessName, MainWindowTitle",
      "Write-Output 'VISIBLE_WINDOWS:'",
      "foreach ($w in $windows) {",
      "    Write-Output \"  - [$($w.ProcessName)] $($w.MainWindowTitle)\"",
      "}",
      "",
      "# Top CPU processes",
      "Write-Output 'TOP_PROCESSES:'",
      "$procs = Get-Process | Sort-Object CPU -Descending | Select-Object -First 8 ProcessName, @{N='CPU_s';E={[math]::Round($_.CPU,1)}}, @{N='Mem_MB';E={[math]::Round($_.WorkingSet64/1MB,0)}}",
      "foreach ($p in $procs) {",
      "    Write-Output \"  - $($p.ProcessName): CPU=$($p.CPU_s)s Mem=$($p.Mem_MB)MB\"",
      "}",
    ].join("\r\n");

    const tmpFile = path.join(
      os.tmpdir(),
      `jarvis_ctx_${Date.now()}.ps1`
    );
    await fs.writeFile(tmpFile, psScript, "utf8");

    const { stdout } = await execAsync(
      `powershell -NonInteractive -ExecutionPolicy Bypass -File "${tmpFile}"`,
      { maxBuffer: 1024 * 1024, timeout: 10000 }
    );

    fs.unlink(tmpFile).catch(() => {});
    return stdout.trim();
  } catch (err) {
    console.error("[screenshot/capture] Context fallback failed:", err);
    return "Unable to retrieve desktop context";
  }
}

/**
 * Check if a PNG base64 string represents a mostly-black/empty image.
 * A real screenshot of a 1920x1080 display is typically 500KB+ in base64.
 * An all-black PNG compresses to ~10-15KB.
 */
function isLikelyBlackScreen(base64: string): boolean {
  // All-black PNGs are extremely small because they compress very well.
  // A 1920x1080 all-black PNG is ~10KB base64 (~7KB raw).
  // A real screenshot would be at least 50-100KB+ base64.
  if (base64.length < 30000) {
    return true;
  }
  return false;
}

export async function GET(req: Request) {
  let tempScriptPath: string | null = null;
  try {
    // ?context=1 → skip the bitmap capture and just return the desktop
    // context (foreground window + process). Used by /api/screen/describe
    // when it has an image but can't caption it (no HF key, HF down).
    if (new URL(req.url).searchParams.get("context") === "1") {
      const context = await getDesktopContext();
      return NextResponse.json({
        success: true,
        image: null,
        desktopContext: context,
        fallback: true,
        timestamp: new Date().toISOString(),
      });
    }

    // Write the PS script to a temp file so $variables are preserved.
    const psScript = [
      "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
      "$Screen   = [System.Windows.Forms.Screen]::PrimaryScreen",
      "$Bitmap   = New-Object System.Drawing.Bitmap $Screen.Bounds.Width, $Screen.Bounds.Height",
      "$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)",
      "try {",
      "    $Graphics.CopyFromScreen($Screen.Bounds.Left, $Screen.Bounds.Top, 0, 0, $Bitmap.Size)",
      "} catch {",
      "    Write-Error 'CopyFromScreen failed - handle invalid'",
      "}",
      "$MS       = New-Object System.IO.MemoryStream",
      "$Bitmap.Save($MS, [System.Drawing.Imaging.ImageFormat]::Png)",
      "$Base64   = [Convert]::ToBase64String($MS.ToArray())",
      "$Bitmap.Dispose()",
      "$Graphics.Dispose()",
      "$MS.Dispose()",
      "Write-Output $Base64",
    ].join("\r\n");

    tempScriptPath = path.join(
      os.tmpdir(),
      `jarvis_ss_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`
    );
    await fs.writeFile(tempScriptPath, psScript, "utf8");

    const { stdout, stderr } = await execAsync(
      `powershell -NonInteractive -File "${tempScriptPath}"`,
      { maxBuffer: 1024 * 1024 * 20, timeout: 15000 }
    );

    const base64 = (stdout || "").trim();

    // If capture failed completely or returned a black screen, use context fallback
    if (!base64 || isLikelyBlackScreen(base64)) {
      console.warn(
        `[screenshot/capture] Black/empty screen detected (base64 length: ${base64.length}). ` +
        `Using desktop context fallback.`
      );

      const context = await getDesktopContext();

      return NextResponse.json({
        success: true,
        image: null,
        desktopContext: context,
        fallback: true,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      image: base64,
      fallback: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[screenshot/capture] error:", error);

    // Even on error, try to get desktop context
    const context = await getDesktopContext();
    if (context && context !== "Unable to retrieve desktop context") {
      return NextResponse.json({
        success: true,
        image: null,
        desktopContext: context,
        fallback: true,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json(
      { success: false, error: "Failed to capture screenshot", details: String(error) },
      { status: 500 }
    );
  } finally {
    if (tempScriptPath) {
      fs.unlink(tempScriptPath).catch(() => {});
    }
  }
}
