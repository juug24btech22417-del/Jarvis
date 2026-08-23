# Master volume set via Win32 Core Audio API.
# Uses the canonical PowerShell pattern from Microsoft / community docs.
# The first 3 methods of any IUnknown-derived COM interface are
# QueryInterface, AddRef, Release. PowerShell's reflection-based COM
# binding expects them to be present.
param([int]$Target = 50)

if (-not ("Win32.CoreAudio" -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace Win32.CoreAudio {

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        // IUnknown
        [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
        [PreserveSig] int AddRef();
        [PreserveSig] int Release();
        // IMMDeviceEnumerator
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int dwFlagsMask, out IntPtr ppDevices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IMMDevice ppDevice);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr pClient);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr pClient);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E8073636"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        // IUnknown
        [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
        [PreserveSig] int AddRef();
        [PreserveSig] int Release();
        // IMMDevice
        [PreserveSig] int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams,
                                    [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        [PreserveSig] int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        [PreserveSig] int GetState(out int pdwState);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        // IUnknown
        [PreserveSig] int QueryInterface(ref Guid iid, out IntPtr ppv);
        [PreserveSig] int AddRef();
        [PreserveSig] int Release();
        // IAudioEndpointVolume
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

    public static class Volume {
        public static float Get() {
            var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice dev;
            en.GetDefaultAudioEndpoint(0, 1, out dev);
            var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
            object obj;
            dev.Activate(ref iid, 0, IntPtr.Zero, out obj);
            var vol = (IAudioEndpointVolume)obj;
            float level;
            vol.GetChannelVolumeLevelScalar(0, out level);
            return level;
        }
        public static void Set(float scalar) {
            var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            IMMDevice dev;
            en.GetDefaultAudioEndpoint(0, 1, out dev);
            var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
            object obj;
            dev.Activate(ref iid, 0, IntPtr.Zero, out obj);
            var vol = (IAudioEndpointVolume)obj;
            Guid empty = Guid.Empty;
            vol.SetChannelVolumeLevelScalar(0, scalar, ref empty);
        }
    }
}
'@
}

$before = [Win32.CoreAudio.Volume]::Get()
[Win32.CoreAudio.Volume]::Set([float]($Target / 100.0))
Start-Sleep -Milliseconds 200
$after = [Win32.CoreAudio.Volume]::Get()
Write-Output ("target:" + $Target + " before:" + $before + " after:" + $after)
