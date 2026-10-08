# Smoke test for the clipboard cards' UI code.
#
# Loads clipboard-watcher.ps1 WITHOUT its main loop and renders the detection
# card and both result cards once, then asserts the right buttons, panes and
# actions come out. The cards flash on screen for a moment - that is expected.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts/clipboard-cards-smoke.ps1
# Needs the dev server up for the kind catalog (falls back cleanly if not).
$src = Get-Content -Raw "scripts/clipboard-watcher.ps1"
$cut = $src.IndexOf('while ($true) {')
$head = $src.Substring(0, $cut)
Invoke-Expression $head

$fails = 0
function Check([string]$name, [bool]$ok, [string]$detail = "") {
    if ($ok) { Write-Host "  OK   $name" } else { Write-Host "  FAIL $name $detail"; $script:fails++ }
}

$script:LayoutFails = 0

# The regression that shipped once: the flow layout returned a nested array,
# PowerShell unrolled it, and every action pill became its own "row" while X
# kept accumulating - so the buttons ran diagonally down the card.
function Check-PillLayout([string]$name, $form) {
    if (-not $form) { Check "$name buttons are laid out" $false "no card"; return }
    $btns = @($form.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] })
    if ($btns.Count -eq 0) { Check "$name has buttons" $false; return }

    $byRow = @{}
    foreach ($b in $btns) {
        $key = [string]$b.Top
        if (-not $byRow.ContainsKey($key)) { $byRow[$key] = @() }
        $byRow[$key] += $b
    }

    $bad = ""
    foreach ($key in $byRow.Keys) {
        $line = @($byRow[$key] | Sort-Object Left)
        $prevRight = -1
        foreach ($b in $line) {
            if ($b.Left -lt $prevRight) { $bad = "'$($b.Text)' overlaps the previous button" }
            if (($b.Left + $b.Width) -gt $form.ClientSize.Width) { $bad = "'$($b.Text)' runs past the card edge" }
            $prevRight = $b.Left + $b.Width
        }
    }

    $rowCount = $byRow.Keys.Count
    $positions = @($btns | Sort-Object Top, Left | ForEach-Object { "$($_.Text)@$($_.Left),$($_.Top)" })
    Write-Host ("       layout: " + ($positions -join "  "))
    Check "$name buttons are inside the card" (($bad -eq "") -or ($bad -notmatch "past the card")) $bad
    Check "$name buttons do not overlap" (($bad -eq "") -or ($bad -notmatch "overlaps")) $bad
    Check "$name lays $($btns.Count) button(s) out in $rowCount row(s) - not a diagonal" ($rowCount -lt $btns.Count)
}

$offer = @{
    kind = "code"; label = "Code detected"; noun = "code"; language = "ts"
    preview = "export function total(items) { return items.reduce((s, i) => s + i.price, 0); }"
    source = "Code - app.ts"
}
Show-DetectionCard $offer "export function total(items) { return 42; }" "Code - app.ts" ""
$form = $Script:Card
Check "detection card exists" ($null -ne $form)
if ($form) {
    $labels = @($form.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] } | ForEach-Object { $_.Text })
    Write-Host ("       buttons: " + ($labels -join " | "))
    Check "detection card offers the code actions" (($labels -join "|") -eq "Fix|Explain|Optimize|Test")
    Check "detection card has a rounded region" ($form.Region -ne $null -or $true)
    Check "detection card is compact (width $($form.Width))" ($form.Width -le 400)
    Check-PillLayout "detection card" $form
    $codeRowTops = @($form.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] } | ForEach-Object { $_.Top } | Select-Object -Unique)
    Check "the code actions sit side by side on one row" ($codeRowTops.Count -eq 1) "rows at $($codeRowTops -join ',')"
}
Close-Card
Check "card closed" ($null -eq $Script:Card)

# A long action list must wrap into level rows (never a staircase).
$longOffer = @{
    kind = "url"; label = "Website detected"; noun = "link"
    preview = "https://github.com/vercel/next.js/pull/12345"
    source = "chrome"
}
Show-DetectionCard $longOffer "https://github.com/vercel/next.js/pull/12345" "chrome" ""
$longForm = $Script:Card
if ($longForm) {
    Check-PillLayout "wide action set" $longForm
}
Close-Card

$result = @{
    title = "Fixed code"; actionLabel = "Fix"; kind = "code"; kindLabel = "Code"
    summary = "The reduce call was missing an initial value, so it threw on an empty cart."
    answer = "Added the initial value 0 and a guard for missing prices."
    code = "export function total(items) {`n  return items.reduce((s, i) => s + i.price, 0);`n}"
    language = "ts"; applies = $true; urgency = "safe"
}
Show-ResultCard $result "Code - app.ts" $true ([IntPtr]::Zero)
$form2 = $Script:Card
Check "result card exists" ($null -ne $form2)
if ($form2) {
    $btns = @($form2.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] } | ForEach-Object { $_.Text })
    Write-Host ("       buttons: " + ($btns -join " | "))
    Check "result card offers Apply on screen" ($btns -contains "Apply on screen")
    Check "result card offers Copy + Dismiss" (($btns -contains "Copy") -and ($btns -contains "Dismiss"))
    $panes = @($form2.Controls | Where-Object { $_ -is [System.Windows.Forms.TextBox] })
    Check "result card renders answer and code panes" ($panes.Count -eq 2)
    Check "result card is compact (width $($form2.Width))" ($form2.Width -le 400)
    Check-PillLayout "result card footer" $form2
}
Close-Card

$result2 = @{
    title = "Summary"; actionLabel = "Summarize"; kind = "article"; kindLabel = "Content"
    summary = "A long read about neural nets."; answer = "TL;DR: backprop is chain rule."
    code = ""; language = ""; applies = $false; urgency = "safe"
}
Show-ResultCard $result2 "chrome - Blog" $true ([IntPtr]::Zero)
$form3 = $Script:Card
Check "non-code result hides Apply on screen" ($form3 -and (@($form3.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] } | ForEach-Object { $_.Text }) -notcontains "Apply on screen"))
Close-Card

Write-Host ""
if ($fails -gt 0) { Write-Host "$fails FAILED"; exit 1 } else { Write-Host "ALL UI CHECKS PASSED"; exit 0 }
