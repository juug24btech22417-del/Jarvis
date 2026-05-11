import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

// Get Windows PC stats using PowerShell and WMIC
async function getPCStats() {
  const stats: Record<string, unknown> = {};

  try {
    // CPU Usage
    const { stdout: cpuOut } = await execAsync(
      'wmic cpu get loadpercentage /value'
    );
    const cpuMatch = cpuOut.match(/LoadPercentage=(\d+)/);
    stats.cpuUsage = cpuMatch ? parseInt(cpuMatch[1]) : null;

    // Memory
    const { stdout: memOut } = await execAsync(
      'wmic OS get TotalVisibleMemorySize,FreePhysicalMemory /value'
    );
    const totalMatch = memOut.match(/TotalVisibleMemorySize=(\d+)/);
    const freeMatch = memOut.match(/FreePhysicalMemory=(\d+)/);
    if (totalMatch && freeMatch) {
      const total = parseInt(totalMatch[1]) * 1024; // Convert KB to bytes
      const free = parseInt(freeMatch[1]) * 1024;
      stats.memoryTotal = total;
      stats.memoryUsed = total - free;
      stats.memoryUsage = Math.round(((total - free) / total) * 100);
    }

    // Disk
    const { stdout: diskOut } = await execAsync(
      'wmic logicaldisk get size,freespace,caption /value'
    );
    const disks: Array<{caption: string; size: number; free: number; usage: number}> = [];
    const diskEntries = diskOut.trim().split(/\r?\n\r?\n/);
    for (const entry of diskEntries) {
      const caption = entry.match(/Caption=(.+)/)?.[1];
      const size = entry.match(/Size=(\d+)/)?.[1];
      const free = entry.match(/FreeSpace=(\d+)/)?.[1];
      if (caption && size && free) {
        const sizeNum = parseInt(size);
        const freeNum = parseInt(free);
        disks.push({
          caption,
          size: sizeNum,
          free: freeNum,
          usage: Math.round(((sizeNum - freeNum) / sizeNum) * 100),
        });
      }
    }
    stats.disks = disks;

    // Battery (laptops)
    try {
      const { stdout: batteryOut } = await execAsync(
        'wmic path Win32_Battery Get EstimatedChargeRemaining /value'
      );
      const batteryMatch = batteryOut.match(/EstimatedChargeRemaining=(\d+)/);
      if (batteryMatch) {
        stats.battery = parseInt(batteryMatch[1]);
      }
    } catch {
      // No battery (desktop)
      stats.battery = null;
    }

    // Uptime
    const { stdout: uptimeOut } = await execAsync(
      'wmic os get LastBootUpTime /value'
    );
    const bootMatch = uptimeOut.match(/LastBootUpTime=(\d{14})/);
    if (bootMatch) {
      const bootTime = new Date(
        bootMatch[1].slice(0, 4) + '-' +
        bootMatch[1].slice(4, 6) + '-' +
        bootMatch[1].slice(6, 8) + 'T' +
        bootMatch[1].slice(8, 10) + ':' +
        bootMatch[1].slice(10, 12) + ':' +
        bootMatch[1].slice(12, 14)
      );
      const uptime = Date.now() - bootTime.getTime();
      stats.uptime = Math.floor(uptime / (1000 * 60 * 60)); // Hours
    }

    // Temperature (if available)
    try {
      const { stdout: tempOut } = await execAsync(
        'wmic /namespace:\\\root\\wmi PATH MSAcpi_ThermalZoneTemperature Get CurrentTemperature /value'
      );
      const tempMatch = tempOut.match(/CurrentTemperature=(\d+)/);
      if (tempMatch) {
        // Convert from tenths of Kelvin to Celsius
        stats.temperature = Math.round((parseInt(tempMatch[1]) / 10) - 273.15);
      }
    } catch {
      stats.temperature = null;
    }

    return stats;
  } catch (error) {
    console.error("PC Stats error:", error);
    throw error;
  }
}

export async function GET() {
  try {
    const stats = await getPCStats();
    return NextResponse.json({ success: true, stats });
  } catch (error) {
    console.error("PC Stats API error:", error);
    return NextResponse.json(
      { error: "Failed to get PC stats", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "processes": {
        // Get top processes by CPU
        const { stdout } = await execAsync(
          'wmic process get Name,ProcessId,WorkingSetSize /value | findstr /B "Name= ProcessId= WorkingSetSize="'
        );
        const lines = stdout.trim().split('\n');
        const processes: Array<{name: string; pid: number; memory: number}> = [];

        for (let i = 0; i < lines.length; i += 3) {
          const nameMatch = lines[i]?.match(/Name=(.+)/);
          const pidMatch = lines[i + 1]?.match(/ProcessId=(\d+)/);
          const memMatch = lines[i + 2]?.match(/WorkingSetSize=(\d+)/);

          if (nameMatch && pidMatch && memMatch) {
            processes.push({
              name: nameMatch[1],
              pid: parseInt(pidMatch[1]),
              memory: Math.round(parseInt(memMatch[1]) / (1024 * 1024)), // MB
            });
          }
        }

        // Sort by memory and return top 10
        processes.sort((a, b) => b.memory - a.memory);
        return NextResponse.json({ success: true, processes: processes.slice(0, 10) });
      }

      case "kill": {
        const { pid } = body;
        if (!pid) {
          return NextResponse.json({ error: "PID required" }, { status: 400 });
        }
        await execAsync(`taskkill /PID ${pid} /F`);
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
