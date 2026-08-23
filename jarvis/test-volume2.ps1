# Set master volume using the documented Windows Audio API pattern.
# Reference: https://learn.microsoft.com/en-us/windows/win32/coreaudio/endpoint-volume-programming-guide
param([int]$Target = 50)

Add-Type -TypeDefinition @"
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    [PreserveSig] int NotImpl1();
    [PreserveSig] int NotImpl2();
    [PreserveSig] int NotImpl3();
    [PreserveSig] int NotImpl4();
    [PreserveSig] int NotImpl5();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
    [PreserveSig] int NotImpl7();
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E8073636"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsctx, IntPtr activationParams, out IAudioEndpointVolume audioEndpoint);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume {
    [PreserveSig] int NotImpl0();
    [PreserveSig] int NotImpl1();
    [PreserveSig] int NotImpl2();
    [PreserveSig] int SetChannelVolumeLevel(uint channelCount, float level, ref Guid eventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channelCount, float level, ref Guid eventContext);
    [PreserveSig] int NotImpl5();
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channelCount, out float level);
    [PreserveSig] int NotImpl7();
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute(out bool mute);
}
"@ -Language CSharp

$enumeratorType = [Type]"MMDeviceEnumerator"
$enumerator = [Activator]::CreateInstance($enumeratorType)

# IMMDeviceEnumerator interface as a typed reference
$deviceEnumeratorType = [Type]"IMMDeviceEnumerator"
$deviceType = [Type]"IMMDevice"

# Get the GetDefaultAudioEndpoint method via reflection on the COM
# object's IDispatch-like surface — but we declared the interface, so
# we can cast directly.
$riid = [Guid]'A95664D2-9614-4F35-A746-DE8DB63625E6'
# Use Marshal.QueryInterface via reflection — simpler approach:
# cast the enumerator to the typed interface reference.
$devEnum = $enumerator
$getMethod = $deviceEnumeratorType.GetMethod("GetDefaultAudioEndpoint")
$device = $null
[void]$getMethod.Invoke($devEnum, @([int]0, [int]1, [ref]$device))

$activateMethod = $deviceType.GetMethod("Activate")
$audioIid = [Guid]'5CDF2C82-841E-4546-9722-0CF74078229A'
$audio = $null
[void]$activateMethod.Invoke($device, @([ref]$audioIid, [int]0, [IntPtr]::Zero, [ref]$audio))

# Now use IAudioEndpointVolume methods
$epType = [Type]"IAudioEndpointVolume"
$setScalar = $epType.GetMethod("SetChannelVolumeLevelScalar")
$getScalar = $epType.GetMethod("GetChannelVolumeLevelScalar")

$scalar = [float]($Target / 100.0)
$emptyGuid = [Guid]::Empty
[void]$setScalar.Invoke($audio, @([uint32]0, $scalar, [ref]$emptyGuid))

$actual = [float]0.0
[void]$getScalar.Invoke($audio, @([uint32]0, [ref]$actual))

Write-Output ("before-target:" + $Target + " set:" + $scalar + " actual:" + $actual)
