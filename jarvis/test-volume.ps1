# Test script — set master volume to a target percent.
# Usage: powershell -ExecutionPolicy Bypass -File .\test-volume.ps1 -Target 50
param([int]$Target = 50)

$signature = @"
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c);
  int SetChannelVolumeLevel(uint c, float l, ref Guid g);
  int SetChannelVolumeLevelScalar(uint c, float l, ref Guid g);
  int GetChannelVolumeLevel(uint c, out float l);
  int GetChannelVolumeLevelScalar(uint c, out float l);
  int SetMute(int m, ref Guid g);
  int GetMute(out int m);
  int GetVolumeStepInfo(out uint s, out uint c);
  int VolumeStepUp(ref Guid g);
  int VolumeStepDown(ref Guid g);
  int QueryHardwareSupport(out uint s);
  int GetVolumeRange(out float min, out float max, out float inc);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1(); int NotImpl2(); int NotImpl3(); int NotImpl4();
  int NotImpl5(); int NotImpl6();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E8073636"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int clsctx, IntPtr p, out IAudioEndpointVolume vol);
}
"@

Add-Type -TypeDefinition $signature -ErrorAction SilentlyContinue

$en = New-Object MMDeviceEnumerator
$dev = $null
[void]$en.GetDefaultAudioEndpoint(0, 1, [ref]$dev)
$iid = [Guid]'5CDF2C82-841E-4546-9722-0CF74078229A'
$vol = $null
[void]$dev.Activate([ref]$iid, 0, [IntPtr]::Zero, [ref]$vol)

# Read current
$before = 0.0
[void]$vol.GetChannelVolumeLevelScalar(0, [ref]$before)
Write-Output ("before:" + $before)

# Set to target
$scalar = $Target / 100.0
[void]$vol.SetChannelVolumeLevelScalar(0, $scalar, [ref][Guid]::Empty)

# Read back
$actual = 0.0
[void]$vol.GetChannelVolumeLevelScalar(0, [ref]$actual)
Write-Output ("set:" + $scalar + " actual:" + $actual)
