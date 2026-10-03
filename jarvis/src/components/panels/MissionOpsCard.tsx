"use client";

// Mission Control — "Systems" card.
//
// Surfaces the two machine-ops surfaces live, right inside the mission panel:
//  • managed dev servers (dev_server_start/stop/status) — port, pid, uptime,
//    HTTP status, recent output, one-click Stop
//  • the last executed file_organize tidy-up with a one-click Undo
//
// Polls /api/agent/ops while the panel is open; both lists are authoritative
// server-side (module registry + persisted undo log), so a server started by an
// earlier mission shows up here on its own.

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cpu,
  Server,
  FolderSearch,
  Square,
  Undo2,
  Loader2,
  CircleCheck,
  CircleAlert,
  Radio,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface DevServerInfo {
  port: number;
  pid?: number;
  command: string;
  cwd: string;
  startedAt: number;
  uptimeMs: number;
  running: boolean;
  managed: boolean;
  ready: boolean;
  httpStatus?: number;
  output?: string;
}

interface LastOrganize {
  id: string;
  folder: string;
  mode: string;
  at: number;
  moved: number;
  folders: string[];
}

interface OpsData {
  devServers: DevServerInfo[];
  lastOrganize: LastOrganize | null;
}

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function MissionOpsCard({ isOpen }: { isOpen: boolean }) {
  const [data, setData] = useState<OpsData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showLog, setShowLog] = useState(false);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/ops", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as OpsData;
      setData({ devServers: json.devServers ?? [], lastOrganize: json.lastOrganize ?? null });
    } catch {
      // transient — keep the last known state
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void poll();
    const t = setInterval(poll, 2500);
    return () => clearInterval(t);
  }, [isOpen, poll]);

  const stopServer = async (s: DevServerInfo) => {
    setBusy(`stop:${s.port}`);
    setNote(null);
    try {
      const res = await fetch("/api/agent/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop_server", port: s.port, cwd: s.cwd }),
      });
      const d = await res.json();
      setNote({ ok: res.ok, text: d?.message ?? (res.ok ? "Stopped." : "Couldn't stop it.") });
      await poll();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const undoOrganize = async () => {
    setBusy("undo");
    setNote(null);
    try {
      const res = await fetch("/api/agent/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "undo_organize" }),
      });
      const d = await res.json();
      setNote({ ok: res.ok, text: d?.message ?? (res.ok ? "Restored." : "Couldn't undo.") });
      await poll();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const servers = data?.devServers ?? [];
  const last = data?.lastOrganize ?? null;
  const idle = servers.length === 0 && !last;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-white/[0.06]">
        <Cpu className="w-3.5 h-3.5 text-reactor-core" />
        <span className="font-orbitron text-[10px] uppercase tracking-[0.18em] text-reactor-core">Systems</span>
        <span className="ml-auto flex items-center gap-3 text-[9px] font-rajdhani uppercase tracking-wider text-text-secondary/50">
          <span className="flex items-center gap-1">
            <Server className="w-2.5 h-2.5" /> {servers.length}
          </span>
          {last && (
            <span className="flex items-center gap-1">
              <FolderSearch className="w-2.5 h-2.5" /> tidy
            </span>
          )}
        </span>
      </div>

      <div className="p-3 space-y-2.5">
        {idle && (
          <p className="text-[11px] font-rajdhani text-text-secondary/50">
            No managed servers or tidy-ups yet — ask JARVIS to <span className="text-reactor-core/80">“start my dev server”</span> or{" "}
            <span className="text-reactor-core/80">“sort out my Downloads”</span>.
          </p>
        )}

        {/* ── dev servers ── */}
        <AnimatePresence initial={false}>
          {servers.map((s) => (
            <motion.div
              key={`${s.cwd}-${s.port}`}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="rounded-xl border border-reactor-core/25 bg-reactor-core/[0.06] p-3"
            >
              <div className="flex items-center gap-2">
                <Server className="w-3.5 h-3.5 text-reactor-core flex-shrink-0" />
                <span className="font-orbitron text-[11px] text-reactor-core">:{s.port}</span>
                {s.ready ? (
                  <span className="flex items-center gap-1 text-[9px] font-rajdhani uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-accent-green/40 bg-accent-green/10 text-accent-green">
                    <CircleCheck className="w-2.5 h-2.5" /> {s.httpStatus ? `HTTP ${s.httpStatus}` : "up"}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[9px] font-rajdhani uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-accent-amber/40 bg-accent-amber/10 text-accent-amber">
                    <CircleAlert className="w-2.5 h-2.5" /> starting
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-[9px] font-rajdhani text-text-secondary/50 uppercase tracking-wider">
                  <Radio className="w-2.5 h-2.5 text-accent-red/70 animate-pulse" /> live
                </span>
              </div>

              <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-rajdhani">
                <span className="text-text-secondary/50">pid <span className="text-text-primary/85">{s.pid ?? "—"}</span></span>
                <span className="text-text-secondary/50">uptime <span className="text-text-primary/85">{fmtUptime(s.uptimeMs)}</span></span>
                <span className="col-span-2 text-text-secondary/50 font-mono text-[9px] truncate" title={s.command}>
                  {s.command}
                </span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={() => void stopServer(s)}
                  disabled={busy === `stop:${s.port}`}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-accent-red/40 bg-accent-red/10 hover:bg-accent-red/20 text-accent-red text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-40 transition-colors"
                >
                  {busy === `stop:${s.port}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />} Stop
                </button>
                <button
                  onClick={() => setShowLog((v) => !v)}
                  className="flex items-center gap-1 text-[10px] font-rajdhani uppercase tracking-wider text-text-secondary/60 hover:text-text-primary transition-colors"
                >
                  {showLog ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} log
                </button>
              </div>

              {showLog && (
                <pre className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-white/[0.06] bg-black/50 p-2 text-[9px] font-mono text-text-secondary/80 whitespace-pre-wrap break-words">
                  {s.output?.trim() || "(no output yet)"}
                </pre>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* ── last tidy-up ── */}
        {last && (
          <motion.div
            layout
            className="rounded-xl border border-accent-amber/25 bg-accent-amber/[0.06] p-3"
          >
            <div className="flex items-center gap-2">
              <FolderSearch className="w-3.5 h-3.5 text-accent-amber flex-shrink-0" />
              <span className="text-[11px] font-rajdhani text-text-primary/90">
                Last tidy-up — <span className="font-orbitron text-[10px]">{last.folder}</span>
              </span>
              <span className="ml-auto text-[9px] font-rajdhani text-text-secondary/50 uppercase tracking-wider">{relTime(last.at)}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-[9px] font-rajdhani uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-white/15 bg-white/[0.04] text-text-secondary">
                {last.mode} · {last.moved} moved
              </span>
              {last.folders.slice(0, 4).map((f) => (
                <span key={f} className="text-[9px] font-rajdhani px-1.5 py-0.5 rounded-full border border-accent-amber/30 bg-accent-amber/10 text-accent-amber/90">
                  {f}/
                </span>
              ))}
            </div>
            <button
              onClick={() => void undoOrganize()}
              disabled={busy === "undo"}
              className="mt-2 flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-accent-amber/40 bg-accent-amber/10 hover:bg-accent-amber/20 text-accent-amber text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-40 transition-colors"
            >
              {busy === "undo" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />} Undo last tidy-up
            </button>
          </motion.div>
        )}

        {/* ── action result ── */}
        <AnimatePresence>
          {note && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] font-rajdhani ${
                note.ok ? "border-accent-green/30 bg-accent-green/10 text-accent-green" : "border-accent-red/30 bg-accent-red/10 text-accent-red"
              }`}
            >
              {note.ok ? <CircleCheck className="w-3 h-3 mt-0.5 flex-shrink-0" /> : <CircleAlert className="w-3 h-3 mt-0.5 flex-shrink-0" />}
              <span>{note.text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}
