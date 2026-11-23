import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

export const runtime = "nodejs";

interface OmniFileItem {
  name: string;
  path: string;
  size: string;
  modified: string;
  kind: "screenshot" | "pdf" | "code" | "doc" | "other";
}

function classifyKind(ext: string, name: string): OmniFileItem["kind"] {
  const e = ext.toLowerCase();
  if (e === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(e) || name.toLowerCase().includes("screenshot")) {
    return "screenshot";
  }
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".cpp", ".c", ".h", ".json", ".html", ".css"].includes(e)) {
    return "code";
  }
  if ([".doc", ".docx", ".txt", ".md", ".csv", ".xlsx", ".pptx"].includes(e)) {
    return "doc";
  }
  return "other";
}

function parseNaturalQuery(query: string) {
  const q = query.toLowerCase();

  // Target directory category
  let category: "screenshots" | "downloads" | "documents" | "desktop" | "workspace" | "all" = "all";
  if (q.includes("screenshot")) {
    category = "screenshots";
  } else if (q.includes("download")) {
    category = "downloads";
  } else if (q.includes("desktop")) {
    category = "desktop";
  } else if (q.includes("doc") || q.includes("document") || q.includes("pdf")) {
    category = "documents";
  } else if (q.includes("code") || q.includes("project") || q.includes("repo") || q.includes("jarvis")) {
    category = "workspace";
  }

  // Date filters
  let daysAgoStart: number | null = null;
  let daysAgoEnd: number | null = null;

  if (q.includes("day before yesterday")) {
    daysAgoStart = 2;
    daysAgoEnd = 1;
  } else if (q.includes("yesterday")) {
    daysAgoStart = 1;
    daysAgoEnd = 0;
  } else if (q.includes("today")) {
    daysAgoStart = 0;
    daysAgoEnd = -1;
  } else if (q.includes("last week")) {
    daysAgoStart = 14;
    daysAgoEnd = 7;
  } else if (q.includes("this week")) {
    daysAgoStart = 7;
    daysAgoEnd = -1;
  } else {
    const match = q.match(/(\d+)\s+days?\s+ago/);
    if (match) {
      const days = parseInt(match[1], 10);
      daysAgoStart = days;
      daysAgoEnd = days - 1;
    }
  }

  // Extensions
  const extensions: string[] = [];
  if (category === "screenshots" || q.includes("screenshot") || q.includes("image") || q.includes("photo")) {
    extensions.push(".png", ".jpg", ".jpeg");
  }
  if (q.includes("pdf")) extensions.push(".pdf");
  if (q.includes("python") || q.includes(".py")) extensions.push(".py");
  if (q.includes("typescript") || q.includes(".ts")) extensions.push(".ts", ".tsx");

  return { category, daysAgoStart, daysAgoEnd, extensions };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action = "search", query = "", filePath = "" } = body;

    // Action: Open file via default OS handler
    if (action === "open") {
      if (!filePath || typeof filePath !== "string") {
        return NextResponse.json({ ok: false, error: "Missing filePath" }, { status: 400 });
      }

      const escaped = filePath.replace(/'/g, "''");
      const psCommand = `Start-Process -FilePath '${escaped}'`;
      await execAsync(`powershell.exe -NoProfile -NonInteractive -Command "${psCommand}"`);
      return NextResponse.json({ ok: true, message: `Opened: ${filePath}` });
    }

    // Action: Search
    const searchParams = parseNaturalQuery(query);

    // Build PowerShell script to find real files on Windows
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$category = '${searchParams.category}'
$daysAgoStart = ${searchParams.daysAgoStart !== null ? searchParams.daysAgoStart : -1}
$daysAgoEnd = ${searchParams.daysAgoEnd !== null ? searchParams.daysAgoEnd : -1}
$exts = @(${searchParams.extensions.map((e) => `'${e}'`).join(",")})

# Resolve base directories
$targets = @()
$userProf = [Environment]::GetFolderPath('UserProfile')
$myPics = [Environment]::GetFolderPath('MyPictures')

switch ($category) {
  'screenshots' {
    $screenDir = Join-Path $myPics 'Screenshots'
    if (Test-Path $screenDir) { $targets += $screenDir }
    else { $targets += $myPics }
  }
  'downloads' {
    $dl = Join-Path $userProf 'Downloads'
    if (Test-Path $dl) { $targets += $dl }
  }
  'desktop' {
    $dt = [Environment]::GetFolderPath('Desktop')
    if (Test-Path $dt) { $targets += $dt }
  }
  'documents' {
    $docs = [Environment]::GetFolderPath('MyDocuments')
    if (Test-Path $docs) { $targets += $docs }
  }
  'workspace' {
    $targets += (Get-Location).Path
  }
  default {
    $dt = [Environment]::GetFolderPath('Desktop')
    $dl = Join-Path $userProf 'Downloads'
    $screenDir = Join-Path $myPics 'Screenshots'
    if (Test-Path $screenDir) { $targets += $screenDir }
    if (Test-Path $dl) { $targets += $dl }
    if (Test-Path $dt) { $targets += $dt }
  }
}

$results = @()
$today = (Get-Date).Date

foreach ($tgt in $targets) {
  if (!(Test-Path $tgt)) { continue }
  $items = Get-ChildItem -LiteralPath $tgt -File -Recurse -Depth 2 -ErrorAction SilentlyContinue
  foreach ($f in $items) {
    # Date filter
    if ($daysAgoStart -ge 0) {
      $startDate = $today.AddDays(-$daysAgoStart)
      $endDate = if ($daysAgoEnd -lt 0) { (Get-Date).AddDays(1) } else { $today.AddDays(-$daysAgoEnd) }
      if ($f.LastWriteTime -lt $startDate -or $f.LastWriteTime -ge $endDate) {
        continue
      }
    }
    
    # Extension filter
    if ($exts.Count -gt 0) {
      if ($exts -notcontains $f.Extension.ToLower()) {
        continue
      }
    }

    $sizeStr = if ($f.Length -gt 1MB) { "$([Math]::Round($f.Length / 1MB, 1)) MB" } else { "$([Math]::Round($f.Length / 1KB, 1)) KB" }
    $results += [PSCustomObject]@{
      name = $f.Name
      path = $f.FullName
      size = $sizeStr
      modified = $f.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss")
      extension = $f.Extension
    }

    if ($results.Count -ge 20) { break }
  }
  if ($results.Count -ge 20) { break }
}

$results | ConvertTo-Json -Compress
`;

    // Execute the PowerShell search command
    const encodedCommand = Buffer.from(psScript, "utf16le").toString("base64");
    const { stdout } = await execAsync(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`);

    let rawFiles: Array<{ name: string; path: string; size: string; modified: string; extension: string }> = [];
    if (stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout.trim());
        rawFiles = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        rawFiles = [];
      }
    }

    const files: OmniFileItem[] = rawFiles.map((f) => ({
      name: f.name,
      path: f.path,
      size: f.size,
      modified: f.modified,
      kind: classifyKind(f.extension, f.name),
    }));

    return NextResponse.json({
      ok: true,
      query,
      category: searchParams.category,
      totalFound: files.length,
      files,
      scannedPath: searchParams.category,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to execute omni-query" },
      { status: 500 }
    );
  }
}
