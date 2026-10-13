"use client";

// DuckDB tab — analytical SQL over local files and JARVIS's own database.
//
// DuckDB runs *inside* the Next.js server (no sidecar, no port, no setup), so
// this panel works the moment the app does. Two things make it useful rather
// than a generic SQL box:
//   1. One click attaches prisma/dev.db read-only, after which memory, tasks,
//      watcher samples and price history are queryable with real SQL.
//   2. Data files found on disk can be registered as views by extension
//      (CSV/TSV/Parquet/JSON), so ad-hoc datasets become joinable tables.

import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Database, Play, RefreshCw, FileSpreadsheet, Link2, Table2, AlertTriangle, Sparkles } from "lucide-react";

async function post(body: unknown): Promise<any> {
  const res = await fetch("/api/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

const glassCard =
  "rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]";
const input =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-cyan-400/60 focus:bg-black/40 focus:ring-2 focus:ring-cyan-400/20";
const btn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500/90 px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40";
const ghost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-white/80 transition hover:border-cyan-400/40 hover:bg-white/[0.07] hover:text-white disabled:opacity-40";

// `{alias}` is substituted with whatever catalog name the database was
// attached under (see duckdb.attach_jarvis), so these presets keep working if
// the alias is changed — nothing is pinned to "jarvis".
const QUICK_QUERIES: { label: string; sql: string; needsAttach?: boolean }[] = [
  { label: "DuckDB version", sql: "SELECT version() AS version" },
  {
    label: "Memory count by category",
    sql: "SELECT category, count(*) AS n FROM {alias}.Memory GROUP BY category ORDER BY n DESC",
    needsAttach: true,
  },
  {
    label: "Open tasks",
    sql: "SELECT title, priority, dueDate FROM {alias}.Task WHERE completed = false ORDER BY priority LIMIT 50",
    needsAttach: true,
  },
  {
    label: "Watcher samples (latest 50)",
    sql: "SELECT watchId, value, takenAt FROM {alias}.WatchSample ORDER BY takenAt DESC LIMIT 50",
    needsAttach: true,
  },
  {
    label: "Price history (latest 50)",
    sql: "SELECT p.asin, p.title, s.price, s.takenAt FROM {alias}.PriceSample s JOIN {alias}.PriceProduct p ON p.id = s.productId ORDER BY s.takenAt DESC LIMIT 50",
    needsAttach: true,
  },
];

export default function DuckDbTab() {
  const [status, setStatus] = useState<any>(null);
  const [sql, setSql] = useState("SELECT 1 AS hello, version() AS duckdb");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<any[]>([]);
  const [attached, setAttached] = useState(false);
  // The catalog name the database is attached under, read back from the server
  // instead of assumed.
  const [alias, setAlias] = useState("jarvis");

  const loadStatus = useCallback(async () => {
    const json = await post({ mcp: "duckdb", action: "status" });
    if (json.success) {
      setStatus(json.data);
      const attachments = (json.data?.attached ?? []) as { alias: string }[];
      setAttached(attachments.length > 0);
      if (attachments[0]?.alias) setAlias(attachments[0].alias);
    } else {
      setError(json.error);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const run = async (query?: string) => {
    const statement = (query ?? sql).trim();
    if (!statement) return;
    setBusy(true);
    setError(null);
    try {
      const json = await post({ mcp: "duckdb", action: "query", params: { sql: statement, limit: 300 } });
      if (json.success) {
        setResult(json.data);
        setSql(statement);
      } else {
        setError(json.error);
        setResult(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const findFiles = async () => {
    setBusy(true);
    try {
      const json = await post({ mcp: "duckdb", action: "files", params: { root: undefined, limit: 60 } });
      if (json.success) setFiles(json.data.files ?? []);
      else setError(json.error);
    } finally {
      setBusy(false);
    }
  };

  const registerFile = async (filePath: string) => {
    const suggested = (filePath.split(/[\\/]/).pop() || "data").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_]/g, "_");
    const alias = window.prompt("Register as view named:", suggested.startsWith("_") || /^[0-9]/.test(suggested) ? `v${suggested}` : suggested);
    if (!alias) return;
    setBusy(true);
    setError(null);
    try {
      const json = await post({ mcp: "duckdb", action: "register", params: { alias, path: filePath } });
      if (json.success) {
        await loadStatus();
        await run(`SELECT * FROM ${alias} LIMIT 50`);
      } else setError(json.error);
    } finally {
      setBusy(false);
    }
  };

  const attachJarvis = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await post({ mcp: "duckdb", action: "attach_jarvis", params: {} });
      if (json.success) {
        setAttached(true);
        await loadStatus();
      } else setError(json.error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className={`${glassCard} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-400/15 ring-1 ring-cyan-400/30">
              <Database className="h-5 w-5 text-cyan-300" />
            </span>
            <div>
              <h2 className="text-base font-semibold">DuckDB workspace</h2>
              <p className="text-xs text-white/45">
                {status ? `${status.version} · in-process, no server` : "connecting…"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ghost} onClick={loadStatus} disabled={busy}>
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button type="button" className={attached ? ghost : btn} onClick={attachJarvis} disabled={busy || attached}>
              <Link2 className="h-4 w-4" /> {attached ? "JARVIS DB attached" : "Attach JARVIS database"}
            </button>
          </div>
        </div>
        {status?.notes && <p className="mt-3 text-[11px] text-white/35">{status.notes}</p>}
      </div>

      <div className={`${glassCard} space-y-3 p-6`}>
        <div className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Play className="h-4 w-4 text-cyan-300" /> SQL (read-only)
        </div>
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={4}
          spellCheck={false}
          className={`${input} font-mono text-[13px] leading-relaxed`}
          placeholder="SELECT * FROM jarvis.Memory LIMIT 20"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={btn} onClick={() => run()} disabled={busy}>
            <Play className="h-4 w-4" /> Run query
          </button>
          <span className="text-[11px] text-white/35">
            Read-only: SELECT / WITH / DESCRIBE / SUMMARIZE / PRAGMA / SHOW. One statement at a time.
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {QUICK_QUERIES.map((q) => (
            <button
              key={q.label}
              type="button"
              onClick={() => run(q.sql.replace(/\{alias\}/g, alias))}
              disabled={busy || (q.needsAttach && !attached)}
              title={
                q.needsAttach && !attached
                  ? "Attach the JARVIS database first"
                  : q.sql.replace(/\{alias\}/g, alias)
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-white/70 transition hover:border-cyan-400/40 hover:text-white disabled:opacity-35"
            >
              <Sparkles className="h-3 w-3 text-cyan-300/70" /> {q.label}
            </button>
          ))}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-pre-wrap break-words">{error}</span>
          </div>
        )}

        {result && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
            <p className="text-[11px] text-white/45">
              {result.rowCount} row{result.rowCount === 1 ? "" : "s"}
              {result.truncated ? ` (showing first ${result.rows.length})` : ""} · {result.columns.length} column
              {result.columns.length === 1 ? "" : "s"}
            </p>
            <div className="max-h-80 overflow-auto rounded-2xl border border-white/10">
              <table className="w-full border-collapse text-left text-[12px]">
                <thead className="sticky top-0 bg-black/60 backdrop-blur">
                  <tr>
                    {result.columns.map((c: string) => (
                      <th key={c} className="whitespace-nowrap border-b border-white/10 px-3 py-2 font-medium text-white/60">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row: Record<string, unknown>, i: number) => (
                    <tr key={i} className="odd:bg-white/[0.02]">
                      {result.columns.map((c: string) => (
                        <td key={c} className="max-w-[280px] truncate border-b border-white/5 px-3 py-1.5 font-mono text-white/80">
                          {row[c] === null || row[c] === undefined ? <span className="text-white/25">—</span> : String(row[c] as string)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {result.rows.length === 0 && (
                    <tr>
                      <td colSpan={Math.max(1, result.columns.length)} className="px-3 py-6 text-center text-white/40">
                        No rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </div>

      <div className={`${glassCard} space-y-4 p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium text-white/80">
            <FileSpreadsheet className="h-4 w-4 text-cyan-300" /> Local data files
          </div>
          <button type="button" className={ghost} onClick={findFiles} disabled={busy}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Scan project
          </button>
        </div>
        <p className="text-[11px] text-white/40">
          CSV, TSV, Parquet, JSON/JSONL and XLSX found in the project folder. Register one to query it as a view.
        </p>
        {files.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-white/35">
            Nothing scanned yet.
          </p>
        ) : (
          <div className="max-h-56 space-y-1.5 overflow-auto pr-1">
            {files.map((f) => (
              <button
                key={f.path}
                type="button"
                onClick={() => registerFile(f.path)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-cyan-400/40 hover:bg-white/[0.06]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs text-white/85">{f.path}</span>
                  <span className="block text-[10px] text-white/35">{(f.sizeBytes / 1024).toFixed(1)} KB · {f.ext}</span>
                </span>
                <Table2 className="h-4 w-4 shrink-0 text-cyan-300/70" />
              </button>
            ))}
          </div>
        )}

        {((status?.views?.length ?? 0) > 0 || (status?.attached?.length ?? 0) > 0) && (
          <div className="grid gap-2 sm:grid-cols-2">
            {status.views?.map((v: { alias: string; source: string }) => (
              <div key={v.alias} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                <p className="font-mono text-xs text-cyan-200">{v.alias}</p>
                <p className="truncate text-[10px] text-white/40">{v.source}</p>
              </div>
            ))}
            {status.attached?.map((a: { alias: string; source: string }) => (
              <div key={a.alias} className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2">
                <p className="font-mono text-xs text-emerald-200">{a.alias} (attached)</p>
                <p className="truncate text-[10px] text-white/40">{a.source}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
