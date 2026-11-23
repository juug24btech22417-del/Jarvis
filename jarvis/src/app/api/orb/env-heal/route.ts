import { NextResponse } from "next/server";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execAsync = promisify(exec);
export const runtime = "nodejs";

// Parse `netstat -ano` output entirely in JS — no PowerShell startup needed.
// Format per line: "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       9932"
function parseNetstat(raw: string) {
  const issues: any[] = [];
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    if (!line.includes("LISTENING")) continue;
    // match the local address part and trailing PID
    const m = line.match(/TCP\s+[\d.:*]+:(\d+)\s+[\d.:*]+\s+LISTENING\s+(\d+)/i);
    if (!m) continue;
    const port = parseInt(m[1], 10);
    const pid  = parseInt(m[2], 10);
    if (!port || !pid || pid <= 4) continue; // skip system/idle
    const key = `${port}-${pid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ port, pid });
  }
  return issues;
}

// Batch-resolve process names with a single tasklist call
function resolveProcessNames(pids: number[]): Record<number, string> {
  if (pids.length === 0) return {};
  try {
    const filter = pids.map(p => `/fi "PID eq ${p}"`).join(" ");
    const raw = execSync(`tasklist /nh ${filter} /fo csv 2>nul`, { timeout: 4000 }).toString();
    const map: Record<number, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const parts = line.match(/"([^"]+)","(\d+)"/);
      if (parts) map[parseInt(parts[2], 10)] = parts[1].replace(/\.exe$/i, "");
    }
    return map;
  } catch { return {}; }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action = "scan", issueId, pid, type } = body;

    // ── HEAL ───────────────────────────────────────────────────────────────
    if (action === "heal") {
      // Git index lock
      if (type === "git_lock" || issueId === "git-index-lock") {
        const candidates = [
          path.join(process.cwd(), ".git", "index.lock"),
          path.join(process.cwd(), "..", ".git", "index.lock"),
          path.join(process.cwd(), "..", "..", ".git", "index.lock"),
        ];
        let removed = false;
        for (const p of candidates) {
          if (fs.existsSync(p)) { fs.unlinkSync(p); removed = true; break; }
        }
        return NextResponse.json({ ok: true, healedIssueId: issueId, message: removed ? "Removed .git/index.lock" : "Lock already cleared" });
      }

      // Kill a port-bound process
      let targetPid = typeof pid === "number" ? pid : null;
      if (!targetPid && issueId?.startsWith("port-")) {
        const parts = (issueId as string).split("-");
        if (parts.length >= 3) targetPid = parseInt(parts[2], 10);
      }
      if (targetPid && !isNaN(targetPid)) {
        if (targetPid === process.pid || targetPid <= 4)
          return NextResponse.json({ ok: false, error: "Cannot kill self or system process" }, { status: 400 });
        try {
          execSync(`taskkill /PID ${targetPid} /F 2>nul`, { timeout: 3000 });
          return NextResponse.json({ ok: true, healedIssueId: issueId || `pid-${targetPid}`, message: `Terminated PID ${targetPid}` });
        } catch (e: any) {
          return NextResponse.json({ ok: false, error: `Kill failed: ${e.message}` }, { status: 500 });
        }
      }
      return NextResponse.json({ ok: false, error: "Nothing to heal" }, { status: 400 });
    }

    // ── SCAN ───────────────────────────────────────────────────────────────
    // 1. Run netstat (native, instant — ~100ms vs 1-2s for Get-NetTCPConnection)
    let netstatRaw = "";
    try {
      netstatRaw = execSync("netstat -ano -p TCP", { timeout: 6000 }).toString();
    } catch { netstatRaw = ""; }

    const rawPorts = parseNetstat(netstatRaw);
    const pids = [...new Set(rawPorts.map(r => r.pid))];
    const procNames = resolveProcessNames(pids);

    const issues: any[] = rawPorts.map(({ port, pid }) => ({
      id: `port-${port}-${pid}`,
      type: "port_collision",
      port,
      pid,
      processName: procNames[pid] || "Unknown",
      description: `Port ${port} occupied by ${procNames[pid] || "Unknown"} (PID ${pid})`,
      fixAction: `Terminate PID ${pid} to release port ${port}`,
    }));

    // 2. Git index.lock detection
    const lockPaths = [
      path.join(process.cwd(), ".git", "index.lock"),
      path.join(process.cwd(), "..", ".git", "index.lock"),
    ];
    for (const lp of lockPaths) {
      if (fs.existsSync(lp)) {
        issues.push({
          id: "git-index-lock",
          type: "git_lock",
          port: null,
          pid: null,
          processName: "git",
          description: "Stale .git/index.lock is blocking git operations",
          fixAction: "Remove .git/index.lock",
        });
        break;
      }
    }

    return NextResponse.json({ ok: true, healthy: issues.length === 0, issues, lastChecked: Date.now() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "Env scan failed" }, { status: 500 });
  }
}
