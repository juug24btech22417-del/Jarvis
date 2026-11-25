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
function resolveKnownDir(name?: string): string {
  if (!name) return path.join(homedir(), "Downloads");
  const n = name.toLowerCase().trim();
  const home = homedir();
  if (n.includes("desktop")) return path.join(home, "Desktop");
  if (n.includes("download")) return path.join(home, "Downloads");
  if (n.includes("document") || n.includes("doc")) return path.join(home, "Documents");
  if (n.includes("picture") || n.includes("photo")) return path.join(home, "Pictures");
  if (n.includes("video") || n.includes("movie")) return path.join(home, "Videos");
  if (n.includes("music") || n.includes("song")) return path.join(home, "Music");
  if (n.includes("workspace") || n.includes("jarvis")) return process.cwd();
  if (path.isAbsolute(name)) return name;
  return path.join(home, "Downloads");
}

// Find newest file in directory (for commands like "rename the latest download")
async function getLatestFileInDir(dirPath: string): Promise<string | null> {
  if (!fsSync.existsSync(dirPath)) return null;
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    let newestFile: string | null = null;
    let newestTime = 0;

    for (const entry of entries) {
      if (entry.isDirectory() || entry.name.startsWith(".")) continue;
      const fullPath = path.join(dirPath, entry.name);
      try {
        const stats = await fs.stat(fullPath);
        if (stats.mtimeMs > newestTime) {
          newestTime = stats.mtimeMs;
          newestFile = fullPath;
        }
      } catch {
        // ignore
      }
    }
    return newestFile;
  } catch {
    return null;
  }
}

// Locate file anywhere on the user's computer
async function findFileLocally(filename: string, hintDir?: string): Promise<string | null> {
  if (!filename) return null;

  // 1. Direct absolute path check
  if (path.isAbsolute(filename)) {
    if (fsSync.existsSync(filename)) return filename;
  }

  const cleanName = path.basename(filename).toLowerCase().trim();
  const cleanBase = cleanName.replace(/\.[^/.]+$/, "");

  // Candidate directories in order of priority
  const candidateDirs: string[] = [];
  if (hintDir) candidateDirs.push(resolveKnownDir(hintDir));
  candidateDirs.push(
    path.join(homedir(), "Downloads"),
    path.join(homedir(), "Desktop"),
    path.join(homedir(), "Documents"),
    path.join(homedir(), "Pictures"),
    path.join(homedir(), "Videos"),
    path.join(homedir(), "Music"),
    homedir(),
    process.cwd()
  );

  // Phase A: Exact filename in candidate dirs
  for (const dir of candidateDirs) {
    if (!fsSync.existsSync(dir)) continue;
    const directPath = path.join(dir, filename);
    if (fsSync.existsSync(directPath)) return directPath;

    try {
      const items = await fs.readdir(dir);
      // Case-insensitive exact match
      const exactMatch = items.find((f) => f.toLowerCase() === cleanName);
      if (exactMatch) return path.join(dir, exactMatch);
    } catch {
      // ignore
    }
  }

  // Phase B: Stem / Extension match (e.g. user says "m2 therm" and file is "m2 therm.pptx")
  for (const dir of candidateDirs) {
    if (!fsSync.existsSync(dir)) continue;
    try {
      const items = await fs.readdir(dir);
      const stemMatch = items.find((f) => {
        const itemLower = f.toLowerCase();
        const itemBase = itemLower.replace(/\.[^/.]+$/, "");
        return itemBase === cleanBase || itemBase === cleanName;
      });
      if (stemMatch) return path.join(dir, stemMatch);
    } catch {
      // ignore
    }
  }

  // Phase C: Substring fuzzy match
  for (const dir of candidateDirs) {
    if (!fsSync.existsSync(dir)) continue;
    try {
      const items = await fs.readdir(dir);
      const fuzzyMatch = items.find((f) => {
        const itemLower = f.toLowerCase();
        return itemLower.includes(cleanBase) || cleanBase.includes(itemLower.replace(/\.[^/.]+$/, ""));
      });
      if (fuzzyMatch) return path.join(dir, fuzzyMatch);
    } catch {
      // ignore
    }
  }

  return null;
}

// ── FAST RULE-BASED PARSER ──
function parseDeterministicCommand(cmd: string, contextFile?: { name: string; path: string }) {
  let text = cmd.trim();
  text = text.replace(/^(?:hey\s+)?jarvis[,:\s]*/i, "");
  text = text.replace(/^(?:please|could\s+you(?:\s+please)?|can\s+you(?:\s+please)?)\s*/i, "").trim();

  // Pattern: "rename [it/file] to <target>"
  const renameMatch =
    text.match(/^rename\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"'\n]+?)["']?\s+to\s+["']?([^"'\n]+)["']?$/i) ||
    text.match(/^change\s+(?:the\s+)?name\s+of\s+["']?([^"'\n]+?)["']?\s+to\s+["']?([^"'\n]+)["']?$/i);

  if (renameMatch) {
    let source = renameMatch[1]?.trim() || "";
    const target = renameMatch[2]?.trim() || "";
    if (!source || ["it", "this", "the file", "this file", "file"].includes(source.toLowerCase())) {
      source = contextFile?.path || contextFile?.name || "latest_download";
    }
    return { action: "rename", source, target };
  }

  // Pattern: "rename to <target>"
  const renameToMatch = text.match(/^rename\s+to\s+["']?([^"'\n]+)["']?$/i);
  if (renameToMatch) {
    const target = renameToMatch[1].trim();
    const source = contextFile?.path || contextFile?.name || "latest_download";
    return { action: "rename", source, target };
  }

  // Pattern: "delete [it/file]"
  const deleteMatch = text.match(/^(?:delete|remove|trash|destroy)\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"'\n]*)["']?$/i);
  if (deleteMatch) {
    let source = deleteMatch[1]?.trim() || "";
    if (!source || ["it", "this", "the file", "this file", "file"].includes(source.toLowerCase())) {
      source = contextFile?.path || contextFile?.name || "";
    }
    if (source) {
      return { action: "delete", source };
    }
  }

  // Pattern: "move [it/file] to <folder>"
  const moveMatch = text.match(/^move\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"'\n]+?)["']?\s+to\s+["']?([^"'\n]+)["']?$/i);
  if (moveMatch) {
    let source = moveMatch[1].trim();
    const targetDir = moveMatch[2].trim();
    if (["it", "this", "the file", "this file", "file"].includes(source.toLowerCase())) {
      source = contextFile?.path || contextFile?.name || "latest_download";
    }
    return { action: "move", source, targetDir };
  }

  // Pattern: "move to <folder>"
  const moveToMatch = text.match(/^move\s+to\s+["']?([^"'\n]+)["']?$/i);
  if (moveToMatch) {
    const targetDir = moveToMatch[1].trim();
    const source = contextFile?.path || contextFile?.name || "latest_download";
    return { action: "move", source, targetDir };
  }

  // Pattern: "copy [it/file] to <folder>" or "duplicate [it/file]"
  const copyMatch = text.match(/^copy\s+(?:the\s+file\s+|file\s+|it\s+|this\s+|this\s+file\s+)?["']?([^"'\n]+?)["']?\s+to\s+["']?([^"'\n]+)["']?$/i);
  if (copyMatch) {
    let source = copyMatch[1].trim();
    const targetDir = copyMatch[2].trim();
    if (["it", "this", "the file", "this file", "file"].includes(source.toLowerCase())) {
      source = contextFile?.path || contextFile?.name || "latest_download";
    }
    return { action: "copy", source, targetDir };
  }

  // Pattern: "create folder <name> [in <folder>]"
  const folderMatch = text.match(/^(?:create|make|new)\s+(?:a\s+)?(?:folder|directory)\s+(?:called\s+|named\s+)?["']?([^"'\n]+?)["']?(?:\s+in\s+["']?([^"'\n]+)["']?)?$/i);
  if (folderMatch) {
    return { action: "create_folder", folderName: folderMatch[1].trim(), parentDir: folderMatch[2]?.trim() };
  }

  // Pattern: "open / reveal in file explorer"
  const openMatch = text.match(/^(?:open|reveal|show)\s+(?:the\s+file\s+|file\s+|folder\s+|it\s+|this\s+)?["']?([^"'\n]*)["']?(?:\s+in\s+(?:file\s+)?explorer)?$/i);
  if (openMatch) {
    let source = openMatch[1]?.trim() || "";
    if (!source || ["it", "this", "the file", "this file", "file", "explorer", "file explorer"].includes(source.toLowerCase())) {
      source = contextFile?.path || contextFile?.name || "downloads";
    }
    return { action: "open", source };
  }

  // Pattern: "list files [in <dir>]"
  const listMatch = text.match(/^(?:list|show|what)\s+(?:all\s+)?(?:the\s+)?files(?:\s+in\s+|\s+on\s+)?["']?([^"'\n]*)["']?$/i);
  if (listMatch) {
    return { action: "list", targetDir: listMatch[1]?.trim() || "downloads" };
  }

  return null;
}

// ── LLM SEMANTIC NATURAL LANGUAGE PARSER (Groq Llama 3) ──
async function parseWithLLM(cmd: string, contextFile?: { name: string; path: string }) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const prompt = `You are a File Explorer command interpreter.
User instruction: "${cmd}"
Staged context file: ${JSON.stringify(contextFile || null)}

Extract the file action and parameters as JSON with exact keys:
- action: "rename" | "delete" | "move" | "copy" | "create_folder" | "open" | "list"
- source: name/path of the file or "context" or "latest_download"
- target: new name if renaming
- targetDir: target folder if moving, copying, or opening
- folderName: folder name if creating folder
- parentDir: parent folder if creating folder

Respond ONLY with valid JSON.`;

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    let { action, sourcePath, targetName, targetDir, folderName, parentDir, command, contextFile } = body;

    // ── 1. Parse Natural Language Command ──
    if (command && typeof command === "string") {
      // Step A: Fast deterministic regex
      let parsed = parseDeterministicCommand(command, contextFile);

      // Step B: LLM fallback if complex phrasing
      if (!parsed) {
        parsed = await parseWithLLM(command, contextFile);
      }

      if (parsed) {
        action = parsed.action || action;
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

    // ── 2. Resolve Dynamic Source ("latest_download", "context", etc.) ──
    let rawSource = sourcePath || contextFile?.path || contextFile?.name;
    if (
      !rawSource ||
      ["it", "this", "the file", "this file", "file", "context"].includes(String(rawSource).toLowerCase())
    ) {
      rawSource = contextFile?.path || contextFile?.name || "latest_download";
    }

    if (
      typeof rawSource === "string" &&
      (rawSource === "latest_download" ||
        rawSource.toLowerCase().includes("latest") ||
        rawSource.toLowerCase().includes("just downloaded"))
    ) {
      const latest = await getLatestFileInDir(resolveKnownDir("downloads"));
      if (latest) {
        rawSource = latest;
      }
    }

    // ── 3. EXECUTE REAL FILE EXPLORER ACTIONS ──

    // ── ACTION: RENAME ──
    if (action === "rename") {
      const rawTarget = targetName || body.newName;
      if (!rawSource || !rawTarget) {
        return NextResponse.json({ ok: false, error: "Missing source file or new name" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found in File Explorer: ${rawSource}` }, { status: 404 });
      }

      const sourceDir = path.dirname(resolvedSource);
      const sourceExt = path.extname(resolvedSource);

      let finalTargetName = rawTarget.trim();
      // Preserve extension if omitted in new name
      if (!path.extname(finalTargetName) && sourceExt) {
        finalTargetName = `${finalTargetName}${sourceExt}`;
      }

      const targetPath = path.join(sourceDir, finalTargetName);

      // Perform real file rename in place
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

    // ── ACTION: DELETE ──
    if (action === "delete" || action === "remove" || action === "trash") {
      if (!rawSource) {
        return NextResponse.json({ ok: false, error: "Missing file to delete" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found in File Explorer: ${rawSource}` }, { status: 404 });
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
        message: `Deleted '${path.basename(resolvedSource)}' from File Explorer.`,
      });
    }

    // ── ACTION: MOVE ──
    if (action === "move") {
      if (!rawSource || !targetDir) {
        return NextResponse.json({ ok: false, error: "Missing source file or target directory" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found in File Explorer: ${rawSource}` }, { status: 404 });
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
        message: `Moved '${fileName}' to ${destDir} in File Explorer.`,
      });
    }

    // ── ACTION: COPY ──
    if (action === "copy" || action === "duplicate") {
      if (!rawSource) {
        return NextResponse.json({ ok: false, error: "Missing source file to copy" }, { status: 400 });
      }

      const resolvedSource = await findFileLocally(rawSource);
      if (!resolvedSource) {
        return NextResponse.json({ ok: false, error: `File not found in File Explorer: ${rawSource}` }, { status: 404 });
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
        message: `Copied '${fileName}' to '${destPath}' in File Explorer.`,
      });
    }

    // ── ACTION: CREATE FOLDER ──
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

    // ── ACTION: OPEN / REVEAL IN WINDOWS FILE EXPLORER ──
    if (action === "open" || action === "reveal") {
      let target = await findFileLocally(rawSource);
      if (!target && fsSync.existsSync(resolveKnownDir(rawSource))) {
        target = resolveKnownDir(rawSource);
      }
      if (!target && fsSync.existsSync(resolveKnownDir(targetDir))) {
        target = resolveKnownDir(targetDir);
      }

      if (!target) {
        target = path.join(homedir(), "Downloads");
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
        message: `Opened '${path.basename(target)}' in Windows File Explorer.`,
      });
    }

    // ── ACTION: LIST DIRECTORY ──
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
