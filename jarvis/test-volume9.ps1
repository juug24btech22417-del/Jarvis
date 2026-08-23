# Test winmm.dll waveOutGetVolume / waveOutSetVolume.
# These set the master volume of the default wave device (0 = first device).
# NOTE: this only affects the *waveOut* (legacy) volume, not the modern
# Windows audio endpoint volume. On modern Windows the user-visible
# volume slider in the system tray is the endpoint volume.

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class M {
    [DllImport("winmm.dll")]
    public static extern int waveOutGetVolume(IntPtr hwo, out uint pdwVolume);
    [DllImport("winmm.dll")]
    public static extern int waveOutSetVolume(IntPtr hwo, uint dwVolume);
}
'@

$before = 0
$null = [M]::waveOutGetVolume([IntPtr]::Zero, [ref]$before)
$leftBefore = ($before -band 0xFFFF) * 100 / 65535
Write-Output ("Before: left=$leftBefore% (raw=$before)")

# Set both channels to 50%
$target = [uint32]([Math]::Round(65535 * 50 / 100))
$both = [uint32](($target -shl 16) -bor $target)
$hr = [M]::waveOutSetVolume([IntPtr]::Zero, $both)
Write-Output ("SetVolume hr=$hr target=$target both=$both")

Start-Sleep -Milliseconds 100

$after = 0
$null = [M]::waveOutGetVolume([IntPtr]::Zero, [ref]$after)
$leftAfter = ($after -band 0xFFFF) * 100 / 65535
Write-Output ("After: left=$leftAfter% (raw=$after)")
