# Core Audio API test - variant using Type.GetTypeFromCLSID + .NET RCW.

$src = @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface _IMMDeviceEnumerator2
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
public interface _IMMDevice2
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
public interface _IAudioEndpointVolume2
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
'@

Add-Type -TypeDefinition $src -Language CSharp

# Step 1: create enumerator via Type.GetTypeFromCLSID, which uses .NET's
# built-in COM activator (handles STA apartment and CLSCTX properly).
$clsid = [Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E"
$enType = [Type]::GetTypeFromCLSID($clsid)
Write-Output ("enType: " + $enType.FullName)

try {
    $en = [Activator]::CreateInstance($enType)
    Write-Output ("en: " + $en.GetType().FullName)
} catch {
    Write-Output ("FAIL CreateInstance: " + $_.Exception.Message)
    if ($_.Exception.InnerException) { Write-Output ("  Inner: " + $_.Exception.InnerException.Message) }
    exit 1
}

# Cast the __ComObject to our managed interface.
try {
    $enIf = [_IMMDeviceEnumerator2]$en
    Write-Output ("Cast to _IMMDeviceEnumerator2 OK")
} catch {
    Write-Output ("FAIL cast: " + $_.Exception.Message)
    exit 2
}

# Step 2: get the default audio endpoint.
$devPtr = [IntPtr]::Zero
$hr = $enIf.GetDefaultAudioEndpoint(0, 1, [ref]$devPtr)
Write-Output ("GetDefaultAudioEndpoint hr=$hr devPtr=0x{0:x}" -f $devPtr.ToInt64())
if ($hr -ne 0) { exit 3 }

# Step 3: wrap device pointer as COM object and activate for IAudioEndpointVolume.
$devObj = [Runtime.InteropServices.Marshal]::GetObjectForIUnknown($devPtr)
$dev = [_IMMDevice2]$devObj
Write-Output ("dev cast OK")

$audioIid = [Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"
$epPtr = [IntPtr]::Zero
$hr = $dev.Activate([ref]$audioIid, 0x17, [IntPtr]::Zero, [ref]$epPtr)
Write-Output ("Activate hr=$hr epPtr=0x{0:x}" -f $epPtr.ToInt64())
if ($hr -ne 0) { exit 4 }

# Step 4: cast and read/set volume.
$epObj = [Runtime.InteropServices.Marshal]::GetObjectForIUnknown($epPtr)
$ep = [_IAudioEndpointVolume2]$epObj
Write-Output ("ep cast OK")

$before = [float]0.0
$null = $ep.GetChannelVolumeLevelScalar([uint32]0, [ref]$before)
Write-Output ("Before: {0:P1}" -f $before)

$target = [float]0.5
$null = $ep.SetChannelVolumeLevelScalar([uint32]0, $target, [ref][Guid]::Empty)
Write-Output ("Set: $target")

Start-Sleep -Milliseconds 100

$after = [float]0.0
$null = $ep.GetChannelVolumeLevelScalar([uint32]0, [ref]$after)
Write-Output ("After:  {0:P1}" -f $after)