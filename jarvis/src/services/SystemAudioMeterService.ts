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
 * Consumers get three views of the same data:
 *   - level / reactivity   → smoothed 0..1 for simple "how loud?" checks
 *   - envelope + envelopeT → the RAW peak history, timestamped, which the
 *     reactor interpolates into a circular equalizer (see
 *     lib/audio/MusicSpectrum.ts). Raw + timestamped is the whole point:
 *     a pre-smoothed scalar aliases badly at any poll rate.
 */

import { spawn, ChildProcess } from "child_process";

interface AudioSample {
  t: number;
  peak: number;
}

const HISTORY_MS = 5000;
const ENVELOPE_WINDOW_MS = 600; // raw peaks handed to the reactor
const MUSIC_THRESHOLD = 0.06; // 6% peak — well above silence, below speech
const LATCH_MS = 4000;

let proc: ChildProcess | null = null;
let samples: AudioSample[] = [];
let lastPeak = 0;
let running = false;
let restartTimer: NodeJS.Timeout | null = null;

/**
 * Polls the render device's peak meter (IAudioMeterInformation) via a
 * tiny C# COM interop type in an MTA PowerShell process ~40×/sec and
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
if ([AudioMeter]::Init() -ne 1) { [Console]::WriteLine('ERR=nometer'); exit }
while ($true) {
  $p = [AudioMeter]::Peak()
  if ($p -ge 0) {
    # Timestamp AT THE SOURCE and write straight to the console: PowerShell
    # buffers Write-Output when stdout is a pipe, which delivers a burst of
    # lines whose arrival times are all identical. Stamping on arrival then
    # time-compresses real audio into steps — the exact staircase the
    # reactor is built to avoid.
    $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    [Console]::WriteLine('T=' + $t + ' P=' + $p.ToString('F3', [System.Globalization.CultureInfo]::InvariantCulture))
  }
  Start-Sleep -Milliseconds 20
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
        // T=<epoch ms> P=<0..1> — T is stamped by the meter itself. The
        // bare P= form is still accepted (arrival-stamped) for robustness.
        const m = /^T=(\d+)\s+P=([\d.]+)$/.exec(line) || /^P=([\d.]+)$/.exec(line);
        if (!m) continue;
        const stamped = m.length === 3;
        const peak = Math.min(1, parseFloat(stamped ? m[2] : m[1]) || 0);
        lastPeak = peak;
        samples.push({ t: stamped ? Number(m[1]) : Date.now(), peak });
        const newest = samples[samples.length - 1].t;
        // Trim history
        while (samples.length && newest - samples[0].t > HISTORY_MS) samples.shift();
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

/**
 * Raw peak envelope for the last ENVELOPE_WINDOW_MS, oldest first, with
 * the timestamp of every sample. The client re-maps these onto its own
 * clock using the LAST timestamp, so poll jitter can never reach the
 * animation — only the freshest reading decides "now".
 */
function recentEnvelope(): { vals: number[]; ts: number[]; dt: number } {
  const newest = samples.length ? samples[samples.length - 1].t : Date.now();
  const cut = newest - ENVELOPE_WINDOW_MS;
  let from = samples.length;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].t >= cut) {
      from = i;
      break;
    }
  }
  const vals: number[] = [];
  const ts: number[] = [];
  for (let i = from; i < samples.length; i++) {
    vals.push(Number(samples[i].peak.toFixed(4)));
    ts.push(samples[i].t);
  }
  // Nominal spacing from the healthy gaps only.
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) {
    const g = ts[i] - ts[i - 1];
    if (g > 0) gaps.push(g);
  }
  gaps.sort((a, b) => a - b);
  const dt = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 20;
  // Guarantee a strictly increasing timeline. The client interpolates
  // between these stamps, so a duplicated one would render as a step —
  // better to re-space it at the nominal cadence and keep the motion smooth.
  for (let i = 1; i < ts.length; i++) {
    if (ts[i] <= ts[i - 1]) ts[i] = ts[i - 1] + dt;
  }
  return { vals, ts, dt };
}

/** Diagnostic snapshot for tests / status panels. */
export function getAudioMeterStatus(): {
  available: boolean;
  level: number;
  musicPlaying: boolean;
  reactivity: number;
  samples: number;
  envelope: number[];
  envelopeT: number[];
  envelopeDt: number;
} {
  ensureProc();
  const env = recentEnvelope();
  return {
    available: running,
    level: Number(getAudioLevel().toFixed(3)),
    musicPlaying: isMusicPlaying(),
    reactivity: Number(getMusicReactivity().toFixed(3)),
    samples: samples.length,
    envelope: env.vals,
    envelopeT: env.ts,
    envelopeDt: env.dt,
  };
}

// Start lazily on first import in the server runtime — cheap (~1 process)
if (typeof window === "undefined") {
  ensureProc();
}
