import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function GET() {
  try {
    // PowerShell script to capture primary screen and return as base64
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms, System.Drawing
      $Screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $Width = $Screen.Bounds.Width
      $Height = $Screen.Bounds.Height
      $Left = $Screen.Bounds.Left
      $Top = $Screen.Bounds.Top
      $Bitmap = New-Object System.Drawing.Bitmap $Width, $Height
      $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
      $Graphics.CopyFromScreen($Left, $Top, 0, 0, $Bitmap.Size)
      $MS = New-Object System.IO.MemoryStream
      $Bitmap.Save($MS, [System.Drawing.Imaging.ImageFormat]::Png)
      $Base64 = [Convert]::ToBase64String($MS.ToArray())
      $Bitmap.Dispose()
      $Graphics.Dispose()
      $MS.Dispose()
      $Base64
    `.trim();

    // Execute PowerShell command
    // We use a large buffer because the base64 string will be large
    const { stdout, stderr } = await execAsync(`powershell -Command "${psScript.replace(/\n/g, '; ')}"`, {
      maxBuffer: 1024 * 1024 * 20 // 20MB buffer
    });

    if (stderr && !stdout) {
      throw new Error(`PowerShell error: ${stderr}`);
    }

    const base64 = stdout.trim();

    return NextResponse.json({
      success: true,
      image: base64,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Screenshot capture error:", error);
    return NextResponse.json(
      { error: "Failed to capture screenshot", details: String(error) },
      { status: 500 }
    );
  }
}
