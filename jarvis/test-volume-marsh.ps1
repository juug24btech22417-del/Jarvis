# Direct COM approach - skip RCW entirely, use Marshal.QueryInterface
# to call IAudioEndpointVolume.SetChannelVolumeLevelScalar directly via
# vtable arithmetic. The IAudioEndpointVolume vtable layout (from MSDN):
#   [0] QueryInterface
#   [1] AddRef
#   [2] Release
#   [3] RegisterControlChangeNotify
#   [4] UnregisterControlChangeNotify
#   [5] GetChannelCount
#   [6] SetChannelVolumeLevel
#   [7] SetChannelVolumeLevelScalar
#   [8] GetChannelVolumeLevel
#   [9] GetChannelVolumeLevelScalar
#   [10] SetMute
#   ...

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class M {
    [DllImport("ole32.dll")]
    public static extern int CoCreateInstance(
        ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext,
        ref Guid riid, out IntPtr ppv);
    [DllImport("ole32.dll")]
    public static extern int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);
    [DllImport("ole32.dll")]
    public static extern void CoUninitialize();
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetModuleHandle(string lpModuleName);
    [DllImport("kernel32.dll", SetLastError=true)]
    public static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);

    public static IntPtr GetVtableFunc(IntPtr obj, int slot) {
        // Read the vtable pointer (first 8 bytes on x64) from obj
        IntPtr vtbl = Marshal.ReadIntPtr(obj);
        // vtable[slot] is at vtbl + slot*8
        return Marshal.ReadIntPtr(vtbl, slot * IntPtr.Size);
    }

    public delegate int GetChannelVolumeLevelScalarDelegate(IntPtr pThis, uint nChannel, out float pfLevel);
    public delegate int SetChannelVolumeLevelScalarDelegate(IntPtr pThis, uint nChannel, float fLevel, IntPtr pguidEventContext);
}
'@

# Init COM as STA.
$null = [M]::CoInitializeEx([IntPtr]::Zero, 0x2)  # COINIT_APARTMENTTHREADED

# CLSID_MMDeviceEnumerator
$clsid = [Guid]"BCDE0395-E52F-467C-8E3D-C4579291692E"
# IID_IMMDeviceEnumerator
$iidEnum = [Guid]"A95664D2-9614-4F35-A746-DE8DB63625E6"

# IID_IAudioEndpointVolume
$iidAudio = [Guid]"5CDF2C82-841E-4546-9722-0CF74078229A"

$enPtr = [IntPtr]::Zero
$hr = [M]::CoCreateInstance([ref]$clsid, [IntPtr]::Zero, 0x17, [ref]$iidEnum, [ref]$enPtr)
Write-Output ("CoCreateInstance(enumerator) hr=$hr (0x{0:x8}) ptr=0x{1:x}" -f $hr, $enPtr.ToInt64())
if ($hr -ne 0) {
    Write-Output ("FATAL: MMDeviceEnumerator not creatable")
    [M]::CoUninitialize()
    exit 1
}

# IMMDeviceEnumerator vtable layout:
#   [3] EnumAudioEndpoints
#   [4] GetDefaultAudioEndpoint (dataFlow, role, *ppEndpoint)
# GetDefaultAudioEndpoint returns IMMDevice pointer via out IntPtr.

# Read vtable[4] and call it directly.
$getDefaultFn = [M]::GetVtableFunc($enPtr, 4)
Write-Output ("GetDefaultAudioEndpoint fn ptr: 0x{0:x}" -f $getDefaultFn.ToInt64())

# We can't easily invoke a vtable function via delegate from PS w/o a typed delegate.
# Instead, use .NET reflection on a delegate that takes (this, dataFlow, role, out ppv).
# Build a delegate type dynamically.

$asm = [System.Reflection.Assembly]::GetAssembly([System.Object])
$builderType = $asm.GetType("System.Reflection.Emit.DynamicMethod")  # might not exist on .NET 5+
# Actually simplest: use System.Runtime.InteropServices.Marshal.GetDelegateForFunctionPointer
# but we need a delegate type matching the signature.

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class V {
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate int GetDefaultAudioEndpointDelegate(IntPtr pThis, int dataFlow, int role, out IntPtr ppEndpoint);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate int ActivateDelegate(IntPtr pThis, ref Guid iid, uint clsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate int SetChannelVolumeLevelScalarDelegate(IntPtr pThis, uint nChannel, float fLevel, IntPtr pguidEventContext);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate int GetChannelVolumeLevelScalarDelegate(IntPtr pThis, uint nChannel, out float pfLevel);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    public delegate int ReleaseDelegate(IntPtr pThis);
}
'@

$getDefault = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($getDefaultFn, [V+GetDefaultAudioEndpointDelegate])
$devPtr = [IntPtr]::Zero
$hr = $getDefault.Invoke($enPtr, 0, 1, [ref]$devPtr)  # eRender=0, eConsole=1
Write-Output ("GetDefaultAudioEndpoint hr=$hr ptr=0x{0:x}" -f $devPtr.ToInt64())
if ($hr -ne 0) { exit 2 }

# IMMDevice vtable:
#   [3] Activate(iid, clsCtx, pActivationParams, *ppInterface)
$activateFn = [M]::GetVtableFunc($devPtr, 3)
$activate = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($activateFn, [V+ActivateDelegate])
$epPtr = [IntPtr]::Zero
$hr = $activate.Invoke($devPtr, [ref]$iidAudio, 0x17, [IntPtr]::Zero, [ref]$epPtr)
Write-Output ("Activate hr=$hr ptr=0x{0:x}" -f $epPtr.ToInt64())
if ($hr -ne 0) { exit 3 }

# IAudioEndpointVolume vtable:
#   [7] SetChannelVolumeLevelScalar(this, channel, level, pEventContext)
#   [9] GetChannelVolumeLevelScalar(this, channel, *level)

$setFn = [M]::GetVtableFunc($epPtr, 7)
$getFn = [M]::GetVtableFunc($epPtr, 9)
$set = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($setFn, [V+SetChannelVolumeLevelScalarDelegate])
$get = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($getFn, [V+GetChannelVolumeLevelScalarDelegate])

$before = [float]0.0
$hr = $get.Invoke($epPtr, [uint32]0, [ref]$before)
Write-Output ("GetVolume hr=$hr before={0:P1}" -f $before)

$target = [float]0.5
$hr = $set.Invoke($epPtr, [uint32]0, $target, [IntPtr]::Zero)
Write-Output ("SetVolume hr=$hr target={0:P1}" -f $target)

Start-Sleep -Milliseconds 100

$after = [float]0.0
$hr = $get.Invoke($epPtr, [uint32]0, [ref]$after)
Write-Output ("GetVolume hr=$hr after={0:P1}" -f $after)

# Release.
$relFn = [M]::GetVtableFunc($epPtr, 2)
$rel = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($relFn, [V+ReleaseDelegate])
$null = $rel.Invoke($epPtr)
$relFn2 = [M]::GetVtableFunc($devPtr, 2)
$rel2 = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($relFn2, [V+ReleaseDelegate])
$null = $rel2.Invoke($devPtr)
$relFn3 = [M]::GetVtableFunc($enPtr, 2)
$rel3 = [System.Runtime.InteropServices.Marshal]::GetDelegateForFunctionPointer($relFn3, [V+ReleaseDelegate])
$null = $rel3.Invoke($enPtr)

[M]::CoUninitialize()