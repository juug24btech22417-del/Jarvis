import path from "path";

// Where a spoken destination like "my desktop", "dekstop" or "the documents
// folder" actually points. The old code fell back to Downloads for anything it
// did not recognise, so a typo produced a rename onto itself: the route said
// "Moved … to C:\Users\…\Downloads" while nothing had moved.

export type FolderKind =
  | "desktop"
  | "downloads"
  | "documents"
  | "pictures"
  | "videos"
  | "music";

export type FolderTable = Record<FolderKind, string>;

export function fallbackTable(home: string): FolderTable {
  return {
    desktop: path.join(home, "Desktop"),
    downloads: path.join(home, "Downloads"),
    documents: path.join(home, "Documents"),
    pictures: path.join(home, "Pictures"),
    videos: path.join(home, "Videos"),
    music: path.join(home, "Music"),
  };
}

const KIND_ORDER: FolderKind[] = [
  "desktop",
  "downloads",
  "documents",
  "pictures",
  "videos",
  "music",
];

// Words people actually say for each folder.
const ALIASES: Record<FolderKind, string[]> = {
  desktop: ["desk", "desk top", "deskptop", "desktop"],
  downloads: ["download", "downloads", "dl"],
  documents: ["doc", "docs", "document", "documents", "my documents"],
  pictures: ["pic", "pics", "picture", "pictures", "photo", "photos"],
  videos: ["video", "videos", "movie", "movies"],
  music: ["song", "songs", "music"],
};

export function normalizeDestination(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/[.!,?]+$/, "")
    .replace(/^(?:to|into|in|on|onto|inside)\s+/, "")
    .replace(/^(?:the|my|a|an)\s+/, "")
    .replace(/\s+(?:folder|directory|dir)$/, "")
    .trim();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const cur = [i];
    for (let j = 1; j < cols; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[cols - 1];
}

/** Which known folder a spoken name refers to, tolerating a typo or two. */
export function kindForName(raw: string): FolderKind | null {
  const name = normalizeDestination(raw);
  if (!name) return null;

  for (const kind of KIND_ORDER) {
    if (ALIASES[kind].some((alias) => name === alias)) return kind;
  }
  // "the desktop on my laptop", "documents please" — a word match is enough.
  for (const kind of KIND_ORDER) {
    if (ALIASES[kind].some((alias) => alias.length > 3 && name.includes(alias))) return kind;
  }
  // Typos: "dekstop", "documnets", "picyures".
  let best: { kind: FolderKind; distance: number } | null = null;
  for (const kind of KIND_ORDER) {
    for (const alias of ALIASES[kind]) {
      if (alias.length < 4) continue;
      const distance = editDistance(name, alias);
      if (!best || distance < best.distance) best = { kind, distance };
    }
  }
  if (best && best.distance <= 2) return best.kind;
  return null;
}

/**
 * Resolve a spoken destination to a real folder path.
 * Returns null when the name means nothing recognisable — the caller must then
 * tell the user instead of guessing (a guess used to land in Downloads).
 */
export function resolveDestination(
  raw: string,
  table: FolderTable,
  opts: { join?: typeof path.join } = {}
): string | null {
  const join = opts.join ?? path.join;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // "a folder called Reports on the desktop" → Desktop/Reports
  const nested = trimmed.match(
    /^(?:a\s+)?(?:new\s+)?folder\s+(?:called|named)\s+["'`]?([^"'`]+?)["'`]?(?:\s+(?:on|in|inside)\s+(.+))?$/i
  );
  if (nested) {
    const [, folderName, parentRaw] = nested;
    const parent = parentRaw ? kindForName(parentRaw) : "desktop";
    if (!parent) return null;
    return join(table[parent], folderName.trim());
  }

  // An absolute path is taken at its word.
  if (path.isAbsolute(trimmed)) return trimmed;

  // "desktop/Projects", "Downloads\2026"
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  if (parts.length > 1) {
    const kind = kindForName(parts[0]);
    if (!kind) return null;
    return join(table[kind], ...parts.slice(1));
  }

  const kind = kindForName(trimmed);
  return kind ? table[kind] : null;
}
