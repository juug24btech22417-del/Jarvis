# Smoke test for the Circle to Search UX path.
#
# The overlay math and the result card are covered by
# scripts/clipboard-cards-smoke.ps1, and the vision + Google routing by
# scripts/e2e-circle-search.mjs. Neither touches the wiring in between. This
# does, by starting the watcher exactly the way `npm run clipboard` does and
# driving it through the three things a user actually does:
#
#   1. hotkey -> draw -> answer card appears
#   2. hotkey -> draw -> Esc  while it is thinking -> search aborted
#   3. hotkey -> draw -> hotkey again while it is thinking -> screen re-dims
#
# The screen dims for a few seconds while it runs - that is the feature
# working, not a bug. Input is injected through the real Windows input queue
# (keybd_event / mouse_event), and every synthetic mouse event goes to the
# overlay, which is fullscreen and topmost; the drawing checks are skipped
# entirely if the overlay never opened, so this can never click on your desktop.
#
# This drives the default ctrl+alt+s; if CIRCLE_HOTKEY is customised it verifies
# registration and skips the input checks rather than failing.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts/circle-hotkey-smoke.ps1
# Close any other running watcher first: only one process can own the hotkey.
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SmokeDpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
public static class SmokeInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern IntPtr FindWindow(string cls, string title);
    public const uint LEFTDOWN = 0x0002;
    public const uint LEFTUP = 0x0004;
    public const uint KEYUP = 0x0002;
}
"@ -WarningAction SilentlyContinue

# Must happen before anything queries the screen, so the cursor coordinates we
# send are the same physical pixels the DPI-aware watcher crops from.
[void][SmokeDpi]::SetProcessDPIAware()

$fails = 0
function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  OK   $name" } else { Write-Host "  FAIL $name $detail"; $script:fails++ }
}

$jarvisRoot = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $jarvisRoot "scratch"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$log = Join-Path $logDir "circle-hotkey-smoke.log"
$errLog = Join-Path $logDir "circle-hotkey-smoke.err"
foreach ($f in @($log, $errLog)) { if (Test-Path $f) { Remove-Item $f -Force -ErrorAction SilentlyContinue } }

function Get-Log {
    if (Test-Path $log) { return (Get-Content $log -Raw -ErrorAction SilentlyContinue) }
    return ""
}

function Wait-For([string]$pattern, [int]$tries) {
    for ($i = 0; $i -lt $tries; $i++) {
        Start-Sleep -Milliseconds 400
        if ((Get-Log) -match $pattern) { return $true }
    }
    return $false
}

# Count occurrences, so repeated cycles can wait for "one MORE of these"
# instead of re-matching a line an earlier cycle already logged.
function Get-LogCount([string]$pattern) {
    return ([regex]::Matches((Get-Log), [regex]::Escape($pattern))).Count
}

function Wait-ForCount([string]$pattern, [int]$min, [int]$tries) {
    for ($i = 0; $i -lt $tries; $i++) {
        Start-Sleep -Milliseconds 400
        if ((Get-LogCount $pattern) -ge $min) { return $true }
    }
    return $false
}

# ── Synthetic input through the real Windows input queue ────────────────────
# keybd_event (not SendKeys) so the keys go through the system input queue the
# same way a keyboard does: global hotkeys fire, and a held key is down long
# enough that a 20ms poll cannot miss it.
function Send-CircleHotkey {
    [SmokeInput]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)              # Ctrl down
    [SmokeInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)              # Alt down
    Start-Sleep -Milliseconds 40
    [SmokeInput]::keybd_event(0x53, 0, 0, [UIntPtr]::Zero)              # S down
    Start-Sleep -Milliseconds 60
    [SmokeInput]::keybd_event(0x53, 0, [SmokeInput]::KEYUP, [UIntPtr]::Zero)
    [SmokeInput]::keybd_event(0x12, 0, [SmokeInput]::KEYUP, [UIntPtr]::Zero)
    [SmokeInput]::keybd_event(0x11, 0, [SmokeInput]::KEYUP, [UIntPtr]::Zero)
}

function Send-Escape {
    [SmokeInput]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    [SmokeInput]::keybd_event(0x1B, 0, [SmokeInput]::KEYUP, [UIntPtr]::Zero)
}

function Draw-Circle {
    $pts = Get-CirclePoints
    [void][SmokeInput]::SetCursorPos($pts[0].x, $pts[0].y)
    Start-Sleep -Milliseconds 250
    [SmokeInput]::mouse_event([SmokeInput]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
    foreach ($p in $pts) {
        [void][SmokeInput]::SetCursorPos($p.x, $p.y)
        Start-Sleep -Milliseconds 45
    }
    [SmokeInput]::mouse_event([SmokeInput]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
}

# Wait for the draw overlay to actually exist before sending mouse events.
#
# "freezing the screen" is logged BEFORE the frame is fetched and decoded, so a
# fixed sleep raced the overlay: on a slower frame the first drag landed on the
# desktop instead, and the check failed for a reason the user would never hit.
# The overlay names its window, so ask Windows whether it is up.
function Wait-Overlay([int]$tries = 60) {
    for ($i = 0; $i -lt $tries; $i++) {
        if ([SmokeInput]::FindWindow($null, "JARVIS Circle to Search") -ne [IntPtr]::Zero) {
            Start-Sleep -Milliseconds 120
            return $true
        }
        Start-Sleep -Milliseconds 100
    }
    return $false
}

# A circle in the middle of the screen, whatever its size: 12 points around an
# ellipse sized as a fraction of the virtual screen.
function Get-CirclePoints {
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $cx = $vs.Left + [int]($vs.Width / 2)
    $cy = $vs.Top + [int]($vs.Height / 2)
    $rx = [int]($vs.Width * 0.12)
    $ry = [int]($vs.Height * 0.16)
    $pts = @()
    for ($i = 0; $i -le 12; $i++) {
        $a = ($i / 12.0) * 2 * [Math]::PI
        $pts += @{
            x = $cx + [int]($rx * [Math]::Cos($a))
            y = $cy + [int]($ry * [Math]::Sin($a))
        }
    }
    return $pts
}

$proc = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts\clipboard-watcher.ps1") `
    -WorkingDirectory $jarvisRoot -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError $errLog

try {
    Write-Host "Starting the watcher exactly like 'npm run clipboard' (pid $($proc.Id))..."

    if (-not (Wait-For "Circle to search ready" 40)) {
        $text = Get-Log
        if ($text -match "already taken by another app") {
            Check "the circle hotkey could be registered" $false "- another app owns it"
            Write-Host "  (close the other JARVIS watcher, then re-run this smoke test)"
        } elseif ($text -match "not understood") {
            Check "CIRCLE_HOTKEY parses" $false "- check CIRCLE_HOTKEY in .env.local"
        } else {
            Check "the watcher boots and registers the hotkey" $false "- no 'ready' line in the log"
        }
        return
    }
    Check "the watcher registers the circle hotkey" $true

    $hk = ""
    if ((Get-Log) -match "press (\S+) and draw") { $hk = $Matches[1] }
    if ($hk -and $hk.ToLower() -ne "ctrl+alt+s") {
        Write-Host "  NOTE  CIRCLE_HOTKEY is '$hk'; this smoke test drives the default ctrl+alt+s."
        Write-Host "        Registration is verified above - skipping the synthetic input checks."
        return
    }

    # ── 1. the normal gesture: hotkey, draw, release, card ──────────────────
    Send-CircleHotkey
    $overlayOpen = Wait-For "freezing the screen" 25
    Check "the hotkey opens the draw overlay" $overlayOpen

    if (-not $overlayOpen) {
        Write-Host "  SKIP  input checks - the overlay never opened, so nothing was clicked"
        Send-Escape
        return
    }

    [void](Wait-Overlay)
    Draw-Circle
    Check "a drawn loop is accepted and sent to the server" (Wait-For "looking at a" 40)
    Check "the server answers with a circle result" (Wait-For "JARVIS - " 150)
    Check "no failures in the watcher log" ((Get-Log) -notmatch "Circle to search failed")

    # ── 2. Esc while the model is thinking aborts the search ───────────────
    $freezes = Get-LogCount "freezing the screen"
    Send-CircleHotkey
    $ok = Wait-ForCount "freezing the screen" ($freezes + 1) 25
    Check "the hotkey opens the overlay for a second circle" $ok
    if ($ok) {
        [void](Wait-Overlay)
        Draw-Circle
        Start-Sleep -Milliseconds 700   # the request is in flight by now
        Send-Escape
        $cancelled = Wait-ForCount "cancelled with Esc" 1 25
        Check "Esc while it is thinking aborts the search" $cancelled
        if (-not $cancelled) { Write-Host "  (see the log - the answer may have landed before Esc did)" }
    }

    # ── 3. the hotkey while it is thinking re-dims for a fresh circle ──────
    $freezes = Get-LogCount "freezing the screen"
    Send-CircleHotkey
    $ok = Wait-ForCount "freezing the screen" ($freezes + 1) 25
    Check "the hotkey opens the overlay for a third circle" $ok
    if ($ok) {
        [void](Wait-Overlay)
        Draw-Circle
        Start-Sleep -Milliseconds 700
        $freezes = Get-LogCount "freezing the screen"
        Send-CircleHotkey
        Check "the hotkey during the search re-freezes the screen" (Wait-ForCount "freezing the screen" ($freezes + 1) 30)
        Check "the redraw is logged as a redraw" (Wait-For "redraw requested" 10)
        Start-Sleep -Milliseconds 400
        Send-Escape
        Start-Sleep -Milliseconds 600
    }

    Write-Host ""
    Write-Host "  watcher log:"
    (Get-Log) -split "`r?`n" | Where-Object { $_ -match "^\[" } | Select-Object -Last 14 | ForEach-Object { Write-Host "    $_" }
} finally {
    if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
    Start-Sleep -Milliseconds 600
    Write-Host ""
    if ($fails -gt 0) { Write-Host "$fails FAILED"; exit 1 } else { Write-Host "HOTKEY CHECKS PASSED"; exit 0 }
}
