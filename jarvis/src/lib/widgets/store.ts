// Durable widget store — .jarvis-data/widgets.json
//
// Same shape as the mission store: an in-memory list mirrored to disk with
// debounced atomic (temp + rename) writes, so a crash or restart never leaves
// a half-written file and your widgets survive `Ctrl-C`.

import fs from "fs";
import path from "path";
import type { WidgetSpec } from "./spec";
import { WIDGET_LIMITS } from "./spec";

const DATA_DIR = path.join(process.cwd(), ".jarvis-data");
const WIDGETS_FILE = path.join(DATA_DIR, "widgets.json");

interface WidgetGlobal {
  __jarvisWidgets?: WidgetSpec[];
  __jarvisWidgetsLoaded?: boolean;
  __jarvisWidgetsTimer?: ReturnType<typeof setTimeout>;
}

const g = globalThis as unknown as WidgetGlobal;

function load(): WidgetSpec[] {
  if (g.__jarvisWidgets) return g.__jarvisWidgets;
  let list: WidgetSpec[] = [];
  try {
    if (fs.existsSync(WIDGETS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(WIDGETS_FILE, "utf8"));
      if (Array.isArray(raw)) list = raw as WidgetSpec[];
    }
  } catch (e) {
    console.warn("[widgets] could not read widgets.json:", (e as Error).message);
    list = [];
  }
  g.__jarvisWidgets = list;
  g.__jarvisWidgetsLoaded = true;
  return list;
}

function persist(list: WidgetSpec[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${WIDGETS_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
    fs.renameSync(tmp, WIDGETS_FILE);
  } catch (e) {
    console.warn("[widgets] could not persist widgets.json:", (e as Error).message);
  }
}

/** Debounced flush so bursts of edits (ticking checkboxes) write once. */
export function scheduleFlush(): void {
  if (g.__jarvisWidgetsTimer) clearTimeout(g.__jarvisWidgetsTimer);
  g.__jarvisWidgetsTimer = setTimeout(() => {
    g.__jarvisWidgetsTimer = undefined;
    persist(load());
  }, 250);
}

export function flushWidgets(): void {
  if (g.__jarvisWidgetsTimer) {
    clearTimeout(g.__jarvisWidgetsTimer);
    g.__jarvisWidgetsTimer = undefined;
  }
  persist(load());
}

export function listWidgets(): WidgetSpec[] {
  return load().sort((a, b) => a.createdAt - b.createdAt);
}

export function getWidget(id: string): WidgetSpec | undefined {
  return load().find((w) => w.id === id);
}

/** Insert or replace a widget (capped so a runaway generator can't grow forever). */
export function putWidget(widget: WidgetSpec): WidgetSpec {
  const list = load();
  const idx = list.findIndex((w) => w.id === widget.id);
  if (idx >= 0) list[idx] = widget;
  else list.push(widget);
  if (list.length > WIDGET_LIMITS.maxWidgets) {
    // Drop the oldest non-essential widgets, always keeping the one just saved.
    const keep = list.filter((w) => w.id === widget.id || w.id !== list[0].id);
    g.__jarvisWidgets = keep.slice(-WIDGET_LIMITS.maxWidgets);
  }
  scheduleFlush();
  return widget;
}

export function removeWidget(id: string): boolean {
  const list = load();
  const next = list.filter((w) => w.id !== id);
  if (next.length === list.length) return false;
  g.__jarvisWidgets = next;
  flushWidgets();
  return true;
}

export function replaceWidgets(list: WidgetSpec[]): void {
  g.__jarvisWidgets = list;
  scheduleFlush();
}
