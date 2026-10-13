"use client";

// Documents tab — turn PDFs/DOCX/XLSX/PPTX into structured markdown.
//
// Docling is Python, so JARVIS provisions a venv under .jarvis-services/ and
// runs `docling-serve` as a supervised child process: no terminal, no separate
// service for the user to remember to start. The panel exposes exactly the two
// things that matter operationally — whether the runtime is ready, and the
// one-time setup command when it is not.
//
// When Docling is unavailable, conversion still works through the built-in
// pdf-parse/mammoth readers. The response always states which engine ran, and
// warns that tables will be flattened — a document tool that quietly degrades
// is worse than one that admits it.

import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FileText, Play, RefreshCw, Power, Save, AlertTriangle, CheckCircle2, Info } from "lucide-react";

async function post(body: unknown, timeoutMs = 700_000): Promise<any> {
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
    return { success: false, error: (err as Error).name === "AbortError" ? "Conversion timed out." : (err as Error).message };
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

export default function DocumentsTab() {
  const [status, setStatus] = useState<any>(null);
  const [filePath, setFilePath] = useState("");
  const [url, setUrl] = useState("");
  const [tableMode, setTableMode] = useState("accurate");
  const [doOcr, setDoOcr] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadStatus = useCallback(async () => {
    const json = await post({ mcp: "documents", action: "status" }, 60_000);
    if (json.success) setStatus(json.data);
    else setError(json.error);
  }, []);

  useEffect(() => {
    void loadStatus();
    // The sidecar can take minutes to come up on a cold first start; a slow
    // poll keeps the panel honest without hammering the endpoint.
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void loadStatus();
    }, 20_000);
    return () => clearInterval(t);
  }, [loadStatus]);

  const startServer = async () => {
    setStarting(true);
    setError(null);
    try {
      const json = await post({ mcp: "documents", action: "start" });
      if (json.success) {
        if (!json.data.started && json.data.error) setError(json.data.error);
        setStatus({ ...(status ?? {}), ...json.data.status, service: json.data.status?.service });
      } else setError(json.error);
    } finally {
      setStarting(false);
    }
  };

  const convert = async (mode: "preview" | "save") => {
    if (!filePath.trim() && !url.trim()) {
      setError("Enter a local file path or an http(s) URL.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const json = await post({
        mcp: "documents",
        action: mode === "save" ? "convert_to_file" : "convert",
        params: {
          path: filePath.trim() || undefined,
          url: url.trim() || undefined,
          tableMode,
          doOcr,
          includeJson: false,
        },
      });
      if (json.success) setResult(json.data);
      else setError(json.error);
    } finally {
      setBusy(false);
    }
  };

  const service = status?.service;
  const ready = !!service?.ready;

  return (
    <div className="space-y-5">
      <div className={`${glassCard} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-amber-400/15 ring-1 ring-amber-400/30">
              <FileText className="h-5 w-5 text-amber-300" />
            </span>
            <div>
              <h2 className="text-base font-semibold">Document conversion</h2>
              <p className="text-xs text-white/45">
                {ready
                  ? "Docling server is warm — layout, tables and OCR preserved"
                  : status?.provisioned
                    ? "Docling installed but not running"
                    : "Docling runtime not provisioned"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ghost} onClick={loadStatus} disabled={busy}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button type="button" className={btn} onClick={startServer} disabled={starting || ready || !status?.provisioned}>
              <Power className={`h-4 w-4 ${starting ? "animate-spin" : ""}`} />
              {ready ? "Running" : starting ? "Starting…" : "Start Docling"}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className={`rounded-xl border px-3 py-2 ${ready ? "border-emerald-400/25 bg-emerald-500/5" : "border-white/10 bg-black/20"}`}>
            <p className="text-[11px] text-white/45">Docling</p>
            <p className={`text-xs font-medium ${ready ? "text-emerald-300" : "text-white/70"}`}>
              {status?.engines?.docling ?? "…"}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <p className="text-[11px] text-white/45">Built-in fallback</p>
            <p className="text-xs font-medium text-white/70">{status?.engines?.builtin ?? "…"}</p>
          </div>
        </div>

        {!status?.provisioned && status?.setupHint && (
          <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
            <div className="space-y-1.5">
              <p className="text-xs text-amber-100">
                One-time setup (~2-4 GB of document models). JARVIS starts and stops the server itself after that:
              </p>
              <code className="block overflow-x-auto whitespace-pre rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] text-amber-200">
                {status.setupHint}
              </code>
            </div>
          </div>
        )}

        {service?.lastError && !ready && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-words">{service.lastError}</span>
          </div>
        )}
      </div>

      <div className={`${glassCard} space-y-4 p-6`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs text-white/55">Local file path</label>
            <input className={input} value={filePath} onChange={(e) => setFilePath(e.target.value)} placeholder="path/to/report.pdf (absolute or relative to the server)" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-white/55">…or a URL (needs Docling)</label>
            <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://arxiv.org/pdf/2501.17887" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-white/65">
            <input type="checkbox" checked={doOcr} onChange={(e) => setDoOcr(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
            OCR scanned pages
          </label>
          <label className="flex items-center gap-2 text-xs text-white/65">
            Table mode
            <select
              value={tableMode}
              onChange={(e) => setTableMode(e.target.value)}
              className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white outline-none focus:border-cyan-400/60"
            >
              <option value="accurate">accurate</option>
              <option value="fast">fast</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} onClick={() => convert("preview")} disabled={busy}>
            <Play className="h-4 w-4" /> {busy ? "Converting…" : "Convert"}
          </button>
          <button type="button" className={ghost} onClick={() => convert("save")} disabled={busy || !filePath.trim()}>
            <Save className="h-4 w-4" /> Convert &amp; save .md next to file
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="whitespace-pre-wrap break-words">{error}</span>
          </div>
        )}
      </div>

      {result && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`${glassCard} space-y-3 p-6`}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1 text-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" /> engine: {result.engine}
            </span>
            {result.status && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/60">status: {result.status}</span>
            )}
            {result.seconds !== undefined && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/60">{Number(result.seconds).toFixed(2)}s</span>
            )}
            {result.wroteTo && (
              <span className="rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3 py-1 text-cyan-200">wrote {result.wroteTo}</span>
            )}
            {result.bytes !== undefined && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-white/60">{result.bytes} bytes</span>
            )}
          </div>

          {(result.warnings ?? []).map((w: string, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{w}</span>
            </div>
          ))}

          <div className="max-h-[420px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-white/85">
              {result.markdown?.trim() ? result.markdown : "(no text extracted)"}
            </pre>
          </div>
        </motion.div>
      )}
    </div>
  );
}
