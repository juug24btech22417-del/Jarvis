"use client";

// Widget renderer — the fixed primitives that turn a WidgetSpec into UI.
//
// Two sizes: "full" (in the Widgets panel, editable) and "rail" (compact,
// read-only glanceable cards that live on the HUD). Everything is driven by
// the JSON spec, so a widget generated from a sentence renders the same way as
// one you typed by hand.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Check, Loader2, Minus, Pencil, Plus, RefreshCw, Trash2, X, Radio } from "lucide-react";
import {
  WIDGET_ACCENTS,
  WIDGET_KINDS,
  WIDGET_SOURCE_TYPES,
  type WidgetAccent,
  type WidgetKind,
  type WidgetSource,
  type WidgetSpec,
} from "@/lib/widgets/spec";

/** Shared look for every field in the inline editor. */
const IN =
  "w-full bg-white/[0.04] border border-white/10 rounded-lg px-2 py-1 text-[10px] font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-white/25";

const ACCENT: Record<string, { c: string; soft: string; border: string }> = {
  cyan: { c: "#00f3ff", soft: "rgba(0,243,255,0.10)", border: "rgba(0,243,255,0.35)" },
  violet: { c: "#a78bfa", soft: "rgba(167,139,250,0.10)", border: "rgba(167,139,250,0.35)" },
  amber: { c: "#fbbf24", soft: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.35)" },
  green: { c: "#34d399", soft: "rgba(52,211,153,0.10)", border: "rgba(52,211,153,0.35)" },
  rose: { c: "#fb7185", soft: "rgba(251,113,133,0.10)", border: "rgba(251,113,133,0.35)" },
};

export interface WidgetCardProps {
  widget: WidgetSpec;
  size?: "full" | "rail";
  onChange?: (w: WidgetSpec) => void;
  onDelete?: (id: string) => void;
}

export default function WidgetCard({ widget, size = "full", onChange, onDelete }: WidgetCardProps) {
  const a = ACCENT[widget.accent] ?? ACCENT.cyan;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState("");
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(widget.body ?? "");
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setBody(widget.body ?? ""), [widget.id, widget.body]);

  const post = async (payload: Record<string, unknown>): Promise<WidgetSpec | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/widgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const next: WidgetSpec | undefined = data.widget;
      if (next && onChange) onChange(next);
      return next ?? null;
    } catch {
      return null;
    } finally {
      setBusy(false);
    }
  };

  const live = (widget.source?.type ?? "manual") !== "manual";
  const nav = size === "rail";

  /* ── editing ───────────────────────────────────────────────── */
  /** Everything on a widget is editable: fields patch in place, items use
   *  dedicated actions so ids and tick state survive each round-trip. */
  const patch = (fields: Partial<WidgetSpec>) =>
    void post({ action: "update", widget: { id: widget.id, ...fields } });

  const patchSource = (fields: Partial<WidgetSource>) =>
    patch({ source: { ...widget.source, ...fields } });

  const commitOnEnter = (e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  const addRow = (value?: string) => {
    const label = (value ?? adding).trim();
    if (!label) return;
    void post({ action: "item-add", id: widget.id, label });
    setAdding("");
  };

  const saveBody = (value: string) => {
    setBody(value);
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
    bodyTimer.current = setTimeout(() => {
      void post({ action: "update", widget: { id: widget.id, body: value } });
    }, 700);
  };

  /* ── body renderers ─────────────────────────────────────────── */

  const checklist = (
    <div className="space-y-1">
      {widget.items.length === 0 && <div className="text-[10px] text-text-secondary/40">Nothing yet — add one below.</div>}
      {widget.items.map((item) => (
        <div key={item.id} className="group flex items-center gap-2">
          <button
            onClick={() => void post({ action: "item-toggle", id: widget.id, itemId: item.id })}
            className="flex-shrink-0 w-4 h-4 rounded-[5px] border flex items-center justify-center transition-colors"
            style={{ borderColor: item.done ? a.border : "rgba(255,255,255,0.25)", background: item.done ? a.soft : "transparent" }}
            title={item.done ? "Mark as not done" : "Mark as done"}
          >
            {item.done && <Check className="w-2.5 h-2.5" style={{ color: a.c }} />}
          </button>
          <span className={`flex-1 truncate text-[11px] font-rajdhani ${item.done ? "text-text-secondary/45 line-through" : "text-text-primary/90"}`}>
            {item.label}
          </span>
          {item.value && <span className="text-[10px] font-mono text-text-secondary/60">{item.value}</span>}
          <button
            onClick={() => void post({ action: "item-remove", id: widget.id, itemId: item.id })}
            className="text-text-secondary/35 hover:text-accent-red transition-colors"
            title="Remove this row"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );

  const list = (
    <div className="space-y-1">
      {widget.items.length === 0 && <div className="text-[10px] text-text-secondary/40">{live ? "Waiting for data…" : "Nothing yet."}</div>}
      {widget.items.slice(0, nav ? 4 : 12).map((item) => (
        <div key={item.id} className="group flex items-center gap-2">
          <span className="flex-1 truncate text-[11px] font-rajdhani text-text-primary/90" title={item.label}>
            {item.label}
          </span>
          {item.value && (
            <span className="flex-shrink-0 text-[11px] font-mono" style={{ color: a.c }}>
              {item.value}
            </span>
          )}
          {!nav && (
            <button
              onClick={() => void post({ action: "item-remove", id: widget.id, itemId: item.id })}
              className="text-text-secondary/30 hover:text-accent-red transition-colors"
              title="Remove this row"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );

  const bars = (
    <div className="space-y-2">
      {widget.items.slice(0, nav ? 3 : 10).map((item) => {
        const nums = widget.items.map((i) => Number.parseFloat(String(i.value ?? "0").replace(/[^\d.]/g, "")) || 0);
        const max = Math.max(1, ...nums);
        const n = Number.parseFloat(String(item.value ?? "0").replace(/[^\d.]/g, "")) || 0;
        const pct = Math.max(6, Math.round((n / max) * 100));
        return (
          <div key={item.id} className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-[10px] font-rajdhani text-text-primary/85">{item.label}</span>
              <span className="text-[10px] font-mono" style={{ color: a.c }}>{item.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${pct}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${a.c}, rgba(255,255,255,0.6))` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );

  const stat = (
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-orbitron" style={{ color: a.c }}>
        {widget.items[0]?.value ?? "—"}
      </span>
      <span className="text-[10px] uppercase tracking-widest text-text-secondary/60">{widget.items[0]?.label ?? ""}</span>
    </div>
  );

  const counter = (
    <div className="flex items-center gap-3">
      <button
        onClick={() => void post({ action: "counter", id: widget.id, delta: -1 })}
        className="w-7 h-7 rounded-full border border-white/15 hover:border-white/35 flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
      >
        <Minus className="w-3 h-3" />
      </button>
      <div className="text-center min-w-[64px]">
        <div className="text-2xl font-orbitron" style={{ color: a.c }}>
          {widget.items[0]?.value ?? "0"}
        </div>
        <div className="text-[9px] uppercase tracking-widest text-text-secondary/55">{widget.items[0]?.label ?? ""}</div>
      </div>
      <button
        onClick={() => void post({ action: "counter", id: widget.id, delta: 1 })}
        className="w-7 h-7 rounded-full border flex items-center justify-center transition-colors"
        style={{ borderColor: a.border, background: a.soft, color: a.c }}
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );

  const text = (
    <textarea
      value={body}
      onChange={(e) => saveBody(e.target.value)}
      placeholder="Type anything — it saves as you write."
      rows={nav ? 2 : 4}
      className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-white/25 resize-none"
    />
  );

  const bodyNode =
    widget.kind === "checklist" ? checklist
    : widget.kind === "bars" ? bars
    : widget.kind === "stat" ? stat
    : widget.kind === "counter" ? counter
    : widget.kind === "text" ? text
    : list;

  return (
    <div
      className="relative rounded-2xl border backdrop-blur-md overflow-hidden"
      style={{ borderColor: "rgba(255,255,255,0.09)", background: `linear-gradient(160deg, ${a.soft}, rgba(8,12,20,0.55))` }}
    >
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${a.c}, transparent)`, opacity: 0.6 }} />

      <header className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: a.c, boxShadow: `0 0 10px ${a.c}` }} />
        <div className="min-w-0 flex-1">
          <div className={`font-orbitron uppercase tracking-wider truncate ${nav ? "text-[9px]" : "text-[10px]"}`} style={{ color: a.c }}>
            {widget.title}
          </div>
          {widget.subtitle && !nav && (
            <div className="text-[9px] font-rajdhani text-text-secondary/50 truncate">{widget.subtitle}</div>
          )}
        </div>
        {live && (
          <span
            className="flex-shrink-0 flex items-center gap-1 text-[8px] font-rajdhani uppercase tracking-wider px-1.5 py-0.5 rounded-full border"
            style={{ borderColor: a.border, color: a.c }}
            title={widget.lastError ? `Last refresh failed: ${widget.lastError}` : "Live source"}
          >
            <Radio className="w-2 h-2" /> live
          </span>
        )}
        {!nav && live && (
          <button onClick={() => void post({ action: "refresh", id: widget.id })} className="text-text-secondary/50 hover:text-text-primary" title="Refresh now">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          </button>
        )}
        {!nav && (
          <button
            onClick={() => setEditing((v) => !v)}
            className={editing ? "text-reactor-core" : "text-text-secondary/50 hover:text-text-primary"}
            title={editing ? "Hide the editor" : "Edit everything on this widget"}
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
        {!nav && onDelete && (
          <button onClick={() => onDelete(widget.id)} className="text-text-secondary/40 hover:text-accent-red" title="Delete widget">
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </header>

      <div className={`px-3 pb-2.5 ${nav ? "pt-0.5" : "pt-1"}`}>{bodyNode}</div>

      {!nav && widget.lastError && (
        <div className="px-3 pb-2 text-[9px] font-rajdhani text-accent-amber/80">⚠ {widget.lastError}</div>
      )}

      {!nav && widget.kind !== "text" && widget.kind !== "stat" && widget.kind !== "counter" && (
        <div className="px-3 pb-3 flex items-center gap-2">
          <input
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRow();
            }}
            placeholder="Add an item…"
            className={IN}
          />
          <button
            onClick={() => addRow()}
            className="px-2 py-1 rounded-lg border text-[9px] font-rajdhani uppercase tracking-wider"
            style={{ borderColor: a.border, color: a.c }}
          >
            add
          </button>
        </div>
      )}

      {!nav && editing && (
        <div className="mx-3 mb-3 space-y-2.5 rounded-xl border border-white/10 bg-black/35 p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block text-[8px] uppercase tracking-widest text-text-secondary/55">Title</span>
              <input defaultValue={widget.title} onBlur={(e) => patch({ title: e.target.value })} onKeyDown={commitOnEnter} className={IN} />
            </label>
            <label className="space-y-1">
              <span className="block text-[8px] uppercase tracking-widest text-text-secondary/55">Subtitle</span>
              <input
                defaultValue={widget.subtitle ?? ""}
                placeholder="optional"
                onBlur={(e) => patch({ subtitle: e.target.value })}
                onKeyDown={commitOnEnter}
                className={IN}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-[8px] uppercase tracking-widest text-text-secondary/55">Kind</span>
              <select value={widget.kind} onChange={(e) => patch({ kind: e.target.value as WidgetKind })} className={IN}>
                {WIDGET_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            <div className="space-y-1">
              <span className="block text-[8px] uppercase tracking-widest text-text-secondary/55">Accent</span>
              <div className="flex gap-1.5 pt-1">
                {WIDGET_ACCENTS.map((acc) => (
                  <button
                    key={acc}
                    onClick={() => patch({ accent: acc as WidgetAccent })}
                    title={acc}
                    className={`w-4 h-4 rounded-full border transition-transform ${
                      widget.accent === acc ? "scale-110 ring-2 ring-white/45" : "opacity-70 hover:opacity-100"
                    }`}
                    style={{ background: ACCENT[acc].c, borderColor: ACCENT[acc].border }}
                  />
                ))}
              </div>
            </div>
            <label className="space-y-1">
              <span className="block text-[8px] uppercase tracking-widest text-text-secondary/55">Data</span>
              <select
                value={widget.source?.type ?? "manual"}
                onChange={(e) => patchSource({ type: e.target.value as WidgetSource["type"] })}
                className={IN}
              >
                {WIDGET_SOURCE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t === "manual" ? "typed by me" : t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {widget.source?.type === "api" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="col-span-2 space-y-1">
                <span className="block text-[8px] uppercase tracking-widest text-text-secondary/55">JSON URL (https)</span>
                <input
                  defaultValue={widget.source.url ?? ""}
                  placeholder="https://api.example.com/data.json"
                  onBlur={(e) => patchSource({ url: e.target.value.trim() })}
                  onKeyDown={commitOnEnter}
                  className={IN}
                />
              </label>
              {(([
                ["path", widget.source.path, "data.items"],
                ["labelKey", widget.source.labelKey, "name"],
                ["valueKey", widget.source.valueKey, "price"],
              ]) as const).map(([key, val, placeholder]) => (
                <label key={key} className="space-y-1">
                  <span className="block text-[8px] uppercase tracking-widest text-text-secondary/55">{key}</span>
                  <input
                    defaultValue={val ?? ""}
                    placeholder={placeholder}
                    onBlur={(e) => patchSource({ [key]: e.target.value.trim() } as Partial<WidgetSource>)}
                    onKeyDown={commitOnEnter}
                    className={IN}
                  />
                </label>
              ))}
            </div>
          )}
          {widget.source?.type !== "manual" && (
            <p className="text-[9px] font-rajdhani text-text-secondary/50">
              Live rows get replaced on refresh — set Data to “typed by me” to keep your own rows.
            </p>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[8px] uppercase tracking-widest text-text-secondary/55">Rows · {widget.items.length}</span>
              {widget.items.length > 0 && (
                <button
                  onClick={() => void post({ action: "items-clear", id: widget.id })}
                  className="text-[9px] font-rajdhani text-text-secondary/50 hover:text-accent-red"
                >
                  remove all
                </button>
              )}
            </div>
            {widget.items.map((item, i) => (
              <div key={item.id} className="flex items-center gap-1.5">
                <input
                  defaultValue={item.label}
                  onBlur={(e) => void post({ action: "item-update", id: widget.id, itemId: item.id, label: e.target.value })}
                  onKeyDown={commitOnEnter}
                  className={`flex-1 ${IN}`}
                />
                <input
                  defaultValue={item.value ?? ""}
                  placeholder="value"
                  onBlur={(e) => void post({ action: "item-update", id: widget.id, itemId: item.id, value: e.target.value })}
                  onKeyDown={commitOnEnter}
                  className={`w-16 ${IN}`}
                />
                <button
                  onClick={() => void post({ action: "item-move", id: widget.id, itemId: item.id, delta: -1 })}
                  disabled={i === 0}
                  className="text-text-secondary/45 hover:text-text-primary disabled:opacity-20"
                  title="Move up"
                >
                  <ArrowUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => void post({ action: "item-move", id: widget.id, itemId: item.id, delta: 1 })}
                  disabled={i === widget.items.length - 1}
                  className="text-text-secondary/45 hover:text-text-primary disabled:opacity-20"
                  title="Move down"
                >
                  <ArrowDown className="w-3 h-3" />
                </button>
                <button
                  onClick={() => void post({ action: "item-remove", id: widget.id, itemId: item.id })}
                  className="text-text-secondary/45 hover:text-accent-red"
                  title="Remove row"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <input
                value={adding}
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addRow();
                }}
                placeholder="Add a row…"
                className={`flex-1 ${IN}`}
              />
              <button
                onClick={() => addRow()}
                className="px-2 py-1 rounded-lg border text-[9px] font-rajdhani uppercase tracking-wider"
                style={{ borderColor: a.border, color: a.c }}
              >
                add
              </button>
            </div>
          </div>

          <button
            onClick={() => setEditing(false)}
            className="w-full rounded-lg border border-white/10 bg-white/[0.04] py-1.5 text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/80 hover:text-text-primary"
          >
            done editing
          </button>
        </div>
      )}
    </div>
  );
}
