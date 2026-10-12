# JARVIS System-wide Clipboard Assistant
# ------------------------------------------------------------------
# Watches the Windows clipboard EVERYWHERE on the laptop. When you copy
# something, JARVIS first DETECTS what it is - no model call, no waiting:
#
#     JARVIS                                     Code detected
#     Copied from Code - app.ts
#     "export function total(items) { return items.reduce(..."
#     [ Fix ] [ Explain ] [ Optimize ] [ Test ]
#
# Only when you click one of those buttons does JARVIS do the work, and the
# result lands in a card next to the cursor with the answer, the code, and an
# "Apply on screen" button that pastes the fixed code straight over the code
# you copied - while you stay in the app you were working in.
#
# Kinds and buttons come from the server catalog (GET /api/clipboard/capture)
# so this script never duplicates the detection heuristics. If the server is
# unreachable a small built-in fallback keeps the basic Explain/Summarize
# buttons working.
#
# Run:   npm run clipboard      (from the jarvis/ folder)
# Stop:  Ctrl + C
#
# Configuration comes from .env.local (nothing is hardcoded):
#   CLIPBOARD_ASSIST=on|off           master switch (default on)
#   CLIPBOARD_ACTIONS=on|off          show detected-kind action buttons
#                                     (default on; off = old single "Ask
#                                     JARVIS" prompt)
#   CLIPBOARD_ASK_FIRST=on|off        ask before spending a model call. With
#                                     CLIPBOARD_ACTIONS=on the detection card
#                                     is always shown (it costs nothing); this
#                                     switch only controls the auto-answer path
#                                     when actions are off (default on)
#   CLIPBOARD_IMAGES=on|off           offer actions for copied images
#                                     (default on)
#   CLIPBOARD_APPLY_ON_SCREEN=on|off  allow "Apply on screen" to paste the
#                                     fixed code into the app you copied from
#                                     (default on)
#   CLIPBOARD_POPUP=on|off            card next to the cursor (default on)
#   CLIPBOARD_POPUP_POS=pointer|topright|bottomright|topleft|bottomleft
#   CLIPBOARD_POPUP_WIDTH=<px>        card width (default 320)
#   CLIPBOARD_POPUP_TIMEOUT_MS=<ms>   auto-hide after this (0 = never, default 30000)
#   CLIPBOARD_POPUP_OFFSET=<px>       gap from the cursor / screen edge (default 18)
#   CLIPBOARD_MIN_CHARS=<number>      ignore clips shorter than this (default 3)
#   CLIPBOARD_MAX_CHARS=<number>      ignore clips longer than this (default 8000)
#   CLIPBOARD_POLL_MS=<number>        clipboard poll interval (default 700)
#   NEXT_PUBLIC_API_URL=http://localhost:<port>   server + "Open JARVIS" target
#
#   --- Circle to Search (draw around anything on screen) ---
#   CIRCLE_TO_SEARCH=on|off           master switch (default on). While it is on,
#                                     pressing CIRCLE_HOTKEY freezes the screen
#                                     and lets you draw a freehand loop around
#                                     anything. JARVIS then says what it is,
#                                     answers it when it is a question / text /
#                                     code, and shows the matching Google
#                                     results (Shopping / Maps / Images / web)
#                                     in a card next to the cursor. Nothing
#                                     opens in a browser until you click it.
#   CIRCLE_HOTKEY=ctrl+alt+s          the drawing hotkey. Combine ctrl / alt /
#                                     shift (and win) with a letter, digit,
#                                     F1-F12, space, tab or enter. Avoid
#                                     ctrl+shift+s and ctrl+shift+t, which the
#                                     screen agent (npm run hotkey) already owns
#   CIRCLE_CAPTURE_WIDTH=<px>         crops are downscaled to this width before
#                                     being sent to the model (default 900)
#   CIRCLE_MAX_RESULTS=<1-6>          result rows shown on the card (default 4)
#   CIRCLE_TIMEOUT_SEC=<5-120>        give up on the answer after this and say
#                                     so (default 20)
#
#   While the answer is on its way: Esc aborts the search, and pressing
#   CIRCLE_HOTKEY again aborts it and re-freezes the screen for a fresh circle.
#
#   Server-side speed knobs (read by the app, not this script):
#   CIRCLE_VISION_TIMEOUT_MS          hard ceiling on the whole vision race
#                                     (default 9000)
#   CIRCLE_HEDGE_MS                   how long before the fallback vision
#                                     providers join the race (default 2500)
#
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 files as
# ANSI unless they carry a UTF-8 BOM, so a stray em-dash inside a string here
# would decode to a quote and break parsing.

$ErrorActionPreference = "SilentlyContinue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http
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

# Win32 helpers: where the copy came from, rounded corners, and handing focus
# back to the app before we paste the result into it.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class JarvisWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr hObject);
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr hWnd, IntPtr hRgn, bool redraw);
}

// NOTE: keyboard state is deliberately NEVER polled here (no GetAsyncKeyState).
// It is the classic keylogger signal, and Windows Defender's AMSI scanner
// blocks the whole script for it - which takes clipboard intelligence down with
// it. Esc is captured with a temporary RegisterHotKey instead, which is both
// quieter and impossible to miss.
"@ -WarningAction SilentlyContinue

# Circle to Search window types - the DPI helper, the global hotkey window and
# the freehand draw overlay - are compiled from scripts/circle-overlay.cs.
#
# They are deliberately NOT inlined here. A ~200 line embedded C# blob is
# exactly the shape Windows Defender's AMSI scanner blocks, and a blocked script
# takes the whole clipboard watcher down with it (verified: inlining it made
# Windows refuse to run this file at all). If the source file is missing we run
# without circle to search instead of failing to start.
$script:CircleTypesLoaded = $false

# $PSScriptRoot is empty when this file is loaded with Invoke-Expression (the
# smoke tests do exactly that), so try every way we can find the file rather
# than silently running without circle to search.
$script:CircleSource = $null
$script:CircleCandidates = @()
if ($PSScriptRoot) { $script:CircleCandidates += (Join-Path $PSScriptRoot "circle-overlay.cs") }
if ($PSCommandPath) { $script:CircleCandidates += (Join-Path (Split-Path -Parent $PSCommandPath) "circle-overlay.cs") }
$script:CircleCandidates += (Join-Path "scripts" "circle-overlay.cs")
$script:CircleCandidates += "circle-overlay.cs"
foreach ($cand in $script:CircleCandidates) {
    if ($cand -and (Test-Path $cand)) { $script:CircleSource = (Resolve-Path $cand).Path; break }
}
if ($script:CircleSource) {
    try {
        Add-Type -TypeDefinition (Get-Content -Raw $script:CircleSource) -ReferencedAssemblies System.Windows.Forms, System.Drawing -ErrorAction Stop
        [void][JarvisDpi]::SetProcessDPIAware()
        $script:CircleTypesLoaded = $true
    } catch {
        Write-Host "[JARVIS] Circle to search off - circle-overlay.cs did not compile: $($_.Exception.Message)"
    }
} else {
    Write-Host "[JARVIS] Circle to search off - scripts/circle-overlay.cs is missing."
}

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
$Script:OpenUrl = Get-Setting "CLIPBOARD_OPEN_URL" $apiBase

$assistEnabled = (Get-Setting "CLIPBOARD_ASSIST" "on").ToLower() -ne "off"
$actionsEnabled = (Get-Setting "CLIPBOARD_ACTIONS" "on").ToLower() -ne "off"
$askFirst      = (Get-Setting "CLIPBOARD_ASK_FIRST" "on").ToLower() -ne "off"
$imagesEnabled = (Get-Setting "CLIPBOARD_IMAGES" "on").ToLower() -ne "off"
$applyEnabled  = (Get-Setting "CLIPBOARD_APPLY_ON_SCREEN" "on").ToLower() -ne "off"
$popupEnabled  = (Get-Setting "CLIPBOARD_POPUP" "on").ToLower() -ne "off"
$popupPos      = (Get-Setting "CLIPBOARD_POPUP_POS" "pointer").ToLower()
$popupWidth    = [int](Get-Setting "CLIPBOARD_POPUP_WIDTH" "320")
$popupTimeout  = [int](Get-Setting "CLIPBOARD_POPUP_TIMEOUT_MS" "30000")
$popupOffset   = [int](Get-Setting "CLIPBOARD_POPUP_OFFSET" "18")
$script:MinLen = [int](Get-Setting "CLIPBOARD_MIN_CHARS" "3")
$script:MaxLen = [int](Get-Setting "CLIPBOARD_MAX_CHARS" "8000")
$script:PollMs = [int](Get-Setting "CLIPBOARD_POLL_MS" "700")
if ($popupWidth -lt 280) { $popupWidth = 280 }

# --- Circle to Search ---
# Nothing is hardcoded either: the hotkey, the crop size and the card's result
# count all come from .env.local with sane fallbacks.
$circleEnabled  = (Get-Setting "CIRCLE_TO_SEARCH" "on").ToLower() -ne "off"
$circleHotkey   = Get-Setting "CIRCLE_HOTKEY" "ctrl+alt+s"
$circleMaxWidth = [int](Get-Setting "CIRCLE_CAPTURE_WIDTH" "900")
$circleItems    = [int](Get-Setting "CIRCLE_MAX_RESULTS" "4")
$circleTimeoutSec = [int](Get-Setting "CIRCLE_TIMEOUT_SEC" "20")
$Script:CircleUri = "$apiBase/api/circle/search"
$Script:ActUri = "$apiBase/api/circle/act"
$Script:VoiceUri = "$apiBase/api/voice/listen"
# The crop and the region of the last circle, so the action card can act on the
# same pixels it searched, and a translation can be painted back in place.
$Script:LastCircleCrop = $null
$Script:LastCircleRect = $null
$Script:FrameUri = "$apiBase/api/circle/frame"
$Script:CircleMods = 0
$Script:CircleVk = 0
# Hotkey ids: the circle gesture, and the temporary Escape that cancels an
# in-flight search.
$Script:HotkeyIdCircle = 777
$Script:HotkeyIdEsc = 776
$Script:EscHotkeyWarned = $false
if ($circleMaxWidth -lt 320) { $circleMaxWidth = 320 }
if ($circleItems -lt 1) { $circleItems = 1 }
if ($circleItems -gt 6) { $circleItems = 6 }
if ($circleTimeoutSec -lt 5) { $circleTimeoutSec = 5 }
if ($circleTimeoutSec -gt 120) { $circleTimeoutSec = 120 }

# ---------------------------------------------------------------------------
# Apple-style palette (dark) and fonts
# ---------------------------------------------------------------------------
$Script:Bg        = [System.Drawing.Color]::FromArgb(28, 28, 30)      # #1C1C1E
# NOTE: card colours are named *Bg - $Script:Card is the live card form.
$Script:CardBg    = [System.Drawing.Color]::FromArgb(44, 44, 46)      # #2C2C2E
$Script:CardHover = [System.Drawing.Color]::FromArgb(58, 58, 60)      # #3A3A3C
$Script:Sunken    = [System.Drawing.Color]::FromArgb(20, 20, 22)      # #141416
$Script:Fg        = [System.Drawing.Color]::FromArgb(242, 242, 247)   # #F2F2F7
$Script:Dim       = [System.Drawing.Color]::FromArgb(152, 152, 159)   # #98989F
$Script:Faint     = [System.Drawing.Color]::FromArgb(110, 110, 120)
$Script:Accent    = [System.Drawing.Color]::FromArgb(10, 132, 255)    # #0A84FF
$Script:AccentHot = [System.Drawing.Color]::FromArgb(64, 156, 255)    # #409CFF
$Script:Sep       = [System.Drawing.Color]::FromArgb(56, 56, 58)      # #38383A
$Script:Green     = [System.Drawing.Color]::FromArgb(48, 209, 88)
$Script:Amber     = [System.Drawing.Color]::FromArgb(255, 159, 10)
$Script:Red       = [System.Drawing.Color]::FromArgb(255, 69, 58)
$Script:MonoFg    = [System.Drawing.Color]::FromArgb(201, 233, 255)

$Script:FontTitle = New-Object System.Drawing.Font("Segoe UI Semibold", 10)
$Script:FontUI    = New-Object System.Drawing.Font("Segoe UI", 8)
$Script:FontUIB   = New-Object System.Drawing.Font("Segoe UI Semibold", 8)
$Script:FontSmall = New-Object System.Drawing.Font("Segoe UI", 7)
$Script:FontMini  = New-Object System.Drawing.Font("Segoe UI Semibold", 6)
$Script:FontMono  = New-Object System.Drawing.Font("Consolas", 8)

function Write-Log([string]$message) {
    Write-Host ("[" + (Get-Date -Format "HH:mm:ss") + "] " + $message)
}

# ---------------------------------------------------------------------------
# HTTP with a message pump
# ---------------------------------------------------------------------------
# PowerShell's Invoke-RestMethod would freeze the card while a model works, so
# every call is issued through HttpClient and pumped with DoEvents until the
# task completes. The card stays alive, hover states keep working, and the
# user can still dismiss it.
$Script:Http = $null
function Get-Http {
    if (-not $Script:Http) {
        $c = New-Object System.Net.Http.HttpClient
        $c.Timeout = [TimeSpan]::FromSeconds(120)
        $Script:Http = $c
    }
    return $Script:Http
}

function Invoke-JarvisPost([string]$uri, $payload, [int]$timeoutSec) {
    try {
        $json = $payload | ConvertTo-Json -Compress -Depth 6
        $content = New-Object System.Net.Http.StringContent($json, [System.Text.Encoding]::UTF8, "application/json")
        $task = (Get-Http).PostAsync($uri, $content)
        $deadline = (Get-Date).AddSeconds($timeoutSec)
        while (-not $task.IsCompleted) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 25
            if ((Get-Date) -gt $deadline) { return @{ ok = $false; error = "timeout" } }
        }
        if ($task.IsFaulted) { return @{ ok = $false; error = $task.Exception.Message } }
        $body = $task.Result.Content.ReadAsStringAsync().Result
        return @{ ok = $true; data = ($body | ConvertFrom-Json) }
    } catch {
        return @{ ok = $false; error = $_.Exception.Message }
    }
}

function Invoke-JarvisGet([string]$uri, [int]$timeoutSec) {
    try {
        $task = (Get-Http).GetStringAsync($uri)
        $deadline = (Get-Date).AddSeconds($timeoutSec)
        while (-not $task.IsCompleted) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 25
            if ((Get-Date) -gt $deadline) { return $null }
        }
        if ($task.IsFaulted) { return $null }
        return ($task.Result | ConvertFrom-Json)
    } catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# Where did this copy come from? (best effort)
# ---------------------------------------------------------------------------
$Script:CopyHwnd = [IntPtr]::Zero

function Get-CopySource {
    try {
        $h = [JarvisWin]::GetForegroundWindow()
        if ($h -eq [IntPtr]::Zero) { return "" }
        $Script:CopyHwnd = $h
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
    $parts = $source.Split("-")
    if ($parts.Length -ge 2) {
        return (($parts[0..1] | ForEach-Object { $_.Trim() }) -join " - ")
    }
    return $source
}

# ---------------------------------------------------------------------------
# Kind catalog (fetched from the server, small built-in fallback)
# ---------------------------------------------------------------------------
$Script:Kinds = @{}
$Script:FallbackKind = "text"

function Set-FallbackCatalog {
    $Script:Kinds = @{ }
    $Script:Kinds["text"] = @{
        label = "Text detected"
        noun = "text"
        actions = @(
            @{ id = "explain"; label = "Explain"; local = $false; applies = $false },
            @{ id = "summarize"; label = "Summarize"; local = $false; applies = $false },
            @{ id = "answer"; label = "Answer"; local = $false; applies = $false }
        )
    }
    $Script:FallbackKind = "text"
}
Set-FallbackCatalog

function Import-Catalog($cat) {
    if (-not $cat) { $cat = Invoke-JarvisGet $Script:Uri 8 }
    if (-not $cat -or -not $cat.kinds) { return $false }
    $map = @{}
    foreach ($k in $cat.kinds) {
        $acts = @()
        foreach ($a in $k.actions) {
            $acts += @{
                id      = [string]$a.id
                label   = [string]$a.label
                local   = [bool]$a.local
                applies = [bool]$a.applies
            }
        }
        $map[[string]$k.kind] = @{
            label   = [string]$k.label
            noun    = [string]$k.noun
            actions = $acts
        }
    }
    if ($map.Count -eq 0) { return $false }
    $Script:Kinds = $map
    if ($cat.fallback) { $Script:FallbackKind = [string]$cat.fallback }
    return $true
}

# In dev the route compiles on its first request, which can take longer than
# the startup probe waits - so if we are still on the built-in fallback, try
# once more (throttled) before showing a card.
$Script:CatalogRetryAt = (Get-Date)
function Update-CatalogIfMissing {
    if ($Script:Kinds.Count -gt 1) { return }
    if ((Get-Date) -lt $Script:CatalogRetryAt) { return }
    $Script:CatalogRetryAt = (Get-Date).AddSeconds(60)
    if (Import-Catalog $null) {
        Write-Log "Loaded $($Script:Kinds.Count) clip kinds."
    }
}

function Get-KindInfo([string]$kind) {
    if ($Script:Kinds.ContainsKey($kind)) { return $Script:Kinds[$kind] }
    if ($Script:Kinds.ContainsKey($Script:FallbackKind)) { return $Script:Kinds[$Script:FallbackKind] }
    return @{ label = "Text detected"; noun = "text"; actions = @() }
}

# ---------------------------------------------------------------------------
# Small UI toolkit (rounded cards, pill buttons, text measuring)
# ---------------------------------------------------------------------------
function Set-RoundedRegion($control, [int]$radius) {
    try {
        if (-not $control.IsHandleCreated) { return }
        $w = $control.Width
        $h = $control.Height
        if ($w -le 0 -or $h -le 0) { return }
        $rgn = [JarvisWin]::CreateRoundRectRgn(0, 0, $w + 1, $h + 1, $radius * 2, $radius * 2)
        if ($control -is [System.Windows.Forms.Form]) {
            [void][JarvisWin]::SetWindowRgn($control.Handle, $rgn, $true)
        } else {
            $control.Region = [System.Drawing.Region]::FromHrgn($rgn)
            [void][JarvisWin]::DeleteObject($rgn)
        }
    } catch {}
}

function Measure-Width([string]$text, [System.Drawing.Font]$font) {
    return [System.Windows.Forms.TextRenderer]::MeasureText($text, $font).Width
}

function Limit-OneLine([string]$text, [System.Drawing.Font]$font, [int]$width) {
    $s = ($text -replace "\s+", " ").Trim()
    if ($s.Length -eq 0) { return "" }
    if ((Measure-Width $s $font) -le $width) { return $s }
    $lo = 0
    $hi = $s.Length
    while ($lo -lt $hi) {
        $mid = [int](($lo + $hi + 1) / 2)
        $cand = $s.Substring(0, $mid) + "..."
        if ((Measure-Width $cand $font) -le $width) { $lo = $mid } else { $hi = $mid - 1 }
    }
    return $s.Substring(0, [Math]::Max(1, $lo)) + "..."
}

function Get-WrappedLineCount([string]$text, [System.Drawing.Font]$font, [int]$width, [int]$maxLines) {
    if (-not $text) { return 0 }
    $size = [System.Windows.Forms.TextRenderer]::MeasureText(
        $text, $font,
        (New-Object System.Drawing.Size($width, 0)),
        [System.Windows.Forms.TextFormatFlags]::WordBreak)
    $lineH = [int][Math]::Ceiling($font.GetHeight())
    if ($lineH -le 0) { $lineH = 15 }
    $lines = [int][Math]::Ceiling($size.Height / [double]$lineH)
    if ($lines -lt 1) { $lines = 1 }
    if ($maxLines -gt 0 -and $lines -gt $maxLines) { return $maxLines }
    return $lines
}

function New-JarvisLabel([string]$text, [System.Drawing.Font]$font, [System.Drawing.Color]$color, [int]$x, [int]$y, [int]$w, [int]$h) {
    $l = New-Object System.Windows.Forms.Label
    $l.Text = $text
    $l.Font = $font
    $l.ForeColor = $color
    $l.BackColor = [System.Drawing.Color]::Transparent
    $l.AutoSize = $false
    $l.Location = New-Object System.Drawing.Point -ArgumentList $x, $y
    $l.Size = New-Object System.Drawing.Size -ArgumentList $w, $h
    return $l
}

# A flat, rounded pill. `tag` rides along on the control so click handlers can
# read their own data back out without relying on closure variables.
function New-PillButton($caption, [int]$x, [int]$y, [int]$w, [int]$h, [bool]$primary, $tag, $onClick) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $caption
    $b.Font = $Script:FontUI
    $b.FlatStyle = "Flat"
    $b.FlatAppearance.BorderSize = 0
    $b.UseVisualStyleBackColor = $false
    $b.TextAlign = "MiddleCenter"
    $b.Cursor = [System.Windows.Forms.Cursors]::Hand
    $b.Location = New-Object System.Drawing.Point -ArgumentList $x, $y
    $b.Size = New-Object System.Drawing.Size -ArgumentList $w, $h
    if ($primary) {
        $b.BackColor = $Script:Accent
        $b.ForeColor = [System.Drawing.Color]::White
        $b.FlatAppearance.MouseOverBackColor = $Script:AccentHot
    } else {
        $b.BackColor = $Script:CardBg
        $b.ForeColor = $Script:Fg
        $b.FlatAppearance.MouseOverBackColor = $Script:CardHover
    }
    $b.Tag = $tag
    $b.Add_Click($onClick)
    $b.Add_HandleCreated({ Set-RoundedRegion $this ([int][Math]::Min(14, $this.Height / 2)) })
    return $b
}

# A text-only action button: just the term ("Explain", "Optimize"), no pill
# chrome, so the card stays small. Hover tints it so it still reads as a button.
function New-LinkButton($caption, [int]$x, [int]$y, [int]$w, [int]$h, $tag, $onClick) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $caption
    $b.Font = $Script:FontUI
    $b.FlatStyle = "Flat"
    $b.FlatAppearance.BorderSize = 0
    $b.UseVisualStyleBackColor = $false
    $b.TextAlign = "MiddleCenter"
    $b.Cursor = [System.Windows.Forms.Cursors]::Hand
    $b.Location = New-Object System.Drawing.Point -ArgumentList $x, $y
    $b.Size = New-Object System.Drawing.Size -ArgumentList $w, $h
    $b.BackColor = $Script:Bg
    $b.ForeColor = $Script:Accent
    $b.FlatAppearance.MouseOverBackColor = $Script:CardBg
    $b.Tag = $tag
    $b.Add_Click($onClick)
    return $b
}

# A sunken, rounded reading pane (answer / code) with system scrollbars.
function New-ReadingPane([int]$x, [int]$y, [int]$w, [int]$h, [bool]$mono) {
    $t = New-Object System.Windows.Forms.TextBox
    $t.Multiline = $true
    $t.ReadOnly = $true
    $t.BorderStyle = "None"
    $t.BackColor = $Script:Sunken
    $t.ForeColor = $(if ($mono) { $Script:MonoFg } else { $Script:Fg })
    $t.Font = $(if ($mono) { $Script:FontMono } else { $Script:FontUI })
    $t.Location = New-Object System.Drawing.Point -ArgumentList $x, $y
    $t.Size = New-Object System.Drawing.Size -ArgumentList $w, $h
    if ($mono) {
        $t.WordWrap = $false
        $t.ScrollBars = "Both"
    } else {
        $t.ScrollBars = "Vertical"
    }
    return $t
}

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
    if ($x + $w -gt $work.Right)  { $x = $work.Right - $w - $popupOffset }
    if ($y + $h -gt $work.Bottom) { $y = $work.Bottom - $h - $popupOffset }
    if ($x -lt $work.Left) { $x = $work.Left + $popupOffset }
    if ($y -lt $work.Top)  { $y = $work.Top + $popupOffset }
    return @{ x = [int]$x; y = [int]$y }
}

function New-CardForm([int]$w, [int]$h) {
    $form = New-Object JarvisPopup
    $form.Text = "JARVIS"
    $form.BackColor = $Script:Bg
    $form.FormBorderStyle = "None"
    $form.ShowInTaskbar = $false
    $form.TopMost = $true
    $form.StartPosition = "Manual"
    $form.ClientSize = New-Object System.Drawing.Size -ArgumentList $w, $h
    return $form
}

# ---------------------------------------------------------------------------
# Card state
# ---------------------------------------------------------------------------
$Script:Card = $null          # the visible card form
$Script:CardTimer = $null     # click-away watcher
$Script:CardHideAt = $null

function Close-Card {
    try { if ($Script:CardTimer) { $Script:CardTimer.Stop(); $Script:CardTimer.Dispose() } } catch {}
    $Script:CardTimer = $null
    try { if ($Script:Card) { $Script:Card.Close(); $Script:Card.Dispose() } } catch {}
    $Script:Card = $null
    $Script:CardHideAt = $null
}

# Click-away dismissal: the card never takes focus, so watch the global mouse
# buttons on a fast timer and close as soon as a click lands outside.
function Watch-ClickAway($form) {
    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 60
    $timer.Add_Tick({
        try {
            if (-not $Script:Card) { Close-Card; return }
            $btns = [System.Windows.Forms.Control]::MouseButtons
            if ($btns -ne [System.Windows.Forms.MouseButtons]::None) {
                $cursor = [System.Windows.Forms.Cursor]::Position
                if (-not $Script:Card.Bounds.Contains($cursor)) { Close-Card }
            }
        } catch {}
    })
    $timer.Start()
    $Script:CardTimer = $timer
}

function Show-Card($form, [int]$w, [int]$h) {
    $loc = Get-PopupLocation $w $h
    $form.Location = New-Object System.Drawing.Point -ArgumentList $loc.x, $loc.y
    $form.Show()
    Set-RoundedRegion $form 18
    $Script:Card = $form
    if ($popupTimeout -gt 0) { $Script:CardHideAt = (Get-Date).AddMilliseconds($popupTimeout) }
    Watch-ClickAway $form
}

# A 1px hairline used to separate sections the way macOS cards do.
function New-Hairline([int]$x, [int]$y, [int]$w) {
    $p = New-Object System.Windows.Forms.Panel
    $p.BackColor = $Script:Sep
    $p.Location = New-Object System.Drawing.Point -ArgumentList $x, $y
    $p.Size = New-Object System.Drawing.Size -ArgumentList $w, 1
    return $p
}

function New-StatusDot([int]$x, [int]$y, [System.Drawing.Color]$color) {
    $d = New-Object System.Windows.Forms.Panel
    $d.BackColor = $color
    $d.Location = New-Object System.Drawing.Point -ArgumentList $x, $y
    $d.Size = New-Object System.Drawing.Size -ArgumentList 8, 8
    $d.Add_HandleCreated({
        $rgn = [JarvisWin]::CreateRoundRectRgn(0, 0, $this.Width + 1, $this.Height + 1, 8, 8)
        $this.Region = [System.Drawing.Region]::FromHrgn($rgn)
        [void][JarvisWin]::DeleteObject($rgn)
    })
    return $d
}

# ---------------------------------------------------------------------------
# Card 1 - the detection card ("Code detected" + its buttons)
# ---------------------------------------------------------------------------
function Show-DetectionCard($offer, [string]$text, [string]$source, [string]$image) {
    try {
        Close-Card
        $kind = [string]$offer.kind
        $kindLabel = [string]$offer.label
        $info = Get-KindInfo $kind
        $actions = @($info.actions)

        $w = $popupWidth
        $pad = 12
        $innerW = $w - 2 * $pad

        # Header
        $pills = @()
        if ($actionsEnabled -and $actions.Count -gt 0) {
            $pills = @(Get-PillRows $actions $innerW 10)
        }
        $pillH = 22
        $gapY = 4
        $rowsH = Get-PillRowCount $pills
        if ($rowsH -gt 0) { $rowsH = $rowsH * ($pillH + $gapY) }

        $previewText = [string]$offer.preview
        if (-not $previewText) { $previewText = "(image)" }
        $previewLines = Get-WrappedLineCount $previewText $Script:FontUI $innerW 2
        $headY = 10
        $srcY = $headY + 17
        $prevY = $srcY + 15
        $prevH = $previewLines * 14
        $pillsY = $prevY + $prevH + 8
        $hintY = $pillsY + $rowsH + 2
        $h = $hintY + 18

        $form = New-CardForm $w $h

        $dot = New-StatusDot $pad ($headY + 4) $Script:Accent
        $form.Controls.Add($dot)

        $head = New-JarvisLabel "JARVIS" $Script:FontMini $Script:Dim ($pad + 16) $headY 80 16
        $form.Controls.Add($head)

        $badgeW = Measure-Width $kindLabel $Script:FontUIB
        $badge = New-JarvisLabel $kindLabel $Script:FontUIB $Script:Accent ($w - $pad - $badgeW) $headY $badgeW 16
        $badge.TextAlign = "MiddleRight"
        $form.Controls.Add($badge)

        $srcLabel = "Copied from " + (Get-SourceLabel $source)
        $src = New-JarvisLabel (Limit-OneLine $srcLabel $Script:FontSmall $innerW) $Script:FontSmall $Script:Faint $pad $srcY $innerW 16
        $form.Controls.Add($src)

        $prev = New-JarvisLabel $previewText $Script:FontUI $Script:Fg $pad $prevY $innerW $prevH
        $form.Controls.Add($prev)

        if ($pills.Count -gt 0) {
            # Every pill on the same row shares one Y; a new row steps the Y
            # down and resets X, so the buttons always read left to right.
            foreach ($pill in $pills) {
                $tag = @{
                    kind   = $kind
                    id     = $pill.action.id
                    label  = $pill.action.label
                    local  = $pill.action.local
                    text   = $text
                    source = $source
                    image  = $image
                }
                $py = $pillsY + ($pill.row * ($pillH + $gapY))
                $btn = New-LinkButton $pill.action.label ($pad + $pill.x) $py $pill.w $pillH $tag {
                    $info = $this.Tag
                    Close-Card
                    Start-Action $info
                }
                $form.Controls.Add($btn)
            }
            $hint = New-JarvisLabel "Pick an action - click away to dismiss" $Script:FontSmall $Script:Faint $pad $hintY $innerW 16
            $form.Controls.Add($hint)
        } else {
            # CLIPBOARD_ACTIONS=off (or an unknown kind): keep the old behaviour -
            # one button that runs the full smart analysis.
            $tag = @{ auto = $true; text = $text; source = $source }
            $btn = New-PillButton "Ask JARVIS" $pad $pillsY 130 $pillH $true $tag {
                $info = $this.Tag
                Close-Card
                Invoke-AutoAnalysis ([string]$info.text) ([string]$info.source)
            }
            $form.Controls.Add($btn)
            $form.Add_Click({ Close-Card })
        }

        Show-Card $form $w $h
        Write-Log "Detected $kindLabel (from '$(Get-SourceLabel $source)')."
    } catch {
        Write-Log "Detection card failed: $($_.Exception.Message)"
        Write-Log "  at $($_.InvocationInfo.PositionMessage -replace "`r`n", ' ')"
        # Worst case: do not lose the feature - run the smart analysis.
        if ($text) { Invoke-AutoAnalysis $text $source }
    }
}

# Flow-layout the action pills into rows that fit the card width.
#
# Returns a FLAT list of pills, each carrying the row it belongs to. Flat on
# purpose: a nested array (rows of pills) is unrolled by PowerShell when it is
# returned from a function, which made every call site see one pill per "row"
# and rendered the buttons as a diagonal staircase.
# $labelPad is the horizontal room a label gets: small for the text-only
# action names on the detection card, roomier for real footer pills.
function Get-PillRows($actions, [int]$innerW, [int]$labelPad = 30) {
    $pills = @()
    $row = 0
    $x = 0
    foreach ($a in $actions) {
        $label = [string]$a.label
        $pw = [Math]::Max(40, (Measure-Width $label $Script:FontUI) + $labelPad)
        if ($pw -gt $innerW) { $pw = $innerW }
        if ((($x + $pw) -gt $innerW) -and $x -gt 0) {
            $row++
            $x = 0
        }
        $pills += @{ action = $a; x = $x; w = $pw; row = $row }
        $x += $pw + 8
    }
    return $pills
}

# How many rows a flow layout needs (0 when there is nothing to lay out).
function Get-PillRowCount($pills) {
    $rows = 0
    foreach ($p in @($pills)) {
        if (($p.row + 1) -gt $rows) { $rows = $p.row + 1 }
    }
    return $rows
}

# ---------------------------------------------------------------------------
# Card 2 - working indicator (while the model runs)
# ---------------------------------------------------------------------------
function Show-WorkingCard([string]$label, [string]$kind, [string]$hint = "JARVIS is working on it") {
    try {
        Close-Card
        $w = [Math]::Min($popupWidth, 320)
        $h = 74
        $form = New-CardForm $w $h

        $dot = New-StatusDot 16 22 $Script:Amber
        $form.Controls.Add($dot)

        $head = New-JarvisLabel "$label..." $Script:FontUIB $Script:Fg 32 18 ($w - 48) 18
        $form.Controls.Add($head)

        $sub = New-JarvisLabel $hint $Script:FontSmall $Script:Dim 32 38 ($w - 48) 16
        $form.Controls.Add($sub)

        $bar = New-Object System.Windows.Forms.Panel
        $bar.BackColor = $Script:Accent
        $bar.Location = New-Object System.Drawing.Point -ArgumentList 0, ($h - 3)
        $bar.Size = New-Object System.Drawing.Size -ArgumentList 40, 3
        $form.Controls.Add($bar)

        Show-Card $form $w $h
        # Indeterminate progress: a pulse travelling along the bottom edge.
        $Script:ProgressBar = $bar
        $script:progressX = 0
        $timer = New-Object System.Windows.Forms.Timer
        $timer.Interval = 16
        $timer.Add_Tick({
            try {
                if (-not $Script:ProgressBar) { return }
                $script:progressX += 9
                $pw = $Script:ProgressBar.Parent.ClientSize.Width
                if ($script:progressX -gt $pw) { $script:progressX = -60 }
                $Script:ProgressBar.Location = New-Object System.Drawing.Point -ArgumentList $script:progressX, ($Script:ProgressBar.Parent.ClientSize.Height - 3)
            } catch {}
        })
        $timer.Start()
        $Script:ProgressTimer = $timer
        [System.Windows.Forms.Application]::DoEvents()
    } catch {}
}

function Stop-Working {
    try { if ($Script:ProgressTimer) { $Script:ProgressTimer.Stop(); $Script:ProgressTimer.Dispose() } } catch {}
    $Script:ProgressTimer = $null
    $Script:ProgressBar = $null
}

# ---------------------------------------------------------------------------
# Card 3 - result
# ---------------------------------------------------------------------------
function Show-ResultCard($result, [string]$source, [bool]$canApply, [IntPtr]$target) {
    try {
        Stop-Working
        Close-Card

        $w = $popupWidth
        $pad = 16
        $innerW = $w - 2 * $pad

        $title = [string]$result.title
        if (-not $title) { $title = [string]$result.actionLabel }
        $summary = [string]$result.summary
        $answer = [string]$result.answer
        $code = [string]$result.code
        $language = [string]$result.language
        $applies = [bool]$result.applies

        # Height budget: content first, clamped to the screen.
        $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
        $maxH = $work.Height - 120

        $y = 16
        $titleH = 22
        $y += $titleH
        $srcH = 16
        $y += $srcH + 6
        $sumLines = Get-WrappedLineCount $summary $Script:FontUIB $innerW 3
        $sumH = [Math]::Max(18, $sumLines * 17)
        $y += $sumH + 10
        $hasAnswer = $answer.Length -gt 0
        $answerH = 0
        if ($hasAnswer) {
            $answerH = [Math]::Min(230, [Math]::Max(64, (Get-WrappedLineCount $answer $Script:FontUI $innerW 14) * 16 + 12))
            $y += $answerH + 10
        }
        $hasCode = $code.Length -gt 0
        $codeHeadH = 0
        $codeH = 0
        if ($hasCode) {
            $codeHeadH = 18
            $codeLines = ($code -split "`n").Count
            $codeH = [Math]::Min(190, [Math]::Max(58, $codeLines * 15 + 14))
            $y += $codeHeadH + $codeH + 10
        }
        # Footer buttons flow like the action pills, so a narrow card wraps
        # them onto a second row instead of pushing the last one off the edge.
        $btnH = 34
        $footer = @()
        if ($canApply -and $applyEnabled -and $applies -and $code) {
            $footer += @{ id = "apply"; label = "Apply on screen" }
        }
        $footer += @{ id = "copy"; label = "Copy" }
        $footer += @{ id = "open"; label = "Open JARVIS" }
        $footer += @{ id = "dismiss"; label = "Dismiss" }
        $footPills = @(Get-PillRows $footer $innerW)
        $footRows = Get-PillRowCount $footPills
        $footH = 0
        if ($footRows -gt 0) { $footH = $footRows * ($btnH + 8) - 8 }
        $y += $footH + 10
        $h = $y
        if ($h -gt $maxH) { $h = $maxH }

        $form = New-CardForm $w $h

        $dotColor = $Script:Green
        if ($result.urgency -eq "critical") { $dotColor = $Script:Red }
        elseif ($result.urgency -eq "caution") { $dotColor = $Script:Amber }
        $dot = New-StatusDot $pad 22 $dotColor
        $form.Controls.Add($dot)

        $head = New-JarvisLabel (Limit-OneLine $title $Script:FontTitle ($innerW - 90)) $Script:FontTitle $Script:Fg ($pad + 16) 16 ($innerW - 90) 22
        $form.Controls.Add($head)

        $kindText = [string]$result.kindLabel
        if ($language) { $kindText = $language.ToUpper() }
        if ($kindText) {
            $kw = Measure-Width $kindText $Script:FontMini + 16
            $kbg = New-JarvisLabel $kindText $Script:FontMini $Script:Accent ($w - $pad - $kw) 20 $kw 16
            $kbg.TextAlign = "MiddleRight"
            $form.Controls.Add($kbg)
        }

        $srcLabel = "from " + (Get-SourceLabel $source)
        $src = New-JarvisLabel (Limit-OneLine $srcLabel $Script:FontSmall $innerW) $Script:FontSmall $Script:Faint $pad 38 $innerW 16
        $form.Controls.Add($src)

        $y = 60
        if ($summary) {
            $sum = New-JarvisLabel $summary $Script:FontUIB $Script:Fg $pad $y $innerW $sumH
            $form.Controls.Add($sum)
            $y += $sumH + 10
        }

        if ($hasAnswer) {
            $pane = New-ReadingPane $pad $y $innerW $answerH $false
            $pane.Text = $answer
            $form.Controls.Add($pane)
            $y += $answerH + 10
        }

        if ($hasCode) {
            $langLabel = "CODE"
            if ($language) { $langLabel = "CODE - " + $language.ToUpper() }
            $codeHead = New-JarvisLabel $langLabel $Script:FontMini $Script:Dim $pad $y $innerW 16
            $form.Controls.Add($codeHead)
            $y += $codeHeadH
            $codePane = New-ReadingPane $pad $y $innerW $codeH $true
            $codePane.Text = $code
            $form.Controls.Add($codePane)
            $y += $codeH + 10
        }

        $footY = $h - $footH - 12

        foreach ($pill in $footPills) {
            $bx = $pad + $pill.x
            $by = $footY + ($pill.row * ($btnH + 8))
            switch ([string]$pill.action.id) {
                "apply" {
                    $tag = @{ code = $code; target = $target }
                    $btnApply = New-PillButton "Apply on screen" $bx $by $pill.w $btnH $true $tag {
                        $info = $this.Tag
                        $ok = Invoke-ApplyOnScreen ([string]$info.code) $info.target
                        Close-Card
                        if (-not $ok) { Show-Toast "JARVIS" "Copied the fix - press Ctrl+V where you want it." }
                    }
                    $form.Controls.Add($btnApply)
                }
                "copy" {
                    $tagCopy = @{ text = $code; answer = $answer }
                    $btnCopy = New-PillButton "Copy" $bx $by $pill.w $btnH $false $tagCopy {
                        $info = $this.Tag
                        $payload = [string]$info.text
                        if (-not $payload) { $payload = [string]$info.answer }
                        if ($payload) {
                            try { [System.Windows.Forms.Clipboard]::SetText($payload) } catch {}
                            Send-Suppress $payload
                        }
                        Close-Card
                    }
                    $form.Controls.Add($btnCopy)
                }
                "open" {
                    $btnOpen = New-PillButton "Open JARVIS" $bx $by $pill.w $btnH $false @{} {
                        try { Start-Process $Script:OpenUrl } catch {}
                        Close-Card
                    }
                    $form.Controls.Add($btnOpen)
                }
                "dismiss" {
                    $btnDismiss = New-PillButton "Dismiss" $bx $by $pill.w $btnH $false @{} {
                        Close-Card
                    }
                    $form.Controls.Add($btnDismiss)
                }
            }
        }

        Show-Card $form $w $h
        Write-Log "Result card: '$title'."
    } catch {
        Write-Log "Result card failed: $($_.Exception.Message)"
        Write-Log "  at $($_.InvocationInfo.PositionMessage -replace "`r`n", ' ')"
        Show-Toast "JARVIS - $($result.title)" ([string]$result.summary)
    }
}

# ---------------------------------------------------------------------------
# Tray toast (fallback when the card is disabled)
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
# Applying a fix on screen
# ---------------------------------------------------------------------------
function Send-Suppress([string]$text) {
    if (-not $text) { return }
    $script:last = $text
    [void](Invoke-JarvisPost $Script:Uri @{ action = "suppress"; text = $text } 8)
}

# Put the fixed code on the clipboard and paste it over the selection in the
# app the copy came from. The card never takes focus (WS_EX_NOACTIVATE), so
# the target window is usually still foreground and Ctrl+V lands where the
# user was working.
function Invoke-ApplyOnScreen([string]$code, $target) {
    if (-not $code) { return $false }
    try {
        [System.Windows.Forms.Clipboard]::SetText($code)
    } catch {
        return $false
    }
    Send-Suppress $code
    try {
        if ($target -and $target -ne [IntPtr]::Zero) {
            $current = [JarvisWin]::GetForegroundWindow()
            if ($current -ne $target) {
                [void][JarvisWin]::SetForegroundWindow($target)
                Start-Sleep -Milliseconds 220
            }
        }
        Start-Sleep -Milliseconds 60
        [System.Windows.Forms.SendKeys]::SendWait("^v")
        Write-Log "Applied the fix on screen."
        return $true
    } catch {
        Write-Log "Apply on screen failed: $($_.Exception.Message)"
        return $false
    }
}

# ---------------------------------------------------------------------------
# Running an action
# ---------------------------------------------------------------------------
function Start-Action($info) {
    $kind = [string]$info.kind
    $id = [string]$info.id
    $label = [string]$info.label
    $text = [string]$info.text
    $source = [string]$info.source
    $image = [string]$info.image

    # "Open" is handled locally - no model call, no server round trip.
    if ([bool]$info.local) {
        $url = ($text | Select-String -Pattern "https?://[^\s<>`"')]+" -AllMatches).Matches | ForEach-Object { $_.Value } | Select-Object -First 1
        if ($url) {
            Write-Log "Opening $url"
            try { Start-Process $url } catch {}
        } else {
            Show-Toast "JARVIS" "No link found in that clip."
        }
        return
    }

    if ($popupEnabled) { Show-WorkingCard $label $kind }
    Write-Log "Running '$label' on a $kind clip..."

    $payload = @{ text = $text; source = $source; action = "act"; id = $id; kind = $kind }
    if ($image) { $payload.image = $image }

    $resp = Invoke-JarvisPost $Script:Uri $payload 90
    Stop-Working

    if (-not $resp.ok) {
        Close-Card
        Write-Log "Action request failed: $($resp.error)"
        Show-Toast "JARVIS" "Could not reach the JARVIS server. Is 'npm run dev' running?"
        return
    }
    if (-not $resp.data -or -not $resp.data.success -or -not $resp.data.result) {
        Close-Card
        Write-Log "Server returned no result for '$label'."
        Show-Toast "JARVIS" "No result came back. Try again in a moment."
        return
    }

    $result = $resp.data.result
    $canApply = $true
    if ($popupEnabled) {
        Show-ResultCard $result $source $canApply $Script:CopyHwnd
    } else {
        Show-Toast "JARVIS - $($result.title)" ([string]$result.summary)
    }
    Write-Log "JARVIS - $($result.title): $($result.summary)"
}

# Legacy auto path (CLIPBOARD_ASK_FIRST=off): run the full smart analysis.
function Invoke-AutoAnalysis([string]$text, [string]$source) {
    if ($popupEnabled) { Show-WorkingCard "Analyzing" "auto" }
    $resp = Invoke-JarvisPost $Script:Uri @{ text = $text; source = $source } 90
    Stop-Working
    if (-not $resp.ok -or -not $resp.data -or -not $resp.data.success) {
        Close-Card
        if (-not $resp.ok) {
            Write-Log "Analysis request failed: $($resp.error)"
            Show-Toast "JARVIS Clipboard Assistant" "Could not reach the JARVIS server. Is 'npm run dev' running?"
        }
        return
    }
    $d = $resp.data
    $result = @{
        title     = [string]$d.modeLabel
        summary   = [string]$d.summary
        answer    = [string]$d.answer
        code      = [string]$d.code
        language  = [string]$d.language
        kindLabel = [string]$d.category
        applies   = $false
        urgency   = [string]$d.urgency
    }
    if ($popupEnabled) { Show-ResultCard $result $source $false $Script:CopyHwnd }
    else { Show-Toast "JARVIS - $($d.modeLabel)" ([string]$d.summary) }
}

# ---------------------------------------------------------------------------
# Clipboard image capture
# ---------------------------------------------------------------------------
function Get-ClipboardImage {
    try {
        if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { return $null }
        $img = [System.Windows.Forms.Clipboard]::GetImage()
        if (-not $img) { return $null }
        $bmp = $img
        if ($img.Width -gt 1600) {
            $scale = 1600 / [double]$img.Width
            $nw = [int]($img.Width * $scale)
            $nh = [int]($img.Height * $scale)
            $bmp = New-Object System.Drawing.Bitmap($img, $nw, $nh)
        }
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bytes = $ms.ToArray()
        $sha = [System.Security.Cryptography.SHA1]::Create()
        $hash = [System.BitConverter]::ToString($sha.ComputeHash($bytes))
        $b64 = [Convert]::ToBase64String($bytes)
        return @{ data = "data:image/png;base64,$b64"; hash = $hash; bytes = $bytes.Length }
    } catch {
        return $null
    }
}

# ---------------------------------------------------------------------------
# Circle to Search - freeze the screen, draw around anything, JARVIS looks it up
# ---------------------------------------------------------------------------
$Script:CircleBusy = $false

# Freeze the screen for the overlay.
#
# The capture itself happens server-side (GET /api/circle/frame) and arrives as
# raw PNG bytes. Capturing it HERE is what made Windows Defender refuse to run
# this script at all - "read the screen + encode it + upload it + own global
# hotkeys + watch the clipboard" in one file reads as a stealer to its AMSI
# scanner. All this side does now is ask for the frame and decode it.
#
# The rect we send comes from this DPI-aware process, so the frame matches the
# overlay's mouse coordinates exactly, whatever the display scaling is.
function Get-ScreenFrame {
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $uri = "$Script:FrameUri`?left=$($vs.Left)&top=$($vs.Top)&width=$($vs.Width)&height=$($vs.Height)"

    $cts = New-Object System.Threading.CancellationTokenSource
    try {
        $cts.CancelAfter(8000)
        # GetAsync(uri, token) and ReadAsByteArrayAsync() both exist on .NET
        # Framework, unlike GetByteArrayAsync(uri, token) which is .NET 5+ only -
        # calling it threw "Cannot find an overload" on Windows PowerShell 5.1
        # and the overlay had nothing to freeze.
        $task = (Get-Http).GetAsync($uri, $cts.Token)
        # Pump while we wait so nothing on screen freezes, and so the wait can
        # never turn into a hang if the server stops answering.
        while (-not $task.IsCompleted) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 20
        }
        if ($task.IsFaulted -or $task.IsCanceled) {
            Write-Log "Screen frame request failed."
            return $null
        }
        $resp = $task.Result
        if (-not $resp.IsSuccessStatusCode) {
            Write-Log "Screen frame route returned $([int]$resp.StatusCode)."
            return $null
        }
        $bytes = $resp.Content.ReadAsByteArrayAsync().Result
    } catch {
        Write-Log "Could not fetch the screen frame: $($_.Exception.Message)"
        return $null
    } finally {
        $cts.Dispose()
    }

    if (-not $bytes -or $bytes.Length -lt 1000) {
        Write-Log "Screen frame came back empty."
        return $null
    }

    try {
        $stream = [System.IO.MemoryStream]::new($bytes)
        $loaded = [System.Drawing.Image]::FromStream($stream)
        $bmp = New-Object System.Drawing.Bitmap -ArgumentList $loaded
        $loaded.Dispose()
        $stream.Dispose()
        return @{ bitmap = $bmp; rect = $vs }
    } catch {
        Write-Log "Could not decode the screen frame: $($_.Exception.Message)"
        return $null
    }
}

# Turn "F9" / "s" / "space" into a virtual-key code.
function Resolve-Vk([string]$token) {
    $t = $token.Trim().ToUpper()
    if ($t.Length -eq 1 -and $t -match '^[A-Z0-9]$') { return [int][char]$t }
    switch ($t) {
        "SPACE"  { return 0x20 }
        "TAB"    { return 0x09 }
        "ENTER"  { return 0x0D }
        "ESC"    { return 0x1B }
        "ESCAPE" { return 0x1B }
    }
    if ($t -match '^F([1-9]|1[0-2])$') { return 0x70 + ([int]$Matches[1]) - 1 }
    return 0
}

function Register-CircleHotkey {
    if (-not $circleEnabled) { return }
    if (-not $Script:CircleTypesLoaded) { $script:circleEnabled = $false; return }
    $mods = @{
        "alt" = 0x0001; "ctrl" = 0x0002; "control" = 0x0002
        "shift" = 0x0004; "win" = 0x0008; "windows" = 0x0008
    }
    $parts = @($circleHotkey.Split("+") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    foreach ($p in $parts) {
        $low = $p.ToLower()
        if ($mods.ContainsKey($low)) {
            $Script:CircleMods = $Script:CircleMods -bor [int]$mods[$low]
            continue
        }
        $Script:CircleVk = Resolve-Vk $p
    }
    if ($Script:CircleVk -eq 0 -or $Script:CircleMods -eq 0) {
        Write-Log "CIRCLE_HOTKEY '$circleHotkey' not understood - circle to search off. Use e.g. ctrl+alt+s."
        $script:circleEnabled = $false
        return
    }
    $Script:Hotkey = New-Object JarvisHotkeyWindow
    $ok = $Script:Hotkey.Register($Script:HotkeyIdCircle, [uint32]$Script:CircleMods, [uint32]$Script:CircleVk)
    if (-not $ok) {
        Write-Log "CIRCLE_HOTKEY '$circleHotkey' is already taken by another app - circle to search off."
        $script:circleEnabled = $false
    } else {
        Write-Log "Circle to search ready - press $circleHotkey and draw around anything."
    }
}

# One clickable result row on the circle result card.
function New-ResultRow([int]$index, $item, [int]$x, [int]$y, [int]$w) {
    $row = New-Object System.Windows.Forms.Button
    $row.FlatStyle = "Flat"
    $row.FlatAppearance.BorderSize = 0
    $row.UseVisualStyleBackColor = $false
    $row.TextAlign = "MiddleLeft"
    $row.Cursor = [System.Windows.Forms.Cursors]::Hand
    $row.Font = $Script:FontUI
    $row.BackColor = $Script:CardBg
    $row.ForeColor = $Script:Fg
    $row.FlatAppearance.MouseOverBackColor = $Script:CardHover

    $title = [string]$item.title
    if (-not $title) { $title = [string]$item.url }
    $suffix = [string]$item.snippet
    if (-not $suffix) { $suffix = [string]$item.source }
    $label = "$index. $title"
    if ($suffix) { $label = "$label  -  $suffix" }
    $row.Text = Limit-OneLine $label $Script:FontUI ($w - 18)

    $row.Location = New-Object System.Drawing.Point -ArgumentList $x, $y
    $row.Size = New-Object System.Drawing.Size -ArgumentList $w, 26
    $row.Tag = $item
    # The card stays open on purpose: open three results in a row, then click
    # away (or press Dismiss) to close it.
    $row.Add_Click({
        $info = $this.Tag
        $url = [string]$info.url
        if ($url) { try { Start-Process $url } catch {} }
    })
    $row.Add_HandleCreated({ Set-RoundedRegion $this 8 })
    return $row
}

# ---------------------------------------------------------------------------
# Card 4 - circle to search result
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Circle to Act - say what you want done with the circled thing.
# ---------------------------------------------------------------------------
# There is NO action menu here. The crop and the user's own words are handed to
# the same agent that runs every other JARVIS task (POST /api/circle/act), and it
# picks a real tool - browser, email, translate, memory, maps, web. A capability
# the agent learns later shows up here for free.
function Read-CircleInstruction([string]$prefill) {
    # The result card is a no-activate popup, so a text box inside it can never
    # take the keyboard. This asks on its own activating dialog instead.
    $box = New-Object JarvisAskBox -ArgumentList "Tell JARVIS what to do with this  (Enter to run, Esc to cancel)", $prefill
    [void]$box.ShowDialog()
    $text = [string]$box.Answer
    try { $box.Dispose() } catch {}
    return $text
}

function Invoke-CircleAct([string]$instruction) {
    if (-not $Script:LastCircleCrop) { return $null }
    try {
        $uri = "$Script:ActUri`?instruction=$([uri]::EscapeDataString($instruction))"
        $content = [System.Net.Http.ByteArrayContent]::new($Script:LastCircleCrop)
        $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new("image/jpeg")
        # Same additive timeout as the search call: the PRIME line alone must
        # never leave the user staring at a frozen card.
        $task = (Get-Http).PostAsync($uri, $content, [System.Threading.CancellationToken]::None)
        $deadline = (Get-Date).AddSeconds(120)
        while (-not $task.IsCompleted) {
            [System.Windows.Forms.Application]::DoEvents()
            if ((Get-Date) -gt $deadline) { return $null }
            Start-Sleep -Milliseconds 25
        }
        if ($task.IsFaulted -or $task.IsCanceled) {
            Write-Log "Circle act request failed: $($task.Exception.Message)"
            return $null
        }
        $body = $task.Result.Content.ReadAsStringAsync().Result
        return ($body | ConvertFrom-Json)
    } catch {
        Write-Log "Circle act failed: $($_.Exception.Message)"
        return $null
    }
}

function Start-CircleAct([string]$instruction) {
    if (-not $Script:LastCircleCrop) {
        Show-Toast "JARVIS" "Circle something first, then tell me what to do with it."
        return
    }
    Close-Card
    Write-Log "Circle act: '$instruction'"
    if ($popupEnabled) { Show-WorkingCard "Working on it" "circle" "doing what you asked with the circled thing" }
    $act = Invoke-CircleAct $instruction
    Stop-Working
    if (-not $act -or -not $act.success) {
        Write-Log "Circle act got no answer from the server."
        Show-Toast "JARVIS" "That action could not be carried out. Is the JARVIS server running?"
        return
    }
    $did = @($act.actions).Count
    Write-Log "JARVIS acted on '$($act.subject)' - $did action(s) in $($act.elapsedMs)ms."
    # A translation is the one result that also belongs ON the thing itself.
    if ($act.translation -and $Script:LastCircleRect) {
        Show-TranslationInPlace ([string]$act.subject) ([string]$act.translation)
    }
    if ($popupEnabled) { Show-CircleActCard $act }
    else { Show-Toast "JARVIS" ([string]$act.summary) }
}

# The translation, floating exactly over the region that was circled.
function Show-TranslationInPlace([string]$original, [string]$translated) {
    if (-not $translated) { return }
    try {
        $panel = New-Object JarvisTranslatedPanel -ArgumentList $original, $translated, $Script:LastCircleRect, 12000
        $panel.Show()
        $deadline = (Get-Date).AddSeconds(12)
        while (-not $panel.IsDisposed -and (Get-Date) -lt $deadline) {
            [System.Windows.Forms.Application]::DoEvents()
            Start-Sleep -Milliseconds 40
        }
        try { $panel.Close(); $panel.Dispose() } catch {}
    } catch {
        Write-Log "Translation panel failed: $($_.Exception.Message)"
    }
}

function Show-CircleActCard($act) {
    try {
        Stop-Working
        Close-Card

        $w = $popupWidth
        $pad = 14
        $innerW = $w - 2 * $pad

        $title = [string]$act.title
        if (-not $title) { $title = "Done" }
        $summary = [string]$act.summary
        $subject = [string]$act.subject
        $badge = $(if ($act.ok) { "Done" } else { "Partly done" })

        $trail = @()
        foreach ($a in @($act.actions)) {
            $trail += "$($a.tool): $($a.output)"
        }
        $trailText = ($trail -join "`n`n")
        foreach ($f in @($act.failures)) { $trailText += "`n`nCould not do: $f" }

        $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
        $maxH = $work.Height - 120

        $yHead = 12
        $ySrc = $yHead + 17
        $yTitle = $ySrc + 15
        $ySum = $yTitle + 21
        $sumH = [Math]::Max(16, (Get-WrappedLineCount $summary $Script:FontUI $innerW 5) * 15)
        $trailH = 0
        if ($trailText) { $trailH = [Math]::Min(230, [Math]::Max(52, (Get-WrappedLineCount $trailText $Script:FontUI $innerW 14) * 15 + 12)) }

        $btnH = 32
        $footer = @(
            @{ id = "copy"; label = "Copy" },
            @{ id = "dismiss"; label = "Dismiss" }
        )
        if ($act.translation) { $footer = @(@{ id = "inplace"; label = "Show in place" }) + $footer }
        $footPills = @(Get-PillRows $footer $innerW)
        $footRows = Get-PillRowCount $footPills
        $footH = 0
        if ($footRows -gt 0) { $footH = $footRows * ($btnH + 8) - 8 }

        $bodyEnd = $ySum + $sumH
        if ($trailH -gt 0) { $bodyEnd += 8 + $trailH }
        $footY = $bodyEnd + 10
        $h = $footY + $footH + 12
        if ($h -gt $maxH) { $h = $maxH }

        $form = New-CardForm $w $h
        $form.Controls.Add((New-StatusDot $pad ($yHead + 4) $Script:Accent))
        $form.Controls.Add((New-JarvisLabel "JARVIS" $Script:FontMini $Script:Dim ($pad + 16) $yHead 90 16))

        $badgeW = Measure-Width $badge $Script:FontUIB
        $badgeLabel = New-JarvisLabel $badge $Script:FontUIB $Script:Accent ($w - $pad - $badgeW) $yHead $badgeW 16
        $badgeLabel.TextAlign = "MiddleRight"
        $form.Controls.Add($badgeLabel)

        $srcText = "on your screen"
        if ($subject) { $srcText = "on '$($subject)'" }
        $form.Controls.Add((New-JarvisLabel $srcText $Script:FontSmall $Script:Faint $pad $ySrc $innerW 15))
        $form.Controls.Add((New-JarvisLabel (Limit-OneLine $title $Script:FontTitle $innerW) $Script:FontTitle $Script:Fg $pad $yTitle $innerW 20))

        if ($summary) {
            $form.Controls.Add((New-JarvisLabel $summary $Script:FontUI $Script:Fg $pad $ySum $innerW $sumH))
        }
        if ($trailH -gt 0) {
            $pane = New-ReadingPane $pad ($ySum + $sumH + 8) $innerW $trailH $false
            $pane.Text = $trailText
            $form.Controls.Add($pane)
        }

        foreach ($pill in $footPills) {
            $bx = $pad + $pill.x
            $by = $footY + ($pill.row * ($btnH + 8))
            switch ([string]$pill.action.id) {
                "inplace" {
                    $tag = @{ text = [string]$act.translation }
                    $btn = New-PillButton "Show in place" $bx $by $pill.w $btnH $true $tag {
                        $info = $this.Tag
                        Close-Card
                        Show-TranslationInPlace "" ([string]$info.text)
                        # Let the panel sit for its full life, then come back.
                        Start-Sleep -Milliseconds 300
                    }
                    $form.Controls.Add($btn)
                }
                "copy" {
                    $copyText = $summary
                    if (-not $copyText) { $copyText = $title }
                    if ($trailText) { $copyText = "$copyText`n`n$trailText" }
                    $tag = @{ text = $copyText }
                    $btn = New-PillButton "Copy" $bx $by $pill.w $btnH $false $tag {
                        $info = $this.Tag
                        $payload = [string]$info.text
                        if ($payload) {
                            try { [System.Windows.Forms.Clipboard]::SetText($payload) } catch {}
                            Send-Suppress $payload
                        }
                        Close-Card
                    }
                    $form.Controls.Add($btn)
                }
                "dismiss" {
                    $form.Controls.Add((New-PillButton "Dismiss" $bx $by $pill.w $btnH $false @{} { Close-Card }))
                }
            }
        }

        Show-Card $form $w $h
        Write-Log "Circle act card: '$title'."
    } catch {
        Write-Log "Circle act card failed: $($_.Exception.Message)"
    }
}

function Show-CircleResultCard($result) {
    try {
        Stop-Working
        Close-Card

        $w = $popupWidth
        $pad = 14
        $innerW = $w - 2 * $pad

        $title = [string]$result.title
        if (-not $title) { $title = "Screen selection" }
        $kindLabel = [string]$result.kindLabel
        $summary = [string]$result.summary
        $answer = [string]$result.answer
        $searchUrl = [string]$result.searchUrl
        $surface = [string]$result.surface

        $items = @($result.items)
        if ($items.Count -gt $circleItems) { $items = @($items[0..($circleItems - 1)]) }

        $work = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position).WorkingArea
        $maxH = $work.Height - 120

        $yHead = 12
        $ySrc = $yHead + 17
        $yTitle = $ySrc + 15
        $ySum = $yTitle + 21
        $sumH = [Math]::Max(16, (Get-WrappedLineCount $summary $Script:FontUI $innerW 4) * 15)
        $answerH = 0
        if ($answer) {
            $answerH = [Math]::Min(200, [Math]::Max(48, (Get-WrappedLineCount $answer $Script:FontUI $innerW 12) * 15 + 12))
        }
        $rowH = 26
        $rowGap = 6
        $listH = 0
        if ($items.Count -gt 0) { $listH = 20 + ($items.Count * ($rowH + $rowGap)) }

        $btnH = 32
        $footer = @(
            @{ id = "act"; label = "Tell JARVIS what to do" },
            @{ id = "google"; label = "Search Google" },
            @{ id = "openj"; label = "Open JARVIS" },
            @{ id = "copy"; label = "Copy" },
            @{ id = "dismiss"; label = "Dismiss" }
        )
        $footPills = @(Get-PillRows $footer $innerW)
        $footRows = Get-PillRowCount $footPills
        $footH = 0
        if ($footRows -gt 0) { $footH = $footRows * ($btnH + 8) - 8 }

        $bodyEnd = $ySum + $sumH
        if ($answerH -gt 0) { $bodyEnd += 8 + $answerH }
        $yList = $bodyEnd + 8
        $footY = $yList + $listH + 6
        $h = $footY + $footH + 12
        if ($h -gt $maxH) { $h = $maxH }

        $form = New-CardForm $w $h

        $dot = New-StatusDot $pad ($yHead + 4) $Script:Accent
        $form.Controls.Add($dot)

        $head = New-JarvisLabel "JARVIS" $Script:FontMini $Script:Dim ($pad + 16) $yHead 90 16
        $form.Controls.Add($head)

        if ($kindLabel) {
            $badgeW = Measure-Width $kindLabel $Script:FontUIB
            $badge = New-JarvisLabel $kindLabel $Script:FontUIB $Script:Accent ($w - $pad - $badgeW) $yHead $badgeW 16
            $badge.TextAlign = "MiddleRight"
            $form.Controls.Add($badge)
        }

        $src = New-JarvisLabel "from your screen" $Script:FontSmall $Script:Faint $pad $ySrc $innerW 15
        $form.Controls.Add($src)

        $titleLabel = New-JarvisLabel (Limit-OneLine $title $Script:FontTitle $innerW) $Script:FontTitle $Script:Fg $pad $yTitle $innerW 20
        $form.Controls.Add($titleLabel)

        if ($summary) {
            $sum = New-JarvisLabel $summary $Script:FontUI $Script:Fg $pad $ySum $innerW $sumH
            $form.Controls.Add($sum)
        }

        if ($answerH -gt 0) {
            $pane = New-ReadingPane $pad ($ySum + $sumH + 8) $innerW $answerH $false
            $pane.Text = $answer
            $form.Controls.Add($pane)
        }

        if ($items.Count -gt 0) {
            $listTitle = "GOOGLE"
            switch ($surface) {
                "shopping" { $listTitle = "GOOGLE SHOPPING" }
                "places"   { $listTitle = "GOOGLE MAPS" }
                "images"   { $listTitle = "GOOGLE IMAGES" }
            }
            $lb = New-JarvisLabel $listTitle $Script:FontMini $Script:Dim $pad $yList $innerW 16
            $form.Controls.Add($lb)

            $iy = $yList + 20
            $n = 0
            foreach ($item in $items) {
                $n++
                $form.Controls.Add((New-ResultRow $n $item $pad $iy $innerW))
                $iy += $rowH + $rowGap
            }
        }

        foreach ($pill in $footPills) {
            $bx = $pad + $pill.x
            $by = $footY + ($pill.row * ($btnH + 8))
            switch ([string]$pill.action.id) {
                "act" {
                    # Nothing is hardcoded past this point: whatever the user
                    # types is the goal, and the agent picks the tool.
                    $btn = New-PillButton "Tell JARVIS what to do" $bx $by $pill.w $btnH $true @{} {
                        Close-Card
                        $say = Read-CircleInstruction ""
                        if ($say) { Start-CircleAct $say }
                    }
                    $form.Controls.Add($btn)
                }
                "google" {
                    $tag = @{ url = $searchUrl }
                    $btn = New-PillButton "Search Google" $bx $by $pill.w $btnH $true $tag {
                        $info = $this.Tag
                        $url = [string]$info.url
                        if ($url) { try { Start-Process $url } catch {} }
                    }
                    $form.Controls.Add($btn)
                }
                "openj" {
                    $btn = New-PillButton "Open JARVIS" $bx $by $pill.w $btnH $false @{} {
                        try { Start-Process $Script:OpenUrl } catch {}
                        Close-Card
                    }
                    $form.Controls.Add($btn)
                }
                "copy" {
                    $copyText = $answer
                    if (-not $copyText) { $copyText = "$title - $summary" }
                    $tag = @{ text = $copyText }
                    $btn = New-PillButton "Copy" $bx $by $pill.w $btnH $false $tag {
                        $info = $this.Tag
                        $payload = [string]$info.text
                        if ($payload) {
                            try { [System.Windows.Forms.Clipboard]::SetText($payload) } catch {}
                            Send-Suppress $payload
                        }
                        Close-Card
                    }
                    $form.Controls.Add($btn)
                }
                "dismiss" {
                    $btn = New-PillButton "Dismiss" $bx $by $pill.w $btnH $false @{} { Close-Card }
                    $form.Controls.Add($btn)
                }
            }
        }

        Show-Card $form $w $h
        Write-Log "Circle result: '$title'."
    } catch {
        Write-Log "Circle result card failed: $($_.Exception.Message)"
        Write-Log "  at $($_.InvocationInfo.PositionMessage -replace "`r`n", ' ')"
    }
}

# Encode the crop as JPEG bytes. JPEG is several times smaller than PNG for a
# screenshot, and both the upload and the vision model are faster for it - which
# is the difference between a snappy circle and a slow one. Quality 82 keeps
# small text readable, which is exactly what the model has to read.
#
# Deliberately returns BYTES, not a base64 string: the route accepts a raw image
# body, which is a third smaller on the wire, and keeping base64 next to screen
# capture in one script is what made Windows Defender's AMSI scanner block the
# whole watcher ("this script contains malicious content") - taking clipboard
# intelligence down with it.
function Get-JpegBytes($bmp, [int]$quality = 82) {
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $params = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$quality)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, $codec, $params)
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return $bytes
}

# POST the crop and wait for the answer - cancellably.
#
# The wait pumps Windows messages, so the working indicator keeps animating AND
# both of the user's escape hatches work while the model is still thinking:
#   Esc            -> abort the request, show nothing
#   circle hotkey  -> abort the request, hand back to re-freeze for a new circle
# Returns @{ status = "ok" | "esc" | "again" | "timeout" | "error"; data; error }
function Invoke-CircleQuery([byte[]]$bytes) {
    $uri = "$Script:CircleUri`?maxItems=$circleItems"
    $content = [System.Net.Http.ByteArrayContent]::new($bytes)
    $content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new("image/jpeg")
    $cts = New-Object System.Threading.CancellationTokenSource
    $escHeld = $false
    try {
        # Escape is taken with a TEMPORARY global hotkey for the duration of the
        # wait. That makes cancel message-driven (impossible to miss, unlike
        # polling) and stops the keystroke leaking into whichever app is
        # focused. It is released the moment we are done either way.
        if ($Script:Hotkey) {
            $Script:Hotkey.TriggeredId = 0
            # MOD_NOREPEAT (0x4000) + VK_ESCAPE.
            $escHeld = $Script:Hotkey.Register($Script:HotkeyIdEsc, 0x4000, 0x1B)
            if (-not $escHeld -and -not $Script:EscHotkeyWarned) {
                $Script:EscHotkeyWarned = $true
                Write-Log "Note: another app owns bare Escape - the hotkey still re-draws, Esc just will not cancel."
            }
        }

        $task = (Get-Http).PostAsync($uri, $content, $cts.Token)
        $deadline = (Get-Date).AddSeconds($circleTimeoutSec)
        while (-not $task.IsCompleted) {
            [System.Windows.Forms.Application]::DoEvents()

            $id = 0
            if ($Script:Hotkey) { $id = $Script:Hotkey.TriggeredId }
            if ($id -ne 0) {
                $Script:Hotkey.TriggeredId = 0
                $cts.Cancel()
                if ($id -eq $Script:HotkeyIdEsc) { return @{ status = "esc" } }
                return @{ status = "again" }
            }
            if ((Get-Date) -gt $deadline) {
                $cts.Cancel()
                return @{ status = "timeout" }
            }
            Start-Sleep -Milliseconds 20
        }
        if ($task.IsFaulted -or $task.IsCanceled) {
            return @{ status = "error"; error = "request failed or was cancelled" }
        }
        $body = $task.Result.Content.ReadAsStringAsync().Result
        return @{ status = "ok"; data = ($body | ConvertFrom-Json) }
    } catch {
        return @{ status = "error"; error = $_.Exception.Message }
    } finally {
        if ($escHeld -and $Script:Hotkey) {
            try { $Script:Hotkey.Unregister($Script:HotkeyIdEsc) } catch {}
        }
        $cts.Dispose()
    }
}

# The whole gesture: freeze the screen, draw, crop, ask, show the card.
#
# Loops by design: pressing the circle hotkey again - while drawing OR while the
# answer is still on its way - re-freezes the screen and starts a fresh circle,
# so "press it again and circle something else" always just works.
function Invoke-CircleToSearch {
    if ($Script:CircleBusy) { return }
    if (-not $Script:CircleTypesLoaded) { return }
    $Script:CircleBusy = $true
    $frozen = $null
    $overlay = $null
    $crop = $null
    try {
        # for(;;) rather than while($true): the smoke tests cut this file at the
        # marker below, and this inner loop must not look like the main loop.
        for (;;) {
            Close-Card
            # Let the card actually disappear, or it ends up in the screenshot.
            Start-Sleep -Milliseconds 140
            [System.Windows.Forms.Application]::DoEvents()

            Write-Log "Circle to search - freezing the screen..."
            $shot = Get-ScreenFrame
            if (-not $shot) {
                Close-Card
                Write-Log "Circle to search: no screen frame."
                Show-Toast "JARVIS" "I could not capture the screen. Is the JARVIS server running?"
                return
            }
            $frozen = $shot.bitmap
            if ($Script:Hotkey) { $Script:Hotkey.TriggeredId = 0 }

            $overlay = New-Object JarvisCircleOverlay -ArgumentList $frozen, $shot.rect
            [void]$overlay.ShowDialog()

            $cancelled = [bool]$overlay.Cancelled
            $hasSel = [bool]$overlay.HasSelection
            $again = ($Script:Hotkey -and ($Script:Hotkey.TriggeredId -ne 0))
            if ($Script:Hotkey) { $Script:Hotkey.TriggeredId = 0 }

            if (-not $again -and $hasSel) {
                $crop = $overlay.BuildCrop($circleMaxWidth, $true)
                # Where the loop was, in screen coordinates - the overlay sits at
                # the virtual screen's origin, so its selection bounds are
                # already absolute once the frame offset is added.
                $sel = $overlay.SelectionBounds
                $selRect = New-Object System.Drawing.Rectangle -ArgumentList ($shot.rect.X + $sel.X), ($shot.rect.Y + $sel.Y), $sel.Width, $sel.Height
            }
            try { $overlay.Dispose() } catch {}
            $overlay = $null
            try { $frozen.Dispose() } catch {}
            $frozen = $null

            if ($again) {
                Write-Log "Circle to search: redraw requested - re-freezing the screen."
                continue
            }
            if ($cancelled -or -not $hasSel) {
                Write-Log "Circle to search cancelled."
                return
            }
            if (-not $crop) {
                Write-Log "Circle to search: the selection was too small."
                return
            }

            $bytes = Get-JpegBytes $crop
            $crop.Dispose()
            $crop = $null
            # Keep both for the action card: it acts on the same crop the search
            # saw, and knows where it was so a translation can sit in place.
            $Script:LastCircleCrop = $bytes
            $Script:LastCircleRect = $selRect
            $kb = [int]($bytes.Length / 1024)
            Write-Log "Circle to search - looking at a ${kb} KB crop..."

            if ($popupEnabled) {
                Show-WorkingCard "Searching" "circle" "Esc to cancel - $circleHotkey to redraw"
            }
            $resp = Invoke-CircleQuery $bytes
            Stop-Working

            if ($resp.status -eq "esc") {
                Close-Card
                Write-Log "Circle search cancelled with Esc."
                return
            }
            if ($resp.status -eq "again") {
                Close-Card
                Write-Log "Circle to search: redraw requested - re-freezing the screen."
                continue
            }
            if ($resp.status -eq "timeout") {
                Close-Card
                Write-Log "Circle search gave up after ${circleTimeoutSec}s."
                Show-Toast "JARVIS" "That circle took too long to answer. Try again, or circle a smaller area."
                return
            }
            if ($resp.status -ne "ok" -or -not $resp.data -or -not $resp.data.success) {
                Close-Card
                Write-Log "Circle search request failed: $($resp.error)"
                Show-Toast "JARVIS" "Circle search could not reach the JARVIS server. Is 'npm run dev' running?"
                return
            }

            $result = $resp.data
            $found = @($result.items).Count
            $elapsed = [string]$result.elapsedMs
            Write-Log "JARVIS - $($result.kindLabel): $($result.title) ($found results via $($result.provider), ${elapsed}ms)"
            if ($popupEnabled) { Show-CircleResultCard $result }
            else { Show-Toast "JARVIS - $($result.kindLabel)" ([string]$result.summary) }
            return
        }
    } catch {
        Write-Log "Circle to search failed: $($_.Exception.Message)"
        Close-Card
        Show-Toast "JARVIS" "Circle to search hit a problem. Check the terminal."
    } finally {
        try { if ($crop) { $crop.Dispose() } } catch {}
        try { if ($overlay) { $overlay.Dispose() } } catch {}
        try { if ($frozen) { $frozen.Dispose() } } catch {}
        $Script:CircleBusy = $false
    }
}

# ---------------------------------------------------------------------------
Write-Host "=========================================================="
Write-Host " JARVIS Clipboard Assistant - system-wide, detection first"
Write-Host " Copy anything: JARVIS names what it is, then shows buttons."
Write-Host " Endpoint:   $Script:Uri"
Write-Host " Assist:     $(if ($assistEnabled) { 'ON' } else { 'OFF' })   Actions: $(if ($actionsEnabled) { 'ON' } else { 'OFF' })   Images: $(if ($imagesEnabled) { 'ON' } else { 'OFF' })"
Write-Host " Ask first:  $(if ($askFirst) { 'ON' } else { 'OFF' })   Apply on screen: $(if ($applyEnabled) { 'ON' } else { 'OFF' })"
Write-Host " Card:       $(if ($popupEnabled) { $popupPos } else { 'off' })   Length: ${script:MinLen}-${script:MaxLen}   Poll: ${script:PollMs}ms"
Write-Host " Circle:     $(if ($circleEnabled) { $circleHotkey + ' - draw around anything' } else { 'off' })"
Write-Host "=========================================================="

$serverReachable = $false
# 15s: the dev server may still be compiling the route on its first request.
$probe = Invoke-JarvisGet $Script:Uri 15
if ($probe -and $probe.kinds) {
    [void](Import-Catalog $probe)
    $serverReachable = $true
    Write-Log "Server reachable at $apiBase - loaded $($probe.kinds.Count) clip kinds."
} elseif ($probe) {
    $serverReachable = $true
    Write-Log "Server reachable at $apiBase (no catalog - using built-in buttons)."
} else {
    Write-Log "WARNING: no JARVIS dev server at $apiBase. Start it with 'npm run dev', then restart this watcher."
}

# Circle to Search registers its own global hotkey (nothing else in this script
# touches RegisterHotKey, so there is no id collision with the screen agent).
Register-CircleHotkey

# Warm the circle route. Next compiles a route on its FIRST request, and in dev
# that can take several seconds - paying it here means the first circle you draw
# is already fast.
if ($circleEnabled -and $serverReachable) {
    Write-Log "Warming the circle route..."
    [void](Invoke-JarvisGet $Script:CircleUri 25)
}

$script:last = ""
$script:lastImageHash = ""
try { $script:last = [System.Windows.Forms.Clipboard]::GetText() } catch {}
try {
    $img0 = Get-ClipboardImage
    if ($img0) { $script:lastImageHash = $img0.hash }
} catch {}

# Ask the server what this clip is (zero model calls, ~1ms).
function Get-ClipOffer([string]$text, [string]$source, [string]$kindHint) {
    $payload = @{ text = $text; source = $source; action = "probe" }
    if ($kindHint) { $payload.kind = $kindHint }
    $resp = Invoke-JarvisPost $Script:Uri $payload 12
    if (-not $resp.ok) { return $null }
    if ($resp.data -and $resp.data.proceed -eq $false) { return @{ skip = $true } }
    if ($resp.data -and $resp.data.offer) { return $resp.data.offer }
    return $null
}

function Offer-Clip([string]$text, [string]$source, [string]$image) {
    Update-CatalogIfMissing
    $kindHint = ""
    if ($image) { $kindHint = "image" }
    $offer = Get-ClipOffer $text $source $kindHint
    if ($null -eq $offer) {
        # Server unreachable: still offer the basic buttons locally.
        if (-not $text -and -not $image) { return }
        if ($image) {
            $offer = @{ kind = "image"; label = "Image detected"; noun = "image"; preview = "(image)" }
        } else {
            $offer = @{ kind = "text"; label = "Text detected"; noun = "text"; preview = $text }
        }
    } elseif ($offer.skip) {
        Write-Log "Server already handled this clip - not offering."
        return
    }

    if ($popupEnabled -and ($actionsEnabled -or $askFirst)) {
        # The detection card costs nothing (no model call), so it is shown even
        # when actions are off - it is simply the old "ask first" prompt then.
        Show-DetectionCard $offer $text $source $image
    } elseif (-not $askFirst -and $text) {
        # Fully automatic mode: answer the clip without asking.
        Invoke-AutoAnalysis $text $source
    } elseif ($text) {
        Show-Toast "JARVIS - $($offer.label)" "Copied clip ready. Open JARVIS to act on it."
    }
}

# JARVIS-MAIN-LOOP-BELOW
# NOTE: scripts/clipboard-cards-smoke.ps1 and scripts/circle-hotkey-smoke.ps1
# load this file by cutting at the marker above, so keep it on a line of its own
# with everything before it complete (no enclosing block left open). The hotkey
# needs no explicit teardown: the OS releases it when this process exits.
while ($true) {
    [System.Windows.Forms.Application]::DoEvents()
    if ($Script:CardHideAt -and (Get-Date) -gt $Script:CardHideAt) { Close-Card }
    if ($Script:Hotkey -and $Script:Hotkey.TriggeredId -ne 0) {
        $Script:Hotkey.TriggeredId = 0
        Invoke-CircleToSearch
    }

    try {
        $text = ""
        $textChanged = $false
        if ([System.Windows.Forms.Clipboard]::ContainsText()) {
            $text = [System.Windows.Forms.Clipboard]::GetText()
            if ($text -and $text -ne $script:last) {
                $textChanged = $true
            }
        }

        $image = $null
        $imageChanged = $false
        if ($imagesEnabled -and -not $textChanged) {
            $img = Get-ClipboardImage
            if ($img -and $img.hash -ne $script:lastImageHash) {
                $image = $img
                $imageChanged = $true
            }
        }

        if ($textChanged) {
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
                Write-Log "New clip ($trimmedLen chars) - detecting..."
                Offer-Clip $text $source ""
            }
        } elseif ($imageChanged) {
            $script:lastImageHash = $image.hash
            $kb = [int]($image.bytes / 1024)
            if (-not $assistEnabled) {
                Write-Log "Copied an image ($kb KB) - assist is OFF, skipping."
            } else {
                $source = Get-CopySource
                Write-Log "New image clip ($kb KB) - detecting..."
                Offer-Clip "" $source $image.data
            }
        }
    } catch {
        # Clipboard locked by another process; retry on the next tick.
    }
    Start-Sleep -Milliseconds $script:PollMs
}
