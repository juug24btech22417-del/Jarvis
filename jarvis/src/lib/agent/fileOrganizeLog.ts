// Undo log for `file_organize`.
//
// Every executed tidy-up records the exact from→to pairs it performed, so a
// later mission / the Mission Control card can put the files back. The record
// is persisted to scratch/ because the registry must survive a dev-server
// restart (the files are already moved on disk).

import fs from "fs";
import path from "path";

export interface OrganizeMoveRecord {
  from: string;
  to: string;
}

export interface OrganizeRecord {
  id: string;
  folder: string;
  dir: string;
  mode: string;
  at: number;
  moves: OrganizeMoveRecord[];
}

export interface UndoResult {
  ok: boolean;
  restored: number;
  failed: number;
  message: string;
}

/** Records older than this are considered stale and not offered for undo. */
const MAX_AGE_MS = 7 * 86_400_000;

function logPath(): string {
  const scratch = path.join(process.cwd(), "scratch");
  try {
    if (!fs.existsSync(scratch)) fs.mkdirSync(scratch, { recursive: true });
  } catch {
    // fall back to cwd
  }
  return path.join(fs.existsSync(scratch) ? scratch : process.cwd(), "last-organize.json");
}

/** Read the persisted record (null when absent, stale, or unreadable). */
export function getLastOrganize(): OrganizeRecord | null {
  try {
    const raw = fs.readFileSync(logPath(), "utf8");
    const rec = JSON.parse(raw) as OrganizeRecord;
    if (!rec || !Array.isArray(rec.moves) || typeof rec.at !== "number") return null;
    if (Date.now() - rec.at > MAX_AGE_MS) return null;
    if (rec.moves.length === 0) return null;
    return rec;
  } catch {
    return null;
  }
}

/** Persist an executed tidy-up. Never throws. */
export function recordOrganize(rec: Omit<OrganizeRecord, "id" | "at">): void {
  if (!rec.moves.length) return;
  const full: OrganizeRecord = { ...rec, id: `org_${Date.now()}`, at: Date.now() };
  try {
    fs.writeFileSync(logPath(), JSON.stringify(full, null, 2), "utf8");
  } catch {
    // best-effort — losing the undo record must never fail the mission
  }
}

export function clearLastOrganize(): void {
  try {
    fs.unlinkSync(logPath());
  } catch {
    // already gone
  }
}

/**
 * Reverse the last tidy-up: move every file back to where it came from.
 * Runs in reverse order so a chain of moves unwinds cleanly. Never overwrites
 * an existing file at the original path — it reports it instead.
 */
export function undoLastOrganize(): UndoResult {
  const rec = getLastOrganize();
  if (!rec) {
    return { ok: false, restored: 0, failed: 0, message: "There's no recent tidy-up on record to undo." };
  }

  let restored = 0;
  let failed = 0;
  for (const m of [...rec.moves].reverse()) {
    try {
      if (!fs.existsSync(m.to)) {
        failed++;
        continue;
      }
      if (fs.existsSync(m.from)) {
        // Something new took the original name — leave both in place.
        failed++;
        continue;
      }
      fs.mkdirSync(path.dirname(m.from), { recursive: true });
      fs.renameSync(m.to, m.from);
      restored++;
    } catch {
      failed++;
    }
  }

  if (restored > 0) clearLastOrganize();
  const message =
    restored > 0
      ? `Put ${restored} file(s) back in ${rec.folder}${failed ? ` (${failed} couldn't be restored)` : ""}.`
      : `I couldn't restore anything from the last tidy-up in ${rec.folder}.`;
  return { ok: restored > 0, restored, failed, message };
}

/** Compact shape for the API / UI card. */
export function summarizeOrganizeRecord(rec: OrganizeRecord | null) {
  if (!rec) return null;
  return {
    id: rec.id,
    folder: rec.folder,
    mode: rec.mode,
    at: rec.at,
    moved: rec.moves.length,
    folders: Array.from(new Set(rec.moves.map((m) => path.basename(path.dirname(m.to))))).sort(),
  };
}
