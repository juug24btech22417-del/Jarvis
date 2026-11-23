import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

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
  if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(e) || name.toLowerCase().includes("screenshot")) return "screenshot";
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".cpp", ".c", ".h", ".json", ".html", ".css"].includes(e)) return "code";
  if ([".doc", ".docx", ".txt", ".md", ".csv", ".xlsx", ".pptx"].includes(e)) return "doc";
  return "other";
}

function parseNaturalQuery(query: string) {
  const q = query.toLowerCase();

  // ── Date window ───────────────────────────────────────────────────────────
  // daysAgoStart = how many days back to START the window (older boundary)
  // daysAgoEnd   = how many days back to END the window (newer boundary, -1 = now)
  let daysAgoStart: number | null = null;
  let daysAgoEnd: number | null = null;

  if (q.includes("day before yesterday")) { daysAgoStart = 2; daysAgoEnd = 1; }
  else if (q.includes("yesterday"))        { daysAgoStart = 1; daysAgoEnd = 0; }
  else if (q.includes("today"))            { daysAgoStart = 0; daysAgoEnd = -1; }
  else if (q.includes("last week"))        { daysAgoStart = 7; daysAgoEnd = -1; }  // past 7 days
  else if (q.includes("this week"))        { daysAgoStart = 7; daysAgoEnd = -1; }
  else if (q.includes("last month"))       { daysAgoStart = 30; daysAgoEnd = -1; }
  else {
    const match = q.match(/(\d+)\s+days?\s+ago/);
    if (match) { const d = parseInt(match[1], 10); daysAgoStart = d; daysAgoEnd = d - 1; }
  }

  // ── File extensions ───────────────────────────────────────────────────────
  const extensions: string[] = [];
  if (q.includes("pdf"))                                           extensions.push(".pdf");
  if (q.includes("screenshot") || q.includes("image") || q.includes("photo")) extensions.push(".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp");
  if (q.includes("python") || q.includes(".py"))                  extensions.push(".py");
  if (q.includes("typescript") || q.includes(".ts"))              extensions.push(".ts", ".tsx");
  if (q.includes("javascript") || q.includes(".js"))              extensions.push(".js", ".jsx");
  if (q.includes("word") || q.includes(".docx"))                  extensions.push(".docx", ".doc");
  if (q.includes("excel") || q.includes("spreadsheet"))           extensions.push(".xlsx", ".csv");

  // ── Target directories ────────────────────────────────────────────────────
  // For PDFs or generic "downloaded", always check Downloads first
  const dirs: string[] = [];
  if (q.includes("download")) dirs.push("downloads");
  if (q.includes("screenshot"))  dirs.push("screenshots");
  if (q.includes("desktop"))     dirs.push("desktop");
  if (q.includes("document") || q.includes("doc")) dirs.push("documents");
  if (q.includes("code") || q.includes("project") || q.includes("jarvis")) dirs.push("workspace");
  // PDF can live in Downloads OR Documents — search both when no explicit dir
  if (q.includes("pdf") && dirs.length === 0) { dirs.push("downloads", "documents", "desktop"); }
  if (dirs.length === 0) dirs.push("downloads", "desktop", "documents");

  return { dirs, daysAgoStart, daysAgoEnd, extensions };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action = "search", query = "", filePath = "" } = body;

    // ── Open a file ──────────────────────────────────────────────────────────
    if (action === "open") {
      if (!filePath || typeof filePath !== "string")
        return NextResponse.json({ ok: false, error: "Missing filePath" }, { status: 400 });
      const escaped = filePath.replace(/'/g, "''");
      await execAsync(`powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Start-Process -FilePath '${escaped}'"`, { timeout: 5000 });
      return NextResponse.json({ ok: true, message: `Opened: ${filePath}` });
    }

    // ── Search ───────────────────────────────────────────────────────────────
    const { dirs, daysAgoStart, daysAgoEnd, extensions } = parseNaturalQuery(query);

    // Build target-paths block per dir token
    const dirBlock = dirs.map(d => {
      switch (d) {
        case "downloads":   return `$dl = Join-Path $prof 'Downloads'; if (Test-Path $dl) { $targets += $dl }`;
        case "screenshots": return `$sc = Join-Path $pics 'Screenshots'; if (Test-Path $sc) { $targets += $sc } else { $targets += $pics }`;
        case "desktop":     return `$dt = [Environment]::GetFolderPath('Desktop'); if (Test-Path $dt) { $targets += $dt }`;
        case "documents":   return `$dc = [Environment]::GetFolderPath('MyDocuments'); if (Test-Path $dc) { $targets += $dc }`;
        case "workspace":   return `$targets += (Get-Location).Path`;
        default: return "";
      }
    }).filter(Boolean).join("\n");

    const extFilter = extensions.length > 0
      ? `@(${extensions.map(e => `'${e}'`).join(",")})`
      : `@()`;

    // Note: daysAgoEnd = -1 means "up to now"
    const psScript = `
$ErrorActionPreference = 'SilentlyContinue'
$prof  = [Environment]::GetFolderPath('UserProfile')
$pics  = [Environment]::GetFolderPath('MyPictures')
$targets = @()
${dirBlock}
$exts  = ${extFilter}
$hasDays  = ${daysAgoStart !== null ? "1" : "0"}
$startDay = ${daysAgoStart !== null ? daysAgoStart : 0}
$endDay   = ${daysAgoEnd   !== null ? daysAgoEnd   : -1}
$today    = (Get-Date).Date
$results  = [System.Collections.Generic.List[PSObject]]::new()

foreach ($tgt in $targets) {
  if (!(Test-Path $tgt)) { continue }
  $items = Get-ChildItem -LiteralPath $tgt -File -Recurse -Depth 4 -ErrorAction SilentlyContinue

  foreach ($f in $items) {
    # --- Extension filter ---
    if ($exts.Count -gt 0 -and $exts -notcontains $f.Extension.ToLower()) { continue }

    # --- Date filter ---
    if ($hasDays -eq 1) {
      $start = $today.AddDays(-$startDay)
      $end   = if ($endDay -lt 0) { (Get-Date).AddDays(1) } else { $today.AddDays(-$endDay) }
      $modMatch = ($f.LastWriteTime -ge $start -and $f.LastWriteTime -lt $end)
      $creMatch = ($f.CreationTime -ge $start -and $f.CreationTime -lt $end)
      if (-not ($modMatch -or $creMatch)) { continue }
    }

    $sz = if ($f.Length -gt 1MB) { "$([Math]::Round($f.Length/1MB,1)) MB" } else { "$([Math]::Round($f.Length/1KB,1)) KB" }
    $results.Add([PSCustomObject]@{
      name      = $f.Name
      path      = $f.FullName
      size      = $sz
      modified  = $f.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')
      extension = $f.Extension
      rawTime   = $f.LastWriteTime
    })
    if ($results.Count -ge 50) { break }
  }
  if ($results.Count -ge 50) { break }
}

$results | Sort-Object rawTime -Descending | Select-Object -Property name, path, size, modified, extension | ConvertTo-Json -Compress -Depth 2
`;

    const enc = Buffer.from(psScript, "utf16le").toString("base64");
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${enc}`,
      { timeout: 20000 }
    );

    let rawFiles: any[] = [];
    if (stdout.trim()) {
      try {
        const parsed = JSON.parse(stdout.trim());
        rawFiles = Array.isArray(parsed) ? parsed : [parsed];
      } catch { rawFiles = []; }
    }

    const files: OmniFileItem[] = rawFiles.map(f => ({
      name: f.name, path: f.path, size: f.size,
      modified: f.modified,
      kind: classifyKind(f.extension, f.name),
    }));

    return NextResponse.json({
      ok: true, query,
      dirs, totalFound: files.length, files,
      scannedPath: dirs.join(", "),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message || "Omni-Query failed" }, { status: 500 });
  }
}
