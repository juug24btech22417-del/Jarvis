// Mission artifact storage.
//
// Screenshots, generated reports and video briefs are written under
// .jarvis-data/artifacts/<jobId>/ so they survive restarts and can be served
// back to the panel without shoving base64 into the persisted job JSON.

import fs from "fs";
import path from "path";

export const ARTIFACT_ROOT = path.join(process.cwd(), ".jarvis-data", "artifacts");

export function artifactDir(jobId: string): string {
  const safe = String(jobId).replace(/[^\w-]/g, "_");
  const dir = path.join(ARTIFACT_ROOT, safe);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(name: string): string {
  return String(name).replace(/[^\w.-]/g, "_").slice(0, 120);
}

/** Write a buffer/string artifact and return its absolute path. */
export function saveArtifact(jobId: string, name: string, data: Buffer | string): string {
  const dir = artifactDir(jobId);
  const file = path.join(dir, safeName(name));
  fs.writeFileSync(file, data);
  return file;
}

/**
 * Resolve a stored artifact path for serving. Rejects anything outside the
 * artifact root (path traversal guard).
 */
export function resolveArtifactPath(filePath: string): string | null {
  try {
    const abs = path.resolve(filePath);
    const root = path.resolve(ARTIFACT_ROOT);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".json") return "application/json";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  return "text/plain; charset=utf-8";
}
