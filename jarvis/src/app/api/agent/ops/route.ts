// Machine-ops API for the Mission Control "Systems" card.
//
//  GET  → { devServers: [...], lastOrganize: {...} | null }
//  POST → { action: "stop_server", port, cwd? }
//         { action: "undo_organize" }
//
// Backed by the module-scoped dev-server registry + the persisted organize
// undo log, so it shows servers a mission started (or adopted) and offers a
// one-click reversal of the most recent tidy-up.

import { NextRequest, NextResponse } from "next/server";
import { listManagedServers, devServerStatus, stopDevServer } from "@/lib/agent/devServers";
import { getLastOrganize, undoLastOrganize, summarizeOrganizeRecord } from "@/lib/agent/fileOrganizeLog";

export async function GET() {
  const devServers: Array<Record<string, unknown>> = [];
  for (const s of listManagedServers()) {
    if (s.exited) continue;
    const status = await devServerStatus({ cwd: s.cwd, port: s.port });
    devServers.push({
      port: s.port,
      pid: s.pid,
      command: s.command,
      cwd: s.cwd,
      startedAt: s.startedAt,
      uptimeMs: status.uptimeMs ?? Date.now() - s.startedAt,
      running: status.running,
      managed: status.managed,
      ready: status.ready,
      httpStatus: status.httpStatus,
      output: status.output.slice(-1200),
    });
  }
  return NextResponse.json({
    devServers,
    lastOrganize: summarizeOrganizeRecord(getLastOrganize()),
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "stop_server") {
    const port = Number(body.port ?? 3000) || 3000;
    const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : undefined;
    const res = await stopDevServer({ port, cwd });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  if (action === "undo_organize") {
    const res = undoLastOrganize();
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: `Unknown action: ${action || "(none)"}` }, { status: 400 });
}
