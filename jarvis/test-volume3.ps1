# Master volume set via Windows Audio API. Tested pattern.
param([int]$Target = 50)

$code = @'
using System;
using System.Runtime.InteropServices;

public class AudioHelper {
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    public class MMDeviceEnumeratorCom { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDeviceEnumerator {
        [PreserveSig] int NotImpl0();
        [PreserveSig] int NotImpl1();
        [PreserveSig] int NotImpl2();
        [PreserveSig] int NotImpl3();
        [PreserveSig] int NotImpl4();
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role,
                                                  out IMMDevice ep);
        [PreserveSig] int NotImpl6();
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E8073636"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p,
                                   out IAudioEndpointVolume ep);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr p);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr p);
        [PreserveSig] int GetChannelCount(out uint c);
        [PreserveSig] int SetChannelVolumeLevel(uint c, float l, ref Guid g);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint c, float l, ref Guid g);
        [PreserveSig] int GetChannelVolumeLevel(uint c, out float l);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint c, out float l);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
        [PreserveSig] int GetMute(out bool m);
        [PreserveSig] int GetVolumeStepInfo(out uint s, out uint c);
        [PreserveSig] int VolumeStepUp(ref Guid g);
        [PreserveSig] int VolumeStepDown(ref Guid g);
        [PreserveSig] int QueryHardwareSupport(out uint s);
        [PreserveSig] int GetVolumeRange(out float mn, out float mx, out float inc);
    }

    public static void SetVolume(float scalar) {
        var enumerator = new MMDeviceEnumeratorCom();
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)enumerator;
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 1, out dev);
        var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        IAudioEndpointVolume vol;
        dev.Activate(ref iid, 0, IntPtr.Zero, out vol);
        Guid empty = Guid.Empty;
        vol.SetChannelVolumeLevelScalar(0, scalar, ref empty);
    }

    public static float GetVolume() {
        var enumerator = new MMDeviceEnumeratorCom();
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)enumerator;
        IMMDevice dev;
        en.GetDefaultAudioEndpoint(0, 1, out dev);
        var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
        IAudioEndpointVolume vol;
        dev.Activate(ref iid, 0, IntPtr.Zero, out vol);
        float level;
        vol.GetChannelVolumeLevelScalar(0, out level);
        return level;
    }
}
'@

Add-Type -TypeDefinition $code -Language CSharp

$beforeScalar = [AudioHelper]::GetVolume()
[AudioHelper]::SetVolume([float]($Target / 100.0))
Start-Sleep -Milliseconds 200
$afterScalar = [AudioHelper]::GetVolume()
Write-Output ("target:" + $Target + " before:" + $beforeScalar + " after:" + $afterScalar)
