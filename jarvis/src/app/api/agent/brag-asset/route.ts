// Stream the brag skill's music/SFX library to rendered video briefs.
//
// The brief HTML is served from the artifact store, so its audio has to come
// over HTTP. Only known media extensions inside .agents/skills/brag/assets are
// ever readable, and the resolved path is re-checked against the root.
//
// GET ?file=music/<track>.mp3  |  ?file=sfx/interface/click_002.ogg
// GET ?list=1 → available tracks + cues (used by the panel/docs).

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const ALLOWED_EXT = new Set([".mp3", ".ogg", ".wav", ".m4a"]);

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

function assetsRoot(): string | null {
  const candidates = [
    path.join(process.cwd(), "..", ".agents", "skills", "brag", "assets"),
    path.join(process.cwd(), ".agents", "skills", "brag", "assets"),
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return path.resolve(c);
    } catch {
      // keep looking
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const root = assetsRoot();
  if (!root) return NextResponse.json({ error: "brag assets not installed" }, { status: 404 });

  const file = req.nextUrl.searchParams.get("file") ?? "";
  if (!file) {
    return NextResponse.json({
      root,
      available: fs.existsSync(path.join(root, "music"))
        ? fs.readdirSync(path.join(root, "music")).filter((f) => f.endsWith(".mp3"))
        : [],
    });
  }

  // Reject traversal / absolute paths before touching the filesystem.
  if (file.includes("..") || path.isAbsolute(file)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  const full = path.resolve(root, file);
  if (full !== root && !full.startsWith(root + path.sep)) {
    return NextResponse.json({ error: "outside asset root" }, { status: 403 });
  }
  const ext = path.extname(full).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: "unsupported media type" }, { status: 400 });
  }
  if (!fs.existsSync(full)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const data = fs.readFileSync(full);
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      "Accept-Ranges": "bytes",
    },
  });
}
