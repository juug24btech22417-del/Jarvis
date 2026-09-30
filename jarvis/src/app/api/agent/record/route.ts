// Browser workflow recorder.
// GET  → { recordings: [...] }
// POST { action: "start", name, url, session? } → { id }
// POST { action: "stop", id } → { recording }
// POST { action: "delete", id } → { deleted: true }

import { NextRequest, NextResponse } from "next/server";
import { listRecordings, startRecording, stopRecording } from "@/services/BrowserAgentService";
import path from "path";
import fs from "fs";

const RECORDINGS_FILE = path.join(process.cwd(), ".jarvis-data", "recordings.json");

export async function GET() {
  return NextResponse.json({ recordings: listRecordings() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "start") {
    const name = typeof body.name === "string" ? body.name : "";
    const url = typeof body.url === "string" ? body.url : "";
    const session = typeof body.session === "string" ? body.session : undefined;
    if (!url.startsWith("http")) return NextResponse.json({ error: "a valid url is required" }, { status: 400 });
    try {
      const res = await startRecording({ name: name || `Recording ${new Date().toLocaleString()}`, url, session });
      return NextResponse.json(res);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  if (action === "stop") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const rec = await stopRecording(id);
    if (!rec) return NextResponse.json({ error: "No recording session found (or nothing was recorded)" }, { status: 404 });
    return NextResponse.json({ recording: rec });
  }

  if (action === "delete") {
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const list = listRecordings().filter((r) => r.id !== id);
    try {
      if (!fs.existsSync(path.dirname(RECORDINGS_FILE))) fs.mkdirSync(path.dirname(RECORDINGS_FILE), { recursive: true });
      fs.writeFileSync(RECORDINGS_FILE, JSON.stringify(list, null, 2), "utf8");
      const g = globalThis as unknown as { __jarvisRecordings?: unknown };
      g.__jarvisRecordings = list;
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
    return NextResponse.json({ deleted: true });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
