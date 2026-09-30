// Natural-language widgets API.
//
// GET  ?refresh=1            → refresh live sources, return the list
// GET                        → list
// POST { action: "create", prompt }         → build a widget from natural language
// POST { action: "blank", kind?, title? }   → an empty, fully manual widget
// POST { action: "update", widget }         → save edits (title/subtitle/kind/accent/icon/body/source/items)
// POST { action: "delete", id }
// POST { action: "refresh", id? }
// POST { action: "item-add", id, label, value? }
// POST { action: "item-update", id, itemId, label?, value?, done? }
// POST { action: "item-move", id, itemId, delta }
// POST { action: "items-clear", id }
// POST { action: "item-toggle", id, itemId }
// POST { action: "item-remove", id, itemId }
// POST { action: "counter", id, delta }

import { NextRequest, NextResponse } from "next/server";
import {
  createWidgetFromPrompt,
  getWidget,
  listWidgets,
  putWidget,
  removeWidget,
  refreshAllWidgets,
  refreshWidgetById,
} from "@/services/WidgetService";
import {
  normalizeItems,
  normalizeSource,
  normalizeWidget,
  newItemId,
  WIDGET_ACCENTS,
  WIDGET_KINDS,
  WIDGET_LIMITS,
  type WidgetAccent,
  type WidgetKind,
  type WidgetSource,
} from "@/lib/widgets/spec";

export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("refresh") === "1") {
      return NextResponse.json({ widgets: await refreshAllWidgets() });
    }
    return NextResponse.json({ widgets: listWidgets() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  const id = typeof body.id === "string" ? body.id : "";

  try {
    switch (action) {
      case "create": {
        const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
        if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
        if (prompt.length > 300) return NextResponse.json({ error: "prompt too long" }, { status: 400 });
        const widget = await createWidgetFromPrompt(prompt);
        return NextResponse.json({ widget, widgets: listWidgets() }, { status: 201 });
      }

      case "blank": {
        if (listWidgets().length >= WIDGET_LIMITS.maxWidgets) {
          return NextResponse.json({ error: `widget limit (${WIDGET_LIMITS.maxWidgets}) reached` }, { status: 400 });
        }
        const kind = WIDGET_KINDS.includes(body.kind as WidgetKind) ? (body.kind as WidgetKind) : "checklist";
        const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "New widget";
        const widget = normalizeWidget({ title, kind, accent: "cyan", items: [] }, "New widget");
        putWidget(widget);
        return NextResponse.json({ widget, widgets: listWidgets() }, { status: 201 });
      }

      case "update": {
        const incoming = body.widget as Record<string, unknown> | undefined;
        if (!incoming || typeof incoming !== "object") {
          return NextResponse.json({ error: "widget required" }, { status: 400 });
        }
        const existing = typeof incoming.id === "string" ? getWidget(incoming.id) : undefined;
        if (!existing) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        const next: typeof existing = {
          ...existing,
          ...(typeof incoming.title === "string"
            ? { title: incoming.title.replace(/\s+/g, " ").trim().slice(0, WIDGET_LIMITS.maxTitle) || existing.title }
            : {}),
          ...(typeof incoming.subtitle === "string" ? { subtitle: incoming.subtitle.slice(0, 80) } : {}),
          ...(WIDGET_KINDS.includes(incoming.kind as WidgetKind) ? { kind: incoming.kind as WidgetKind } : {}),
          ...(WIDGET_ACCENTS.includes(incoming.accent as WidgetAccent) ? { accent: incoming.accent as WidgetAccent } : {}),
          ...(typeof incoming.icon === "string" ? { icon: incoming.icon.slice(0, 24) } : {}),
          ...(typeof incoming.body === "string" ? { body: incoming.body.slice(0, 2000) } : {}),
          ...(Array.isArray(incoming.items) ? { items: normalizeItems(incoming.items) } : {}),
          ...(incoming.source && typeof incoming.source === "object"
            ? { source: normalizeSource(incoming.source) as WidgetSource }
            : {}),
          updatedAt: Date.now(),
        };
        putWidget(next);
        return NextResponse.json({ widget: next });
      }

      case "delete": {
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const ok = removeWidget(id);
        return NextResponse.json({ ok, widgets: listWidgets() });
      }

      case "refresh": {
        if (id) {
          const widget = await refreshWidgetById(id);
          if (!widget) return NextResponse.json({ error: "widget not found" }, { status: 404 });
          return NextResponse.json({ widget, widgets: listWidgets() });
        }
        return NextResponse.json({ widgets: await refreshAllWidgets() });
      }

      case "item-add": {
        const w = getWidget(id);
        if (!w) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        const label = typeof body.label === "string" ? body.label.trim().slice(0, WIDGET_LIMITS.maxLabel) : "";
        if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
        if (w.items.length >= WIDGET_LIMITS.maxItems) {
          return NextResponse.json({ error: `item limit (${WIDGET_LIMITS.maxItems}) reached` }, { status: 400 });
        }
        const value = typeof body.value === "string" ? body.value.trim().slice(0, 40) : "";
        w.items = [...w.items, { id: newItemId(), label, ...(value ? { value } : {}) }];
        w.updatedAt = Date.now();
        putWidget(w);
        return NextResponse.json({ widget: w });
      }

      case "item-update": {
        const w = getWidget(id);
        if (!w) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        const itemId = typeof body.itemId === "string" ? body.itemId : "";
        const item = w.items.find((i) => i.id === itemId);
        if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });
        if (typeof body.label === "string") {
          const label = body.label.replace(/\s+/g, " ").trim().slice(0, WIDGET_LIMITS.maxLabel);
          if (label) item.label = label;
        }
        if (typeof body.value === "string") {
          const value = body.value.trim().slice(0, 40);
          if (value) item.value = value;
          else delete item.value;
        }
        if (typeof body.done === "boolean") item.done = body.done;
        w.updatedAt = Date.now();
        putWidget(w);
        return NextResponse.json({ widget: w });
      }

      case "item-move": {
        const w = getWidget(id);
        if (!w) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        const itemId = typeof body.itemId === "string" ? body.itemId : "";
        const from = w.items.findIndex((i) => i.id === itemId);
        const to = from + (Number(body.delta) < 0 ? -1 : 1);
        if (from >= 0 && to >= 0 && to < w.items.length) {
          const [moved] = w.items.splice(from, 1);
          w.items.splice(to, 0, moved);
          w.updatedAt = Date.now();
          putWidget(w);
        }
        return NextResponse.json({ widget: w });
      }

      case "items-clear": {
        const w = getWidget(id);
        if (!w) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        w.items = [];
        w.updatedAt = Date.now();
        putWidget(w);
        return NextResponse.json({ widget: w });
      }

      case "item-toggle": {
        const w = getWidget(id);
        if (!w) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        const itemId = typeof body.itemId === "string" ? body.itemId : "";
        const item = w.items.find((i) => i.id === itemId);
        if (!item) return NextResponse.json({ error: "item not found" }, { status: 404 });
        item.done = !item.done;
        w.updatedAt = Date.now();
        putWidget(w);
        return NextResponse.json({ widget: w });
      }

      case "item-remove": {
        const w = getWidget(id);
        if (!w) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        const itemId = typeof body.itemId === "string" ? body.itemId : "";
        w.items = w.items.filter((i) => i.id !== itemId);
        w.updatedAt = Date.now();
        putWidget(w);
        return NextResponse.json({ widget: w });
      }

      case "counter": {
        const w = getWidget(id);
        if (!w) return NextResponse.json({ error: "widget not found" }, { status: 404 });
        const delta = Number(body.delta);
        const step = Number.isFinite(delta) && delta !== 0 ? Math.trunc(delta) : 1;
        const first = w.items[0] ?? { id: "c1", label: "Count", value: "0" };
        const current = Number.parseInt(String(first.value ?? "0").replace(/[^\d-]/g, ""), 10) || 0;
        first.value = String(Math.max(0, current + step));
        w.items = [first, ...w.items.slice(1)];
        w.updatedAt = Date.now();
        putWidget(w);
        return NextResponse.json({ widget: w });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
