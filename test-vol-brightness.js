/**
 * Test script for volume + brightness OS commands.
 * Runs the same PowerShell one-liners the API route uses.
 * Usage: node test-vol-brightness.js
 */
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

const WINMM_TYPE =
  "using System;using System.Runtime.InteropServices;" +
  "public class W{" +
  "[DllImport(\\\"winmm.dll\\\")]public static extern int waveOutGetVolume(IntPtr h, out uint v);" +
  "[DllImport(\\\"winmm.dll\\\")]public static extern int waveOutSetVolume(IntPtr h, uint v);" +
  "}";

function volUpCmd() {
  return (
    `powershell -NonInteractive -Command "` +
    `Add-Type -TypeDefinition '${WINMM_TYPE}';` +
    `$cur = 0;$null = [W]::waveOutGetVolume([IntPtr]::Zero, [ref]$cur);` +
    `$curPct = [int](($cur -band 0xFFFF) * 100 / 65535);` +
    `$next = [Math]::Min(100, $curPct + 5);` +
    `$raw = [uint32]([Math]::Round(65535 * $next / 100));` +
    `$both = [uint32](($raw -shl 16) -bor $raw);` +
    `[void][W]::waveOutSetVolume([IntPtr]::Zero, $both);` +
    `Write-Output ('before:' + $curPct + ' after:' + $next)` +
    `"`
  );
}

function volDownCmd() {
  return (
    `powershell -NonInteractive -Command "` +
    `Add-Type -TypeDefinition '${WINMM_TYPE}';` +
    `$cur = 0;$null = [W]::waveOutGetVolume([IntPtr]::Zero, [ref]$cur);` +
    `$curPct = [int](($cur -band 0xFFFF) * 100 / 65535);` +
    `$next = [Math]::Max(0, $curPct - 5);` +
    `$raw = [uint32]([Math]::Round(65535 * $next / 100));` +
    `$both = [uint32](($raw -shl 16) -bor $raw);` +
    `[void][W]::waveOutSetVolume([IntPtr]::Zero, $both);` +
    `Write-Output ('before:' + $curPct + ' after:' + $next)` +
    `"`
  );
}

function volSetCmd(level) {
  return (
    `powershell -NonInteractive -Command "` +
    `Add-Type -TypeDefinition '${WINMM_TYPE}';` +
    `$cur = 0;$null = [W]::waveOutGetVolume([IntPtr]::Zero, [ref]$cur);` +
    `$curPct = [int](($cur -band 0xFFFF) * 100 / 65535);` +
    `$raw = [uint32]([Math]::Round(65535 * ${level} / 100));` +
    `$both = [uint32](($raw -shl 16) -bor $raw);` +
    `[void][W]::waveOutSetVolume([IntPtr]::Zero, $both);` +
    `Write-Output ('before:' + $curPct + ' after:${level}')` +
    `"`
  );
}

function brightUpCmd() {
  return (
    `powershell -NonInteractive -Command "` +
    `$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness;` +
    `if ($cur -eq $null) { Write-Output 'wmi_not_supported'; exit 0 };` +
    `$next = [Math]::Min(100, [int]$cur + 10);` +
    `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$next);` +
    `Write-Output ('before:' + $cur + ' after:' + $next)` +
    `"`
  );
}

function brightDownCmd() {
  return (
    `powershell -NonInteractive -Command "` +
    `$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness;` +
    `if ($cur -eq $null) { Write-Output 'wmi_not_supported'; exit 0 };` +
    `$next = [Math]::Max(0, [int]$cur - 10);` +
    `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,$next);` +
    `Write-Output ('before:' + $cur + ' after:' + $next)` +
    `"`
  );
}

function brightSetCmd(level) {
  return (
    `powershell -NonInteractive -Command "` +
    `$cur = (Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness -ErrorAction SilentlyContinue).CurrentBrightness;` +
    `if ($cur -eq $null) { Write-Output 'wmi_not_supported'; exit 0 };` +
    `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${level});` +
    `Write-Output ('before:' + $cur + ' after:${level}')` +
    `"`
  );
}

async function run(label, cmd) {
  process.stdout.write(`\n[TEST] ${label} ... `);
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
    const out = stdout.trim();
    if (out === "wmi_not_supported") {
      console.log("⚠️  WMI not supported (desktop / external monitor) — command skipped");
    } else {
      console.log(`✅  ${out}`);
    }
    if (stderr && !stderr.includes("npm notice")) {
      console.warn(`   stderr: ${stderr.trim().slice(0, 150)}`);
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
  await run("volume_up   (+5%)", volUpCmd());
  await run("volume_down (-5%)", volDownCmd());
  await run("volume_set  (50%)", volSetCmd(50));
  await run("volume_set  (70%)", volSetCmd(70));

  // ── Brightness ────────────────────────────────────
  await run("brightness_up   (+10%)", brightUpCmd());
  await run("brightness_down (-10%)", brightDownCmd());
  await run("brightness_set  (60%)",  brightSetCmd(60));
  await run("brightness_set  (80%)",  brightSetCmd(80));

  console.log("\n✔ All tests done.\n");
})();
