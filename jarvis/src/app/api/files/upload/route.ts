import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { homedir } from "os";

export const runtime = "nodejs";

// Target upload directory in User's Downloads/JarvisUploads for direct File Explorer accessibility
function getUploadDir(): string {
  const dir = path.join(homedir(), "Downloads", "JarvisUploads");
  return dir;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function POST(req: NextRequest) {
  try {
    const uploadDir = getUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });

    const contentType = req.headers.get("content-type") || "";

    // Handle Multipart Form Data (standard file upload)
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const files: any[] = [];

      for (const [key, value] of formData.entries()) {
        if (value && typeof value === "object" && "arrayBuffer" in value) {
          const file = value as File;
          const originalName = file.name || "uploaded_file";
          const ext = path.extname(originalName);
          const base = path.basename(originalName, ext);

          // If file already exists, create unique name or overwrite if requested
          let finalName = originalName;
          let targetPath = path.join(uploadDir, finalName);
          let counter = 1;

          while (true) {
            try {
              await fs.access(targetPath);
              finalName = `${base}_${counter}${ext}`;
              targetPath = path.join(uploadDir, finalName);
              counter++;
            } catch {
              break;
            }
          }

          const buffer = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(targetPath, buffer);

          files.push({
            name: finalName,
            originalName,
            path: targetPath,
            size: formatBytes(buffer.length),
            sizeBytes: buffer.length,
            extension: ext.toLowerCase(),
            type: file.type || "application/octet-stream",
            uploadedAt: Date.now(),
          });
        }
      }

      if (files.length === 0) {
        return NextResponse.json({ ok: false, error: "No files found in form data" }, { status: 400 });
      }

      const primary = files[0];
      return NextResponse.json({
        ok: true,
        success: true,
        file: primary,
        files,
        name: primary.name,
        path: primary.path,
        size: primary.size,
        type: primary.type,
        message: `Uploaded '${primary.name}' to File Explorer (${primary.path}). Ready for any file operations, Boss.`,
      });
    }

    // Handle JSON Base64 Upload (programmatic / drag-drop fallback)
    const json = await req.json().catch(() => ({}));
    const { name, base64, buffer: rawBuffer, overwrite = false } = json;

    if (!name || (!base64 && !rawBuffer)) {
      return NextResponse.json({ ok: false, error: "Missing filename or content payload" }, { status: 400 });
    }

    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let finalName = name;
    let targetPath = path.join(uploadDir, finalName);

    if (!overwrite) {
      let counter = 1;
      while (true) {
        try {
          await fs.access(targetPath);
          finalName = `${base}_${counter}${ext}`;
          targetPath = path.join(uploadDir, finalName);
          counter++;
        } catch {
          break;
        }
      }
    }

    const fileBuffer = base64
      ? Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64")
      : Buffer.from(rawBuffer);

    await fs.writeFile(targetPath, fileBuffer);

    const fileInfo = {
      name: finalName,
      originalName: name,
      path: targetPath,
      size: formatBytes(fileBuffer.length),
      sizeBytes: fileBuffer.length,
      extension: ext.toLowerCase(),
      type: "application/octet-stream",
      uploadedAt: Date.now(),
    };

    return NextResponse.json({
      ok: true,
      success: true,
      file: fileInfo,
      name: fileInfo.name,
      path: fileInfo.path,
      size: fileInfo.size,
      type: fileInfo.type,
      message: `Uploaded '${finalName}' to File Explorer (${targetPath}). Ready for any file operations, Boss.`,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "File upload failed" }, { status: 500 });
  }
}
