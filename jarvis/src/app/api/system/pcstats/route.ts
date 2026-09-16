import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import os from "os";

const execAsync = promisify(exec);

// Cache for slow-changing system metrics (disks, battery)
interface CachedMetric<T> {
  data: T;
  timestamp: number;
}

let cachedDisks: CachedMetric<Array<{ caption: string; size: number; free: number; usage: number }>> | null = null;
let cachedTemp: CachedMetric<number | null> | null = null;
let cachedBattery: CachedMetric<number | null> | null = null;
const CACHE_TTL_MS = 25000; // 25 seconds

// CPU measurement using os.cpus()
interface CpuTickSummary {
  idle: number;
  total: number;
  time: number;
}

let lastCpuSnapshot: CpuTickSummary | null = null;

function getCpuTickSummary(): CpuTickSummary {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type as keyof typeof cpu.times];
    }
    idle += cpu.times.idle;
  }
  return { idle, total, time: Date.now() };
}

async function getCpuUsage(): Promise<number> {
  const nowSnapshot = getCpuTickSummary();

  if (!lastCpuSnapshot || (nowSnapshot.time - lastCpuSnapshot.time) > 10000 || (nowSnapshot.time - lastCpuSnapshot.time) < 300) {
    // Take a short sample if no valid recent baseline exists
    const baseline = nowSnapshot;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const sample = getCpuTickSummary();
    lastCpuSnapshot = sample;

    const idleDiff = sample.idle - baseline.idle;
    const totalDiff = sample.total - baseline.total;
    if (totalDiff <= 0) return 0;
    const pct = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
    return Math.max(0, Math.min(100, pct));
  }

  const idleDiff = nowSnapshot.idle - lastCpuSnapshot.idle;
  const totalDiff = nowSnapshot.total - lastCpuSnapshot.total;
  lastCpuSnapshot = nowSnapshot;

  if (totalDiff <= 0) return 0;
  const pct = Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
  return Math.max(0, Math.min(100, pct));
}

async function getDisks(): Promise<Array<{ caption: string; size: number; free: number; usage: number }>> {
  if (cachedDisks && (Date.now() - cachedDisks.timestamp) < CACHE_TTL_MS) {
    return cachedDisks.data;
  }

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType = 3' | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json"`,
      { timeout: 5000 }
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      return cachedDisks?.data ?? [];
    }

    const parsed = JSON.parse(trimmed);
    const diskList = Array.isArray(parsed) ? parsed : [parsed];

    const result = diskList
      .filter((d) => d && d.DeviceID && d.Size)
      .map((d) => {
        const size = Number(d.Size) || 0;
        const free = Number(d.FreeSpace) || 0;
        const usage = size > 0 ? Math.round(((size - free) / size) * 100) : 0;
        return {
          caption: String(d.DeviceID),
          size,
          free,
          usage,
        };
      });

    cachedDisks = { data: result, timestamp: Date.now() };
    return result;
  } catch (error) {
    console.warn("Disks CIM query warning:", error);
    return cachedDisks?.data ?? [];
  }
}

async function getBattery(): Promise<number | null> {
  if (cachedBattery && (Date.now() - cachedBattery.timestamp) < CACHE_TTL_MS) {
    return cachedBattery.data;
  }

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining | ConvertTo-Json"`,
      { timeout: 4000 }
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      cachedBattery = { data: null, timestamp: Date.now() };
      return null;
    }

    const parsed = JSON.parse(trimmed);
    const batteryObj = Array.isArray(parsed) ? parsed[0] : parsed;
    const charge = batteryObj?.EstimatedChargeRemaining != null ? Number(batteryObj.EstimatedChargeRemaining) : null;

    cachedBattery = { data: charge, timestamp: Date.now() };
    return charge;
  } catch {
    cachedBattery = { data: null, timestamp: Date.now() };
    return null;
  }
}

async function getPCStats() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsage = Math.round((usedMem / totalMem) * 100);
  const uptimeHours = Math.floor(os.uptime() / 3600);

  // Fetch CPU, Disks, and Battery in parallel
  const [cpuUsage, disks, battery] = await Promise.all([
    getCpuUsage().catch(() => null),
    getDisks().catch(() => []),
    getBattery().catch(() => null),
  ]);

  const temperature = await getTemperature().catch(() => null);

  return {
    cpuUsage,
    memoryTotal: totalMem,
    memoryUsed: usedMem,
    memoryUsage: memUsage,
    uptime: uptimeHours,
    battery,
    temperature,
    disks,
  };
}

/**
 * Thermal zone temperature — no admin elevation needed.
 * MSAcpi_ThermalZoneTemperature is access-denied unelevated on Windows,
 * but the thermal zone performance counter is readable:
 * Win32_PerfFormattedData_Counters_ThermalZoneInformation.Temperature
 *
 * Windows reports this counter inconsistently across builds/machines:
 *   - plain Kelvin      (e.g. 301 → 27.9 °C) — most common unelevated
 *   - tenths of Kelvin  (e.g. 3010 → 27.9 °C)
 * Detect the scale and sanity-clamp to a plausible machine range.
 * Cached 25s — thermals move slowly.
 */
async function getTemperature(): Promise<number | null> {
  if (cachedTemp && Date.now() - cachedTemp.timestamp < CACHE_TTL_MS) {
    return cachedTemp.data;
  }
  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -NonInteractive -Command "(Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue | Where-Object { $_.Temperature -gt 0 } | Select-Object -First 1).Temperature"`,
      { timeout: 5000 }
    );
    const raw = parseFloat(stdout.trim());
    let celsius: number | null = null;
    if (Number.isFinite(raw) && raw > 0) {
      if (raw >= 1000) celsius = raw / 10 - 273.15; // tenths of Kelvin
      else if (raw >= 150) celsius = raw - 273.15; // plain Kelvin
    }
    // Plausible operating range for a machine's thermal zone.
    if (celsius === null || celsius < 0 || celsius > 110) celsius = null;
    cachedTemp = { data: celsius === null ? null : Math.round(celsius), timestamp: Date.now() };
    return cachedTemp.data;
  } catch {
    cachedTemp = { data: null, timestamp: Date.now() };
    return null;
  }
}

export async function GET() {
  try {
    const stats = await getPCStats();
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error("PC Stats API error:", error);
    // Even in an edge-case failure, return a safe fallback instead of throwing 500
    return NextResponse.json({
      success: true,
      stats: {
        cpuUsage: null,
        memoryTotal: os.totalmem(),
        memoryUsed: os.totalmem() - os.freemem(),
        memoryUsage: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        uptime: Math.floor(os.uptime() / 3600),
        battery: null,
        temperature: null,
        disks: [],
      },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "processes": {
        try {
          const { stdout } = await execAsync(
            `powershell -NoProfile -NonInteractive -Command "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 -Property ProcessName, Id, WorkingSet64 | ConvertTo-Json"`,
            { timeout: 6000 }
          );

          const trimmed = stdout.trim();
          if (!trimmed) {
            return NextResponse.json({ success: true, processes: [] });
          }

          const parsed = JSON.parse(trimmed);
          const rawList = Array.isArray(parsed) ? parsed : [parsed];

          const processes = rawList
            .filter((p) => p && p.ProcessName && p.Id != null)
            .map((p) => ({
              name: String(p.ProcessName),
              pid: Number(p.Id),
              memory: Math.round((Number(p.WorkingSet64) || 0) / (1024 * 1024)), // MB
            }));

          return NextResponse.json({ success: true, processes });
        } catch (procErr) {
          console.error("Failed to list processes via CIM:", procErr);
          return NextResponse.json({ success: true, processes: [] });
        }
      }

      case "kill": {
        const { pid } = body;
        if (!pid) {
          return NextResponse.json({ error: "PID required" }, { status: 400 });
        }
        await execAsync(`taskkill /PID ${Number(pid)} /F`);
        return NextResponse.json({ success: true, message: `Process ${pid} killed` });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("PC Stats action error:", error);
    return NextResponse.json(
      { error: "Action failed", details: String(error) },
      { status: 500 }
    );
  }
}
