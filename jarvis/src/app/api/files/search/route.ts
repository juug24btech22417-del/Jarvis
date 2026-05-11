import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { homedir } from "os";
import { join } from "path";

const execAsync = promisify(exec);

interface FileResult {
  name: string;
  path: string;
  type: "file" | "folder";
  size?: string;
  modified?: string;
}

// File extension mappings for common types
const FILE_EXTENSIONS: Record<string, string[]> = {
  pdf: ["*.pdf"],
  python: ["*.py", "*.pyw"],
  javascript: ["*.js", "*.jsx", "*.ts", "*.tsx", "*.mjs"],
  java: ["*.java"],
  cpp: ["*.cpp", "*.hpp", "*.c", "*.h"],
  c: ["*.c", "*.h"],
  word: ["*.doc", "*.docx"],
  excel: ["*.xls", "*.xlsx", "*.csv"],
  powerpoint: ["*.ppt", "*.pptx"],
  image: ["*.jpg", "*.jpeg", "*.png", "*.gif", "*.bmp", "*.webp", "*.svg"],
  video: ["*.mp4", "*.avi", "*.mkv", "*.mov", "*.wmv"],
  audio: ["*.mp3", "*.wav", "*.flac", "*.aac", "*.ogg"],
  zip: ["*.zip", "*.rar", "*.7z", "*.tar", "*.gz"],
  text: ["*.txt", "*.md", "*.rtf"],
  code: ["*.js", "*.ts", "*.py", "*.java", "*.cpp", "*.c", "*.html", "*.css"],
  document: ["*.pdf", "*.doc", "*.docx", "*.txt", "*.rtf"],
};

// Search files using Windows Everything or PowerShell
async function searchFiles(query: string): Promise<FileResult[]> {
  const results: FileResult[] = [];
  const seenPaths = new Set<string>();

  // Common search locations
  const searchPaths = [
    join(homedir(), "Documents"),
    join(homedir(), "Downloads"),
    join(homedir(), "Desktop"),
    join(homedir(), "OneDrive"),
  ];

  // Parse query for file type keywords
  const queryLower = query.toLowerCase();
  const matchedExtensions: string[] = [];
  const searchTerms: string[] = [];

  // Check for file type keywords
  for (const [keyword, extensions] of Object.entries(FILE_EXTENSIONS)) {
    if (queryLower.includes(keyword)) {
      matchedExtensions.push(...extensions);
    }
  }

  // Extract search terms (non-extension words)
  const words = queryLower.split(/\s+/);
  for (const word of words) {
    if (!FILE_EXTENSIONS[word] && word.length > 1) {
      searchTerms.push(word);
    }
  }

  // Build search patterns
  const searchPatterns: string[] = [];
  if (matchedExtensions.length > 0) {
    // Search by extension
    for (const ext of Array.from(new Set(matchedExtensions))) {
      if (searchTerms.length > 0) {
        // Extension + name pattern: *term*.ext
        for (const term of searchTerms) {
          searchPatterns.push(`*${term}*${ext.slice(1)}`); // Remove the dot from ext
        }
      } else {
        // Just extension
        searchPatterns.push(ext);
      }
    }
  } else {
    // General search by name
    searchPatterns.push(`*${query}*`);
  }

  try {
    for (const basePath of searchPaths) {
      for (const pattern of searchPatterns) {
        try {
          const psCommand = `
            Get-ChildItem -Path "${basePath}" -Recurse -Filter "${pattern}" -ErrorAction SilentlyContinue |
            Select-Object -First 10 |
            ForEach-Object {
              "$($_.Name)|$($_.FullName)|$($_.PSIsContainer ? 'folder' : 'file')|$($_.Length)|$($_.LastWriteTime)"
            }
          `;

          const { stdout } = await execAsync(
            `powershell -Command "${psCommand}"`,
            { timeout: 15000 }
          );

          if (stdout) {
            const lines = stdout.trim().split("\n");
            for (const line of lines) {
              const parts = line.split("|");
              if (parts.length >= 3) {
                const path = parts[1].trim();
                // Avoid duplicates
                if (!seenPaths.has(path)) {
                  seenPaths.add(path);
                  results.push({
                    name: parts[0].trim(),
                    path: path,
                    type: parts[2].trim() as "file" | "folder",
                    size: parts[3] ? formatBytes(parseInt(parts[3])) : undefined,
                    modified: parts[4] ? new Date(parts[4]).toLocaleDateString() : undefined,
                  });
                }
              }
            }
          }
        } catch {
          // Pattern or path might not exist, skip
        }
      }
    }

    return results.slice(0, 10); // Limit to 10 results
  } catch (error) {
    console.error("File search error:", error);
    return [];
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query) {
      return NextResponse.json(
        { error: "Search query required" },
        { status: 400 }
      );
    }

    const results = await searchFiles(query);

    return NextResponse.json({
      success: true,
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("File search API error:", error);
    return NextResponse.json(
      { error: "File search failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json(
        { error: "Search query required" },
        { status: 400 }
      );
    }

    const results = await searchFiles(query);

    return NextResponse.json({
      success: true,
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    console.error("File search API error:", error);
    return NextResponse.json(
      { error: "File search failed", details: String(error) },
      { status: 500 }
    );
  }
}
