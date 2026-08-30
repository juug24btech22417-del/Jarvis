# JARVIS System-wide Screen Capture & Vision Analysis Daemon
# Listens globally for:
#   - Ctrl + Shift + S: Region Capture Snipping & VLM Analysis (with Auto-Error Fix Clipboard Copy)
#   - Ctrl + Shift + T: Region Capture OCR & Clean Text Clipboard Copy

# Ensure we clean up previous window handles if re-run in same terminal session
if ($global:window) {
    try { $global:window.Dispose() } catch {}
    $global:window = $null
}
if ($global:balloon) {
    try { $global:balloon.Dispose() } catch {}
    $global:balloon = $null
}

# 1. Compile C# class for global Win32 RegisterHotKey hook
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class HotkeyWindow : NativeWindow, IDisposable
{
    [DllImport("user32.dll")]
    private static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

    [DllImport("user32.dll")]
    private static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    private const int WM_HOTKEY = 0x0312;
    public int TriggeredId = 0;

    public HotkeyWindow()
    {
        CreateHandle(new CreateParams());
    }

    public void Register(int id, uint modifiers, uint key)
    {
        RegisterHotKey(Handle, id, modifiers, key);
    }

    public void Unregister(int id)
    {
        UnregisterHotKey(Handle, id);
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg == WM_HOTKEY)
        {
            TriggeredId = (int)m.WParam;
        }
    }

    public void Dispose()
    {
        UnregisterHotKey(Handle, 999);
        UnregisterHotKey(Handle, 888);
        DestroyHandle();
    }
}
"@ -ReferencedAssemblies "System.Windows.Forms"

# 2. Speech Synthesizer & Speech API setup
$Speak = New-Object -ComObject SAPI.SpVoice

# 3. Notification helper using standard Windows Notification Icon
function Show-Notification ($title, $text) {
    try {
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        if (-not $global:balloon) {
            $global:balloon = New-Object System.Windows.Forms.NotifyIcon
            $global:balloon.Icon = [System.Drawing.SystemIcons]::Shield
            $global:balloon.Visible = $true
        }
        # Windows balloon tip limit is 256 characters
        $truncatedText = $text
        if ($truncatedText.Length -gt 250) {
            $truncatedText = $truncatedText.Substring(0, 247) + "..."
        }
        $global:balloon.BalloonTipTitle = $title
        $global:balloon.BalloonTipText = $truncatedText
        $global:balloon.ShowBalloonTip(7000)
    } catch {}
}

# 4. Screenshot and POST processing function
function Handle-Trigger ($triggerId) {
    $mode = "analyze"
    if ($triggerId -eq 888) {
        $mode = "ocr"
        Write-Host "[JARVIS] Processing OCR capture..."
        $Speak.Speak("Select text region to extract.", 1)
        Show-Notification "JARVIS OCR" "Draw a rectangle over the text you wish to copy..."
    } else {
        Write-Host "[JARVIS] Processing analysis capture..."
        $Speak.Speak("Select screen region to analyze.", 1)
        Show-Notification "JARVIS Screen Analysis" "Draw a rectangle over the target screen area..."
    }

    try {
        # Clear clipboard to detect new snip
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Clipboard]::Clear()

        # Trigger Windows Snipping Tool (dimmed overlay for custom region selection)
        Start-Process "ms-screenclip:"
        
        # Wait up to 15 seconds for user to draw the snippet
        $timeout = 15
        $elapsed = 0.0
        $img = $null
        while ($elapsed -lt $timeout) {
            if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
                $img = [System.Windows.Forms.Clipboard]::GetImage()
                break
            }
            Start-Sleep -Milliseconds 200
            $elapsed += 0.2
        }

        if (-not $img) {
            Write-Host "[JARVIS] Capture cancelled or timed out."
            $Speak.Speak("Capture cancelled.", 1)
            Show-Notification "JARVIS" "Capture timed out or cancelled."
            return
        }

        Write-Host "[JARVIS] Image grabbed from clipboard. Resizing and compressing..."
        $Speak.Speak("Analyzing.", 1)

        # Resize image to max 960px wide (keeps aspect ratio) to speed up upload & VLM reasoning
        Add-Type -AssemblyName System.Drawing
        $maxWidth = 960
        $origW = $img.Width
        $origH = $img.Height
        if ($origW -gt $maxWidth) {
            $scale   = $maxWidth / $origW
            $newW    = $maxWidth
            $newH    = [int]($origH * $scale)
        } else {
            $newW = $origW
            $newH = $origH
        }
        $resized = New-Object System.Drawing.Bitmap $newW, $newH
        $g = [System.Drawing.Graphics]::FromImage($resized)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($img, 0, 0, $newW, $newH)
        $g.Dispose()
        $img.Dispose()

        # Encode as JPEG at 55% quality — fast to transfer, highly readable for VLM
        $jpegCodec    = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
            [System.Drawing.Imaging.Encoder]::Quality, [long]55
        )
        $MS = New-Object System.IO.MemoryStream
        $resized.Save($MS, $jpegCodec, $encoderParams)
        $Base64 = [Convert]::ToBase64String($MS.ToArray())
        $resized.Dispose()
        $MS.Dispose()

        $payloadKB = [math]::Round($Base64.Length / 1024, 1)
        Write-Host "[JARVIS] Payload size: ${payloadKB} KB (${newW}x${newH} JPEG)"
        
        # Determine port from .env.local dynamically
        $port = 3000
        if (Test-Path ".env.local") {
            $envFile = Get-Content ".env.local"
            foreach ($line in $envFile) {
                if ($line -match "^NEXT_PUBLIC_API_URL=http://localhost:(\d+)") {
                    $port = $Matches[1]
                }
            }
        }
        
        $uri = "http://localhost:$port/api/screenshot/analyze"
        Write-Host "[JARVIS] Sending payload to $uri..."
        
        # Send HTTP POST — 90s timeout to comfortably handle vision model latency
        $Body = @{ image = $Base64; mode = $mode } | ConvertTo-Json -Compress
        try {
            $RawResponse = Invoke-WebRequest -Uri $uri -Method Post -ContentType "application/json" -Body $Body -TimeoutSec 90 -UseBasicParsing
        } catch {
            # Read the actual error body from the WebException
            $errStream = $_.Exception.Response.GetResponseStream()
            $errBody   = ""
            if ($errStream) {
                $reader  = New-Object System.IO.StreamReader($errStream)
                $errBody = $reader.ReadToEnd()
                $reader.Close()
            }
            Write-Host "[JARVIS] Server returned error: $($_.Exception.Message)"
            Write-Host "[JARVIS] Error details: $errBody"
            $Speak.Speak("Server error. Check the terminal for details.", 1)
            Show-Notification "JARVIS Error" "API returned an error. Check terminal."
            return
        }

        $Response = $RawResponse.Content | ConvertFrom-Json

        if ($Response.success) {
            $analysis = $Response.analysis
            Write-Host "[JARVIS] Response: $analysis"

            if ($mode -eq "ocr") {
                # Copy raw extracted text directly to clipboard
                [System.Windows.Forms.Clipboard]::SetText($analysis)
                Show-Notification "JARVIS OCR Success" "Text copied to clipboard."
                $Speak.Speak("Text copied to clipboard.", 1)
            } else {
                # Look for fix command patterns (Option 5)
                # Matches: FIX_COMMAND: <command>
                if ($analysis -match "(?i)FIX_COMMAND:\s*(.+)") {
                    $fixCommand = $Matches[1].Trim()
                    Write-Host "[JARVIS] Extracted Fix Command: $fixCommand"
                    
                    # Copy fix command directly to clipboard
                    [System.Windows.Forms.Clipboard]::SetText($fixCommand)
                    Show-Notification "JARVIS Error Fixer" "Suggested fix command copied to clipboard: $fixCommand"
                    $Speak.Speak("Issue detected. I have placed the suggested fix command on your clipboard.", 1)
                } else {
                    # Standard analysis mode - copy general response to clipboard for convenience
                    [System.Windows.Forms.Clipboard]::SetText($analysis)
                    Show-Notification "JARVIS Observation" $analysis
                    $Speak.Speak($analysis, 1)
                }
            }
        } else {
            $Speak.Speak("I encountered an issue analyzing your selection.", 1)
            Show-Notification "JARVIS Error" "VLM analysis API failed."
        }
    } catch {
        Write-Error $_
        $Speak.Speak("Apologies, I failed to process your selection.", 1)
        Show-Notification "JARVIS Error" "Failed to process screenshot."
    }
}

# 5. Initialize global listener
$global:window = New-Object HotkeyWindow
# Register Hotkeys:
# 999: Ctrl + Shift + S (Modifiers: Control (0x0002) + Shift (0x0004) = 6, VK: 'S' = 83)
$global:window.Register(999, 6, 83)
# 888: Ctrl + Shift + T (Modifiers: Control (0x0002) + Shift (0x0004) = 6, VK: 'T' = 84)
$global:window.Register(888, 6, 84)

Write-Host "=========================================================="
Write-Host "JARVIS Screen Capture Upgrades Active:"
Write-Host " - Ctrl + Shift + S : Region Snip & Analyze (Fix Auto-Copy)"
Write-Host " - Ctrl + Shift + T : Region Snip & OCR Text Extraction"
Write-Host "=========================================================="

# Speak greeting
$Speak.Speak("System screen analysis active.", 1)
Show-Notification "JARVIS Upgraded Screen Agent" "Press Ctrl+Shift+S to analyze selection or Ctrl+Shift+T to extract text."

# 6. Infinite message pumping loop
try {
    while ($true) {
        [System.Windows.Forms.Application]::DoEvents()
        if ($global:window.TriggeredId -ne 0) {
            $id = $global:window.TriggeredId
            $global:window.TriggeredId = 0
            Handle-Trigger $id
        }
        Start-Sleep -Milliseconds 100
    }
} finally {
    # Ensure window is unregistered and handles destroyed when script terminates
    if ($global:window) {
        $global:window.Dispose()
        $global:window = $null
    }
    if ($global:balloon) {
        $global:balloon.Dispose()
        $global:balloon = $null
    }
    Write-Host "[JARVIS] Screen Agent stopped cleanly."
}
