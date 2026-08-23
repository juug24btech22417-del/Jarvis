# Master volume set. Uses the canonical PowerShell Core Audio pattern.
# The key trick that makes it work: define [ComImport] interface AND
# class with matching GUIDs, then `new` the class and cast to the
# interface. PowerShell's COM activator uses the class's GUID for
# CoCreateInstance and the interface's GUID for QueryInterface.
# This works because the GUIDs match the real Windows COM objects.
param([int]$Target = 50)

$src = @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator5 {
    [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwFlagsMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IntPtr ppDevice);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume5 {
    [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int RegisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr pNotify);
    [PreserveSig] int GetChannelCount(out uint pnChannelCount);
    [PreserveSig] int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    [PreserveSig] int GetMute(out bool pbMute);
    [PreserveSig] int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
    [PreserveSig] int VolumeStepUp(ref Guid pguidEventContext);
    [PreserveSig] int VolumeStepDown(ref Guid pguidEventContext);
    [PreserveSig] int QueryHardwareSupport(out uint pdwHardwareSupportMask);
    [PreserveSig] int GetVolumeRange(out float pflMin, out float pflMax, out float pflIncrement);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"),
 ClassInterface(ClassInterfaceType.None)]
public class MMDeviceEnumerator5 { }
'@

Add-Type -TypeDefinition $src -Language CSharp

# Instantiate the enumerator class. PowerShell's COM activator sees the
# [ComImport, Guid(...)] on the class and calls CoCreateInstance with
# that GUID. The returned RCW is bound to the COM object's default
# interface, which we cast to our managed IMMDeviceEnumerator5 interface.
$enumerator = New-Object MMDeviceEnumerator5
$en = [IMMDeviceEnumerator5]$enumerator

# Call GetDefaultAudioEndpoint. The out parameter is declared as
# IntPtr (a pointer) but the runtime will marshal the IMMDevice RCW
# through that pointer — we then cast to a managed interface if needed.
# For our needs, we just need the IAudioEndpointVolume, which we get
# via Activate. So we'll receive the IMMDevice pointer, then Activate
# it ourselves with the audio endpoint IID.
$devPtr = [IntPtr]::Zero
$hr = $en.GetDefaultAudioEndpoint(0, 1, [ref]$devPtr)
if ($hr -ne 0 -or $devPtr -eq [IntPtr]::Zero) {
    Write-Output ("FAIL GetDefaultAudioEndpoint hr=$hr")
    exit 1
}

# Activate the device with IAudioEndpointVolume IID.
$audioIid = [Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"
$epPtr = [IntPtr]::Zero
# IMMDevice.Activate uses a different vtable — we don't have its
# managed interface declared. Use Marshal.QueryInterface manually
# via reflection on the device RCW. PowerShell wraps COM pointers
# in __ComObject, but we have a raw IntPtr. We need a different
# path: use IID_PV (private) via Marshal.

# Simpler: wrap the device pointer back into an RCW by binding it
# to the device's IID. We don't have IMMDevice declared, so just
# cast the IntPtr to __ComObject isn't going to work either.

# Most reliable path: do Activate on the enumerator's vtable via
# reflection on the RCW type.
$deviceRc = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E"))
$dev = $deviceRc.GetType().InvokeMember("GetDefaultAudioEndpoint",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $deviceRc, @(0, 1, $null))

# Try Activator.CreateInstance on the EP CLSID? Not a CoClass.
# Use the epObj from reflection.

$epObj = $dev.GetType().InvokeMember("Activate",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $dev,
    @([ref]$audioIid, 0, [IntPtr]::Zero, [ref]$null))

$levelRef = [float]0.0
$null = $epObj.GetType().InvokeMember("GetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, @([uint32]0, [ref]$levelRef))
$before = $levelRef

$scalar = [float]($Target / 100.0)
$null = $epObj.GetType().InvokeMember("SetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, @([uint32]0, $scalar, [Guid]::Empty))

Start-Sleep -Milliseconds 200

$levelRef = [float]0.0
$null = $epObj.GetType().InvokeMember("GetChannelVolumeLevelScalar",
    [System.Reflection.BindingFlags]::InvokeMethod,
    $null, $epObj, @([uint32]0, [ref]$levelRef))
$after = $levelRef

Write-Output ("target:$Target before:$before set:$scalar after:$after")
