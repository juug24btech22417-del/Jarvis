Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$Screen = [System.Windows.Forms.Screen]::PrimaryScreen
$Bitmap = New-Object System.Drawing.Bitmap $Screen.Bounds.Width, $Screen.Bounds.Height
$G = [System.Drawing.Graphics]::FromImage($Bitmap)
$G.CopyFromScreen($Screen.Bounds.Left, $Screen.Bounds.Top, 0, 0, $Bitmap.Size)
$MS = New-Object System.IO.MemoryStream
$Bitmap.Save($MS, [System.Drawing.Imaging.ImageFormat]::Png)
$b64 = [Convert]::ToBase64String($MS.ToArray())
Write-Output ("FIRST50: " + $b64.Substring(0, 50))
Write-Output ("LENGTH: " + $b64.Length)
$Bitmap.Dispose()
$G.Dispose()
$MS.Dispose()
