# Read master waveOut volume in a fresh process.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class M {
    [DllImport("winmm.dll")]
    public static extern int waveOutGetVolume(IntPtr hwo, out uint pdwVolume);
}
'@

$v = 0
$null = [M]::waveOutGetVolume([IntPtr]::Zero, [ref]$v)
$left = ($v -band 0xFFFF) * 100 / 65535
Write-Output ("read-back: {0}% (raw={1})" -f [int]$left, $v)