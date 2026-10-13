"use client";

// Chrome DevTools tab — the inspector surface for JARVIS's own browsing.
//
// The MCP server is a child process the Next.js server spawns and keeps alive
// (src/lib/mcp/stdioClient.ts), so there is nothing to start by hand. This tab
// exists because the *interesting* part of a browser failure is never the
// click — it is the 403 in the network list or the console error behind it.
//
// "Inspect a URL" chains navigate → snapshot → console → network so one button
// answers "what happened on this page", and the raw tool runner is there for
// everything else (the server exposes ~29 tools and they change between
// releases, so the UI lists whatever it actually advertises).

import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bug, Play, RefreshCw, Terminal, Globe, Gamepad2, AlertTriangle, PowerOff } from "lucide-react";

async function post(body: unknown, timeoutMs = 180_000): Promise<any> {
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
    return { success: false, error: (err as Error).name === "AbortError" ? "Timed out." : (err as Error).message };
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

type Section = { label: string; body: string; isError?: boolean };

export default function DevToolsTab() {
  const [status, setStatus] = useState<any>(null);
  // Default to whatever origin the panel is actually served from rather than a
  // hardcoded port — JARVIS may be running on any host/port.
  const [url, setUrl] = useState(() => (typeof window === "undefined" ? "" : window.location.origin));
  const [loading, setLoading] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toolName, setToolName] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");
  const [showTools, setShowTools] = useState(false);

  const loadStatus = useCallback(async () => {
    const json = await post({ mcp: "devtools", action: "status" }, 90_000);
    if (json.success) setStatus(json.data);
    else setError(json.error);
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const inspect = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    setSections([]);
    setImages([]);
    try {
      const json = await post({ mcp: "devtools", action: "inspect", params: { url: url.trim() } });
      if (json.success) {
        const d = json.data;
        // The server returns whatever it managed to collect plus an explicit
        // list of what went wrong — surface both, never a bare empty panel.
        setSections((d.sections ?? []) as Section[]);
        setImages(d.images ?? []);
        if ((d.warnings ?? []).length > 0) setError((d.warnings as string[]).join("\n"));
        else if (d.summary) setError(d.summary);
        void loadStatus();
      } else {
        setError(json.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const callTool = async () => {
    if (!toolName.trim()) {
      setError("Enter a tool name (open “Available tools” to see the list).");
      return;
    }
    let args: unknown = {};
    try {
      args = toolArgs.trim() ? JSON.parse(toolArgs) : {};
    } catch {
      setError("Tool arguments must be valid JSON.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const json = await post({ mcp: "devtools", action: "call", params: { tool: toolName.trim(), args } });
      if (json.success) {
        const d = json.data;
        setSections([
          {
            label: `tool: ${d.tool}${d.isError ? " — failed" : ""}  args: ${JSON.stringify(d.args ?? {})}`,
            body: d.text || "(no text output)",
            isError: !!d.isError,
          },
        ]);
        setImages(d.images ?? []);
        setError(d.isError ? d.text : null);
      } else setError(json.error);
    } finally {
      setLoading(false);
    }
  };

  const perf = async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await post({ mcp: "devtools", action: "perf", params: { url: url.trim() || undefined } });
      if (json.success) {
        const d = json.data;
        setSections([{ label: "performance insights", body: d.insights || "(no insights returned)", isError: !!d.isError }]);
        if ((d.warnings ?? []).length > 0) setError((d.warnings as string[]).join("\n"));
        else if (!d.insights) setError("The trace completed but produced no insights.");
      } else setError(json.error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className={`${glassCard} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-purple-400/15 ring-1 ring-purple-400/30">
              <Bug className="h-5 w-5 text-purple-300" />
            </span>
            <div>
              <h2 className="text-base font-semibold">Chrome DevTools</h2>
              <p className="text-xs text-white/45">
                {status?.connected
                  ? `MCP server connected · ${status.toolCount ?? 0} tools · no telemetry sent to Google`
                  : status?.installed
                    ? "Server installed, not connected yet — it starts on first use"
                    : "Server not installed"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={ghost} onClick={() => setShowTools((v) => !v)}>
              <Terminal className="h-4 w-4" /> {showTools ? "Hide tools" : "Available tools"}
            </button>
            <button type="button" className={ghost} onClick={loadStatus} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Reconnect
            </button>
            <button
              type="button"
              className={ghost}
              onClick={async () => {
                await post({ mcp: "devtools", action: "disconnect" }, 30_000);
                void loadStatus();
              }}
              disabled={!status?.connected}
            >
              <PowerOff className="h-4 w-4" /> Disconnect
            </button>
          </div>
        </div>

        {status?.lastError && !status?.connected && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-[11px] text-amber-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="space-y-1">
              <p className="break-words">{status.lastError}</p>
              <p className="text-amber-200/70">{status.setupHint}</p>
            </div>
          </div>
        )}

        {showTools && (
          <div className="mt-4 max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/25 p-3">
            {(status?.toolNames ?? []).length === 0 ? (
              <p className="text-[11px] text-white/40">No tool list yet — connect first.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {status.toolNames.map((t: string) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setToolName(t);
                      setToolArgs("{}");
                    }}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-white/75 transition hover:border-cyan-400/40 hover:text-white"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={`${glassCard} space-y-3 p-6`}>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} flex-1 min-w-[240px]`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
          <button type="button" className={btn} onClick={inspect} disabled={loading}>
            <Globe className="h-4 w-4" /> {loading ? "Working…" : "Inspect URL"}
          </button>
          <button type="button" className={ghost} onClick={perf} disabled={loading}>
            <Gamepad2 className="h-4 w-4" /> Perf trace
          </button>
        </div>
        <p className="text-[11px] text-white/40">
          Inspect = navigate → snapshot → console → network in one call. That is the chain that explains a failing scrape or a broken page.
        </p>
      </div>

      <div className={`${glassCard} space-y-3 p-6`}>
        <p className="text-sm font-medium text-white/80">Raw tool call</p>
        <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
          <input className={`${input} font-mono text-xs`} value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="take_snapshot" />
          <input className={`${input} font-mono text-xs`} value={toolArgs} onChange={(e) => setToolArgs(e.target.value)} placeholder='{"url": "https://…"}' />
        </div>
        <button type="button" className={btn} onClick={callTool} disabled={loading}>
          <Play className="h-4 w-4" /> Call tool
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{error}</span>
        </div>
      )}

      {images.length > 0 && (
        <div className={`${glassCard} space-y-2 p-6`}>
          <p className="text-sm font-medium text-white/80">Screenshots</p>
          <div className="flex flex-wrap gap-3">
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt={`screenshot ${i + 1}`} className="max-h-72 rounded-xl border border-white/10" />
            ))}
          </div>
        </div>
      )}

      {sections.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className={`${glassCard} space-y-2 p-6 ${s.isError ? "border-rose-400/25" : ""}`}
        >
          <p className={`text-[11px] uppercase tracking-wider ${s.isError ? "text-rose-300/80" : "text-white/40"}`}>{s.label}</p>
          <div className="max-h-[400px] overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4">
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-white/85">{s.body}</pre>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
