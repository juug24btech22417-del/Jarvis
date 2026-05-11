import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const MEMOS_DIR = path.join(process.cwd(), "voice-memos");

// Ensure memos directory exists
async function ensureMemosDir() {
  try {
    await fs.access(MEMOS_DIR);
  } catch {
    await fs.mkdir(MEMOS_DIR, { recursive: true });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureMemosDir();
    const body = await req.json();
    const { action, audioBase64, filename, transcript } = body;

    switch (action) {
      case "save": {
        if (!audioBase64) {
          return NextResponse.json({ error: "Audio data required" }, { status: 400 });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const safeFilename = filename?.replace(/[^a-z0-9]/gi, "_") || `memo-${timestamp}`;
        const filepath = path.join(MEMOS_DIR, `${safeFilename}.webm`);
        const metaPath = path.join(MEMOS_DIR, `${safeFilename}.json`);

        // Save audio file
        const buffer = Buffer.from(audioBase64, "base64");
        await fs.writeFile(filepath, buffer);

        // Save metadata
        await fs.writeFile(
          metaPath,
          JSON.stringify({
            filename: `${safeFilename}.webm`,
            created: new Date().toISOString(),
            transcript: transcript || "",
          })
        );

        return NextResponse.json({
          success: true,
          filename: `${safeFilename}.webm`,
          filepath,
        });
      }

      case "list": {
        const files = await fs.readdir(MEMOS_DIR);
        const memos = await Promise.all(
          files
            .filter((f) => f.endsWith(".json"))
            .map(async (f) => {
              const metaContent = await fs.readFile(
                path.join(MEMOS_DIR, f),
                "utf8"
              );
              const meta = JSON.parse(metaContent);
              return {
                ...meta,
                id: f.replace(".json", ""),
              };
            })
        );
        return NextResponse.json({ success: true, memos });
      }

      case "get": {
        if (!filename) {
          return NextResponse.json({ error: "Filename required" }, { status: 400 });
        }
        const filepath = path.join(MEMOS_DIR, filename);
        const audio = await fs.readFile(filepath);
        return new NextResponse(audio, {
          headers: {
            "Content-Type": "audio/webm",
            "Content-Disposition": `attachment; filename="${filename}"`,
          },
        });
      }

      case "delete": {
        if (!filename) {
          return NextResponse.json({ error: "Filename required" }, { status: 400 });
        }
        const baseName = filename.replace(/\.webm$/, "");
        await fs.unlink(path.join(MEMOS_DIR, filename)).catch(() => {});
        await fs.unlink(path.join(MEMOS_DIR, `${baseName}.json`)).catch(() => {});
        return NextResponse.json({ success: true, deleted: filename });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Voice memo API error:", error);
    return NextResponse.json(
      { error: "Voice memo command failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await ensureMemosDir();
    const files = await fs.readdir(MEMOS_DIR);
    return NextResponse.json({
      success: true,
      memos: files.filter((f) => f.endsWith(".webm")),
      location: MEMOS_DIR,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list memos", details: String(error) },
      { status: 500 }
    );
  }
}
