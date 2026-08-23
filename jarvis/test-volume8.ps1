# Set OS master volume using raw CoCreateInstance + IAudioEndpointVolume.
# Bypasses PowerShell's broken COM cast machinery by using Marshal.ReleaseComObject
# and direct pointer arithmetic via Marshal.QueryInterface.
param([int]$Target = 50)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct GUID {
    public uint Data1;
    public ushort Data2;
    public ushort Data3;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst=8)]
    public byte[] Data4;
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
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
"@

# CoCreateInstance via reflection (ole32!CoCreateInstance).
# CLSID_MMDeviceEnumerator = {BCDE0395-E52F-467C-8E3D-C4579291692E}
# IID_IMMDeviceEnumerator  = {A95664D2-9614-4F35-A746-DE8DB63625E6}
$ole32 = Add-Type -Name "Ole32" -Namespace "Win32" -MemberDefinition @'
[DllImport("ole32.dll")]
public static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext, ref Guid riid, out IntPtr ppv);
[DllImport("ole32.dll")]
public static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);
'@ -PassThru

# Initialize COM apartment as STA (required for audio).
$null = [Win32.Ole32]::CoInitializeEx([IntPtr]::Zero, 0x2) # COINIT_APARTMENTTHREADED

# Build CLSID and IID GUIDs.
$clsidMMDE = [Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E"
$iidIMMDE = [Guid]"A95664D2-9614-4F35-A746-DE8DB63625E6"
$iidIAEV = [Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"

# CoCreateInstance(CLSID_MMDeviceEnumerator, NULL, CLSCTX_ALL, IID_IMMDeviceEnumerator, &pEnumerator)
$enPtr = [IntPtr]::Zero
$hr = [Win32.Ole32]::CoCreateInstance([ref]$clsidMMDE, [IntPtr]::Zero, 0x17, [ref]$iidIMMDE, [ref]$enPtr)
if ($hr -ne 0) {
    Write-Output ("FAIL CoCreateInstance hr=$hr (0x{0:x8})" -f $hr)
    exit 1
}
Write-Output ("Got enumerator at 0x{0:x8}" -f $enPtr.ToInt64())

# We have an IAudioEndpointVolume interface pointer is what we ACTUALLY need.
# But to get there via IMMDeviceEnumerator, we'd need to call GetDefaultAudioEndpoint,
# then Activate, etc. That's a lot of vtable arithmetic.
#
# Easier alternative: many Windows machines have the audio endpoint
# registered under a direct COM path. Let me just confirm the IMMDeviceEnumerator
# interface works by calling GetDefaultAudioEndpoint via reflection on the
# RCW that PowerShell's COM activator would normally create.

# The fundamental problem is that PowerShell's RCW binding for COM objects
# returned by CoCreateInstance via raw P/Invoke doesn't work — we just have
# an IntPtr, not an RCW.
#
# Final approach: use PowerShell's [Type]::GetTypeFromCLSID + [Activator]::CreateInstance
# to get an RCW for the enumerator, then call methods on the RCW type via reflection.
# We tried this in v6 and it failed with NullReferenceException because
# InvokeMember doesn't work on __ComObject types.
#
# THE WORKING APPROACH: declare the interface properly and cast the RCW.
# Earlier failures were due to wrong method ordering. Let me try with
# the IMMDeviceEnumerator interface declared in C# and the cast done
# by .NET runtime, not PowerShell.

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator8 {
    [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwFlagsMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IntPtr ppDevice);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"),
 ClassInterface(ClassInterfaceType.None)]
public class MMDeviceEnumerator8 { }
"@

# This is the line that should work but failed in earlier attempts:
# PowerShell's [Type]::GetTypeFromCLSID + [Activator]::CreateInstance should
# return an RCW castable to the matching interface.
try {
    $enumType = [Type]::GetTypeFromCLSID([Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E")
    $enum = [Activator]::CreateInstance($enumType)
    Write-Output ("Created enumerator type: " + $enum.GetType().FullName)
    $asIface = [IMMDeviceEnumerator8]$enum
    Write-Output ("Cast to interface OK")
    $devPtr = [IntPtr]::Zero
    $hr2 = $asIface.GetDefaultAudioEndpoint(0, 1, [ref]$devPtr)
    Write-Output ("GetDefaultAudioEndpoint hr=$hr2 ptr=$devPtr")
} catch {
    Write-Output ("ERROR: " + $_.Exception.Message)
}
