# JARVIS System-wide Clipboard Assistant
# ------------------------------------------------------------------
# Watches the Windows clipboard EVERYWHERE on the laptop. When you copy new
# text it first shows a small ASK-FIRST prompt next to your cursor:
#
#     JARVIS  -  Copied from chrome - Stack Overflow
#     "how do I reverse a list in python"
#     [ Ask JARVIS ]  [ Dismiss ]
#
# Nothing is sent to the language models until YOU click "Ask JARVIS". Then
# JARVIS decides what you actually need - an answer to a question, code, a fix
# for an error, a translation, or a plain explanation - and shows the result in
# a small ALWAYS-ON-TOP POPUP right where you are working. No browser needed.
#
# If the JARVIS tab is also open, the answer offer appears there too, and the
# full breakdown opens when you click it.
#
# Run:  npm run clipboard      (from the jarvis/ folder)
# Stop: Ctrl + C
#
# Configuration comes from .env.local (nothing is hardcoded):
#   CLIPBOARD_ASSIST=on|off           master switch (default on)
#   CLIPBOARD_ASK_FIRST=on|off        show the "Ask JARVIS?" prompt first
#                                     instead of answering automatically (default on)
#   CLIPBOARD_POPUP=on|off            popup near cursor (default on)
#   CLIPBOARD_POPUP_POS=pointer|topright|bottomright|topleft|bottomleft
#   CLIPBOARD_POPUP_WIDTH=<px>        popup width (default 440)
#   CLIPBOARD_POPUP_TIMEOUT_MS=<ms>   auto-hide after this (0 = never, default 30000)
#   CLIPBOARD_POPUP_OFFSET=<px>       gap from the cursor / screen edge (default 18)
#   CLIPBOARD_MIN_CHARS=<number>      ignore clips shorter than this (default 3)
#   CLIPBOARD_MAX_CHARS=<number>      ignore clips longer than this (default 8000)
#   CLIPBOARD_POLL_MS=<number>        clipboard poll interval (default 700)
#   NEXT_PUBLIC_API_URL=http://localhost:<port>   server + "Open JARVIS" target
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 files as
# ANSI unless they carry a UTF-8 BOM, so a stray em-dash inside a string here
# would decode to a quote and break parsing.

$ErrorActionPreference = "SilentlyContinue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

# A borderless, top-most window that never steals focus from the app you are
# working in (WS_EX_NOACTIVATE + ShowWithoutActivation).
Add-Type -TypeDefinition @"
using System;
using System.Windows.Forms;
public class JarvisPopup : Form {
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams {
        get {
            CreateParams cp = base.CreateParams;
            cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
            return cp;
        }
    }
}
"@ -ReferencedAssemblies System.Windows.Forms, System.Drawing -WarningAction SilentlyContinue

# Win32 helpers so we can report WHERE the copy came from (foreground app).
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
"@ -WarningAction SilentlyContinue

# ---------------------------------------------------------------------------
# Settings from .env.local
# ---------------------------------------------------------------------------
$Script:Env = @{}
if (Test-Path ".env.local") {
    foreach ($line in Get-Content ".env.local") {
        if ($line -match "^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$") {
            $Script:Env[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
        }
    }
}
function Get-Setting([string]$name, [string]$fallback) {
    if ($Script:Env.ContainsKey($name) -and $Script:Env[$name] -ne "") { return $Script:Env[$name] }
    return $fallback
}

$apiBase = Get-Setting "NEXT_PUBLIC_API_URL" "http://localhost:3000"
$Script:Uri = "$apiBase/api/clipboard/capture"
$Script:SuppressUri = $Script:Uri
$Script:OpenUrl = Get-Setting "CLIPBOARD_OPEN_URL" $apiBase

$assistEnabled = (Get-Setting "CLIPBOARD_ASSIST" "on").ToLower() -ne "off"
$askFirst      = (Get-Setting "CLIPBOARD_ASK_FIRST" "on").ToLower() -ne "off"
$popupEnabled  = (Get-Setting "CLIPBOARD_POPUP" "on").ToLower() -ne "off"
$popupPos      = (Get-Setting "CLIPBOARD_POPUP_POS" "pointer").ToLower()
$popupWidth    = [int](Get-Setting "CLIPBOARD_POPUP_WIDTH" "440")
$popupTimeout  = [int](Get-Setting "CLIPBOARD_POPUP_TIMEOUT_MS" "30000")
$popupOffset   = [int](Get-Setting "CLIPBOARD_POPUP_OFFSET" "18")
$script:MinLen = [int](Get-Setting "CLIPBOARD_MIN_CHARS" "3")
$script:MaxLen = [int](Get-Setting "CLIPBOARD_MAX_CHARS" "8000")
$script:PollMs = [int](Get-Setting "CLIPBOARD_POLL_MS" "700")

# Shared colors.
$Script:Bg    = [System.Drawing.Color]::FromArgb(9, 12, 20)
$Script:Panel = [System.Drawing.Color]::FromArgb(16, 20, 30)
$Script:Fg    = [System.Drawing.Color]::FromArgb(228, 238, 248)
$Script:Dim   = [System.Drawing.Color]::FromArgb(140, 155, 172)
$Script:Cyan  = [System.Drawing.Color]::FromArgb(80, 216, 255)

function Write-Log([string]$message) {
    Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $message)
}

# ---------------------------------------------------------------------------
# Where did this copy come from? (best effort)
# ---------------------------------------------------------------------------
function Get-CopySource {
    try {
        $h = [JarvisWin]::GetForegroundWindow()
        if ($h -eq [IntPtr]::Zero) { return "" }
        $procId = 0
        [void][JarvisWin]::GetWindowThreadProcessId($h, [ref]$procId)
        if (-not $procId) { return "" }
        $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if (-not $p) { return "" }
        $name = [string]$p.ProcessName
        $title = [string]$p.MainWindowTitle
        if ($title.Length -gt 70) { $title = $title.Substring(0, 67) + "..." }
        if ($title) { return "$name - $title" }
        return $name
    } catch {
        return ""
    }
}

# Pull a short, human label out of the raw source string.
function Get-SourceLabel([string]$source) {
    if (-not $source) { return "your clipboard" }
    # "chrome - Stack Overflow - Google Chrome" -> keep the first two parts.
    $parts = $source.Split("-")
    if ($parts.Length -ge 2) {
        return (($parts[0..1] | ForEach-Object { $_.Trim() }) -join " - ")
    }
    return $source
}

# ---------------------------------------------------------------------------
# Tray toast (fallback when the popup is disabled)
# ---------------------------------------------------------------------------
$Script:balloon = $null
function Show-Toast([string]$title, [string]$text) {
    try {
        if (-not $Script:balloon) {
            $Script:balloon = New-Object System.Windows.Forms.NotifyIcon
            $Script:balloon.Icon = [System.Drawing.SystemIcons]::Information
            $Script:balloon.Visible = $true
        }
        if ($text.Length -gt 250) { $text = $text.Substring(0, 247) + "..." }
        $Script:balloon.BalloonTipTitle = $title
        $Script:balloon.BalloonTipText = $text
        $Script:balloon.ShowBalloonTip(7000)
    } catch {}
}

# ---------------------------------------------------------------------------
# Cursor-adjacent placement (shared)
# ---------------------------------------------------------------------------
function Get-PopupLocation([int]$w, [int]$h) {
    $cursor = [System.Windows.Forms.Cursor]::Position
    $work = [System.Windows.Forms.Screen]::FromPoint($cursor).WorkingArea
    switch ($popupPos) {
        "topright"    { $x = $work.Right - $w - $popupOffset; $y = $work.Top + $popupOffset }
        "bottomright" { $x = $work.Right - $w - $popupOffset; $y = $work.Bottom - $h - $popupOffset }
        "topleft"     { $x = $work.Left + $popupOffset; $y = $work.Top + $popupOffset }
        "bottomleft"  { $x = $work.Left + $popupOffset; $y = $work.Bottom - $h - $popupOffset }
        default       { $x = $cursor.X + $popupOffset; $y = $cursor.Y + $popupOffset }
    }
    # Keep it fully on-screen.
    if ($x + $w -gt $work.Right)  { $x = $work.Right - $w - $popupOffset }
    if ($y + $h -gt $work.Bottom) { $y = $work.Bottom - $h - $popupOffset }
    if ($x -lt $work.Left) { $x = $work.Left + $popupOffset }
    if ($y -lt $work.Top)  { $y = $work.Top + $popupOffset }
    return @{ x = [int]$x; y = [int]$y }
}

function New-JarvisButton([string]$caption, [int]$bx, [int]$by, [int]$bw, [bool]$primary) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $caption
    $b.FlatStyle = "Flat"
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(70, 90, 110)
    $b.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $b.Location = New-Object System.Drawing.Point -ArgumentList $bx, $by
    $b.Size = New-Object System.Drawing.Size -ArgumentList $bw, 30
    $b.ForeColor = [System.Drawing.Color]::White
    if ($primary) { $b.BackColor = [System.Drawing.Color]::FromArgb(14, 116, 144) }
    else { $b.BackColor = [System.Drawing.Color]::FromArgb(28, 34, 46) }
    return $b
}

# ---------------------------------------------------------------------------
# Stage 1 - the "Ask JARVIS?" prompt (nothing is analysed yet)
# ---------------------------------------------------------------------------
$Script:askPopup = $null
$Script:askTimer = $null
$Script:askHideAt = $null
$Script:askText = ""
$Script:askSource = ""
$script:pendingAsk = $null

function Close-AskPrompt {
    try { if ($Script:askTimer) { $Script:askTimer.Stop(); $Script:askTimer.Dispose() } } catch {}
    $Script:askTimer = $null
    try { if ($Script:askPopup) { $Script:askPopup.Close(); $Script:askPopup.Dispose() } } catch {}
    $Script:askPopup = $null
    $Script:askHideAt = $null
}

# A tiny, quiet card: click it to ask, click anywhere else to dismiss. No
# buttons, no panel - just one line of text that gets out of your way.
function Show-AskPrompt([string]$text, [string]$source) {
    try {
        Close-AskPrompt
        Close-JarvisPopup

        $w = 360
        $h = 96
        $form = New-Object JarvisPopup
        $form.Text = "JARVIS"
        $form.BackColor = $Script:Bg
        $form.FormBorderStyle = "None"
        $form.ShowInTaskbar = $false
        $form.TopMost = $true
        $form.StartPosition = "Manual"
        $form.ClientSize = New-Object System.Drawing.Size -ArgumentList $w, $h
        $form.Cursor = [System.Windows.Forms.Cursors]::Hand

        $label = Get-SourceLabel $source

        $head = New-Object System.Windows.Forms.Label
        $head.Text = "JARVIS  -  ask about this?"
        $head.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 9)
        $head.ForeColor = $Script:Cyan
        $head.BackColor = $Script:Bg
        $head.AutoSize = $false
        $head.Location = New-Object System.Drawing.Point -ArgumentList 12, 8
        $head.Size = New-Object System.Drawing.Size -ArgumentList ($w - 24), 18
        $head.Cursor = [System.Windows.Forms.Cursors]::Hand
        $form.Controls.Add($head)

        $src = New-Object System.Windows.Forms.Label
        $src.Text = "Copied from $label"
        $src.Font = New-Object System.Drawing.Font("Segoe UI", 8)
        $src.ForeColor = $Script:Dim
        $src.BackColor = $Script:Bg
        $src.AutoSize = $false
        $src.Location = New-Object System.Drawing.Point -ArgumentList 12, 26
        $src.Size = New-Object System.Drawing.Size -ArgumentList ($w - 24), 16
        $src.Cursor = [System.Windows.Forms.Cursors]::Hand
        $form.Controls.Add($src)

        $oneLine = $text.Trim().Replace("`r", " ").Replace("`n", " ")
        if ($oneLine.Length -gt 96) { $oneLine = $oneLine.Substring(0, 93) + "..." }
        $prev = New-Object System.Windows.Forms.Label
        $prev.Text = "`"$oneLine`""
        $prev.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Italic)
        $prev.ForeColor = $Script:Fg
        $prev.BackColor = $Script:Bg
        $prev.AutoSize = $false
        $prev.Location = New-Object System.Drawing.Point -ArgumentList 12, 44
        $prev.Size = New-Object System.Drawing.Size -ArgumentList ($w - 24), 20
        $prev.Cursor = [System.Windows.Forms.Cursors]::Hand
        $form.Controls.Add($prev)

        $hint = New-Object System.Windows.Forms.Label
        $hint.Text = "Click to ask  -  click away to dismiss"
        $hint.Font = New-Object System.Drawing.Font("Segoe UI", 8)
        $hint.ForeColor = $Script:Dim
        $hint.BackColor = $Script:Bg
        $hint.AutoSize = $false
        $hint.Location = New-Object System.Drawing.Point -ArgumentList 12, 70
        $hint.Size = New-Object System.Drawing.Size -ArgumentList ($w - 24), 16
        $hint.Cursor = [System.Windows.Forms.Cursors]::Hand
        $form.Controls.Add($hint)

        $Script:askText = $text
        $Script:askSource = $source

        # Clicking ANYWHERE on the card asks JARVIS.
        $proceed = {
            $Script:pendingAsk = @{ text = $Script:askText; source = $Script:askSource }
            Close-AskPrompt
        }
        $form.Add_Click($proceed)
        $head.Add_Click($proceed)
        $src.Add_Click($proceed)
        $prev.Add_Click($proceed)
        $hint.Add_Click($proceed)

        $loc = Get-PopupLocation $w $h
        $form.Location = New-Object System.Drawing.Point -ArgumentList $loc.x, $loc.y
        $form.Show()
        $Script:askPopup = $form
        if ($popupTimeout -gt 0) { $Script:askHideAt = (Get-Date).AddMilliseconds($popupTimeout) }

        # Click-away dismissal. The card never takes focus, so watch the global
        # mouse buttons on a fast timer and close the moment a click lands
        # outside our bounds.
        $timer = New-Object System.Windows.Forms.Timer
        $timer.Interval = 60
        $timer.Add_Tick({
            try {
                if (-not $Script:askPopup) { Close-AskPrompt; return }
                $btns = [System.Windows.Forms.Control]::MouseButtons
                if ($btns -ne [System.Windows.Forms.MouseButtons]::None) {
                    $cursor = [System.Windows.Forms.Cursor]::Position
                    if (-not $Script:askPopup.Bounds.Contains($cursor)) { Close-AskPrompt }
                }
            } catch {}
        })
        $timer.Start()
        $Script:askTimer = $timer

        Write-Log "Ask prompt shown for a clip from '$(Get-SourceLabel $source)'."
    } catch {
        Write-Log "Ask prompt failed: $($_.Exception.Message)"
        # Worst case: don't lose the feature - go straight to the answer.
        $script:pendingAsk = @{ text = $text; source = $source }
    }
}

# ---------------------------------------------------------------------------
# Stage 2 - the answer popup
# ---------------------------------------------------------------------------
$Script:popup = $null
$Script:popupAnswer = ""
$Script:popupHideAt = $null

function Close-JarvisPopup {
    try { if ($Script:popup) { $Script:popup.Close(); $Script:popup.Dispose() } } catch {}
    $Script:popup = $null
    $Script:popupHideAt = $null
}

function Show-JarvisPopup($resp) {
    try {
        Close-JarvisPopup

        $w = $popupWidth
        $hasCode = [bool]($resp.code)
        if ($hasCode) { $h = 470 } else { $h = 380 }
        $form = New-Object JarvisPopup
        $form.Text = "JARVIS Clipboard Assistant"
        $form.BackColor = $Script:Bg
        $form.FormBorderStyle = "None"
        $form.ShowInTaskbar = $false
        $form.TopMost = $true
        $form.StartPosition = "Manual"
        $form.ClientSize = New-Object System.Drawing.Size -ArgumentList $w, $h

        $fromLabel = ""
        if ($resp.source) { $fromLabel = "  from " + (Get-SourceLabel ([string]$resp.source)) }

        $head = New-Object System.Windows.Forms.Label
        $head.Text = "JARVIS  -  $($resp.modeLabel)  [$($resp.category)]$fromLabel"
        $head.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)
        $head.ForeColor = $Script:Cyan
        $head.BackColor = $Script:Bg
        $head.AutoSize = $false
        $head.Location = New-Object System.Drawing.Point -ArgumentList 14, 12
        $head.Size = New-Object System.Drawing.Size -ArgumentList ($w - 28), 22
        $form.Controls.Add($head)

        $sub = New-Object System.Windows.Forms.Label
        $sub.Text = [string]$resp.summary
        $sub.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
        $sub.ForeColor = $Script:Fg
        $sub.BackColor = $Script:Bg
        $sub.AutoSize = $false
        $sub.Location = New-Object System.Drawing.Point -ArgumentList 14, 38
        $sub.Size = New-Object System.Drawing.Size -ArgumentList ($w - 28), 48
        $form.Controls.Add($sub)

        # The prose answer goes in a normal font. Code gets its OWN monospace
        # box with wrapping OFF and both scrollbars, so it keeps its real
        # formatting instead of collapsing into a wrapped paragraph.
        $answerBody = [string]$resp.answer
        if (-not $answerBody) { $answerBody = [string]$resp.summary }

        $answerBox = New-Object System.Windows.Forms.TextBox
        $answerBox.Multiline = $true
        $answerBox.ReadOnly = $true
        $answerBox.ScrollBars = "Vertical"
        $answerBox.BorderStyle = "None"
        $answerBox.BackColor = $Script:Panel
        $answerBox.ForeColor = $Script:Fg
        $answerBox.Font = New-Object System.Drawing.Font("Segoe UI", 9)
        $answerBox.Location = New-Object System.Drawing.Point -ArgumentList 14, 92
        if ($hasCode) { $answerBox.Size = New-Object System.Drawing.Size -ArgumentList ($w - 28), 190 }
        else { $answerBox.Size = New-Object System.Drawing.Size -ArgumentList ($w - 28), ($h - 152) }
        $answerBox.Text = $answerBody
        $form.Controls.Add($answerBox)

        $codeText = ""
        if ($hasCode) {
            $codeLang = ""
            if ($resp.language) { $codeLang = "  -  " + [string]$resp.language }

            $codeHead = New-Object System.Windows.Forms.Label
            $codeHead.Text = "CODE$codeLang"
            $codeHead.Font = New-Object System.Drawing.Font("Consolas", 8, [System.Drawing.FontStyle]::Bold)
            $codeHead.ForeColor = $Script:Cyan
            $codeHead.BackColor = $Script:Bg
            $codeHead.AutoSize = $false
            $codeHead.Location = New-Object System.Drawing.Point -ArgumentList 14, 286
            $codeHead.Size = New-Object System.Drawing.Size -ArgumentList ($w - 28), 16
            $form.Controls.Add($codeHead)

            $codeBox = New-Object System.Windows.Forms.TextBox
            $codeBox.Multiline = $true
            $codeBox.ReadOnly = $true
            $codeBox.WordWrap = $false
            $codeBox.AcceptsReturn = $true
            $codeBox.ScrollBars = "Both"
            $codeBox.BorderStyle = "None"
            $codeBox.BackColor = [System.Drawing.Color]::FromArgb(4, 8, 14)
            $codeBox.ForeColor = [System.Drawing.Color]::FromArgb(190, 230, 255)
            $codeBox.Font = New-Object System.Drawing.Font("Consolas", 9)
            $codeBox.Location = New-Object System.Drawing.Point -ArgumentList 14, 304
            $codeBox.Size = New-Object System.Drawing.Size -ArgumentList ($w - 28), ($h - 304 - 52)
            $codeBox.Text = [string]$resp.code
            $form.Controls.Add($codeBox)
            $codeText = [string]$resp.code
        }

        if ($codeText) { $Script:popupAnswer = $answerBody + "`r`n`r`n" + $codeText }
        else { $Script:popupAnswer = $answerBody }

        $btnCopy = New-JarvisButton "Copy" 14 ($h - 46) 90 $true
        $btnCopy.Add_Click({
            if ($Script:popupAnswer) {
                try { [System.Windows.Forms.Clipboard]::SetText($Script:popupAnswer) } catch {}
                # The main loop must ignore the clip we just wrote ourselves.
                $script:last = $Script:popupAnswer
                try {
                    $b = @{ action = "suppress"; text = $Script:popupAnswer } | ConvertTo-Json -Compress
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($b)
                    Invoke-RestMethod -Uri $Script:SuppressUri -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 10 | Out-Null
                } catch {}
            }
            Close-JarvisPopup
        })
        $form.Controls.Add($btnCopy)

        $btnOpen = New-JarvisButton "Open JARVIS" 112 ($h - 46) 110 $false
        $btnOpen.Add_Click({ try { Start-Process $Script:OpenUrl } catch {}; Close-JarvisPopup })
        $form.Controls.Add($btnOpen)

        $btnDismiss = New-JarvisButton "Dismiss" ($w - 104) ($h - 46) 90 $false
        $btnDismiss.Add_Click({ Close-JarvisPopup })
        $form.Controls.Add($btnDismiss)

        $loc = Get-PopupLocation $w $h
        $form.Location = New-Object System.Drawing.Point -ArgumentList $loc.x, $loc.y
        $form.Show()
        $Script:popup = $form
        if ($popupTimeout -gt 0) { $Script:popupHideAt = (Get-Date).AddMilliseconds($popupTimeout) }
        Write-Log "Answer popup shown at $($loc.x),$($loc.y)."
    } catch {
        Write-Log "Popup failed: $($_.Exception.Message)"
        Write-Log "  at $($_.InvocationInfo.PositionMessage -replace "`r`n", ' ')"
        Show-Toast "JARVIS - $($resp.modeLabel)" ([string]$resp.summary)
    }
}

# ---------------------------------------------------------------------------
# Server calls
# ---------------------------------------------------------------------------
$Script:warnedDown = $false

# Cheap pass: has the server already seen (and suppressed/answered) this clip?
function Test-Clip([string]$text, [string]$source) {
    try {
        $body = @{ text = $text; source = $source; action = "probe" } | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $resp = Invoke-RestMethod -Uri $Script:Uri -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 8
        if ($resp -and $resp.success -and $resp.proceed -eq $false) { return $false }
        return $true
    } catch {
        # Server unreachable - still offer, the real POST will report the error.
        return $true
    }
}

# Real work: analyse the clip and return the payload for the answer popup.
function Invoke-ClipAnalysis([string]$text, [string]$source) {
    $body = @{ text = $text; source = $source } | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    try {
        $resp = Invoke-RestMethod -Uri $Script:Uri -Method Post -ContentType "application/json; charset=utf-8" -Body $bytes -TimeoutSec 60
        if ($resp -and $resp.success) { return $resp }
        if ($resp -and $resp.skipped) { Write-Log "Server skipped this clip ($($resp.skipped))." }
        else { Write-Log "Server returned no result." }
    } catch {
        $status = ""
        if ($_.Exception.Response) { $status = " HTTP " + [int]$_.Exception.Response.StatusCode }
        Write-Log "Request failed$status - $($_.Exception.Message)"
        if (-not $Script:warnedDown) {
            $Script:warnedDown = $true
            Show-Toast "JARVIS Clipboard Assistant" "Could not reach the JARVIS server. Is 'npm run dev' running?"
        }
    }
    return $null
}

# ---------------------------------------------------------------------------
Write-Host "=========================================================="
Write-Host " JARVIS Clipboard Assistant - system-wide"
Write-Host " Watching every copy on this laptop. Press Ctrl+C to stop."
Write-Host " Endpoint:   $Script:Uri"
Write-Host " Assist:     $(if ($assistEnabled) { 'ON' } else { 'OFF' })   Ask first: $(if ($askFirst) { 'ON' } else { 'OFF' })   Popup: $(if ($popupEnabled) { $popupPos } else { 'off' })"
Write-Host " Length:     ${script:MinLen}-${script:MaxLen}   Poll: ${script:PollMs}ms"
Write-Host "=========================================================="

$serverReachable = $false
try {
    $probe = Invoke-WebRequest -Uri $Script:Uri -Method Get -TimeoutSec 5 -UseBasicParsing
    $serverReachable = $true
} catch {
    if ($_.Exception.Response) { $serverReachable = $true }
}
if ($serverReachable) {
    Write-Log "Dev server reachable at $apiBase."
} else {
    Write-Log "WARNING: no JARVIS dev server at $apiBase. Start it with 'npm run dev', then restart this watcher."
}

$script:last = ""
try { $script:last = [System.Windows.Forms.Clipboard]::GetText() } catch {}

# Analyse a clip and show the answer (used by both the ask-first and auto paths).
function Complete-Clip([string]$text, [string]$source) {
    Write-Log "Analysing clip ($($text.Trim().Length) chars, from '$(Get-SourceLabel $source)')..."
    $resp = Invoke-ClipAnalysis $text $source
    if ($resp) {
        Write-Log "JARVIS - $($resp.modeLabel) [$($resp.category)]"
        if ($popupEnabled) { Show-JarvisPopup $resp } else { Show-Toast "JARVIS - $($resp.modeLabel)" ([string]$resp.summary) }
    }
}

while ($true) {
    [System.Windows.Forms.Application]::DoEvents()
    if ($Script:popupHideAt -and (Get-Date) -gt $Script:popupHideAt) { Close-JarvisPopup }
    if ($Script:askHideAt -and (Get-Date) -gt $Script:askHideAt) { Close-AskPrompt }

    # The user clicked "Ask JARVIS" - now, and only now, spend the LLM call.
    if ($script:pendingAsk) {
        $ask = $script:pendingAsk
        $script:pendingAsk = $null
        Close-AskPrompt
        Complete-Clip ([string]$ask.text) ([string]$ask.source)
    }

    try {
        if ([System.Windows.Forms.Clipboard]::ContainsText()) {
            $text = [System.Windows.Forms.Clipboard]::GetText()
            if ($text -and $text -ne $script:last) {
                $script:last = $text
                $trimmedLen = ($text.Trim()).Length

                if (-not $assistEnabled) {
                    Write-Log "Copied $trimmedLen chars - assist is OFF (CLIPBOARD_ASSIST=off), skipping."
                } elseif ($trimmedLen -lt $script:MinLen) {
                    Write-Log "Copied $trimmedLen chars - below CLIPBOARD_MIN_CHARS ($script:MinLen), skipping."
                } elseif ($text.Length -gt $script:MaxLen) {
                    Write-Log "Copied $($text.Length) chars - above CLIPBOARD_MAX_CHARS ($script:MaxLen), skipping."
                } else {
                    $source = Get-CopySource
                    if ($askFirst -and -not (Test-Clip $text $source)) {
                        Write-Log "Server already handled this clip - not offering."
                    } elseif ($askFirst -and $popupEnabled) {
                        Write-Log "New clip ($trimmedLen chars) - offering 'Ask JARVIS?'"
                        Show-AskPrompt $text $source
                    } else {
                        Complete-Clip $text $source
                    }
                }
            }
        }
    } catch {
        # Clipboard locked by another process; retry on the next tick.
    }
    Start-Sleep -Milliseconds $script:PollMs
}
