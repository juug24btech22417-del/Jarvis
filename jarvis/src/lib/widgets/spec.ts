// Natural-language widgets — pure spec layer.
//
// A widget is a small JSON document: a title, a kind, and items. It can be
// fully manual (a checklist you tick), or backed by a live source (a JSON API,
// the task list, the notes folder). The LLM only ever produces this JSON; the
// renderer is a fixed, boring set of primitives — that's what keeps "build me
// a panel that tracks X" from turning into arbitrary generated UI.
//
// Everything here is pure so the normalisation rules are unit-testable.

export const WIDGET_KINDS = ["stat", "list", "bars", "checklist", "counter", "text"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const WIDGET_ACCENTS = ["cyan", "violet", "amber", "green", "rose"] as const;
export type WidgetAccent = (typeof WIDGET_ACCENTS)[number];

export const WIDGET_SOURCE_TYPES = ["manual", "api", "tasks", "notes"] as const;
export type WidgetSourceType = (typeof WIDGET_SOURCE_TYPES)[number];

export interface WidgetItem {
  id: string;
  label: string;
  value?: string;
  done?: boolean;
  url?: string;
}

export interface WidgetSource {
  type: WidgetSourceType;
  /** Absolute URL for `api` sources. */
  url?: string;
  /** Dot path to the collection inside the JSON payload, e.g. "data.items". */
  path?: string;
  /** Key to use as the label / value when the payload is an array of objects. */
  labelKey?: string;
  valueKey?: string;
  refreshSeconds?: number;
}

export interface WidgetSpec {
  id: string;
  title: string;
  subtitle?: string;
  kind: WidgetKind;
  accent: WidgetAccent;
  icon?: string;
  items: WidgetItem[];
  /** Free text for `text` widgets (scratchpad / journal). */
  body?: string;
  source: WidgetSource;
  createdAt: number;
  updatedAt: number;
  /** Last refresh outcome, surfaced in the card (never fatal). */
  lastRefreshed?: number;
  lastError?: string;
}

export const WIDGET_LIMITS = {
  maxWidgets: 24,
  maxItems: 20,
  maxLabel: 90,
  maxTitle: 60,
} as const;

let counter = 0;
function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function newWidgetId(): string {
  return uid("w");
}

export function newItemId(): string {
  return uid("i");
}

/* ----------------------------- normalisation ----------------------------- */

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Coerce whatever the LLM produced into items the renderer understands. */
export function normalizeItems(raw: unknown): WidgetItem[] {
  if (!Array.isArray(raw)) return [];
  const items: WidgetItem[] = [];
  for (const entry of raw) {
    if (entry == null) continue;
    if (typeof entry === "string" || typeof entry === "number") {
      const label = str(String(entry), WIDGET_LIMITS.maxLabel);
      if (label) items.push({ id: uid("i"), label });
    } else if (typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      const label = str(o.label ?? o.title ?? o.name ?? o.text ?? o.item, WIDGET_LIMITS.maxLabel);
      if (!label) continue;
      const value = str(o.value ?? o.amount ?? o.price ?? o.status, 40);
      const url = typeof o.url === "string" && /^https?:/.test(o.url) ? o.url : undefined;
      items.push({
        id: uid("i"),
        label,
        ...(value ? { value } : {}),
        ...(typeof o.done === "boolean" ? { done: o.done } : {}),
        ...(url ? { url } : {}),
      });
    }
    if (items.length >= WIDGET_LIMITS.maxItems) break;
  }
  return items;
}

export function normalizeSource(raw: unknown): WidgetSource {
  if (!raw || typeof raw !== "object") return { type: "manual" };
  const o = raw as Record<string, unknown>;
  let type: WidgetSourceType = WIDGET_SOURCE_TYPES.includes(o.type as WidgetSourceType)
    ? (o.type as WidgetSourceType)
    : "manual";
  const url = typeof o.url === "string" && /^https?:\/\//.test(o.url) ? o.url : undefined;
  // An api source with no URL can never refresh — treat it as manual.
  if (type === "api" && !url) type = "manual";
  const refreshSeconds = Number(o.refreshSeconds);
  return {
    type,
    ...(url ? { url } : {}),
    ...(str(o.path, 80) ? { path: str(o.path, 80) } : {}),
    ...(str(o.labelKey, 40) ? { labelKey: str(o.labelKey, 40) } : {}),
    ...(str(o.valueKey, 40) ? { valueKey: str(o.valueKey, 40) } : {}),
    ...(Number.isFinite(refreshSeconds) && refreshSeconds >= 30 ? { refreshSeconds: Math.min(refreshSeconds, 86_400) } : {}),
  };
}

/**
 * Turn arbitrary LLM JSON into a valid widget. Repairs instead of rejecting:
 * unknown kind → list, unknown accent → cyan, missing title → fallback.
 */
export function normalizeWidget(raw: unknown, fallbackTitle = "Untitled widget"): WidgetSpec {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = WIDGET_KINDS.includes(o.kind as WidgetKind) ? (o.kind as WidgetKind) : "list";
  const accent = WIDGET_ACCENTS.includes(o.accent as WidgetAccent) ? (o.accent as WidgetAccent) : "cyan";
  const now = Date.now();
  let items = normalizeItems(o.items ?? o.data ?? o.entries);
  const source = normalizeSource(o.source);

  // A counter/stat/text widget with no items still needs a seed so the card
  // has something to render.
  if (items.length === 0 && (kind === "counter" || kind === "stat")) {
    const value = str(o.value ?? o.count, 24) || "0";
    items = [{ id: uid("i"), label: str(o.unit ?? o.label, 40) || "Count", value }];
  }

  return {
    id: typeof o.id === "string" && o.id ? o.id : newWidgetId(),
    title: str(o.title ?? o.name, WIDGET_LIMITS.maxTitle) || fallbackTitle,
    ...(str(o.subtitle ?? o.description, 80) ? { subtitle: str(o.subtitle ?? o.description, 80) } : {}),
    kind,
    accent,
    ...(str(o.icon, 24) ? { icon: str(o.icon, 24) } : {}),
    items,
    ...(typeof (o.body ?? o.text) === "string" ? { body: String(o.body ?? o.text).slice(0, 2000) } : {}),
    source,
    createdAt: now,
    updatedAt: now,
  };
}

/* ----------------------------- live payloads ----------------------------- */

/** Resolve a dot path ("data.items") inside a decoded JSON payload. */
export function parsePath(payload: unknown, path?: string): unknown {
  if (!path) return payload;
  let cur: unknown = payload;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function primitive(v: unknown): string | undefined {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  if (typeof v === "string" && v.trim() && v.length < 40) return v.trim();
  return undefined;
}

/**
 * Turn any reasonable JSON payload into widget items:
 *   • [{name, price}]        → label/value rows
 *   • {bitcoin: {inr: 123}}  → label/value rows from the nested dict
 *   • ["a","b"]              → plain rows
 */
export function flattenSourcePayload(payload: unknown, source: WidgetSource): WidgetItem[] {
  const collection = parsePath(payload, source.path);
  const items: WidgetItem[] = [];

  const push = (label: string, value?: string) => {
    if (!label || items.length >= WIDGET_LIMITS.maxItems) return;
    items.push({ id: uid("i"), label: label.slice(0, WIDGET_LIMITS.maxLabel), ...(value ? { value } : {}) });
  };

  if (Array.isArray(collection)) {
    for (const entry of collection) {
      if (entry == null) continue;
      if (typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        const label = source.labelKey
          ? String(o[source.labelKey] ?? "")
          : String(o.label ?? o.title ?? o.name ?? o.symbol ?? o.id ?? "");
        const value = source.valueKey
          ? primitive(o[source.valueKey])
          : primitive(o.value ?? o.price ?? o.amount ?? o.count ?? o.total ?? o.status);
        if (label) push(label, value);
      } else {
        push(String(entry));
      }
      if (items.length >= WIDGET_LIMITS.maxItems) break;
    }
    return items;
  }

  if (collection && typeof collection === "object") {
    // {bitcoin: {inr: 5000000}, ethereum: {...}} → one row per key.
    for (const [key, val] of Object.entries(collection as Record<string, unknown>)) {
      if (val && typeof val === "object") {
        const inner = Object.entries(val as Record<string, unknown>);
        const nestedKey = source.valueKey ?? inner[0]?.[0];
        const nestedVal = source.valueKey ? (val as Record<string, unknown>)[source.valueKey] : inner[0]?.[1];
        push(key, primitive(nestedVal) ?? (nestedKey ? `${nestedKey}: ${String(nestedVal)}` : undefined));
      } else {
        push(key, primitive(val));
      }
      if (items.length >= WIDGET_LIMITS.maxItems) break;
    }
  }
  return items;
}

/* ----------------------------- heuristics ----------------------------- */

/** Live API sources for the things people actually ask to track. */
export function guessApiSource(prompt: string): WidgetSource | null {
  const p = prompt.toLowerCase();
  if (/\b(crypto|bitcoin|btc|ethereum|eth|solana|coin)\b/.test(p)) {
    const ids = [
      ...(/\b(bitcoin|btc)\b/.test(p) ? ["bitcoin"] : []),
      ...(/\b(ethereum|eth)\b/.test(p) ? ["ethereum"] : []),
      ...(/\b(solana|sol)\b/.test(p) ? ["solana"] : []),
    ];
    const wanted = ids.length
      ? ids
      : ["bitcoin", "ethereum", "solana"];
    const currency = /\$|usd|dollar/.test(p) ? "usd" : "inr";
    return {
      type: "api",
      url: `https://api.coingecko.com/api/v3/simple/price?ids=${wanted.join(",")}&vs_currencies=${currency}`,
      refreshSeconds: 120,
      valueKey: currency,
    };
  }
  return null;
}

/**
 * No-LLM fallback (and the shape the LLM is asked to imitate): build a
 * sensible, editable widget straight from the prompt.
 */
export function heuristicWidget(prompt: string): WidgetSpec {
  const p = (prompt || "").toLowerCase();
  const api = guessApiSource(prompt);

  if (api) {
    const title = /\bprice|cost\b/.test(p) ? "Crypto prices" : "Crypto tracker";
    return normalizeWidget(
      {
        title,
        subtitle: "live via CoinGecko",
        kind: "list",
        accent: "green",
        source: api,
        items: [],
      },
      title
    );
  }

  if (/\b(note|notes|reading|articles?)\b/.test(p)) {
    return normalizeWidget({ title: "Recent notes", kind: "list", accent: "violet", source: { type: "notes" }, items: [] }, "Recent notes");
  }

  if (/\b(task|tasks|todo|assignment|homework|deadline)\b/.test(p)) {
    return normalizeWidget(
      {
        title: /\bassignment|homework|deadline\b/.test(p) ? "Assignments" : "Tasks",
        subtitle: "from your task list",
        kind: "checklist",
        accent: "amber",
        source: { type: "tasks" },
        items: [],
      },
      "Tasks"
    );
  }

  if (/\b(water|habit|streak|counter|steps|reps|pages)\b/.test(p)) {
    return normalizeWidget(
      { title: "Daily counter", kind: "counter", accent: "cyan", items: [{ label: "Today", value: "0" }] },
      "Daily counter"
    );
  }

  if (/\b(journal|log|scratch|idea|brain ?dump)\b/.test(p)) {
    return normalizeWidget({ title: "Scratchpad", kind: "text", accent: "rose", items: [] }, "Scratchpad");
  }

  // Default: an editable checklist the user can fill and tick.
  return normalizeWidget(
    {
      title: prompt ? prompt.replace(/^(?:build|make|create|add|generate|give me)\b[^a-z0-9]*/i, "").slice(0, 48) || "Checklist" : "Checklist",
      kind: "checklist",
      accent: "cyan",
      items: [],
    },
    "Checklist"
  );
}
