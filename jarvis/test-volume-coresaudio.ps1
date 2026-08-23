# Test IAudioEndpointVolume via Type.GetTypeFromCLSID + [Activator]::CreateInstance
# with the proper [ComImport] interface declarations so the RCW can be cast.

$src = @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumeratorX {
    [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
    [PreserveSig] int AddRef();
    [PreserveSig] int Release();
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwFlagsMask, out IntPtr ppDevices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IntDevice ppDevice);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
}
"@

# That won't compile (IntDevice typo). Simpler: don't declare the interface,
# just use reflection on the __ComObject returned by CreateInstance.
$enType = [Type]::GetTypeFromCLSID([Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E")
Write-Output ("enType: " + $enType.FullName)
try {
    $en = [Activator]::CreateInstance($enType)
    Write-Output ("Created enum: " + $en.GetType().FullName)
} catch {
    Write-Output ("FAIL CreateInstance: " + $_.Exception.GetType().FullName + " - " + $_.Exception.Message)
    exit 1
}

# Try reflection-based invocation of GetDefaultAudioEndpoint
# The __ComObject returned by Activator has a hidden IDispatch interface.
# Use InvokeMember with BindingFlags.InvokeMethod.
try {
    $dev = $en.GetType().InvokeMember(
        "GetDefaultAudioEndpoint",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null, $en, @(0, 1))   # eRender=0, eConsole=1
    Write-Output ("Got device: " + $dev.GetType().FullName)
} catch {
    Write-Output ("FAIL GetDefaultAudioEndpoint: " + $_.Exception.Message)
    if ($_.Exception.InnerException) {
        Write-Output ("  Inner: " + $_.Exception.InnerException.Message)
    }
    exit 2
}

# Activate with IAudioEndpointVolume IID
$audioIid = [Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"
try {
    $ep = $dev.GetType().InvokeMember(
        "Activate",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null, $dev,
        @([ref]$audioIid, [uint32]0, [IntPtr]::Zero, [IntPtr]::Zero))
    Write-Output ("Got endpoint: " + $ep.GetType().FullName)
} catch {
    Write-Output ("FAIL Activate: " + $_.Exception.Message)
    if ($_.Exception.InnerException) {
        Write-Output ("  Inner: " + $_.Exception.InnerException.Message)
    }
    exit 3
}

# Get current volume
try {
    $levelRef = [float]0.0
    $null = $ep.GetType().InvokeMember(
        "GetChannelVolumeLevelScalar",
        [System.Reflection.BindingFlags]::InvokeMethod,
        $null, $ep, @([uint32]0, [ref]$levelRef))
    Write-Output ("Before: " + $levelRef)
} catch {
    Write-Output ("FAIL GetVolume: " + $_.Exception.Message)
    exit 4
}