"use client";

// Zotero tab — the user's own library, highlights included.
//
// Prefers Zotero's LOCAL API (the desktop app serves it on 127.0.0.1:23119),
// which needs no API key and keeps the library on the machine. The panel is
// explicit about which source answered, because "it works but only when the
// desktop app is open" is exactly the kind of thing that looks like a bug
// later.

import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, Search, RefreshCw, Highlighter, FolderOpen, AlertTriangle, ExternalLink, Cloud, HardDrive, Play } from "lucide-react";

async function post(body: unknown, timeoutMs = 60_000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return res.json();
  } catch (err) {
    return { success: false, error: (err as Error).name === "AbortError" ? "Zotero request timed out." : (err as Error).message };
  } finally {
    clearTimeout(t);
  }
}

const glassCard =
  "rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]";
const input =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-cyan-400/60 focus:bg-black/40 focus:ring-2 focus:ring-cyan-400/20";
const btn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500/90 px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40";
const ghost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-white/80 transition hover:border-cyan-400/40 hover:bg-white/[0.07] hover:text-white disabled:opacity-40";

type Item = {
  key: string;
  itemType: string;
  title: string;
  creators: string[];
  date: string | null;
  publication: string | null;
  doi: string | null;
  url: string | null;
  tags: string[];
  abstractNote: string | null;
};

export default function ZoteroTab() {
  const [status, setStatus] = useState<any>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [annotations, setAnnotations] = useState<{ key: string; list: any[] } | null>(null);

  const loadStatus = useCallback(async () => {
    const json = await post({ mcp: "zotero", action: "status" });
    if (json.success) setStatus(json.data);
    else setError(json.error);
  }, []);

  const loadItems = useCallback(async (q?: string) => {
    setBusy(true);
    setError(null);
    try {
      const json = q
        ? await post({ mcp: "zotero", action: "search", params: { query: q, limit: 25 } })
        : await post({ mcp: "zotero", action: "items", params: { limit: 25 } });
      if (json.success) setItems(json.data.items ?? []);
      else setError(json.error);
    } finally {
      setBusy(false);
    }
  }, []);

  const loadCollections = async () => {
    const json = await post({ mcp: "zotero", action: "collections" });
    if (json.success) setCollections(json.data.collections ?? []);
    else setError(json.error);
  };

  // Starting the desktop app is the one step the user cannot take from here,
  // and the only reason key-free local mode fails on a machine that has Zotero
  // installed — so the panel does it (and reports what happened).
  const startZotero = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await post({ mcp: "zotero", action: "launch" }, 90_000);
      if (!json.success) {
        setError(json.error);
        return;
      }
      if (json.data?.reachable) {
        await loadStatus();
        await loadItems();
      } else {
        await loadStatus();
        setError(json.data?.error || "Zotero started but its local API did not answer yet.");
      }
    } finally {
      setBusy(false);
    }
  };

  const loadAnnotations = async (key: string) => {
    setBusy(true);
    setError(null);
    try {
      const json = await post({ mcp: "zotero", action: "annotations", params: { key } });
      if (json.success) setAnnotations({ key, list: json.data.annotations ?? [] });
      else setError(json.error);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    void loadItems();
  }, [loadStatus, loadItems]);

  const source = status?.activeSource;
  const localReachable = status?.local?.reachable;

  return (
    <div className="space-y-5">
      <div className={`${glassCard} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-400/15 ring-1 ring-rose-400/30">
              <BookOpen className="h-5 w-5 text-rose-300" />
            </span>
            <div>
              <h2 className="text-base font-semibold">Zotero library</h2>
              <p className="text-xs text-white/45">
                {source === "local"
                  ? "Reading the local library — no API key, nothing leaves this machine"
                  : source === "cloud"
                    ? "Reading the cloud library via ZOTERO_API_KEY"
                    : "No source reachable"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] ${
                localReachable ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-white/10 bg-white/[0.04] text-white/50"
              }`}
            >
              <HardDrive className="h-3.5 w-3.5" /> local {localReachable ? "online" : "offline"}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] ${
                status?.cloud?.configured ? "border-cyan-400/25 bg-cyan-500/10 text-cyan-200" : "border-white/10 bg-white/[0.04] text-white/50"
              }`}
            >
              <Cloud className="h-3.5 w-3.5" /> cloud key {status?.cloud?.configured ? "set" : "unset"}
            </span>
            {status && !localReachable && (
              <button
                type="button"
                className={btn}
                onClick={() => {
                  // Nothing to launch if Zotero was never installed — send the
                  // user to the one thing that fixes it instead of an error.
                  if (status.app?.installed) void startZotero();
                  else window.open("https://www.zotero.org/download/", "_blank", "noopener");
                }}
                disabled={busy}
              >
                <Play className="h-4 w-4" /> {status.app?.installed ? "Start Zotero" : "Get Zotero"}
              </button>
            )}
            <button type="button" className={ghost} onClick={() => { void loadStatus(); void loadItems(query); }} disabled={busy}>
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>

        {!localReachable && status && (
          <div className="mt-3 space-y-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-100">
            <p>{status.local?.error || "Zotero desktop app not detected."} {status.hint}</p>
            {!status.app?.installed && (
              <a
                href="https://www.zotero.org/download/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-medium text-amber-50 underline decoration-amber-200/40 underline-offset-2 hover:decoration-amber-100"
              >
                Download Zotero (free) <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}
      </div>

      <div className={`${glassCard} space-y-3 p-6`}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${input} flex-1 min-w-[220px]`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void loadItems(query.trim() || undefined);
            }}
            placeholder="Search your library (title, author, tag, note…)"
          />
          <button type="button" className={btn} onClick={() => loadItems(query.trim() || undefined)} disabled={busy}>
            <Search className="h-4 w-4" /> Search
          </button>
          <button type="button" className={ghost} onClick={loadCollections} disabled={busy}>
            <FolderOpen className="h-4 w-4" /> Collections
          </button>
        </div>

        {collections.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {collections.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => loadItems(c.name)}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/70 transition hover:border-cyan-400/40 hover:text-white"
              >
                {c.name}
                {c.itemCount != null && <span className="ml-1.5 text-white/35">{c.itemCount}</span>}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-pre-wrap break-words">{error}</span>
          </div>
        )}

        <div className="max-h-[460px] space-y-2 overflow-auto pr-1">
          {items.length === 0 && !busy && (
            <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-white/35">
              Nothing loaded. Start Zotero, or search once a source is reachable.
            </p>
          )}
          {items.map((it) => (
            <motion.div
              key={it.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/90">{it.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/45">
                    {it.creators.slice(0, 3).join(", ")}
                    {it.creators.length > 3 ? " et al." : ""}
                    {it.date ? ` · ${it.date}` : ""}
                    {it.publication ? ` · ${it.publication}` : ""}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/45">
                  {it.itemType}
                </span>
              </div>

              {it.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {it.tags.slice(0, 8).map((t) => (
                    <span key={t} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-white/55">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadAnnotations(it.key)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/75 transition hover:border-cyan-400/40 hover:text-white disabled:opacity-40"
                >
                  <Highlighter className="h-3 w-3 text-cyan-300" /> Highlights
                </button>
                {it.url && (
                  <a
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[11px] text-cyan-300/80 transition hover:text-cyan-200"
                  >
                    <ExternalLink className="h-3 w-3" /> Open
                  </a>
                )}
                {it.doi && <span className="text-[10px] text-white/35">DOI {it.doi}</span>}
              </div>

              {annotations?.key === it.key && (
                <div className="mt-3 space-y-1.5 rounded-xl border border-white/10 bg-black/25 p-3">
                  {annotations.list.length === 0 ? (
                    <p className="text-[11px] text-white/40">No highlights or notes on this item.</p>
                  ) : (
                    annotations.list.map((a, i) => (
                      <div key={i} className="border-l-2 pl-3" style={{ borderColor: a.color || "#67e8f9" }}>
                        {a.text && <p className="text-[12px] text-white/85">{a.text}</p>}
                        {a.comment && <p className="text-[11px] italic text-white/55">“{a.comment}”</p>}
                        <p className="text-[10px] text-white/35">
                          {a.type ?? "highlight"}
                          {a.page ? ` · p.${a.page}` : ""}
                          {a.attachment ? ` · ${a.attachment}` : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
