// Set OS master volume via Core Audio API (IAudioEndpointVolume).
// Compile:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /out:VolumeControl.exe Program.cs
// Run:
//   VolumeControl.exe set 50        (set to 50%)
//   VolumeControl.exe up            (+5%)
//   VolumeControl.exe down          (-5%)
//   VolumeControl.exe mute          (mute)
//   VolumeControl.exe unmute        (unmute)
//   VolumeControl.exe get           (print current %)
//
// Uses the canonical .NET ComImport pattern: declare the interface, cast the
// RCW. .NET's runtime handles QueryInterface for us. This avoids the PowerShell
// RCW marshalling bugs that fail on some Win11 builds.

using System;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63625E6"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator {
    void _VtblSlot0(); void _VtblSlot1(); void _VtblSlot2();
    int EnumAudioEndpoints(int dataFlow, int dwFlagsMask, out IntPtr ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, out IntPtr ppDevice);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E07FDAD5"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice {
    void _VtblSlot0(); void _VtblSlot1(); void _VtblSlot2();
    int Activate(ref Guid iid, uint dwClsCtx, IntPtr pActivationParams, out IntPtr ppInterface);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"),
 InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume {
    void _VtblSlot0(); void _VtblSlot1(); void _VtblSlot2();
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}

// Coclass wrapper. .NET's runtime CoCreates MMDeviceEnumerator using this
// class's GUID and QueryInterfaces the IUnknown to IMMDeviceEnumerator
// (the declared interface above).
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"),
 ClassInterface(ClassInterfaceType.None)]
internal class MMDeviceEnumeratorCoclass { }

internal static class Audio {
    static readonly Guid CLSID_MMDeviceEnumerator =
        new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
    static readonly Guid IID_IMMDeviceEnumerator  =
        new Guid("A95664D2-9614-4F35-A746-DE8DB63625E6");
    static readonly Guid IID_IAudioEndpointVolume =
        new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    public static float GetScalar() {
        var ep = GetEndpoint();
        try {
            float level;
            int hr = ep.GetChannelVolumeLevelScalar(0, out level);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            return level;
        } finally { Marshal.ReleaseComObject(ep); }
    }

    public static void SetScalar(float level) {
        var ep = GetEndpoint();
        try {
            Guid ctx = Guid.Empty;
            int hr = ep.SetChannelVolumeLevelScalar(0, level, ref ctx);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        } finally { Marshal.ReleaseComObject(ep); }
    }

    public static bool GetMute() {
        var ep = GetEndpoint();
        try {
            bool mute;
            int hr = ep.GetMute(out mute);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            return mute;
        } finally { Marshal.ReleaseComObject(ep); }
    }

    public static void SetMute(bool mute) {
        var ep = GetEndpoint();
        try {
            Guid ctx = Guid.Empty;
            int hr = ep.SetMute(mute, ref ctx);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
        } finally { Marshal.ReleaseComObject(ep); }
    }

    static IAudioEndpointVolume GetEndpoint() {
        // CoCreateInstance via Type.GetTypeFromCLSID + Activator. This is the
        // .NET-blessed path that does proper STA + QueryInterface under the hood.
        Type clsType = Type.GetTypeFromCLSID(CLSID_MMDeviceEnumerator);
        object enumerator = Activator.CreateInstance(clsType);
        try {
            var en = (IMMDeviceEnumerator)enumerator;
            // eRender = 0, eConsole = 1
            IntPtr devPtr;
            int hr = en.GetDefaultAudioEndpoint(0, 1, out devPtr);
            if (hr != 0) Marshal.ThrowExceptionForHR(hr);
            var devObj = Marshal.GetObjectForIUnknown(devPtr);
            try {
                var dev = (IMMDevice)devObj;
                IntPtr epPtr;
                Guid iidAudio = IID_IAudioEndpointVolume;
                hr = dev.Activate(ref iidAudio, 0x17, IntPtr.Zero, out epPtr);
                if (hr != 0) Marshal.ThrowExceptionForHR(hr);
                var epObj = Marshal.GetObjectForIUnknown(epPtr);
                return (IAudioEndpointVolume)epObj;
            } finally { Marshal.ReleaseComObject(devObj); }
        } finally { Marshal.ReleaseComObject(enumerator); }
    }
}

internal static class Program {
    static int Main(string[] args) {
        if (args.Length == 0) {
            Console.Error.WriteLine("Usage: VolumeControl.exe {get|set N|up|down|mute|unmute}");
            return 64;
        }
        try {
            switch (args[0]) {
                case "get": {
                    float v = Audio.GetScalar();
                    Console.WriteLine((v * 100).ToString("F1"));
                    return 0;
                }
                case "set": {
                    if (args.Length < 2) { Console.Error.WriteLine("set requires N"); return 64; }
                    float pct = float.Parse(args[1]);
                    pct = Math.Max(0, Math.Min(100, pct));
                    float before = Audio.GetScalar();
                    Audio.SetScalar(pct / 100.0f);
                    float after = Audio.GetScalar();
                    Console.WriteLine(string.Format("before:{0:F1} after:{1:F1}",
                        before * 100, after * 100));
                    return 0;
                }
                case "up": {
                    float before = Audio.GetScalar();
                    Audio.SetScalar(Math.Min(1.0f, before + 0.05f));
                    float after = Audio.GetScalar();
                    Console.WriteLine(string.Format("before:{0:F1} after:{1:F1}",
                        before * 100, after * 100));
                    return 0;
                }
                case "down": {
                    float before = Audio.GetScalar();
                    Audio.SetScalar(Math.Max(0.0f, before - 0.05f));
                    float after = Audio.GetScalar();
                    Console.WriteLine(string.Format("before:{0:F1} after:{1:F1}",
                        before * 100, after * 100));
                    return 0;
                }
                case "mute":
                    Audio.SetMute(true);
                    Console.WriteLine("muted");
                    return 0;
                case "unmute":
                    Audio.SetMute(false);
                    Console.WriteLine("unmuted");
                    return 0;
                default:
                    Console.Error.WriteLine("Unknown command: " + args[0]);
                    return 64;
            }
        } catch (Exception ex) {
            Console.Error.WriteLine("ERROR: " + ex.GetType().Name + ": " + ex.Message);
            return 1;
        }
    }
}