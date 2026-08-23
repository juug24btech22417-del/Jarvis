Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$Screen   = [System.Windows.Forms.Screen]::PrimaryScreen
$Bitmap   = New-Object System.Drawing.Bitmap $Screen.Bounds.Width, $Screen.Bounds.Height
$Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
$Graphics.CopyFromScreen($Screen.Bounds.Left, $Screen.Bounds.Top, 0, 0, $Bitmap.Size)
$MS       = New-Object System.IO.MemoryStream
$Bitmap.Save($MS, [System.Drawing.Imaging.ImageFormat]::Png)
$Base64   = [Convert]::ToBase64String($MS.ToArray())
$Bitmap.Dispose()
$Graphics.Dispose()
$MS.Dispose()

Write-Host ("Screenshot base64 length: " + $Base64.Length)

# POST to sentinel analyze
$body = '{"imageBase64":"' + $Base64 + '"}'
$response = Invoke-RestMethod -Uri "http://localhost:3002/api/sentinel/analyze" `
    -Method POST `
    -ContentType "application/json" `
    -Body $body `
    -TimeoutSec 60

Write-Host "=== SENTINEL ANALYZE RESPONSE ==="
Write-Host ($response | ConvertTo-Json -Depth 5)
