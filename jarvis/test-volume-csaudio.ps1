# Master volume via IAudioEndpointVolume.
# Strategy: define both the [ComImport] interfaces AND the [ComImport] class
# in C# (via Add-Type). PowerShell's COM activator then CoCreates the class
# and QueryInterfaces it. The interfaces must be declared in the SAME C#
# file (not split) so the C# compiler emits the vtables correctly.

$src = @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface _IMMDeviceEnumerator
{
    [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwFlagsMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IntPtr ppDevice);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E07FDAD5"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface _IMMDevice
{
    [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
    [PreserveSig] int OpenPropertyStore(uint stgmAccess, out IntPtr ppProperties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
    [PreserveSig] int GetState(out uint pdwState);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface _IAudioEndpointVolume
{
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
public class _MMDeviceEnumerator { }
'@

Add-Type -TypeDefinition $src -Language CSharp

# Instantiate via the [ComImport] class. PowerShell's activator sees the
# Guid attribute and calls CoCreateInstance.
try {
    $enumerator = New-Object _MMDeviceEnumerator
    Write-Output ("enumerator: " + $enumerator.GetType().FullName)
} catch {
    Write-Output ("FAIL New-Object: " + $_.Exception.Message)
    if ($_.Exception.InnerException) { Write-Output ("  Inner: " + $_.Exception.InnerException.InnerException.Message) }
    exit 1
}

# Cast to managed interface and call GetDefaultAudioEndpoint.
try {
    $en = [_IMMDeviceEnumerator]$enumerator
    $devPtr = [IntPtr]::Zero
    # eRender=0, eConsole=1
    $hr = $en.GetDefaultAudioEndpoint(0, 1, [ref]$devPtr)
    Write-Output ("GetDefaultAudioEndpoint hr=$hr devPtr=0x{0:x}" -f $devPtr.ToInt64())
    if ($hr -ne 0) { exit 2 }
} catch {
    Write-Output ("FAIL enum cast: " + $_.Exception.Message)
    if ($_.Exception.InnerException) { Write-Output ("  Inner: " + $_.Exception.InnerException.Message) }
    exit 3
}

# Wrap the IMMDevice raw pointer as a __ComObject so we can cast it.
# Marshal.GetObjectForIUnknown is the canonical way.
try {
    $devObj = [Runtime.InteropServices.Marshal]::GetObjectForIUnknown($devPtr)
    Write-Output ("devObj: " + $devObj.GetType().FullName)
    $dev = [_IMMDevice]$devObj

    $audioIid = [Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"
    $epPtr = [IntPtr]::Zero
    # CLSCTX_ALL = 0x17
    $hr = $dev.Activate([ref]$audioIid, 0x17, [IntPtr]::Zero, [ref]$epPtr)
    Write-Output ("Activate hr=$hr epPtr=0x{0:x}" -f $epPtr.ToInt64())
    if ($hr -ne 0) { exit 4 }
} catch {
    Write-Output ("FAIL device cast/activate: " + $_.Exception.Message)
    if ($_.Exception.InnerException) { Write-Output ("  Inner: " + $_.Exception.InnerException.Message) }
    exit 5
}

try {
    $epObj = [Runtime.InteropServices.Marshal]::GetObjectForIUnknown($epPtr)
    $ep = [_IAudioEndpointVolume]$epObj

    $before = [float]0.0
    $null = $ep.GetChannelVolumeLevelScalar([uint32]0, [ref]$before)
    Write-Output ("Before: {0:P1}" -f $before)

    # Set to 50%
    $target = [float]0.5
    $null = $ep.SetChannelVolumeLevelScalar([uint32]0, $target, [ref][Guid]::Empty)
    Write-Output ("Set: $target")

    Start-Sleep -Milliseconds 100

    $after = [float]0.0
    $null = $ep.GetChannelVolumeLevelScalar([uint32]0, [ref]$after)
    Write-Output ("After:  {0:P1}" -f $after)
} catch {
    Write-Output ("FAIL endpoint cast: " + $_.Exception.Message)
    if ($_.Exception.InnerException) { Write-Output ("  Inner: " + $_.Exception.InnerException.Message) }
    exit 6
}