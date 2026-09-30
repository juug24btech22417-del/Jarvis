// Widgets from natural language.
//
// "build me a panel that tracks my assignments and crypto" → the LLM returns a
// small JSON spec (title/kind/items/source), which is validated and repaired
// into a WidgetSpec, saved to .jarvis-data/widgets.json, and rendered by the
// fixed widget primitives in the HUD. Live sources (a JSON API, the task list,
// the notes folder) refresh on demand and on an interval.

import fs from "fs";
import path from "path";
import { agentLlm, parseJsonLoose } from "@/lib/agent/llm";
import {
  flattenSourcePayload,
  guessApiSource,
  heuristicWidget,
  normalizeWidget,
  WIDGET_LIMITS,
  type WidgetItem,
  type WidgetSpec,
} from "@/lib/widgets/spec";
import { getWidget, listWidgets, putWidget, removeWidget } from "@/lib/widgets/store";

const INTERNAL_BASE = process.env.INTERNAL_BASE_URL || "http://localhost:3000";

const WIDGET_SYSTEM = [
  "You design small, useful dashboard widgets for JARVIS (a personal AI assistant HUD).",
  "Return ONLY JSON describing ONE widget:",
  '{"title": string, "subtitle"?: string, "kind": "stat"|"list"|"bars"|"checklist"|"counter"|"text",',
  ' "accent": "cyan"|"violet"|"amber"|"green"|"rose", "items": [{"label": string, "value"?: string, "done"?: boolean}],',
  ' "source": {"type": "manual"|"api"|"tasks"|"notes", "url"?: string, "path"?: string, "labelKey"?: string, "valueKey"?: string, "refreshSeconds"?: number}}',
  "Rules:",
  "- kind: checklist = things to tick off; list = label/value rows; bars = comparative numbers; stat = one big number; counter = tap to increment; text = scratchpad.",
  "- source.type: 'manual' when the data is static or typed by the user; 'tasks' to mirror the user's task list; 'notes' to list recent notes;",
  "  'api' ONLY for a public JSON endpoint you are confident about (absolute https URL). For crypto use:",
  '  https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=inr  with valueKey "inr".',
  "- Never invent private endpoints, tokens or scrape URLs. If unsure, use 'manual' and leave items empty so the user can fill them.",
  "- Seed 3-10 sensible starter items for manual widgets (real defaults the user would want to edit).",
  "- Title: max 6 words. Subtitle: max 8 words. Keep it clean and specific to the request.",
].join("\n");

/**
 * If the model left a live-data request as a manual widget (with invented
 * placeholder numbers), point it at the real source instead — a crypto tracker
 * must not display made-up prices.
 */
function upgradeSource(spec: WidgetSpec, prompt: string): WidgetSpec {
  if ((spec.source?.type ?? "manual") !== "manual") return spec;
  const api = guessApiSource(prompt);
  if (api) return { ...spec, source: api, items: [], subtitle: spec.subtitle || "live", lastError: undefined };
  const p = prompt.toLowerCase();
  if (/\b(my )?(tasks?|todos?|to-dos?|checklist)\b/.test(p) && !/assignment|homework|deadline/.test(p)) {
    return { ...spec, source: { type: "tasks" }, items: [] };
  }
  if (/\b(my )?(recent )?notes?\b/.test(p)) return { ...spec, source: { type: "notes" }, items: [] };
  return spec;
}

/** Ask the LLM for a widget spec; fall back to the heuristic on any failure. */
export async function createWidgetFromPrompt(prompt: string): Promise<WidgetSpec> {
  const p = (prompt || "").trim();
  if (!p) throw new Error("prompt required");

  let spec: WidgetSpec;
  try {
    const raw = await agentLlm({
      system: WIDGET_SYSTEM,
      user: `Build a widget for: ${p}`,
      maxTokens: 700,
      temperature: 0.4,
      timeoutMs: 15_000,
      label: "widget",
      json: true,
    });
    const parsed = parseJsonLoose<Record<string, unknown>>(raw);
    if (!parsed) throw new Error("could not parse the widget JSON");
    spec = normalizeWidget(parsed, p.slice(0, 40));
  } catch (e) {
    console.warn("[widgets] LLM unavailable, using heuristic:", (e as Error).message.slice(0, 120));
    spec = heuristicWidget(p);
  }

  spec = upgradeSource(spec, p);
  // One free refresh so a live widget shows data immediately.
  spec = await refreshWidget(spec).catch(() => spec);
  return putWidget(spec);
}

/** Notes folder shared with the Notes panel and mission file_save. */
function notesList(max = 8): WidgetItem[] {
  try {
    const dir = path.join(process.cwd(), "notes");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => !f.startsWith(".") && fs.statSync(path.join(dir, f)).isFile())
      .map((f) => ({ f, at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, max)
      .map(({ f, at }) => ({
        id: `n_${f}`,
        label: f.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, WIDGET_LIMITS.maxLabel),
        value: new Date(at).toLocaleDateString([], { month: "short", day: "numeric" }),
      }));
  } catch {
    return [];
  }
}

async function tasksList(): Promise<WidgetItem[]> {
  try {
    const res = await fetch(`${INTERNAL_BASE}/api/tasks`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const rows: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : [];
    return rows.slice(0, WIDGET_LIMITS.maxItems).map((raw, i) => {
      const t = (raw ?? {}) as Record<string, unknown>;
      const label = String(t.title ?? t.text ?? t.name ?? `Task ${i + 1}`).slice(0, WIDGET_LIMITS.maxLabel);
      const done = t.completed === true || t.done === true;
      return { id: String(t.id ?? `t${i}`), label, done };
    });
  } catch {
    return [];
  }
}

/**
 * Refresh a widget's live source. Manual widgets are returned untouched, so
 * this is safe to call on any widget.
 */
export async function refreshWidget(spec: WidgetSpec): Promise<WidgetSpec> {
  const type = spec.source?.type ?? "manual";
  if (type === "manual") return spec;

  try {
    let items: WidgetItem[] = [];
    if (type === "notes") {
      items = notesList();
    } else if (type === "tasks") {
      items = await tasksList();
    } else if (type === "api") {
      const url = spec.source.url;
      if (!url || !/^https:\/\//.test(url)) throw new Error("api source needs an https url");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 9000);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(`source returned HTTP ${res.status}`);
      const json = await res.json();
      const live = flattenSourcePayload(json, spec.source);
      if (live.length === 0) throw new Error("source returned no usable rows");
      items = live;
    }

    if (items.length === 0) {
      return { ...spec, lastRefreshed: Date.now(), updatedAt: Date.now(), lastError: "source had no rows" };
    }
    const next: WidgetSpec = {
      ...spec,
      items,
      lastRefreshed: Date.now(),
      updatedAt: Date.now(),
      ...(spec.lastError ? { lastError: undefined } : {}),
    };
    return next;
  } catch (e) {
    return { ...spec, lastRefreshed: Date.now(), lastError: (e as Error).message.slice(0, 120) };
  }
}

export async function refreshWidgetById(id: string): Promise<WidgetSpec | undefined> {
  const w = getWidget(id);
  if (!w) return undefined;
  const next = await refreshWidget(w);
  putWidget(next);
  return next;
}

/** Refresh every live widget (manual ones are skipped). */
export async function refreshAllWidgets(): Promise<WidgetSpec[]> {
  const list = listWidgets();
  const next: WidgetSpec[] = [];
  for (const w of list) {
    if ((w.source?.type ?? "manual") === "manual") next.push(w);
    else next.push(await refreshWidget(w));
  }
  for (const w of next) putWidget(w);
  return next;
}

export { listWidgets, getWidget, putWidget, removeWidget };
export type { WidgetSpec, WidgetItem };
