import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { homedir } from "os";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
export const runtime = "nodejs";

// Common directory shortcuts
function resolveKnownDir(name: string): string {
  const n = name.toLowerCase().trim();
  const home = homedir();
  if (n.includes("desktop")) return path.join(home, "Desktop");
  if (n.includes("download")) return path.join(home, "Downloads");
  if (n.includes("document") || n.includes("doc")) return path.join(home, "Documents");
  if (n.includes("picture") || n.includes("photo")) return path.join(home, "Pictures");
  if (n.includes("workspace") || n.includes("jarvis")) return process.cwd();
  if (path.isAbsolute(name)) return name;
  return path.join(home, "Downloads");
}

// Locate file if only a relative name is given
async function findFileLocally(filename: string): Promise<string | null> {
  if (path.isAbsolute(filename)) {
    try {
      await fs.access(filename);
      return filename;
    } catch {
      return null;
    }
  }

  const cleanName = path.basename(filename).toLowerCase();
  const candidateDirs = [
    path.join(homedir(), "Downloads", "JarvisUploads"),
    path.join(homedir(), "Downloads"),
    path.join(homedir(), "Desktop"),
    path.join(homedir(), "Documents"),
    path.join(homedir(), "Pictures"),
    path.join(homedir(), "Pictures", "Screenshots"),
    process.cwd(),
  ];

  // 1. Direct check in candidate folders
  for (const dir of candidateDirs) {
    if (!fsSync.existsSync(dir)) continue;
    const directPath = path.join(dir, filename);
    if (fsSync.existsSync(directPath)) return directPath;

    // Scan directory for case-insensitive match
    try {
      const items = await fs.readdir(dir);
      const match = items.find((f) => f.toLowerCase() === cleanName);
      if (match) return path.join(dir, match);
    } catch {
      /* continue */
    }
  }

  // 2. Fuzzy partial match in JarvisUploads or Downloads
  for (const dir of candidateDirs.slice(0, 3)) {
    if (!fsSync.existsSync(dir)) continue;
    try {
      const items = await fs.readdir(dir);
      const partial = items.find((f) => f.toLowerCase().includes(cleanName.replace(/\.[^/.]+$/, "")));
      if (partial) return path.join(dir, partial);
    } catch {
      /* continue */
    }
  }

  return null;
}

// Natural language command parser
function parseNaturalFileCommand(cmd: string, contextFile?: { name: string; path: string }) {
  const text = cmd.trim();

  // Pattern: "rename to <new_name>"
  const renameToOnly = text.match(/^rename\s+to\s+["']?([^"']+)["']?$/i);
  if (renameToOnly) {
    const target = renameToOnly[1].trim();
    const source = contextFile ? (contextFile.path || contextFile.name) : "";
    return { action: "rename", source, target };
  }

  // Pattern: "rename [it | file | filename] to <new_name>"
  const renameMatch =
    text.match(/^rename\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/i) ||
    text.match(/^change\s+(?:the\s+)?name\s+of\s+["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/i);

  if (renameMatch) {
    let source = renameMatch[1].trim();
    let target = renameMatch[2].trim();

    // If "rename it to XYZ" or "rename this to XYZ"
    if (["it", "this", "the file", "this file", "file"].includes(source.toLowerCase()) && contextFile) {
      source = contextFile.path || contextFile.name;
    }

    return { action: "rename", source, target };
  }

  // Pattern: "delete [file]" or "remove [file]" or "trash [file]"
  const deleteMatch = text.match(/^(?:delete|remove|trash|destroy)\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"']*)["']?/i);
  if (deleteMatch) {
    let source = deleteMatch[1]?.trim();
    if ((!source || ["it", "this", "the file", "this file", "file"].includes(source.toLowerCase())) && contextFile) {
      source = contextFile.path || contextFile.name;
    }
    if (source) {
      return { action: "delete", source };
    }
  }

  // Pattern: "move to [folder]"
  const moveToOnly = text.match(/^move\s+to\s+["']?([^"']+)["']?$/i);
  if (moveToOnly && contextFile) {
    return { action: "move", source: contextFile.path || contextFile.name, targetDir: moveToOnly[1].trim() };
  }

  // Pattern: "move [file] to [folder]"
  const moveMatch = text.match(/^move\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/i);
  if (moveMatch) {
    let source = moveMatch[1].trim();
    let target = moveMatch[2].trim();
    if (["it", "this", "the file", "this file", "file"].includes(source.toLowerCase()) && contextFile) {
      source = contextFile.path || contextFile.name;
    }
    return { action: "move", source, targetDir: target };
  }

  // Pattern: "copy [file] to [folder]"
  const copyMatch = text.match(/^copy\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"']+)["']?\s+to\s+["']?([^"']+)["']?/i);
  if (copyMatch) {
    let source = copyMatch[1].trim();
    let target = copyMatch[2].trim();
    if (["it", "this", "the file", "this file", "file"].includes(source.toLowerCase()) && contextFile) {
      source = contextFile.path || contextFile.name;
    }
    return { action: "copy", source, targetDir: target };
  }

  // Pattern: "create [a] folder [called/named] <name>" or "make [a] folder <name> in <dir>"
  const folderMatch = text.match(/^(?:create|make|new)\s+(?:a\s+)?folder\s+(?:called\s+|named\s+)?["']?([^"'\n]+?)["']?(?:\s+in\s+["']?([^"'\n]+)["']?)?$/i);
  if (folderMatch) {
    return { action: "create_folder", folderName: folderMatch[1].trim(), parentDir: folderMatch[2]?.trim() };
  }

  // Pattern: "reveal [file] in explorer" or "open [file / folder]"
  const openMatch = text.match(/^(?:open|reveal|show)\s+(?:the\s+file\s+|file\s+|folder\s+|it\s+|this\s+)?["']?([^"']*)["']?(?:\s+in\s+explorer)?/i);
  if (openMatch) {
    let source = openMatch[1]?.trim();
    if ((!source || ["it", "this", "the file", "this file", "file"].includes(source.toLowerCase())) && contextFile) {
      source = contextFile.path || contextFile.name;
    }
    if (source) {
      return { action: "open", source };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let { action, sourcePath, targetName, targetDir, folderName, parentDir, command, contextFile } = body;

    // Handle Natural Language Command if provided
    if (command && typeof command === "string") {
      const parsed = parseNaturalFileCommand(command, contextFile);
      if (parsed) {
        action = parsed.action;
        if (parsed.source) sourcePath = parsed.source;
        if (parsed.target) targetName = parsed.target;
        if (parsed.targetDir) targetDir = parsed.targetDir;
        if (parsed.folderName) folderName = parsed.folderName;
        if (parsed.parentDir) parentDir = parsed.parentDir;
      }
    }

    if (!action) {
      return NextResponse.json({ ok: false, error: "Missing action or unparseable command" }, { status: 400 });
    }

    // ── 1. RENAME FILE ───────────────────────────────────────────────────────
    if (action === "rename") {
      const rawSource = sourcePath || contextFile?.path || contextFile?.name;
      const rawTarget = targetName || body.newName;

      if (!rawSource || !rawTarget) {
        return NextResponse.json({ ok: false, error: "Missing source file or new name" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found on disk: ${rawSource}` }, { status: 404 });
      }

      const sourceDir = path.dirname(resolvedSource);
      const sourceExt = path.extname(resolvedSource);

      // If user provided a new name without extension, keep the original extension
      let finalTargetName = rawTarget.trim();
      if (!path.extname(finalTargetName) && sourceExt) {
        finalTargetName = `${finalTargetName}${sourceExt}`;
      }

      const targetPath = path.join(sourceDir, finalTargetName);

      // Perform real file rename
      await fs.rename(resolvedSource, targetPath);

      return NextResponse.json({
        ok: true,
        action: "rename",
        oldPath: resolvedSource,
        newPath: targetPath,
        oldName: path.basename(resolvedSource),
        newName: finalTargetName,
        message: `Successfully renamed '${path.basename(resolvedSource)}' to '${finalTargetName}' in File Explorer (${targetPath}).`,
      });
    }

    // ── 2. DELETE / REMOVE FILE ──────────────────────────────────────────────
    if (action === "delete" || action === "remove" || action === "trash") {
      const rawSource = sourcePath || contextFile?.path || contextFile?.name;
      if (!rawSource) {
        return NextResponse.json({ ok: false, error: "Missing source file to delete" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found on disk: ${rawSource}` }, { status: 404 });
      }

      const stats = await fs.stat(resolvedSource);
      if (stats.isDirectory()) {
        await fs.rm(resolvedSource, { recursive: true, force: true });
      } else {
        await fs.unlink(resolvedSource);
      }

      return NextResponse.json({
        ok: true,
        action: "delete",
        deletedPath: resolvedSource,
        fileName: path.basename(resolvedSource),
        message: `Deleted '${path.basename(resolvedSource)}' from File Explorer (${resolvedSource}).`,
      });
    }

    // ── 3. MOVE FILE ─────────────────────────────────────────────────────────
    if (action === "move") {
      const rawSource = sourcePath || contextFile?.path || contextFile?.name;
      if (!rawSource || !targetDir) {
        return NextResponse.json({ ok: false, error: "Missing source file or target directory" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found: ${rawSource}` }, { status: 404 });
      }

      const destDir = resolveKnownDir(targetDir);
      await fs.mkdir(destDir, { recursive: true });

      const fileName = path.basename(resolvedSource);
      const destPath = path.join(destDir, fileName);

      await fs.rename(resolvedSource, destPath);

      return NextResponse.json({
        ok: true,
        action: "move",
        sourcePath: resolvedSource,
        destPath,
        fileName,
        destDir,
        message: `Moved '${fileName}' to ${destDir} (${destPath}).`,
      });
    }

    // ── 4. COPY / DUPLICATE FILE ─────────────────────────────────────────────
    if (action === "copy" || action === "duplicate") {
      const rawSource = sourcePath || contextFile?.path || contextFile?.name;
      if (!rawSource) {
        return NextResponse.json({ ok: false, error: "Missing source file to copy" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found: ${rawSource}` }, { status: 404 });
      }

      const fileName = path.basename(resolvedSource);
      const ext = path.extname(fileName);
      const base = path.basename(fileName, ext);

      const destDir = targetDir ? resolveKnownDir(targetDir) : path.dirname(resolvedSource);
      await fs.mkdir(destDir, { recursive: true });

      const destPath = targetDir
        ? path.join(destDir, fileName)
        : path.join(destDir, `${base}_copy${ext}`);

      await fs.copyFile(resolvedSource, destPath);

      return NextResponse.json({
        ok: true,
        action: "copy",
        sourcePath: resolvedSource,
        copyPath: destPath,
        message: `Copied '${fileName}' to '${destPath}'.`,
      });
    }

    // ── 5. CREATE FOLDER ─────────────────────────────────────────────────────
    if (action === "create_folder" || action === "mkdir") {
      const name = folderName || body.name;
      if (!name) {
        return NextResponse.json({ ok: false, error: "Missing folder name" }, { status: 400 });
      }

      const baseDir = parentDir ? resolveKnownDir(parentDir) : path.join(homedir(), "Desktop");
      const targetFolderPath = path.join(baseDir, name);

      await fs.mkdir(targetFolderPath, { recursive: true });

      return NextResponse.json({
        ok: true,
        action: "create_folder",
        path: targetFolderPath,
        folderName: name,
        message: `Created folder '${name}' in ${baseDir}.`,
      });
    }

    // ── 6. OPEN / REVEAL IN FILE EXPLORER ────────────────────────────────────
    if (action === "open" || action === "reveal") {
      const rawSource = sourcePath || contextFile?.path || contextFile?.name;
      if (!rawSource) {
        return NextResponse.json({ ok: false, error: "Missing file or folder to open" }, { status: 400 });
      }

      let target = await findFileLocally(rawSource);
      if (!target && fsSync.existsSync(resolveKnownDir(rawSource))) {
        target = resolveKnownDir(rawSource);
      }

      if (!target) {
        return NextResponse.json({ ok: false, error: `File or folder not found: ${rawSource}` }, { status: 404 });
      }

      const isDir = fsSync.statSync(target).isDirectory();
      if (isDir) {
        await execAsync(`explorer.exe "${target}"`);
      } else {
        await execAsync(`explorer.exe /select,"${target}"`);
      }

      return NextResponse.json({
        ok: true,
        action: "open",
        path: target,
        message: `Revealed '${path.basename(target)}' in File Explorer.`,
      });
    }

    // ── 7. LIST DIRECTORY CONTENTS ───────────────────────────────────────────
    if (action === "list" || action === "explore") {
      const target = resolveKnownDir(sourcePath || targetDir || "downloads");
      if (!fsSync.existsSync(target)) {
        return NextResponse.json({ ok: false, error: `Directory not found: ${target}` }, { status: 404 });
      }

      const rawItems = await fs.readdir(target, { withFileTypes: true });
      const items = rawItems.slice(0, 40).map((i) => ({
        name: i.name,
        type: i.isDirectory() ? "folder" : "file",
        path: path.join(target, i.name),
      }));

      return NextResponse.json({
        ok: true,
        action: "list",
        path: target,
        total: items.length,
        items,
        message: `Found ${items.length} items in ${target}.`,
      });
    }

    return NextResponse.json({ ok: false, error: `Unknown file action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "File Explorer operation failed" }, { status: 500 });
  }
}
