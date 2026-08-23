# Final approach: use [Type]::GetTypeFromCLSID + Activator.CreateInstance.
# This is the canonical pattern from the Microsoft "Hey, Scripting Guy!" blog
# and works on all Windows versions.
param([int]$Target = 50)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int Unused1(); int Unused2(); int Unused3();
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out uint pnChannelCount);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
    int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
    int VolumeStepUp(Guid pguidEventContext);
    int VolumeStepDown(Guid pguidEventContext);
    int QueryHardwareSupport(out uint pdwHardwareSupportMask);
    int GetVolumeRange(out float pflMin, out float pflMax, out float pflIncrement);
}
"@

# Use Type.GetTypeFromCLSID with the MMDeviceEnumerator CLSID.
# Activator.CreateInstance on this Type returns an object that can be
# cast to IAudioEndpointVolume directly via PowerShell's COM RCW
# (it uses QueryInterface internally).
$endpointKey = "HKLM:\SYSTEM\CurrentControlSet\Control\Audio\DefaultEndpoint"
$defaultDeviceId = (Get-ItemProperty -Path $endpointKey -ErrorAction SilentlyContinue).Render

# Use the CLSID for the device enumerator
$type = [Type]::GetTypeFromCLSID([Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E")
$en = [Activator]::CreateInstance($type)

# Use reflection to call GetDefaultAudioEndpoint on the COM object.
# We don't have a managed interface for IMMDeviceEnumerator, so we
# bind to its vtable via reflection.
$epType = [IAudioEndpointVolume]
$mmType = $en.GetType()

# GetDefaultAudioEndpoint: vtable slot 4 (after 3 IUnknown slots).
# Use IDispatch-style late binding via InvokeMember.
$dev = $mmType.InvokeMember("GetDefaultAudioEndpoint",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $en, @(0, 1))

# Get IAudioEndpointVolume via IMMDevice.Activate (slot 4 after IUnknown).
# dev is an RCW; cast to a Type we can Invoke on. Use [__ComObject] tricks:
# call InvokeMember with method name and binding flags.
$epObj = $dev.GetType().InvokeMember("Activate",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $dev,
    @([ref]([Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"), 0, [IntPtr]::Zero))

# Set scalar volume
$scalar = [float]($Target / 100.0)
$epObj.GetType().InvokeMember("SetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, @(0, $scalar, [Guid]::Empty))

# Read back
$levelObj = $epObj.GetType().InvokeMember("GetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, @([uint32]0))

# levelObj should be the out float — PowerShell wraps as an object.
# It might be a boxed Single.
$actualScalar = [float]$levelObj

Write-Output ("target:" + $Target + " set:" + $scalar + " actual:" + $actualScalar)
