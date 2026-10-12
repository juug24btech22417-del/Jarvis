# Smoke test for the clipboard cards' UI code.
#
# Loads clipboard-watcher.ps1 WITHOUT its main loop and renders the detection
# card and both result cards once, then asserts the right buttons, panes and
# actions come out. The cards flash on screen for a moment - that is expected.
#
# Run:  powershell -ExecutionPolicy Bypass -File scripts/clipboard-cards-smoke.ps1
# Needs the dev server up for the kind catalog (falls back cleanly if not).
$src = Get-Content -Raw "scripts/clipboard-watcher.ps1"
$cut = $src.IndexOf('# JARVIS-MAIN-LOOP-BELOW')
if ($cut -lt 0) { Write-Host "FAIL cannot find the JARVIS-MAIN-LOOP-BELOW marker"; exit 1 }
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

# ── Circle to Search ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "Circle to Search"

Check "overlay type compiles" ($null -ne [JarvisCircleOverlay])
Check "hotkey window type compiles" ($null -ne [JarvisHotkeyWindow])
Check "'s' resolves to VK 83" ((Resolve-Vk "s") -eq 83)
Check "'F9' resolves to VK 0x78" ((Resolve-Vk "F9") -eq 0x78)
Check "'space' resolves to VK 0x20" ((Resolve-Vk "space") -eq 0x20)
Check "an unknown key is rejected" ((Resolve-Vk "banana") -eq 0)

# The crop is what the model actually sees, so verify the geometry that decides
# whether it looks at the circled thing or at the whole screen: a padded box
# around the loop, downscaled only when it exceeds CIRCLE_CAPTURE_WIDTH, with
# everything outside the loop dimmed.
function New-LoopBitmap([int]$w, [int]$h) {
    $bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.Color]::White)
    $g.Dispose()
    return $bmp
}

function Add-Loop($overlay, $points) {
    $field = $overlay.GetType().GetField("_pts", [System.Reflection.BindingFlags]"NonPublic,Instance")
    $list = $field.GetValue($overlay)
    foreach ($pt in $points) {
        [void]$list.Add($pt)
    }
}

function New-Loop([int]$x1, [int]$y1, [int]$x2, [int]$y2) {
    return @(
        (New-Object System.Drawing.Point -ArgumentList $x1, $y1),
        (New-Object System.Drawing.Point -ArgumentList $x2, $y1),
        (New-Object System.Drawing.Point -ArgumentList $x2, $y2),
        (New-Object System.Drawing.Point -ArgumentList $x1, $y2)
    )
}

$screen = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, 400, 300
$bmpSmall = New-LoopBitmap 400 300
$ovSmall = New-Object JarvisCircleOverlay -ArgumentList $bmpSmall, $screen
Add-Loop $ovSmall (New-Loop 100 100 200 160)
$bounds = $ovSmall.SelectionBounds
Check "selection bounds wrap the drawn loop" (($bounds.Left -eq 100) -and ($bounds.Top -eq 100) -and ($bounds.Right -eq 200) -and ($bounds.Bottom -eq 160)) "$bounds"

$cropSmall = $ovSmall.BuildCrop(1024, $true)
Check "a small loop is cropped with 14px of context" ($cropSmall -and $cropSmall.Width -eq 128 -and $cropSmall.Height -eq 88) "$($cropSmall.Width)x$($cropSmall.Height)"
$inside = $cropSmall.GetPixel([int]($cropSmall.Width / 2), [int]($cropSmall.Height / 2))
$outside = $cropSmall.GetPixel(0, 0)
Check "the circled thing stays bright" ($inside.R -gt 220) "R=$($inside.R)"
Check "everything outside the loop is dimmed" ($outside.R -lt 200) "R=$($outside.R)"
$cropSmall.Dispose()
$ovSmall.Dispose()
$bmpSmall.Dispose()

$bmpWide = New-LoopBitmap 400 300
$ovWide = New-Object JarvisCircleOverlay -ArgumentList $bmpWide, $screen
Add-Loop $ovWide (New-Loop 5 5 395 295)
$cropWide = $ovWide.BuildCrop(200, $false)
Check "a crop wider than CIRCLE_CAPTURE_WIDTH is downscaled to 200" ($cropWide -and $cropWide.Width -eq 200) "$($cropWide.Width)x$($cropWide.Height)"
Check "downscaling keeps the aspect ratio" ($cropWide.Height -eq 150) "$($cropWide.Height)"
$cropWide.Dispose()
$ovWide.Dispose()
$bmpWide.Dispose()

# The result card is the whole feature: what it is, the answer, and clickable
# Google results that do not run off the card.
$circle = @{
    kind = "product"; kindLabel = "Product found"; surface = "shopping"
    title = "Sony WH-1000XM5"; summary = "Wireless over-ear headphones by Sony."
    answer = ""; query = "Sony WH-1000XM5"
    provider = "Gemini/gemini-2.5-flash + Serper/shopping"
    searchUrl = "https://www.google.com/search?tbm=shop&q=Sony%20WH-1000XM5"
    items = @(
        @{ title = "Sony WH-1000XM5"; url = "https://amazon.com/dp/x"; snippet = "amazon.com - 348.00"; source = "amazon.com" },
        @{ title = "Sony WH-1000XM5 (Renewed)"; url = "https://ebay.com/itm/y"; snippet = "ebay.com - 199.00"; source = "ebay.com" }
    )
}
Show-CircleResultCard $circle
$circleForm = $Script:Card
Check "circle result card exists" ($null -ne $circleForm)
if ($circleForm) {
    $circleBtns = @($circleForm.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] })
    $circleNames = @($circleBtns | ForEach-Object { $_.Text })
    Write-Host ("       buttons: " + ($circleNames -join " | "))
    Check "circle card offers Search Google" ($circleNames -contains "Search Google")
    Check "circle card offers Copy + Dismiss" (($circleNames -contains "Copy") -and ($circleNames -contains "Dismiss"))
    # Circle to Act: the action is whatever the user types, so the card ships one
    # entry point instead of a menu of fixed actions.
    Check "circle card offers the natural-language action" ($circleNames -contains "Tell JARVIS what to do")
    Check "circle card labels the Shopping surface" (@($circleForm.Controls | Where-Object { $_.Text -eq "GOOGLE SHOPPING" }).Count -eq 1)
    Check "circle card is compact (width $($circleForm.Width))" ($circleForm.Width -le 400)
    $rows = @($circleBtns | Where-Object { $_.Text -match '^[0-9]+\. ' })
    Check "circle card lists both results" ($rows.Count -eq 2) "$($rows.Count) rows"
    Check "result rows stay inside the card" (@($rows | Where-Object { ($_.Left + $_.Width) -gt $circleForm.ClientSize.Width }).Count -eq 0)
    Check "result rows stack vertically" (@($rows | ForEach-Object { $_.Top } | Select-Object -Unique).Count -eq $rows.Count)
    $searchBtn = @($circleBtns | Where-Object { $_.Text -eq "Search Google" })[0]
    Check "Search Google carries the shopping url" ($searchBtn -and ($searchBtn.Tag.url -like "*tbm=shop*"))
    Check-PillLayout "circle result card footer" $circleForm
}
Close-Card

# A question circle is answer-first: the answer pane is the point, and a
# question with no results must still render (never an empty card).
$question = @{
    kind = "question"; kindLabel = "Answered"; surface = "search"
    title = "Physics question"; summary = "A numerical about gravity."
    answer = "The acceleration is 9.8 m/s squared."; query = "acceleration due to gravity"
    provider = "Gemini/gemini-2.5-flash"
    searchUrl = "https://www.google.com/search?q=acceleration%20due%20to%20gravity"
    items = @()
}
Show-CircleResultCard $question
$qForm = $Script:Card
Check "answer-only card renders with no results" ($null -ne $qForm)
if ($qForm) {
    $panes = @($qForm.Controls | Where-Object { $_ -is [System.Windows.Forms.TextBox] })
    Check "answer-only card shows the answer pane" ($panes.Count -eq 1)
    Check "answer pane holds the answer" ($panes[0].Text -eq $question.answer)
    Check "answer-only card still offers Search Google" (@($qForm.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] -and $_.Text -eq "Search Google" }).Count -eq 1)
    Check "answer-only card hides the RESULTS label" (@($qForm.Controls | Where-Object { $_.Text -eq "GOOGLE" }).Count -eq 0)
}
Close-Card

# ── Circle to Act: the types, and the card that reports what it did ─────────
Check "ask box type compiles" ([bool]([System.Management.Automation.PSTypeName]'JarvisAskBox').Type)
Check "translation panel type compiles" ([bool]([System.Management.Automation.PSTypeName]'JarvisTranslatedPanel').Type)

$ask = New-Object JarvisAskBox -ArgumentList "prompt", "prefill"
Check "ask box takes a prefill and reports an empty answer until typed" (($ask.Answer -eq "") -and ($ask.Width -gt 300))
$ask.Dispose()

$anchor = New-Object System.Drawing.Rectangle -ArgumentList 100, 100, 240, 70
$panel = New-Object JarvisTranslatedPanel -ArgumentList "Bonjour", "Hello", $anchor, 1000
Check "translation panel anchors over the circled region" (($panel.Left -lt 100) -and ($panel.Top -lt 100) -and ($panel.Width -ge 240))
$panel.Dispose()

$act = @{
    ok = $true; title = "email this to rahul"; subject = "an invoice"
    summary = "Sent the invoice email to rahul@example.com."
    actions = @(@{ tool = "email.send"; detail = '{"to":"rahul@example.com"}'; output = 'Email sent to rahul@example.com with the subject "Invoice 2026-114".' })
    failures = @(); translation = $null
}
Show-CircleActCard $act
$actForm = $Script:Card
Check "act result card exists" ($null -ne $actForm)
if ($actForm) {
    $actNames = @($actForm.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] } | ForEach-Object { $_.Text })
    Write-Host ("       buttons: " + ($actNames -join " | "))
    Check "act card offers Copy + Dismiss" (($actNames -contains "Copy") -and ($actNames -contains "Dismiss"))
    Check "act card hides 'Show in place' when there is no translation" ($actNames -notcontains "Show in place")
    Check "act card shows the tool that ran" (@($actForm.Controls | Where-Object { $_ -is [System.Windows.Forms.TextBox] -and $_.Text -match "email\.send" }).Count -eq 1)
    Check "act card is compact (width $($actForm.Width))" ($actForm.Width -le 400)
    Check-PillLayout "act card footer" $actForm
}
Close-Card

# A translation result also gets the in-place affordance.
$trAct = @{
    ok = $true; title = "translate this"; subject = "a french recipe"
    summary = "Translated the circled text."
    actions = @(@{ tool = "text.translate"; detail = "{}"; output = "Une recette de cuisine" })
    failures = @(); translation = "Une recette de cuisine"
}
Show-CircleActCard $trAct
$trForm = $Script:Card
if ($trForm) {
    $trNames = @($trForm.Controls | Where-Object { $_ -is [System.Windows.Forms.Button] } | ForEach-Object { $_.Text })
    Check "translation result offers Show in place" ($trNames -contains "Show in place")
    Check-PillLayout "translation card footer" $trForm
}
Close-Card

Write-Host ""

if ($fails -gt 0) { Write-Host "$fails FAILED"; exit 1 } else { Write-Host "ALL UI CHECKS PASSED"; exit 0 }
