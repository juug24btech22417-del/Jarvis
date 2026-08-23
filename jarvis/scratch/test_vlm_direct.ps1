Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$Screen   = [System.Windows.Forms.Screen]::PrimaryScreen
$Bitmap   = New-Object System.Drawing.Bitmap $Screen.Bounds.Width, $Screen.Bounds.Height
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.CopyFromScreen($Screen.Bounds.Left, $Screen.Bounds.Top, 0, 0, $Bitmap.Size)

# Scale down to save tokens — 50% of original
$newW = [int]($Screen.Bounds.Width * 0.5)
$newH = [int]($Screen.Bounds.Height * 0.5)
$Scaled = New-Object System.Drawing.Bitmap $newW, $newH
$GS = [System.Drawing.Graphics]::FromImage($Scaled)
$GS.DrawImage($Bitmap, 0, 0, $newW, $newH)

$MS = New-Object System.IO.MemoryStream
$Scaled.Save($MS, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$Base64 = [Convert]::ToBase64String($MS.ToArray())
$Bitmap.Dispose(); $Graphics.Dispose(); $Scaled.Dispose(); $GS.Dispose(); $MS.Dispose()

Write-Host ("Screenshot base64 length (50% JPEG): " + $Base64.Length)

# Call NVIDIA directly to see raw output
$apiKey = (Get-Content ".env.local" | Where-Object { $_ -match "NVIDIA_API_KEY" } | ForEach-Object { ($_ -split "=", 2)[1] })
Write-Host ("API Key found: " + ($apiKey.Length -gt 0))

$headers = @{
    "Authorization" = "Bearer $apiKey"
    "Content-Type"  = "application/json"
}

$prompt = "You are JARVIS. Look at this screenshot and tell me what you see on screen in 1-2 sentences. If you see Amazon or any shopping site, describe the product visible."

$messages = @(
    @{
        role    = "user"
        content = @(
            @{ type = "text"; text = $prompt },
            @{ type = "image_url"; image_url = @{ url = "data:image/jpeg;base64,$Base64" } }
        )
    }
)

$body = @{
    model       = "meta/llama-3.2-90b-vision-instruct"
    messages    = $messages
    max_tokens  = 200
    temperature = 0.1
} | ConvertTo-Json -Depth 10

Write-Host "Calling NVIDIA VLM directly..."
$response = Invoke-RestMethod -Uri "https://integrate.api.nvidia.com/v1/chat/completions" `
    -Method POST -Headers $headers -Body $body -TimeoutSec 60

Write-Host "=== RAW VLM OUTPUT ==="
Write-Host $response.choices[0].message.content
