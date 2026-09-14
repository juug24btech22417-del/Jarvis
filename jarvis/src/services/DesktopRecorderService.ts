/**
 * DesktopRecorderService — Semantic desktop automation via Windows UI Automation.
 *
 * NO MORE ABSOLUTE PIXELS. Steps store SEMANTIC targets:
 *   { process, name, controlType, automationId, className }
 * e.g. "Button 'Play' in Spotify".
 *
 * At replay time the element is re-resolved in the live UIA tree and we click
 * its CURRENT position — so window moves, resizes and monitor changes are fine.
 *
 * Recording UX: user clicks on the live screenshot → we call
 * UIA FromPoint to identify the element under the cursor → store the
 * semantic descriptor. Window-relative coordinates are kept as fallback.
 *
 * Flow:
 *   1. startDesktopRecording()   → screenshot + session
 *   2. User clicks screenshot    → describePoint(x,y) resolves the ELEMENT
 *   3. addDesktopStep()          → stores semantic target (+coord fallback)
 *   4. stopDesktopRecording()    → saves macro
 *   5. replayDesktopMacro()      → re-resolves elements at runtime
 */

import { execSync, spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { saveMacro, appendStep, incrementReplayCount, getMacro, interpolateStep } from "@/lib/ghost/macroStore";
import type { Macro, MacroStep, MacroReplayResult } from "@/lib/ghost/macroTypes";

/** Semantic UIA descriptor stored per step in step.options.uia */
export interface UiaTarget {
  process: string;       // process name e.g. "Spotify"
  name: string;          // element Name e.g. "Play"
  controlType: string;   // e.g. "Button", "Edit", "Document"
  automationId: string;
  className: string;
  windowName: string;    // top-level window title
}

interface DesktopSession {
  id: string;
  macroId: string;
  steps: MacroStep[];
  isRecording: boolean;
  startedAt: Date;
  targetProcess?: string;
}

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const activeDesktopSessions = new Map<string, DesktopSession>();

function stepId(): string {
  return `dstep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Strip characters that break PowerShell single/double-quoted strings */
function psSafe(s: string): string {
  return (s || "").replace(/['"`$]/g, "").slice(0, 200);
}

// ─── PowerShell helpers ────────────────────────────────────────────────

function ps(command: string, timeoutMs = 10000): string {
  try {
    // IMPORTANT: drop full-line # comments BEFORE collapsing newlines.
    // A # comment on the single collapsed line would comment out the
    // entire rest of the script (this actually happened).
    const lines = command
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    // ALWAYS make the process DPI-aware first. Without this, Windows scales
    // every coordinate by the display factor (e.g. 1.25x at 125%): the mouse
    // API clicks at scaled pixels while UIA reports physical ones — clicks
    // silently land in the wrong place (the "replay does nothing" bug).
    // Clause-aware join: `if {...}` followed by `elseif {...}` on the next
    // line must join with a SPACE, not a semicolon. `... }; elseif ...`
    // orphans elseif into an unknown command (PowerShell terminates the if
    // statement at the semicolon) — every branch silently died and scans
    // returned nothing (this actually happened; catch{continue} ate it).
    const CLAUSE = /^(elseif|else|catch|finally)\b/;
    let oneliner = `${psAddType(CS_DPIA)}; [DPIA]::SetProcessDPIAware() | Out-Null`;
    for (const l of lines) {
      oneliner = oneliner.endsWith("}") && CLAUSE.test(l)
        ? `${oneliner} ${l}`
        : `${oneliner}; ${l}`;
    }
    oneliner = oneliner.replace(/;\s*;/g, ";").trim();
    return execSync(
      `powershell -NoProfile -Command "${oneliner.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8", timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  } catch (err: any) {
    console.error("[DesktopRecorder] PowerShell error:", err?.message?.slice(0, 300));
    const stderr = (err as any)?.stderr?.toString?.().slice(0, 500);
    if (stderr) console.error("[DesktopRecorder] PS stderr:", stderr);
    return "";
  }
}

/**
 * Inline C# for Add-Type — MUST stay single-line because ps() collapses
 * newlines (PowerShell here-strings break when flattened).
 */
const CS_GETWINDOWRECT =
  'using System;using System.Runtime.InteropServices;public class Win32GR { [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect); }[StructLayout(LayoutKind.Sequential)]public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }';

const CS_FOREGROUND =
  'using System;using System.Runtime.InteropServices;public class Win32FG { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }';

const CS_SETFOREGROUND =
  'using System;using System.Runtime.InteropServices;public class Win32SF { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }';

const CS_MOUSE =
  'using System;using System.Runtime.InteropServices;public class MouseOps { [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo); [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo); }';

const CS_DPIA =
  'using System;using System.Runtime.InteropServices;public class DPIA { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }';

const CS_FGPID =
  'using System;using System.Runtime.InteropServices;public class Win32FG2 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count); }';

function psAddType(cs: string): string {
  return `Add-Type -TypeDefinition '${cs}'`;
}

// ─── Persistent PowerShell worker ───────────────────────────────────────
// Every execSync("powershell ...") costs ~1s of process startup + assembly
// loading, and a 6-step replay used to spawn ~20 of them = most of the
// replay time. One long-lived worker loads DPI/C#/UIA ONCE, then each
// command is a fast stdin roundtrip (~30-100ms).

const WORKER_INIT = [
  psAddType(CS_DPIA),
  "[DPIA]::SetProcessDPIAware() | Out-Null",
  psAddType(CS_GETWINDOWRECT),
  psAddType(CS_FOREGROUND),
  psAddType(CS_FGPID),
  psAddType(CS_SETFOREGROUND),
  psAddType(CS_MOUSE),
  "Add-Type -AssemblyName System.Windows.Forms",
  "Add-Type -AssemblyName System.Drawing",
  "Add-Type -AssemblyName UIAutomationClient",
  "Add-Type -AssemblyName UIAutomationTypes",
  "Add-Type -AssemblyName WindowsBase",
].join("; ");

let worker: ChildProcess | null = null;
let workerReady = false;
let workerSeq = 0;
interface PsJob {
  marker: string;
  buf: string;
  resolve: (v: string) => void;
  timer: NodeJS.Timeout;
}
let currentJob: PsJob | null = null;
const jobQueue: Array<{ cmd: string; timeoutMs: number; resolve: (v: string) => void }> = [];

/** Strip comment/blank lines and join clause-aware (elseif/else/catch/finally
 * must attach to the preceding `}` with a SPACE — see psAsync comment). */
function buildOneLiner(command: string): string {
  const lines = command
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const CLAUSE = /^(elseif|else|catch|finally)\b/;
  let s = "";
  for (const l of lines) {
    s = s.endsWith("}") && CLAUSE.test(l) ? `${s} ${l}` : `${s}; ${l}`;
  }
  return s.replace(/;\s*;/g, ";").trim();
}

function killWorker() {
  try { worker?.kill(); } catch {}
}

function pumpWorker() {
  if (!worker || !workerReady || currentJob || jobQueue.length === 0) return;
  const job = jobQueue.shift()!;
  const marker = `<<PSDONE_${++workerSeq}_${Date.now()}>>`;
  currentJob = {
    marker,
    buf: "",
    resolve: job.resolve,
    timer: setTimeout(() => {
      console.error(`[DesktopRecorder] PS worker command timed out (${job.timeoutMs}ms) — recycling worker`);
      killWorker(); // exit handler resolves with "" and clears the queue
    }, job.timeoutMs),
  };
  try {
    worker?.stdin?.write(`${job.cmd}\nWrite-Output "${marker}"\n`);
  } catch {
    // dead pipe — exit handler will clean up
  }
}

function startWorker(): boolean {
  try {
    worker = spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-Command", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (e: any) {
    console.error("[DesktopRecorder] Failed to start PS worker:", e?.message);
    worker = null;
    return false;
  }
  workerReady = false;
  worker.stdout?.setEncoding("utf8");
  worker.stdout?.on("data", (d: string) => {
    if (!currentJob) return;
    currentJob.buf += d;
    const i = currentJob.buf.indexOf(currentJob.marker);
    if (i !== -1) {
      const out = currentJob.buf.slice(0, i).trim();
      const j = currentJob;
      currentJob = null;
      clearTimeout(j.timer);
      j.resolve(out);
      pumpWorker();
    }
  });
  worker.stderr?.setEncoding("utf8");
  worker.stderr?.on("data", (d: string) => {
    const t = String(d).trim();
    if (t) console.error("[DesktopRecorder] PS worker stderr:", t.slice(0, 300));
  });
  worker.on("exit", () => {
    worker = null;
    workerReady = false;
    if (currentJob) {
      const j = currentJob;
      currentJob = null;
      clearTimeout(j.timer);
      j.resolve("");
    }
    // Drop queued jobs — callers get "" (same as a failed spawn)
    while (jobQueue.length) jobQueue.shift()!.resolve("");
  });
  worker.on("error", () => {
    killWorker();
  });
  // Preload DPI + Win32 + UIA as the first queued roundtrip
  const initMarker = `<<PSINIT_${Date.now()}>>`;
  currentJob = {
    marker: initMarker,
    buf: "",
    resolve: () => {
      workerReady = true;
      pumpWorker();
    },
    timer: setTimeout(() => killWorker(), 25000),
  };
  try {
    worker.stdin?.write(`${WORKER_INIT}\nWrite-Output "${initMarker}"\n`);
  } catch {}
  return true;
}

/**
 * Run a PowerShell snippet and return its stdout. Uses the persistent
 * worker (fast) with an execSync fallback if the worker can't start.
 */
async function psAsync(command: string, timeoutMs = 10000): Promise<string> {
  if (!worker) {
    if (!startWorker()) return psSyncFallback(command, timeoutMs);
  }
  // In worker mode the DPI/C#/assembly preloads are already loaded — strip
  // those lines so each roundtrip is pure logic.
  const workerLines = command
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("#") &&
        !/^Add-Type -AssemblyName /.test(l) &&
        !/^Add-Type -TypeDefinition 'using System/.test(l)
    );
  const CLAUSE = /^(elseif|else|catch|finally)\b/;
  let oneliner = "";
  for (const l of workerLines) {
    oneliner = oneliner.endsWith("}") && CLAUSE.test(l) ? `${oneliner} ${l}` : `${oneliner}; ${l}`;
  }
  oneliner = oneliner.replace(/;\s*;/g, ";").trim();
  if (!oneliner) return "";

  return new Promise((resolve) => {
    jobQueue.push({ cmd: oneliner, timeoutMs, resolve });
    pumpWorker();
  });
}

/** Old spawn-per-command path — fallback only. */
function psSyncFallback(command: string, timeoutMs: number): string {
  try {
    // DPI-aware first (each fresh process needs it), then the clause-aware
    // one-liner build (see buildOneLiner).
    const oneliner = `${psAddType(CS_DPIA)}; [DPIA]::SetProcessDPIAware() | Out-Null; ${buildOneLiner(command)}`;
    return execSync(
      `powershell -NoProfile -Command "${oneliner.replace(/"/g, '\\"')}"`,
      { encoding: "utf-8", timeout: timeoutMs, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  } catch (err: any) {
    console.error("[DesktopRecorder] PowerShell error:", err?.message?.slice(0, 300));
    const stderr = (err as any)?.stderr?.toString?.().slice(0, 500);
    if (stderr) console.error("[DesktopRecorder] PS stderr:", stderr);
    return "";
  }
}

/**
 * Origin of the virtual screen that screenshots are captured from.
 * Screenshot pixel (bx,by) == screen point (bx+ox, by+oy).
 * Updated every time a screenshot is taken; single-monitor = 0,0.
 */
let virtualOrigin = { x: 0, y: 0 };

/**
 * Get the bounding rectangle of a window by process name.
 */
async function getWindowBounds(processName: string): Promise<WindowBounds | null> {
  const raw = await psAsync(`
    ${psAddType(CS_GETWINDOWRECT)}
    $proc = Get-Process -Name "${psSafe(processName)}" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($proc) {
      $rect = New-Object RECT
      [Win32GR]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
      Write-Output "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
    }
  `);
  if (!raw || raw.includes("Error")) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length < 4 || parts.some(isNaN)) return null;
  return { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
}

/**
 * Get the currently focused (foreground) window's process name.
 */
async function getForegroundProcessName(): Promise<string> {
  const raw = await psAsync(`
    ${psAddType(CS_FOREGROUND)}
    $hwnd = [Win32FG]::GetForegroundWindow()
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $hwnd } | Select-Object -First 1
    if ($proc) { Write-Output $proc.Name }
  `);
  return raw || "";
}

/**
 * List all open top-level windows (process name + title) for the app picker.
 */
export async function listOpenWindows(): Promise<Array<{ process: string; title: string }>> {
  const raw = await psAsync(`
    Get-Process | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.MainWindowTitle } |
      ForEach-Object { Write-Output "$($_.Name)|$($_.MainWindowTitle)" }
  `, 8000);
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const idx = l.indexOf("|");
      return { process: l.slice(0, idx), title: l.slice(idx + 1) };
    });
}

/**
 * UIA: identify the element at a screen point — the heart of the new recorder.
 * Returns a semantic descriptor instead of coordinates.
 */
export async function uiaDescribePoint(bx: number, by: number): Promise<UiaTarget | null> {
  // Panel sends coordinates in SCREENSHOT pixel space; UIA needs real screen
  // coordinates — translate by the virtual-screen origin of the last capture.
  const x = Math.round(bx) + virtualOrigin.x;
  const y = Math.round(by) + virtualOrigin.y;
  const raw = await psAsync(`
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName WindowsBase
    $pt = New-Object System.Windows.Point(${x}, ${y})
    $el = [System.Windows.Automation.AutomationElement]::FromPoint($pt)
    if ($el) {
      $c = $el.Current
      $ct = $c.ControlType.ProgrammaticName -replace 'ControlType.',''
      $pname = ''
      $p = Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue
      if ($p) { $pname = $p.Name }
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $win = $el
      $winName = ''
      for ($i = 0; $i -lt 15; $i++) {
        if (-not $win) { break }
        if ($win.Current.ControlType.ProgrammaticName -eq 'ControlType.Window') { $winName = $win.Current.Name; break }
        try { $parent = $walker.GetParent($win) } catch { break }
        if (-not $parent -or $parent.Equals($win)) { break }
        $win = $parent
      }
      Write-Output ('NAME=' + $c.Name)
      Write-Output ('TYPE=' + $ct)
      Write-Output ('AID=' + $c.AutomationId)
      Write-Output ('CLS=' + $c.ClassName)
      Write-Output ('PROC=' + $pname)
      Write-Output ('WIN=' + $winName)
    }
  `, 15000);

  if (!raw) return null;
  const map: Record<string, string> = {};
  raw.split("\n").forEach((line) => {
    const idx = line.indexOf("=");
    if (idx > 0) map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  if (!map.PROC && !map.NAME) return null;
  return {
    process: map.PROC || "",
    name: map.NAME || "",
    controlType: map.TYPE || "",
    automationId: map.AID || "",
    className: map.CLS || "",
    windowName: map.WIN || "",
  };
}

/**
 * Human-readable description of a semantic target.
 */
export function describeUiaTarget(t: UiaTarget): string {
  const namePart = t.name ? `"${t.name}"` : t.automationId ? `#${t.automationId}` : "element";
  return `${t.controlType || "Element"} ${namePart}${t.process ? ` (${t.process})` : ""}`;
}

/**
 * UIA: re-resolve a semantic target in the LIVE tree → screen coords of its center.
 *
 * Spotify's legacy UIA bridge HARD-CRASHES PowerShell mid-scan (native code,
 * no .NET exception — script just dies with zero output). One big scan is
 * therefore useless: a crash anywhere = "not found". So Node orchestrates
 * small single-ControlType scans — one PowerShell process per type, recorded
 * type first. A crash only burns that one attempt; earlier output survives.
 * Off-screen / virtualized rows (huge coords) are rejected — unclickable.
 */
export async function uiaResolveTarget(t: UiaTarget): Promise<string | null> {
  const proc = psSafe(t.process);
  const name = psSafe(t.name);
  const aid = psSafe(t.automationId);
  const cls = psSafe(t.className);
  if (!proc) return null;

  const typeOrder = [
    ...(t.controlType ? [t.controlType] : []),
    "ListItem", "DataItem", "Group", "Button", "ComboBox",
    "Edit", "Document", "Hyperlink", "TabItem", "Custom",
  ].filter((v, i, a) => a.indexOf(v) === i);

  for (const ty of typeOrder) {
    const coords = await uiaScanOneType(proc, name, aid, cls, ty);
    console.log(`[DesktopRecorder] uiaScan type=${ty} name="${name}" → ${coords || "null"}`);
    if (coords) return coords;
  }
  return null;
}

/**
 * Scan ONE ControlType subtree via CacheRequest (bulk property fetch —
 * per-element .Current walks take 25s+ on Spotify's bridge). Cache only
 * Name+BoundingRectangle; bulk-reading more properties crashes on Spotify.
 * CRITICAL: keep the activation context in a variable ($ctx) — discarding it
 * deactivates the cache and every .Cached read then throws.
 * Output-as-found: exact on-screen name match prints and exits immediately —
 * never defer output, the bridge can die at any point mid-scan.
 */
async function uiaScanOneType(
  proc: string,
  name: string,
  aid: string,
  cls: string,
  controlType: string
): Promise<string | null> {
  const script = `
    # NOTE: no 'exit' anywhere — in the persistent worker exit kills the whole
    # process (marker never sent, job looks failed). Early-outs use if-blocks.
    $out = $null
    $p2 = Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($p2) {
      $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($p2.MainWindowHandle)
      if ($rootEl) {
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $needle = '${name}'.ToLower()
        $tc = $null
        try { $tc = [System.Windows.Automation.ControlType]::('${controlType}') } catch {}
        if ($tc) {
          $tcond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $tc)
          # CacheRequest MUST be active BEFORE FindAll — the request active at
          # FindAll time is baked into the returned elements. Activating it
          # after leaves every element cache-less and .Cached throws for each.
          $ctx = $null
          $req = New-Object System.Windows.Automation.CacheRequest
          $req.TreeScope = [System.Windows.Automation.TreeScope]::Element
          $req.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::None
          [void]$req.Add([System.Windows.Automation.AutomationElement]::NameProperty)
          [void]$req.Add([System.Windows.Automation.AutomationElement]::BoundingRectangleProperty)
          $ctx = $req.Activate()
          $subset = $rootEl.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tcond)
          if ($subset -and $subset.Count -gt 0) {
            $best = $null
            $bestRank = -1000000.0
            foreach ($e in $subset) {
              try {
                $c = $e.Cached
                $n = $c.Name
                if ($n) {
                  $nl = $n.ToLower()
                  $score = 0.0
                  if ($needle) {
                    if ($nl -eq $needle) { $score += 4 }
                    elseif ($nl.Contains($needle)) { $score += 2 }
                    else { continue }
                  }
                  if ($score -le 0) { continue }
                  $r = $c.BoundingRectangle
                  if ($r.Width -le 0 -or $r.Height -le 0 -or [double]::IsInfinity($r.X)) { continue }
                  $cx = $r.X + $r.Width / 2
                  $cy = $r.Y + $r.Height / 2
                  # Off-screen / virtualized rows: huge coords, unclickable
                  if ([double]::IsInfinity($cx) -or [double]::IsInfinity($cy)) { continue }
                  $onScreen = ($cx -ge $vs.X) -and ($cx -le ($vs.X + $vs.Width)) -and ($cy -ge $vs.Y) -and ($cy -le ($vs.Y + $vs.Height))
                  if (-not $onScreen) { continue }
                  $rank = $score * 1000 + (8000 - $cy)
                  if ($rank -gt $bestRank) { $bestRank = $rank; $best = @($cx, $cy) }
                  if ($score -ge 4) { break }
                }
              } catch { continue }
            }
            if ($best) { $out = ("" + [int]$best[0] + "," + [int]$best[1]) }
          }
          if ($ctx) { try { $ctx.Dispose() } catch {} }
        }
      }
    }
    if ($out) { Write-Output $out }
  `;
  const raw = await psAsync(script, 8000);
  if (!raw) return null;
  const parts = raw.trim().split(",").map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  return `${parts[0]},${parts[1]}`;
}

// ─── Mouse / keyboard simulation ───────────────────────────────────────

async function mouseClick(x: number, y: number): Promise<void> {
  await psAsync(`
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    ${psAddType(CS_MOUSE)}
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
    Start-Sleep -Milliseconds 60
    [MouseOps]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [MouseOps]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  `);
}

async function launchApp(target: string): Promise<void> {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
    await psAsync(`Start-Process "${psSafe(target)}"`);
    return;
  }
  if (target.endsWith(".exe") && (target.includes("\\") || target.includes("/"))) {
    await psAsync(`Start-Process "${psSafe(target)}"`);
    return;
  }
  const knownApps: Record<string, string> = {
    spotify: "spotify",
    chrome: "chrome",
    firefox: "firefox",
    edge: "msedge",
    notepad: "notepad",
    calculator: "calc",
    cmd: "cmd",
    powershell: "powershell",
    "file explorer": "explorer",
    explorer: "explorer",
  };
  const lower = target.toLowerCase().trim();
  const appName = knownApps[lower] || psSafe(lower);
  await psAsync(`Start-Process "${appName}"`);
}

async function focusWindow(processName: string): Promise<void> {
  await psAsync(`
    ${psAddType(CS_SETFOREGROUND)}
    ${psAddType(CS_MOUSE)}
    $proc = Get-Process -Name "${psSafe(processName)}" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if (-not $proc) {
      # Store apps (Notepad/Calc) are frame-hosted by ApplicationFrameHost
      $frameHost = Get-Process -Name "ApplicationFrameHost" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match [regex]::Escape('${psSafe(processName)}') } | Select-Object -First 1
      if ($frameHost) { $proc = $frameHost }
    }
    if ($proc) {
      [Win32SF]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
      # Windows denies SetForegroundWindow to background processes —
      # tapping Alt first grants the foreground-transfer right.
      [MouseOps]::keybd_event(0x12, 0, 0, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      [Win32SF]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
      [MouseOps]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
    }
  `);
}

/**
 * Focus a window and wait briefly — needed before semantic clicks so the
 * UIA tree is live and the app receives input.
 */
async function focusAndWait(processName: string): Promise<void> {
  if (processName) {
    await focusWindow(processName);
  }
}

async function typeText(text: string): Promise<void> {
  const escaped = text.replace(/([+^%~(){}[\]])/g, "{$1}");
  await psAsync(`
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("${escaped.replace(/"/g, '`"')}")
  `);
}

async function pressKey(key: string): Promise<void> {
  const keyMap: Record<string, string> = {
    Enter: "{ENTER}", Tab: "{TAB}", Escape: "{ESC}",
    Backspace: "{BACKSPACE}", Delete: "{DELETE}",
    ArrowUp: "{UP}", ArrowDown: "{DOWN}",
    ArrowLeft: "{LEFT}", ArrowRight: "{RIGHT}",
    Home: "{HOME}", End: "{END}",
    PageUp: "{PGUP}", PageDown: "{PGDN}",
    Space: " ",
    F1: "{F1}", F2: "{F2}", F3: "{F3}", F4: "{F4}",
    F5: "{F5}", F6: "{F6}", F7: "{F7}", F8: "{F8}",
    F9: "{F9}", F10: "{F10}", F11: "{F11}", F12: "{F12}",
  };
  const sendKey = keyMap[key] || key;
  await psAsync(`
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("${sendKey.replace(/"/g, '`"')}")
  `);
}

// ─── Verified input — the fix for "replay says success but nothing happened" ─
// Each verification is ONE worker roundtrip: act + poll + verdict inside a
// single PowerShell script. The old version spawned 4-6 processes per click.

/**
 * Click, then verify the target app actually took focus — all in one
 * PowerShell roundtrip (click + ≤1.2s foreground poll via PID lookup).
 * Retry-with-force-focus happens in Node (rare path).
 */
async function verifiedMouseClick(x: number, y: number, targetProcess: string): Promise<void> {
  const want = psSafe(targetProcess);
  const script = `
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)}, ${Math.round(y)})
    Start-Sleep -Milliseconds 60
    [MouseOps]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 50
    [MouseOps]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    $fgname = ''
    $fgtitle = ''
    if ('${want}') {
      $deadline = [DateTime]::UtcNow.AddMilliseconds(1200)
      while ([DateTime]::UtcNow -lt $deadline) {
        $h = [Win32FG2]::GetForegroundWindow()
        $wpid = [uint32]0
        [Win32FG2]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
        $p = Get-Process -Id $wpid -ErrorAction SilentlyContinue
        if ($p) { $fgname = $p.Name }
        $sb = New-Object System.Text.StringBuilder 512
        [Win32FG2]::GetWindowText($h, $sb, 512) | Out-Null
        $fgtitle = $sb.ToString()
        # Store apps (Notepad, Calculator...) are frame-hosted by
        # ApplicationFrameHost — match the window title as well.
        if ($fgname -ieq '${want}' -or $fgtitle.ToLower().Contains(('${want}').ToLower())) { break }
        Start-Sleep -Milliseconds 100
      }
    }
    $ok = (-not '${want}') -or ($fgname -ieq '${want}') -or ($fgtitle.ToLower().Contains(('${want}').ToLower()))
    if ($ok) { Write-Output 'CLICK_OK' } else { Write-Output ('CLICK_MISS=' + $fgname) }
  `;
  const raw = await psAsync(script, 6000);
  if ((raw || "").includes("CLICK_OK")) return;

  const fg = /CLICK_MISS=(.*)/.exec(raw || "")?.[1]?.trim() || "unknown";
  console.warn(`[DesktopRecorder] Click did not land on "${targetProcess}" (fg=${fg}) — forcing focus + retry`);
  await focusWindow(targetProcess);
  const raw2 = await psAsync(script, 6000);
  if ((raw2 || "").includes("CLICK_OK")) return;
  throw new Error(`Click at ${x},${y} did not activate "${targetProcess}" (foreground is "${fg}")`);
}

/**
 * Type text, then verify it landed by polling the focused element's
 * ValuePattern — all in one PowerShell roundtrip (≤2s poll).
 */
async function verifiedTypeText(text: string, targetProcess: string): Promise<void> {
  // Raw text embedded in a PowerShell single-quoted string ('' = literal ')
  const psTyped = text.replace(/'/g, "''").slice(0, 300);
  const wantLower = psSafe(text).toLowerCase();
  const script = `
    # Type char-by-char with tiny delays — after OCR self-heal clicks the
    # field can still be initializing; a whole-string SendWait drops
    # spaces (e.g. "Back to friends" → "Backtofriends").
    $rawText = '${psTyped}'
    foreach ($c in $rawText.ToCharArray()) {
      $s = [string]$c
      if ($s -match '[+^%~(){}[\]]') { $s = '{' + $s + '}' }
      [System.Windows.Forms.SendKeys]::SendWait($s)
      Start-Sleep -Milliseconds 25
    }
    $want = '${wantLower}'
    $found = ''
    $fgname = ''
    $deadline = [DateTime]::UtcNow.AddMilliseconds(2000)
    while ([DateTime]::UtcNow -lt $deadline) {
      try {
        $f = [System.Windows.Automation.AutomationElement]::FocusedElement
        if ($f) {
          $vp = $null
          if ($f.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$vp)) {
            $v = $vp.Current.Value
            if ($v) { $found = $v }
            if ($v -and $v.ToLower().Contains($want)) { break }
          }
        }
      } catch {}
      Start-Sleep -Milliseconds 120
    }
    $h = [Win32FG2]::GetForegroundWindow()
    $wpid = [uint32]0
    [Win32FG2]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
    $p = Get-Process -Id $wpid -ErrorAction SilentlyContinue
    if ($p) { $fgname = $p.Name }
    if ($found -and $found.ToLower().Contains($want)) { Write-Output ('TYPE_OK=' + $found) }
    elseif ($found) { Write-Output ('TYPE_MISS=' + $found) }
    else { Write-Output ('TYPE_NOFIELD FGN=' + $fgname) }
  `;
  const raw = (await psAsync(script, 8000)) || "";
  if (raw.includes("TYPE_OK")) {
    console.log(`[DesktopRecorder] Type verified: "${text}" landed in focused field`);
    return;
  }
  const miss = /TYPE_MISS=(.*)/.exec(raw)?.[1]?.trim();
  if (miss !== undefined) {
    throw new Error(`Typed text did not land (field contains "${miss.slice(0, 60)}")`);
  }
  // No value-readable field — verify the target app at least owns input.
  const fg = /FGN=(.*)/.exec(raw)?.[1]?.trim() || "";
  if (targetProcess && fg.toLowerCase() !== targetProcess.toLowerCase()) {
    throw new Error(`Typed text but "${targetProcess}" is not the foreground app (fg="${fg || "unknown"}")`);
  }
  console.log(`[DesktopRecorder] Type sent (non-verifiable field — app focus confirmed)`);
}

/**
 * Wait until a process has a main window (app actually launched) —
 * replaces blind 4-5s launch sleeps. Returns quickly once visible.
 */
async function waitForWindow(processName: string, timeoutMs: number): Promise<boolean> {
  const script = `
    $found = ''
    $deadline = [DateTime]::UtcNow.AddMilliseconds(${Math.min(timeoutMs, 15000)})
    while ([DateTime]::UtcNow -lt $deadline) {
      $p = Get-Process -Name '${psSafe(processName)}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
      if ($p) { $found = $p.Name; break }
      Start-Sleep -Milliseconds 200
    }
    Write-Output ('FOUND=' + $found)
  `;
  const raw = await psAsync(script, timeoutMs + 4000);
  return /FOUND=.+/.test(raw || "");
}

async function takeScreenshotPath(): Promise<string> {
  const path = require("path") as typeof import("path");
  const os = require("os") as typeof import("os");
  const ssPath = path.join(os.tmpdir(), `desktop_${Date.now()}.png`);
  const psPath = ssPath.replace(/\\/g, "/");
  const raw = await psAsync(`
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($vs.X, $vs.Y, 0, 0, $vs.Size)
    $bmp.Save('${psPath}')
    $gfx.Dispose()
    $bmp.Dispose()
    Write-Output ("ORIGIN=" + $vs.X + "," + $vs.Y)
  `);
  const m = /ORIGIN=(-?\d+),(-?\d+)/.exec(raw || "");
  if (m) virtualOrigin = { x: Number(m[1]), y: Number(m[2]) };
  return ssPath;
}

async function takeScreenshotBase64(filePath?: string): Promise<string> {
  const ssPath = filePath || (await takeScreenshotPath());
  try {
    const fs = await import("fs/promises");
    const data = await fs.readFile(ssPath);
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}

// ─── Self-healing: OCR fallback ───────────────────────────────────────
// When the UIA tree no longer contains a recorded element (app redesign,
// virtualized list, web view with no accessibility tree), OCR the screen
// and click the text label itself. Runs in its own STA PowerShell process
// (Windows Media OCR requires STA; the persistent worker is MTA).

async function ocrFindText(
  text: string,
  processName?: string
): Promise<string | null> {
  const want = psSafe(text).toLowerCase().trim();
  if (!want) return null;
  // Bring the app to front so its pixels are actually on screen
  // (also restores minimized windows — wait out the restore animation
  // or the screenshot catches an empty frame)
  if (processName) await focusWindow(processName);
  await new Promise((r) => setTimeout(r, 900));

  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class DPICOCR { [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware(); }'",
    "[DPICOCR]::SetProcessDPIAware() | Out-Null",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    "[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]",
    "[void][Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]",
    "[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]",
    "[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]",
    "$ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()",
    "if (-not $ocr) { $ocr = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language,Windows.Foundation,ContentType=WindowsRuntime]::new('en-US')) }",
    "if (-not $ocr) { Write-Output 'OCRDIAG=noengine' }",
    "if ($ocr) {",
    "  Write-Output ('OCRDIAG=engine-ok lang=' + $ocr.RecognitionLanguage.LanguageTag)",
    "  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen",
    "  $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)",
    "  $gfx = [System.Drawing.Graphics]::FromImage($bmp)",
    "  $gfx.CopyFromScreen($vs.X, $vs.Y, 0, 0, $vs.Size)",
    "  $ms = New-Object System.IO.MemoryStream",
    "  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)",
    "  $ms.Position = 0",
    "  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    "  function Await($WinRtTask, $ResultType) {",
    "    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)",
    "    $netTask = $asTask.Invoke($null, @($WinRtTask))",
    "    $netTask.Wait(-1) | Out-Null",
    "    $netTask.Result",
    "  }",
    "  $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)",
    "  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])",
    "  $softBitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])",
    "  $result = Await ($ocr.RecognizeAsync($softBitmap)) ([Windows.Media.Ocr.OcrResult])",
    "  Write-Output ('OCRDIAG=lines=' + $result.Lines.Count)",
    `  $needle = '${want}'`,
    "  $words = @()",
    "  if ($needle) { $words = ($needle -split '\\s+') | Where-Object { $_.Length -ge 4 } }",
    "  $best = $null",
    "  $bestScore = 0",
    "  foreach ($line in $result.Lines) {",
    "    $lt = $line.Text.ToLower()",
    "    $score = 0",
    "    if ($needle -and $lt.Contains($needle)) { $score = 100 }",
    "    else { foreach ($w in $words) { if ($lt.Contains($w)) { $score++ } } }",
    "    if ($score -gt $bestScore) {",
    "      $minX = [double]::MaxValue; $minY = [double]::MaxValue; $maxX = 0.0; $maxY = 0.0",
    "      foreach ($wd in $line.Words) {",
    "        $wr = $wd.BoundingRect",
    "        if ($wr.X -lt $minX) { $minX = $wr.X }",
    "        if ($wr.Y -lt $minY) { $minY = $wr.Y }",
    "        if (($wr.X + $wr.Width) -gt $maxX) { $maxX = $wr.X + $wr.Width }",
    "        if (($wr.Y + $wr.Height) -gt $maxY) { $maxY = $wr.Y + $wr.Height }",
    "      }",
    "      $bestScore = $score",
    "      $best = @(($vs.X + ($minX + $maxX)/2), ($vs.Y + ($minY + $maxY)/2))",
    "    }",
    "  }",
    "  if ($best) { Write-Output ('OCR=' + [int]$best[0] + ',' + [int]$best[1] + ' SCORE=' + $bestScore) }",
    "  $gfx.Dispose(); $bmp.Dispose()",
    "}",
  ].join("\n");

  const raw = await new Promise<string>((resolve) => {
    let out = "";
    const p = spawn("powershell.exe", ["-NoProfile", "-NoLogo", "-STA", "-Command", script], {
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      console.warn(`[DesktopRecorder] OCR timed out after 25s (partial out: ${out.length} chars)`);
      try { p.kill(); } catch {}
      resolve(out);
    }, 25000);
    p.stdout?.on("data", (d) => (out += d.toString()));
    p.stderr?.on("data", (d) => {
      const t = String(d).trim();
      if (t) console.warn(`[DesktopRecorder] OCR stderr: ${t.slice(0, 300)}`);
    });
    p.on("exit", (code) => {
      clearTimeout(timer);
      console.log(`[DesktopRecorder] OCR process exit=${code} out=${out.length} chars`);
      resolve(out);
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      console.error(`[DesktopRecorder] OCR spawn error: ${e.message}`);
      resolve(out);
    });
  });

  const m = /OCR=(-?\d+),(-?\d+)/.exec(raw || "");
  if (!m) {
    console.warn(
      `[DesktopRecorder] OCR self-heal found nothing for "${text}": ${(raw || "(no output)").trim().slice(0, 200)}`
    );
    return null;
  }
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!isFinite(x) || !isFinite(y) || (x === 0 && y === 0)) return null;
  return `${x},${y}`;
}

// ─── Recording API ─────────────────────────────────────────────────────

export async function startDesktopRecording(): Promise<{
  sessionId: string;
  macroId: string;
  screenshotPath: string;
  screenshotBase64: string;
  foregroundApp: string;
}> {
  const sessionId = `dsession_${Date.now()}`;

  const screenshotPath = await takeScreenshotPath();
  const screenshotBase64 = await takeScreenshotBase64(screenshotPath);
  const foregroundApp = await getForegroundProcessName();

  const macro = await saveMacro({
    name: `Desktop Recording ${new Date().toLocaleTimeString()}`,
    description: "Auto-recorded desktop session (semantic targets)",
    steps: [],
    isFormFill: false,
    tags: ["desktop", "recorded"],
  });

  const session: DesktopSession = {
    id: sessionId,
    macroId: macro.id,
    steps: [],
    isRecording: true,
    startedAt: new Date(),
    targetProcess: foregroundApp || undefined,
  };

  activeDesktopSessions.set(sessionId, session);

  console.log(`[DesktopRecorder] Recording started: session=${sessionId} macro=${macro.id} foreground=${foregroundApp}`);

  return { sessionId, macroId: macro.id, screenshotPath, screenshotBase64, foregroundApp };
}

export async function addDesktopStep(
  sessionId: string,
  step: Omit<MacroStep, "id">
): Promise<{ success: boolean; screenshotBase64: string; elementName?: string }> {
  const session = activeDesktopSessions.get(sessionId);
  if (!session || !session.isRecording) return { success: false, screenshotBase64: "" };

  const uia = (step.options as any)?.uia as UiaTarget | undefined;
  if (uia?.process) session.targetProcess = uia.process;

  // For clicks with raw coords and NO semantic target: keep window-relative
  // conversion as fallback so replays survive window moves.
  let processedStep: MacroStep = { id: stepId(), ...step };
  if (
    (step.action === "click" || step.action === "type") &&
    step.target && /^\d+,\d+$/.test(step.target)
  ) {
    const targetProcess = uia?.process || session.targetProcess || "";
    if (targetProcess && !uia) {
      const bounds = await getWindowBounds(targetProcess);
      if (bounds) {
        const [absX, absY] = step.target.split(",").map(Number);
        processedStep = {
          ...processedStep,
          target: `${absX - bounds.x},${absY - bounds.y}`,
          options: { ...step.options, windowRelative: true, targetProcess },
        };
      }
    }
  }

  session.steps.push(processedStep);
  await appendStep(session.macroId, processedStep).catch((e) =>
    console.error("[DesktopRecorder] appendStep error:", e)
  );

  // NOTE: no auto-screenshot here. The panel keeps the screenshot the user
  // clicked on stable and refreshes it explicitly via the Refresh button —
  // silently re-capturing mid-recording replaced their view after ~5s.
  return { success: true, screenshotBase64: "", elementName: uia ? describeUiaTarget(uia) : undefined };
}

export async function refreshDesktopScreenshot(sessionId: string): Promise<string> {
  const session = activeDesktopSessions.get(sessionId);
  if (!session) return "";
  return takeScreenshotBase64();
}

export async function stopDesktopRecording(
  sessionId: string
): Promise<{ macro: Macro; totalSteps: number } | null> {
  const session = activeDesktopSessions.get(sessionId);
  if (!session) return null;

  session.isRecording = false;
  activeDesktopSessions.delete(sessionId);

  const macro = await getMacro(session.macroId);
  if (!macro) return null;

  const { updateMacro } = await import("@/lib/ghost/macroStore");
  await updateMacro(session.macroId, {
    name: `Desktop — ${session.steps.length} steps`,
    description: `Recorded ${session.steps.length} desktop actions (semantic). Duration: ${Math.round((Date.now() - session.startedAt.getTime()) / 1000)}s`,
  });

  const finalMacro = await getMacro(session.macroId);
  console.log(`[DesktopRecorder] Recording stopped: ${session.steps.length} steps captured`);
  return { macro: finalMacro!, totalSteps: session.steps.length };
}

export function getDesktopRecordingStatus(
  sessionId: string
): { sessionId: string; isRecording: boolean; stepsRecorded: number; durationMs: number } | null {
  const session = activeDesktopSessions.get(sessionId);
  if (!session) return null;
  return {
    sessionId: session.id,
    isRecording: session.isRecording,
    stepsRecorded: session.steps.length,
    durationMs: Date.now() - session.startedAt.getTime(),
  };
}

// ─── Replay ────────────────────────────────────────────────────────────

const DESKTOP_STEP_TIMEOUT_MS = 45000;

export async function replayDesktopMacro(
  macroId: string,
  vars?: Record<string, string>
): Promise<MacroReplayResult> {
  const macro = await getMacro(macroId);
  if (!macro) {
    return {
      macroId, macroName: "Unknown", success: false,
      totalSteps: 0, stepsCompleted: 0, stepsFailed: 0,
      durationMs: 0, results: [],
    };
  }

  const startTime = Date.now();
  const stepResults: MacroReplayResult["results"] = [];
  let stepsCompleted = 0;
  let stepsFailed = 0;

  for (const rawStep of macro.steps) {
    const step = interpolateStep(rawStep, vars);
    const stepStart = Date.now();
    let stepSuccess = false;
    let stepError: string | undefined;
    let resolvedBy: string | undefined;

    try {
      await Promise.race([
        (async () => {
          switch (step.action) {
            case "click": {
              const uia = (step.options as any)?.uia as UiaTarget | undefined;
              if (uia?.process) await focusAndWait(uia.process);

              let coords: string | null = null;

              // 1. Semantic resolution — re-find the element in the live tree
              if (uia?.process) {
                coords = await uiaResolveTarget(uia);
                if (coords) resolvedBy = "uia";
              }

              // 2. Fallback: window-relative coordinates
              if (!coords && /^\d+,\d+$/.test(step.target || "")) {
                const parts = (step.target || "0,0").split(",").map(Number);
                const isRelative = (step.options as any)?.windowRelative;
                const targetProc = (step.options as any)?.targetProcess || uia?.process || "";
                if (isRelative && targetProc) {
                  // Re-fetch current window bounds
                  const raw = await psAsync(`
                    ${psAddType(CS_GETWINDOWRECT)}
                    $proc = Get-Process -Name "${psSafe(targetProc)}" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
                    if ($proc) {
                      $rect = New-Object RECT
                      [Win32GR]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
                      Write-Output "$($rect.Left),$($rect.Top)"
                    }
                  `);
                  if (raw) {
                    const [wx, wy] = raw.split(",").map(Number);
                    coords = `${(wx || 0) + (parts[0] || 0)},${(wy || 0) + (parts[1] || 0)}`;
                    resolvedBy = "window-relative";
                  }
                } else if (!isRelative) {
                  coords = `${parts[0] || 0},${parts[1] || 0}`;
                  resolvedBy = "absolute";
                }
              }

              // 3. Self-heal — UIA lost the element? OCR the screen and click
              // the text label itself (survives app UI overhauls).
              if (!coords && uia?.name) {
                const ocr = await ocrFindText(uia.name, uia.process);
                if (ocr) {
                  coords = ocr;
                  resolvedBy = "ocr";
                  console.log(`[DesktopRecorder] Self-healed via OCR: "${uia.name}" → ${ocr}`);
                }
              }
              if (!coords) throw new Error(`Could not resolve click target: ${uia ? describeUiaTarget(uia) : step.target}`);
              const [x, y] = coords.split(",").map(Number);
              const clickProc = uia?.process || (step.options as any)?.targetProcess || "";
              await verifiedMouseClick(x, y, clickProc);
              console.log(`[DesktopRecorder] Click @${coords} via ${resolvedBy} (verified)`);
              await new Promise((r) => setTimeout(r, 250));
              break;
            }

            case "type":
            case "fill": {
              const uia = (step.options as any)?.uia as UiaTarget | undefined;
              const typeProc = uia?.process || "";
              // If a semantic field target exists, focus it first
              if (uia?.process) {
                await focusAndWait(uia.process);
                let coords = await uiaResolveTarget(uia);
                // Self-heal: OCR fallback when UIA can't find the field
                if (!coords && uia.name) coords = await ocrFindText(uia.name, uia.process);
                if (coords) {
                  const [x, y] = coords.split(",").map(Number);
                  await verifiedMouseClick(x, y, uia.process);
                  await new Promise((r) => setTimeout(r, 200));
                }
              }
              await verifiedTypeText(step.value || "", typeProc);
              await new Promise((r) => setTimeout(r, 150));
              break;
            }

            case "press":
              await pressKey(step.value || "Enter");
              break;

            case "wait":
              await new Promise((r) => setTimeout(r, parseInt(step.value || "1000", 10)));
              break;

            case "launch": {
              const appTarget = step.target || step.value || "";
              if (!appTarget) throw new Error("No app target specified for launch");
              await launchApp(appTarget);
              // Wait only until the window actually exists (instead of a blind 5s)
              const processName = appTarget.replace(/\.exe$/i, "").split(/[/\\]/).pop() || appTarget;
              await waitForWindow(processName, 12000);
              await focusWindow(processName);
              await new Promise((r) => setTimeout(r, 400));
              break;
            }

            case "focus": {
              const focusTarget = step.target || step.value || "";
              if (!focusTarget) throw new Error("No window name for focus");
              await focusWindow(focusTarget);
              await new Promise((r) => setTimeout(r, 300));
              break;
            }

            case "goto": {
              const gotoTarget = step.target || "";
              if (!gotoTarget) throw new Error("No target for goto");
              if (/^https?:/i.test(gotoTarget)) {
                execSync(`start "" "${gotoTarget}"`, { stdio: "ignore", timeout: 10000 });
                await new Promise((r) => setTimeout(r, 2000));
              } else {
                await launchApp(gotoTarget);
                const pn = gotoTarget.replace(/\.exe$/i, "").split(/[/\\]/).pop() || gotoTarget;
                await waitForWindow(pn, 12000);
              }
              break;
            }

            case "scroll":
              await psAsync(`
                Add-Type -AssemblyName System.Windows.Forms
                [System.Windows.Forms.SendKeys]::SendWait("{PGDN}")
              `);
              await new Promise((r) => setTimeout(r, 200));
              break;

            default:
              throw new Error(`Unsupported desktop action: ${step.action}`);
          }
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Step timed out after ${DESKTOP_STEP_TIMEOUT_MS / 1000}s`)), DESKTOP_STEP_TIMEOUT_MS)
        ),
      ]);

      stepSuccess = true;
    } catch (err: any) {
      stepError = err?.message || String(err);
      console.error(`[DesktopRecorder] Step failed: ${step.action} — ${stepError}`);
    }

    stepResults.push({
      stepId: step.id,
      success: stepSuccess,
      error: stepError,
      durationMs: Date.now() - stepStart,
      resolvedBy,
    });

    if (stepSuccess) {
      stepsCompleted++;
    } else {
      stepsFailed++;
    }
  }

  await incrementReplayCount(macroId);

  return {
    macroId,
    macroName: macro.name,
    success: stepsFailed === 0,
    totalSteps: macro.steps.length,
    stepsCompleted,
    stepsFailed,
    durationMs: Date.now() - startTime,
    results: stepResults,
  };
}

export function getActiveDesktopSessions(): Array<{
  sessionId: string;
  macroId: string;
  stepsRecorded: number;
  isRecording: boolean;
  durationMs: number;
}> {
  return Array.from(activeDesktopSessions.values()).map((s) => ({
    sessionId: s.id,
    macroId: s.macroId,
    stepsRecorded: s.steps.length,
    isRecording: s.isRecording,
    durationMs: Date.now() - s.startedAt.getTime(),
  }));
}

/**
 * Detect the currently focused window's process name.
 */
export async function detectForegroundWindow(): Promise<string> {
  return getForegroundProcessName();
}
