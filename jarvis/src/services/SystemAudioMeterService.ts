/**
 * System Audio Meter — "is music playing, and how loud?"
 *
 * Loops peak meter samples off the default render device via WASAPI
 * (IAudioMeterInformation) and remembers the recent peak envelope.
 *
 * Music detection: speech/content avg ~35-55% peaks; silence ~0-1%.
 * We latch "music playing" while any of the last ~4 seconds spiked
 * above the threshold — beats dip, so we smooth over the gaps.
 *
 * Consumed by the reactor (beats/pulses with the music) and available
 * for "is anything playing?" queries.
 */

import { spawn, ChildProcess } from "child_process";

interface AudioSample {
  t: number;
  peak: number;
}

const HISTORY_MS = 5000;
const MUSIC_THRESHOLD = 0.06; // 6% peak — well above silence, below speech
const LATCH_MS = 4000;

let proc: ChildProcess | null = null;
let samples: AudioSample[] = [];
let lastPeak = 0;
let running = false;
let restartTimer: NodeJS.Timeout | null = null;

/**
 * Polls the render device's peak meter (IAudioMeterInformation) via a
 * tiny C# COM interop type in an MTA PowerShell process ~20×/sec and
 * prints P=<0..1> lines. All COM calls stay inside C# — PowerShell
 * cannot late-bind IAudioMeterInformation on a raw __ComObject.
 */
const METER_PS_V2 = `\
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition 'using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}
[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation {
  [PreserveSig] int GetPeakValue(out float peak);
}
public enum EDataFlow { eRender, eCapture, eAll }
public enum ERole { eConsole, eMultimedia, eCommunications }
public static class AudioMeter {
  static IAudioMeterInformation meter;
  public static int Init() {
    try {
      IMMDevice dev;
      var en = (IMMDeviceEnumerator)(object)new MMDeviceEnumerator();
      int hr = en.GetDefaultAudioEndpoint((int)EDataFlow.eRender, (int)ERole.eConsole, out dev);
      if (hr != 0) return -1;
      var guid = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
      object o;
      hr = dev.Activate(ref guid, 1, IntPtr.Zero, out o);
      if (hr != 0) return -2;
      meter = (IAudioMeterInformation)o;
      return meter != null ? 1 : -3;
    } catch { return -4; }
  }
  public static float Peak() {
    if (meter == null) return -1f;
    float p;
    meter.GetPeakValue(out p);
    return p;
  }
}'
if ([AudioMeter]::Init() -ne 1) { Write-Output 'ERR=nometer'; exit }
while ($true) {
  $p = [AudioMeter]::Peak()
  if ($p -ge 0) { Write-Output ('P=' + $p.ToString('F3', [System.Globalization.CultureInfo]::InvariantCulture)) }
  Start-Sleep -Milliseconds 50
}
`;

function ensureProc() {
  if (running && proc && !proc.killed) return;
  try {
    running = true;
    proc = spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-MTA", "-Command", METER_PS_V2], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        const m = /^P=([\d.]+)$/.exec(line);
        if (m) {
          const peak = Math.min(1, parseFloat(m[1]) || 0);
          lastPeak = peak;
          const now = Date.now();
          samples.push({ t: now, peak });
          // Trim history
          while (samples.length && now - samples[0].t > HISTORY_MS) samples.shift();
        }
      }
    });
    proc.on("exit", () => {
      running = false;
      proc = null;
      // Auto-restart with backoff so music-reactivity survives sleep/resume
      if (!restartTimer) {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          ensureProc();
        }, 3000);
      }
    });
    proc.on("error", () => {
      running = false;
      proc = null;
    });
  } catch {
    running = false;
    proc = null;
  }
}

/** Current 0..1 peak of the default render device (smoothed slightly). */
export function getAudioLevel(): number {
  ensureProc();
  return Math.min(1, lastPeak * 1.2);
}

/**
 * Is music/content actually playing? Latches for LATCH_MS after any
 * recent peak crossed MUSIC_THRESHOLD so beat gaps don't flicker.
 */
export function isMusicPlaying(): boolean {
  ensureProc();
  const now = Date.now();
  return samples.some((s) => now - s.t <= LATCH_MS && s.peak >= MUSIC_THRESHOLD);
}

/** Envelope for the reactor: 0..1 with recent max, decays smoothly. */
export function getMusicReactivity(): number {
  ensureProc();
  const now = Date.now();
  const recent = samples.filter((s) => now - s.t < LATCH_MS);
  if (!recent.length) return 0;
  // Blend: quick response (last peak) + fullness (recent max)
  const maxPeak = Math.max(...recent.map((s) => s.peak));
  return Math.min(1, Math.max(lastPeak * 0.6 + maxPeak * 0.6, 0));
}

/** Diagnostic snapshot for tests / status panels. */
export function getAudioMeterStatus(): {
  available: boolean;
  level: number;
  musicPlaying: boolean;
  reactivity: number;
  samples: number;
} {
  ensureProc();
  return {
    available: running,
    level: Number(getAudioLevel().toFixed(3)),
    musicPlaying: isMusicPlaying(),
    reactivity: Number(getMusicReactivity().toFixed(3)),
    samples: samples.length,
  };
}

// Start lazily on first import in the server runtime — cheap (~1 process)
if (typeof window === "undefined") {
  ensureProc();
}
