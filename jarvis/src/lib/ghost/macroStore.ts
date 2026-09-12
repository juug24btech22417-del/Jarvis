// Macro Store — in-memory cache with JSON-file persistence.
//
// Same pattern as formHistory: fast reads from RAM, async writes to disk.
// Max 200 macros stored; oldest deleted when limit exceeded.

import fs from "fs/promises";
import path from "path";
import type { Macro, MacroStep } from "./macroTypes";

const MACRO_FILE = path.join(process.cwd(), ".jarvis_macros.json");
const MAX_MACROS = 200;

let macros: Macro[] = [];
let loaded = false;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const raw = await fs.readFile(MACRO_FILE, "utf8");
    macros = JSON.parse(raw);
  } catch {
    macros = [];
  }
  loaded = true;
}

async function persist() {
  try {
    const trimmed = macros.slice(-MAX_MACROS);
    await fs.writeFile(MACRO_FILE, JSON.stringify(trimmed, null, 2), "utf8");
  } catch (err) {
    console.error("[MacroStore] persist error:", err);
  }
}

export async function saveMacro(
  macro: Omit<Macro, "id" | "createdAt" | "updatedAt" | "replayCount">
): Promise<Macro> {
  await ensureLoaded();
  const now = new Date().toISOString();
  const saved: Macro = {
    id: `macro_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    replayCount: 0,
    ...macro,
    tags: macro.tags || [],
  };
  macros.push(saved);
  await persist();
  return saved;
}

export async function updateMacro(
  id: string,
  updates: Partial<Pick<Macro, "name" | "description" | "steps" | "tags" | "targetUrl" | "isFormFill">>
): Promise<Macro | null> {
  await ensureLoaded();
  const idx = macros.findIndex((m) => m.id === id);
  if (idx === -1) return null;
  macros[idx] = {
    ...macros[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  await persist();
  return macros[idx];
}

export async function appendStep(
  macroId: string,
  step: MacroStep
): Promise<boolean> {
  await ensureLoaded();
  const macro = macros.find((m) => m.id === macroId);
  if (!macro) return false;
  macro.steps.push(step);
  macro.updatedAt = new Date().toISOString();
  await persist();
  return true;
}

export async function getMacro(id: string): Promise<Macro | null> {
  await ensureLoaded();
  return macros.find((m) => m.id === id) || null;
}

export async function getMacroByName(name: string): Promise<Macro | null> {
  await ensureLoaded();
  const lower = name.toLowerCase().trim();
  return (
    macros.find(
      (m) =>
        m.name.toLowerCase() === lower ||
        m.name.toLowerCase().includes(lower)
    ) || null
  );
}

export async function listMacros(opts?: {
  limit?: number;
  tag?: string;
  isFormFill?: boolean;
}): Promise<Macro[]> {
  await ensureLoaded();
  let result = [...macros];

  if (opts?.tag) {
    result = result.filter((m) =>
      m.tags.some((t) => t.toLowerCase() === opts.tag!.toLowerCase())
    );
  }
  if (opts?.isFormFill !== undefined) {
    result = result.filter((m) => m.isFormFill === opts.isFormFill);
  }

  return result
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
    .slice(0, opts?.limit ?? 50);
}

export async function deleteMacro(id: string): Promise<boolean> {
  await ensureLoaded();
  const idx = macros.findIndex((m) => m.id === id);
  if (idx === -1) return false;
  macros.splice(idx, 1);
  await persist();
  return true;
}

export async function incrementReplayCount(id: string): Promise<void> {
  await ensureLoaded();
  const macro = macros.find((m) => m.id === id);
  if (macro) {
    macro.replayCount++;
    macro.lastReplayedAt = new Date().toISOString();
    await persist();
  }
}
