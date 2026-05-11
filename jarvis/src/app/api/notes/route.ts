import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const NOTES_DIR = path.join(process.cwd(), "notes");

// Ensure notes directory exists
async function ensureNotesDir() {
  try {
    await fs.access(NOTES_DIR);
  } catch {
    await fs.mkdir(NOTES_DIR, { recursive: true });
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureNotesDir();
    const body = await req.json();
    const { action, content, title, filename } = body;

    switch (action) {
      case "create": {
        if (!content) {
          return NextResponse.json({ error: "Content required" }, { status: 400 });
        }

        const noteTitle = title || `Note-${new Date().toISOString().slice(0, 10)}`;
        const safeFilename = noteTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase();
        const filepath = path.join(NOTES_DIR, `${safeFilename}.txt`);

        const timestamp = new Date().toLocaleString();
        const noteContent = `[${timestamp}]\n${content}\n\n`;

        await fs.appendFile(filepath, noteContent);

        return NextResponse.json({
          success: true,
          filename: `${safeFilename}.txt`,
          filepath,
        });
      }

      case "list": {
        const files = await fs.readdir(NOTES_DIR);
        const notes = await Promise.all(
          files.map(async (file) => {
            const stat = await fs.stat(path.join(NOTES_DIR, file));
            return {
              filename: file,
              created: stat.birthtime,
              modified: stat.mtime,
            };
          })
        );
        return NextResponse.json({ success: true, notes });
      }

      case "read": {
        if (!filename) {
          return NextResponse.json({ error: "Filename required" }, { status: 400 });
        }
        const filepath = path.join(NOTES_DIR, filename);
        const content = await fs.readFile(filepath, "utf8");
        return NextResponse.json({ success: true, filename, content });
      }

      case "delete": {
        if (!filename) {
          return NextResponse.json({ error: "Filename required" }, { status: 400 });
        }
        const filepath = path.join(NOTES_DIR, filename);
        await fs.unlink(filepath);
        return NextResponse.json({ success: true, deleted: filename });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Notes API error:", error);
    return NextResponse.json(
      { error: "Notes command failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await ensureNotesDir();
    const files = await fs.readdir(NOTES_DIR);
    return NextResponse.json({
      success: true,
      notes: files.filter((f) => f.endsWith(".txt")),
      location: NOTES_DIR,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list notes", details: String(error) },
      { status: 500 }
    );
  }
}
