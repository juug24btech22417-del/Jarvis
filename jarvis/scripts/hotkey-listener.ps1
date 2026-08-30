# JARVIS System-wide Screen Capture & Vision Analysis Daemon
# Listens globally for Ctrl+Shift+S, captures the screen, POSTs to Next.js API, and speaks the analysis.

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
    private int _id = 999;
    public bool Triggered = false;

    public HotkeyWindow()
    {
        CreateHandle(new CreateParams());
    }

    public void Register(uint modifiers, uint key)
    {
        RegisterHotKey(Handle, _id, modifiers, key);
    }

    protected override void WndProc(ref Message m)
    {
        base.WndProc(ref m);
        if (m.Msg == WM_HOTKEY)
        {
            Triggered = true;
        }
    }

    public void Dispose()
    {
        UnregisterHotKey(Handle, _id);
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
function Handle-Screenshot {
    Write-Host "[JARVIS] Processing hotkey trigger..."
    $Speak.Speak("Screen captured, analyzing.", 1)
    Show-Notification "JARVIS Screen Capture" "Analyzing screen content..."

    try {
        # Capture Primary Screen Bounds
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        $Screen   = [System.Windows.Forms.Screen]::PrimaryScreen
        $Bitmap   = New-Object System.Drawing.Bitmap $Screen.Bounds.Width, $Screen.Bounds.Height
        $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
        $Graphics.CopyFromScreen($Screen.Bounds.Left, $Screen.Bounds.Top, 0, 0, $Bitmap.Size)
        
        # Save to memory stream as PNG base64
        $MS       = New-Object System.IO.MemoryStream
        $Bitmap.Save($MS, [System.Drawing.Imaging.ImageFormat]::Png)
        $Base64   = [Convert]::ToBase64String($MS.ToArray())
        
        # Dispose objects immediately
        $Bitmap.Dispose()
        $Graphics.Dispose()
        $MS.Dispose()
        
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
        Write-Host "[JARVIS] Sending screen payload to $uri..."
        
        # Send HTTP POST payload
        $Body = @{ image = $Base64 } | ConvertTo-Json -Compress
        $Response = Invoke-RestMethod -Uri $uri -Method Post -ContentType "application/json" -Body $Body -TimeoutSec 20
        
        if ($Response.success) {
            $analysis = $Response.analysis
            Write-Host "[JARVIS] Analysis response: $analysis"
            Show-Notification "JARVIS Observation" $analysis
            $Speak.Speak($analysis, 1)
        } else {
            $Speak.Speak("I encountered an issue analyzing your screen.", 1)
            Show-Notification "JARVIS Error" "Screen analysis API failed."
        }
    } catch {
        Write-Error $_
        $Speak.Speak("Apologies, I failed to capture your screen.", 1)
        Show-Notification "JARVIS Error" "Failed to capture or analyze screen."
    }
}

# 5. Initialize global listener
$global:window = New-Object HotkeyWindow
# Register modifier keys: Control (0x0002) + Shift (0x0004) = 6
# Virtual key code for 'S' key is 83 (0x53)
$global:window.Register(6, 83)

Write-Host "=========================================================="
Write-Host "JARVIS Global Screen Analysis Daemon Active"
Write-Host "Press Ctrl + Shift + S on any screen/application to trigger."
Write-Host "Press Ctrl + C in this terminal to exit."
Write-Host "=========================================================="

# Speak greeting
$Speak.Speak("System screen analysis active. Press Control Shift S at any time.", 1)
Show-Notification "JARVIS Screen Agent" "Screen analysis system is running. Press Ctrl+Shift+S to analyze your active screen."

# 6. Infinite message pumping loop
try {
    while ($true) {
        [System.Windows.Forms.Application]::DoEvents()
        if ($global:window.Triggered) {
            $global:window.Triggered = $false
            Handle-Screenshot
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
    Write-Host "[JARVIS] Screen Analysis Listener stopped cleanly."
}
