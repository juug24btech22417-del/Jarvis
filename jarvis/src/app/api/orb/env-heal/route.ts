import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action = "scan", issueId, pid, type } = body;

    if (action === "heal") {
      // 1. Heal Git index lock
      if (type === "git_lock" || issueId === "git-index-lock") {
        const lockPath = path.join(process.cwd(), ".git", "index.lock");
        const altLockPath = path.join(process.cwd(), "..", ".git", "index.lock");
        let removed = false;
        if (fs.existsSync(lockPath)) {
          fs.unlinkSync(lockPath);
          removed = true;
        } else if (fs.existsSync(altLockPath)) {
          fs.unlinkSync(altLockPath);
          removed = true;
        }
        return NextResponse.json({
          ok: true,
          healedIssueId: issueId || "git-index-lock",
          message: removed ? "Successfully removed .git/index.lock" : "Lock already cleared",
        });
      }

      // 2. Heal Port Collision / Zombie Process by stopping PID
      let targetPid = pid;
      if (!targetPid && issueId && issueId.startsWith("port-")) {
        const parts = issueId.split("-");
        if (parts.length >= 3) {
          targetPid = parseInt(parts[2], 10);
        }
      }

      if (targetPid && !isNaN(targetPid)) {
        // Prevent killing our own process or system idle/init
        if (targetPid === process.pid || targetPid <= 4) {
          return NextResponse.json({ ok: false, error: "Cannot terminate self or core system process" }, { status: 400 });
        }

        try {
          await execAsync(`powershell.exe -NoProfile -NonInteractive -Command "Stop-Process -Id ${targetPid} -Force"`);
          return NextResponse.json({
            ok: true,
            healedIssueId: issueId || `pid-${targetPid}`,
            message: `Terminated process (PID ${targetPid}) and released port`,
          });
        } catch (killErr: any) {
          return NextResponse.json(
            { ok: false, error: `Failed to terminate process ${targetPid}: ${killErr.message}` },
            { status: 500 }
          );
        }
      }

      return NextResponse.json({ ok: false, error: "No valid PID or lock target provided for healing" }, { status: 400 });
    }

    // Action: Scan
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$ports = @(3000, 3001, 8000, 8080, 5000, 5173, 4000, 9222)
$issues = @()

foreach ($p in $ports) {
  $conns = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($c in $conns) {
    $proc = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
    $procName = if ($proc) { $proc.ProcessName } else { "Unknown" }
    $issues += [PSCustomObject]@{
      id = "port-$p-$($c.OwningProcess)"
      type = "port_collision"
      port = [int]$p
      pid = [int]$c.OwningProcess
      processName = $procName
      description = "Port $p is currently occupied by $procName (PID $($c.OwningProcess))"
      fixAction = "Release port $p (terminate PID $($c.OwningProcess))"
    }
  }
}

$gitLock = Join-Path (Get-Location).Path ".git\\index.lock"
if (Test-Path $gitLock) {
  $issues += [PSCustomObject]@{
    id = "git-index-lock"
    type = "git_lock"
    port = $null
    pid = $null
    processName = "git"
    description = "Stale .git/index.lock detected blocking git operations"
    fixAction = "Remove stale .git/index.lock"
  }
}

$issues | ConvertTo-Json -Compress
`;

    const encodedCommand = Buffer.from(psScript, "utf16le").toString("base64");
    const { stdout } = await execAsync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`);

    let issues: any[] = [];
    if (stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout.trim());
        issues = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        issues = [];
      }
    }

    return NextResponse.json({
      ok: true,
      healthy: issues.length === 0,
      issues,
      lastChecked: Date.now(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to scan environment health" },
      { status: 500 }
    );
  }
}
