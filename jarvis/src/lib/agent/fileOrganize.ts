// file_organize — pure planning layer.
//
// The actual moving happens in AgentService (fs.rename). Everything about
// WHICH file should go WHERE lives here so it can be unit-tested without
// touching the disk. Default behaviour is a dry run: the mission reports the
// plan, then a second mission (after the user says "go ahead") executes it.

export type OrganizeMode = "by-type" | "archive";

export interface OrganizeFile {
  name: string;
  mtime: number;
}

export interface OrganizeMove {
  /** Original file name. */
  name: string;
  /** Destination relative to the folder being organized, e.g. "Images". */
  to: string;
  /** Destination file name (usually === name; collisions get suffixed). */
  as: string;
}

export interface OrganizeOptions {
  mode?: OrganizeMode;
  /** archive mode: only files older than this many days move. */
  olderThanDays?: number;
  /** Injectable clock for tests. */
  now?: number;
}

export interface OrganizePlan {
  moves: OrganizeMove[];
  /** Files deliberately left alone (unknown type / too new / hidden). */
  skipped: string[];
}

const EXT_CATEGORY: Record<string, string> = {
  // Images
  jpg: "Images", jpeg: "Images", png: "Images", gif: "Images", webp: "Images",
  bmp: "Images", svg: "Images", heic: "Images", tiff: "Images", ico: "Images",
  // Documents
  pdf: "Documents", doc: "Documents", docx: "Documents", txt: "Documents",
  rtf: "Documents", odt: "Documents", xls: "Documents", xlsx: "Documents",
  csv: "Documents", ppt: "Documents", pptx: "Documents", md: "Documents",
  // Videos
  mp4: "Videos", mkv: "Videos", mov: "Videos", avi: "Videos", webm: "Videos",
  flv: "Videos", wmv: "Videos", m4v: "Videos",
  // Audio
  mp3: "Audio", wav: "Audio", flac: "Audio", m4a: "Audio", aac: "Audio",
  ogg: "Audio", wma: "Audio", opus: "Audio",
  // Archives
  zip: "Archives", rar: "Archives", "7z": "Archives", tar: "Archives",
  gz: "Archives", bz2: "Archives", xz: "Archives", iso: "Archives",
  // Code
  js: "Code", ts: "Code", jsx: "Code", tsx: "Code", json: "Code", html: "Code",
  css: "Code", py: "Code", java: "Code", c: "Code", cpp: "Code", cs: "Code",
  go: "Code", rs: "Code", rb: "Code", php: "Code", sh: "Code", sql: "Code",
  yml: "Code", yaml: "Code", toml: "Code", xml: "Code", ipynb: "Code",
  // Installers / packages
  exe: "Installers", msi: "Installers", dmg: "Installers", pkg: "Installers",
  deb: "Installers", apk: "Installers", appx: "Installers",
};

/** Extension (lowercase, no dot) of a file name; "" when there is none. */
export function fileExtension(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/** Folder a file belongs to in a by-type tidy-up. */
export function categoryForFile(name: string): string {
  return EXT_CATEGORY[fileExtension(name)] ?? "Other";
}

/** Hidden/system files stay put. */
function isHidden(name: string): boolean {
  return name.startsWith(".") || name.toLowerCase() === "desktop.ini" || name.toLowerCase() === "thumbs.db";
}

/**
 * Resolve a destination name that does not collide with an already-taken name.
 * "photo.jpg" -> "photo (1).jpg" once "photo.jpg" is taken.
 */
export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * Build the move plan for a folder of files. Pure — no disk access.
 *
 *  - by-type (default): route each file into its category subfolder.
 *  - archive: move files older than `olderThanDays` (default 30) into "Archive".
 */
export function planFileOrganization(files: OrganizeFile[], opts: OrganizeOptions = {}): OrganizePlan {
  const mode: OrganizeMode = opts.mode ?? "by-type";
  const now = opts.now ?? Date.now();
  const olderThanDays = opts.olderThanDays ?? 30;
  const cutoff = now - olderThanDays * 86_400_000;

  const moves: OrganizeMove[] = [];
  const skipped: string[] = [];
  const taken = new Set<string>();

  for (const f of files) {
    if (!f.name || isHidden(f.name)) {
      if (f.name) skipped.push(f.name);
      continue;
    }

    if (mode === "archive") {
      if (f.mtime > cutoff) {
        skipped.push(f.name);
        continue;
      }
      moves.push({ name: f.name, to: "Archive", as: uniqueName(f.name, taken) });
      taken.add(moves[moves.length - 1].as);
      continue;
    }

    // by-type
    const cat = categoryForFile(f.name);
    if (cat === "Other") {
      skipped.push(f.name);
      continue;
    }
    moves.push({ name: f.name, to: cat, as: uniqueName(f.name, taken) });
    taken.add(moves[moves.length - 1].as);
  }

  // Stable, readable order: folder then name.
  moves.sort((a, b) => a.to.localeCompare(b.to) || a.name.localeCompare(b.name));
  return { moves, skipped };
}
