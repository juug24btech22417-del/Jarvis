/**
 * Test script for volume + brightness OS commands.
 * Runs the same PowerShell scripts the API route uses.
 * Usage: node test-vol-brightness.js
 */
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const execAsync = promisify(exec);

// ── Working Core Audio C# (uses CoCreateInstance directly) ─────────────────
const CORE_AUDIO_TYPE = `
using System;
using System.Runtime.InteropServices;

public class Audio {
    [DllImport("ole32.dll")]
    private static extern int CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, int dwClsContext, ref Guid riid, out IntPtr ppv);

    private static readonly Guid CLSID_MMDeviceEnumerator = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
    private static readonly Guid IID_IMMDeviceEnumerator   = new Guid("A95664D2-9614-4F35-A746-DE8DB63617E6");
    private static readonly Guid IID_IAudioEndpointVolume  = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator {
        int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IntPtr ppEndpoint);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        [PreserveSig] int OpenPropertyStore(uint stgmAccess, out IntPtr ppProperties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
        [PreserveSig] int GetState(out uint pdwState);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume {
        int RegisterControlChangeNotify(IntPtr pNotify);
        int UnregisterControlChangeNotify(IntPtr pNotify);
        int GetChannelCount(out uint pnChannelCount);
        int SetMasterVolumeLevel(float fLevelDB, ref Guid pguidEventContext);
        int SetMasterVolumeLevelScalar(float fLevel, ref Guid pguidEventContext);
        int GetMasterVolumeLevel(out float pfLevelDB);
        int GetMasterVolumeLevelScalar(out float pfLevel);
        int SetChannelVolumeLevel(uint nChannel, float fLevelDB, ref Guid pguidEventContext);
        int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, ref Guid pguidEventContext);
        int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
        int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
        int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid pguidEventContext);
        int GetMute(out bool bMute);
    }

    private static IAudioEndpointVolume GetVolumeInterface() {
        Guid clsid = CLSID_MMDeviceEnumerator;
        Guid iid   = IID_IMMDeviceEnumerator;
        IntPtr pEnum;
        int hr = CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iid, out pEnum);
        if (hr != 0) throw new System.Runtime.InteropServices.COMException("CoCreateInstance failed: 0x" + hr.ToString("X8"), hr);

        var enumerator = (IMMDeviceEnumerator)Marshal.GetObjectForIUnknown(pEnum);
        IntPtr pDevice;
        hr = enumerator.GetDefaultAudioEndpoint(0, 1, out pDevice);
        if (hr != 0) throw new System.Runtime.InteropServices.COMException("GetDefaultAudioEndpoint failed: 0x" + hr.ToString("X8"), hr);

        var device = (IMMDevice)Marshal.GetObjectForIUnknown(pDevice);
        Guid volIid = IID_IAudioEndpointVolume;
        object volObj;
        hr = device.Activate(ref volIid, 23, IntPtr.Zero, out volObj);
        if (hr != 0) throw new System.Runtime.InteropServices.COMException("Activate IAudioEndpointVolume failed: 0x" + hr.ToString("X8"), hr);

        return (IAudioEndpointVolume)volObj;
    }

    public static float GetVolume() {
        var vol = GetVolumeInterface();
        float level;
        vol.GetMasterVolumeLevelScalar(out level);
        return level * 100f;
    }

    public static void SetVolume(float percent) {
        var vol = GetVolumeInterface();
        Guid g = Guid.Empty;
        float scalar = Math.Max(0f, Math.Min(1f, percent / 100f));
        vol.SetMasterVolumeLevelScalar(scalar, ref g);
    }

    public static void ToggleMute() {
        var vol = GetVolumeInterface();
        bool muted;
        vol.GetMute(out muted);
        Guid g = Guid.Empty;
        vol.SetMute(!muted, ref g);
    }
}
`;

async function runVolScript(label, scriptBody) {
  const script =
`$Source = @'
${CORE_AUDIO_TYPE}
'@
Add-Type -TypeDefinition $Source -ErrorAction Stop
${scriptBody}`;

  const tempScriptPath = path.join(os.tmpdir(), `jarvis_test_vol_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);
  await fs.writeFile(tempScriptPath, script, "utf8");

  process.stdout.write(`\n[TEST] ${label} ... `);
  try {
    const { stdout, stderr } = await execAsync(`powershell -NonInteractive -File "${tempScriptPath}"`, { timeout: 15000 });
    const out = stdout.trim();
    console.log(`✅  ${out}`);
    if (stderr && !stderr.includes("npm notice")) {
      console.warn(`   stderr: ${stderr.trim().slice(0, 200)}`);
    }
  } catch (e) {
    console.log(`❌  FAILED: ${e.message.slice(0, 200)}`);
    if (e.stderr) console.log(`   stderr: ${e.stderr.slice(0, 300)}`);
  } finally {
    try { await fs.unlink(tempScriptPath); } catch {}
  }
}

function brightCmd(body) {
  return (
    `powershell -NonInteractive -Command "` +
    `$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness;` +
    `if ($cur -eq $null) { Write-Output 'wmi_not_supported'; exit 0 };` +
    body +
    `"`
  );
}

async function runBright(label, cmd) {
  process.stdout.write(`\n[TEST] ${label} ... `);
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
    const out = stdout.trim();
    if (out === "wmi_not_supported") {
      console.log("⚠️  WMI not supported — skipped");
    } else {
      console.log(`✅  ${out}`);
    }
  } catch (e) {
    console.log(`❌  FAILED: ${e.message.slice(0, 200)}`);
  }
}

(async () => {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Jarvis Volume + Brightness Command Test  ║");
  console.log("╚══════════════════════════════════════════╝");

  // ── Volume ────────────────────────────────────────
  await runVolScript("volume_up   (+5%)", `
$cur = [Audio]::GetVolume()
$next = [Math]::Min(100, $cur + 5)
[Audio]::SetVolume($next)
Write-Output ("before:" + [int]$cur + " after:" + [int]$next)`);

  await runVolScript("volume_down (-5%)", `
$cur = [Audio]::GetVolume()
$next = [Math]::Max(0, $cur - 5)
[Audio]::SetVolume($next)
Write-Output ("before:" + [int]$cur + " after:" + [int]$next)`);

  await runVolScript("volume_set  (50%)", `
$cur = [Audio]::GetVolume()
[Audio]::SetVolume(50)
Write-Output ("before:" + [int]$cur + " after:50")`);

  await runVolScript("volume_set  (70%)", `
$cur = [Audio]::GetVolume()
[Audio]::SetVolume(70)
Write-Output ("before:" + [int]$cur + " after:70")`);

  await runVolScript("mute toggle", `
[Audio]::ToggleMute()
Write-Output "toggled"`);

  // ── Brightness ────────────────────────────────────
  await runBright("brightness_up   (+10%)",
    brightCmd(`$next = [Math]::Min(100, [int]$cur + 10);(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$next);Write-Output ('before:' + $cur + ' after:' + $next)`));

  await runBright("brightness_down (-10%)",
    brightCmd(`$next = [Math]::Max(0, [int]$cur - 10);(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$next);Write-Output ('before:' + $cur + ' after:' + $next)`));

  await runBright("brightness_set  (60%)",
    brightCmd(`(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,60);Write-Output ('before:' + $cur + ' after:60')`));

  console.log("\n✔ All tests done.\n");
})();
