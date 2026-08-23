import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import fs from "fs/promises";

const execAsync = promisify(exec);

export async function GET() {
  let tempScriptPath: string | null = null;
  try {
    // Write the PS script to a temp file so $variables are preserved.
    // Running inline via -Command strips $ signs — this is the root fix.
    const psScript = [
      "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
      "$Screen   = [System.Windows.Forms.Screen]::PrimaryScreen",
      "$Bitmap   = New-Object System.Drawing.Bitmap $Screen.Bounds.Width, $Screen.Bounds.Height",
      "$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)",
      "$Graphics.CopyFromScreen($Screen.Bounds.Left, $Screen.Bounds.Top, 0, 0, $Bitmap.Size)",
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

    if (stderr && !stdout) {
      throw new Error(`PowerShell error: ${stderr}`);
    }

    const base64 = stdout.trim();
    if (!base64) {
      throw new Error("Empty output — screen capture may be blocked or display unavailable");
    }

    return NextResponse.json({
      success: true,
      image: base64,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[screenshot/capture] error:", error);
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
