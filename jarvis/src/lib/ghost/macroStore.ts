// Macro Store — in-memory cache with JSON-file persistence.
//
// Same pattern as formHistory: fast reads from RAM, async writes to disk.
// Max 200 macros stored; oldest deleted when limit exceeded.

import fs from "fs/promises";
import path from "path";
import type { Macro, MacroStep, MacroVariable } from "./macroTypes";

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
  updates: Partial<Pick<Macro, "name" | "description" | "steps" | "tags" | "targetUrl" | "isFormFill" | "variables">>
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

// ─── Variable interpolation ({{name}} placeholders) ───────────────────

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/**
 * Substitute {{var}} placeholders in a string with runtime values.
 * Unset placeholders are left as-is so the step fails loudly (and
 * visibly) instead of silently typing an empty string.
 */
export function interpolateVars(
  input: string | undefined,
  vars: Record<string, string> | undefined
): string {
  if (!input) return input || "";
  if (!vars || Object.keys(vars).length === 0) return input;
  return input.replace(VAR_RE, (full, name: string) => {
    const v = vars[name];
    return v !== undefined && v !== null && String(v).trim() !== "" ? String(v) : full;
  });
}

/**
 * Deep-clone a step with every {{var}} placeholder replaced by the
 * runtime value. Covers target, value, and semantic UIA fields.
 */
export function interpolateStep<T extends MacroStep>(
  step: T,
  vars?: Record<string, string>
): T {
  if (!vars || Object.keys(vars).length === 0) return step;
  const uia = (step.options as any)?.uia
    ? { ...(step.options as any).uia }
    : undefined;
  if (uia) {
    uia.name = interpolateVars(uia.name, vars);
    uia.process = interpolateVars(uia.process, vars);
    uia.windowName = interpolateVars(uia.windowName, vars);
  }
  return {
    ...step,
    target: interpolateVars(step.target, vars),
    value: interpolateVars(step.value, vars),
    options: uia ? { ...(step.options as any), uia } : step.options,
  } as T;
}

/**
 * Find every {{var}} referenced by a step list so generators/recorders
 * can auto-declare them as MacroVariables.
 */
export function extractMacroVariables(steps: MacroStep[]): MacroVariable[] {
  const found = new Map<string, MacroVariable>();
  const scan = (s: string | undefined) => {
    if (!s) return;
    VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAR_RE.exec(s))) {
      if (!found.has(m[1])) found.set(m[1], { name: m[1] });
    }
  };
  for (const st of steps) {
    scan(st.target);
    scan(st.value);
    const uia = (st.options as any)?.uia;
    if (uia) {
      scan(uia.name);
      scan(uia.process);
      scan(uia.windowName);
    }
  }
  return Array.from(found.values());
}
