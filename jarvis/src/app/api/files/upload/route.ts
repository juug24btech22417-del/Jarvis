import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { homedir } from "os";

export const runtime = "nodejs";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Find if the file already exists anywhere on the user's computer
async function findExistingFile(filename: string): Promise<string | null> {
  const cleanName = path.basename(filename).toLowerCase();
  const searchDirs = [
    path.join(homedir(), "Downloads"),
    path.join(homedir(), "Desktop"),
    path.join(homedir(), "Documents"),
    path.join(homedir(), "Pictures"),
    path.join(homedir(), "Videos"),
    path.join(homedir(), "Music"),
    homedir(),
    process.cwd(),
  ];

  for (const dir of searchDirs) {
    if (!fsSync.existsSync(dir)) continue;
    const directPath = path.join(dir, filename);
    if (fsSync.existsSync(directPath)) return directPath;

    try {
      const items = await fs.readdir(dir);
      const match = items.find((f) => f.toLowerCase() === cleanName);
      if (match) return path.join(dir, match);
    } catch {
      // continue search
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // ── 1. Multipart Form Data (file picker or drag-and-drop) ──
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const explicitPath = formData.get("filePath") as string | null;

      // If client provided a native local file path (e.g. from Electron)
      if (explicitPath && typeof explicitPath === "string") {
        if (fsSync.existsSync(explicitPath)) {
          const stats = await fs.stat(explicitPath);
          const fileName = path.basename(explicitPath);
          return NextResponse.json({
            ok: true,
            success: true,
            file: {
              name: fileName,
              originalName: fileName,
              path: explicitPath,
              size: formatBytes(stats.size),
              sizeBytes: stats.size,
              extension: path.extname(explicitPath).toLowerCase(),
              type: "application/octet-stream",
              uploadedAt: Date.now(),
            },
            name: fileName,
            path: explicitPath,
            size: formatBytes(stats.size),
            type: "application/octet-stream",
            message: `Selected '${fileName}' in File Explorer (${explicitPath}). Ready for file operations.`,
          });
        }
      }

      for (const [key, value] of formData.entries()) {
        if (value && typeof value === "object" && "arrayBuffer" in value) {
          const file = value as File;
          const originalName = file.name || "selected_file";
          const ext = path.extname(originalName);

          // Check if file ALREADY exists on the user's hard drive
          const existingPath = await findExistingFile(originalName);
          if (existingPath && fsSync.existsSync(existingPath)) {
            const stats = await fs.stat(existingPath);
            return NextResponse.json({
              ok: true,
              success: true,
              file: {
                name: originalName,
                originalName,
                path: existingPath,
                size: formatBytes(stats.size),
                sizeBytes: stats.size,
                extension: ext.toLowerCase(),
                type: file.type || "application/octet-stream",
                uploadedAt: Date.now(),
              },
              name: originalName,
              path: existingPath,
              size: formatBytes(stats.size),
              type: file.type || "application/octet-stream",
              message: `Found '${originalName}' in File Explorer (${existingPath}). Ready for any file operations in place, Boss.`,
            });
          }

          // File doesn't exist on disk yet: save directly into Downloads root (NO subfolders)
          const downloadsDir = path.join(homedir(), "Downloads");
          await fs.mkdir(downloadsDir, { recursive: true });

          const base = path.basename(originalName, ext);
          let finalName = originalName;
          let targetPath = path.join(downloadsDir, finalName);
          let counter = 1;

          while (fsSync.existsSync(targetPath)) {
            finalName = `${base}_${counter}${ext}`;
            targetPath = path.join(downloadsDir, finalName);
            counter++;
          }

          const buffer = Buffer.from(await file.arrayBuffer());
          await fs.writeFile(targetPath, buffer);

          const fileInfo = {
            name: finalName,
            originalName,
            path: targetPath,
            size: formatBytes(buffer.length),
            sizeBytes: buffer.length,
            extension: ext.toLowerCase(),
            type: file.type || "application/octet-stream",
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
            message: `Saved '${finalName}' to File Explorer (${targetPath}). Ready for any file operations, Boss.`,
          });
        }
      }

      return NextResponse.json({ ok: false, error: "No files found in form data" }, { status: 400 });
    }

    // ── 2. JSON Base64 Upload ──
    const json = await req.json().catch(() => ({}));
    const { name, base64, filePath, buffer: rawBuffer } = json;

    if (filePath && fsSync.existsSync(filePath)) {
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      return NextResponse.json({
        ok: true,
        success: true,
        file: {
          name: fileName,
          originalName: fileName,
          path: filePath,
          size: formatBytes(stats.size),
          sizeBytes: stats.size,
          extension: path.extname(filePath).toLowerCase(),
          type: "application/octet-stream",
          uploadedAt: Date.now(),
        },
        name: fileName,
        path: filePath,
        size: formatBytes(stats.size),
        type: "application/octet-stream",
        message: `Found '${fileName}' in File Explorer (${filePath}). Ready for file operations.`,
      });
    }

    if (!name && !base64 && !rawBuffer) {
      return NextResponse.json({ ok: false, error: "Missing file payload" }, { status: 400 });
    }

    // Check if file already exists locally
    if (name) {
      const existing = await findExistingFile(name);
      if (existing && fsSync.existsSync(existing)) {
        const stats = await fs.stat(existing);
        return NextResponse.json({
          ok: true,
          success: true,
          file: {
            name,
            originalName: name,
            path: existing,
            size: formatBytes(stats.size),
            sizeBytes: stats.size,
            extension: path.extname(existing).toLowerCase(),
            type: "application/octet-stream",
            uploadedAt: Date.now(),
          },
          name,
          path: existing,
          size: formatBytes(stats.size),
          type: "application/octet-stream",
          message: `Found '${name}' in File Explorer (${existing}). Ready for file operations.`,
        });
      }
    }

    // Save directly to Downloads root
    const downloadsDir = path.join(homedir(), "Downloads");
    await fs.mkdir(downloadsDir, { recursive: true });

    const ext = path.extname(name || "file.bin");
    const base = path.basename(name || "file.bin", ext);
    let finalName = name || `file_${Date.now()}${ext}`;
    let targetPath = path.join(downloadsDir, finalName);
    let counter = 1;

    while (fsSync.existsSync(targetPath)) {
      finalName = `${base}_${counter}${ext}`;
      targetPath = path.join(downloadsDir, finalName);
      counter++;
    }

    const fileBuffer = base64
      ? Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64")
      : Buffer.from(rawBuffer || "");

    await fs.writeFile(targetPath, fileBuffer);

    const fileInfo = {
      name: finalName,
      originalName: name || finalName,
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
      message: `Saved '${finalName}' to File Explorer (${targetPath}). Ready for any file operations, Boss.`,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "File staging failed" }, { status: 500 });
  }
}
