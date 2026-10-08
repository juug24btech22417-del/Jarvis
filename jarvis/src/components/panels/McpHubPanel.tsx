"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Layers,
  GitBranch,
  FolderTree,
  MapPin,
  MessageSquare,
  CheckCircle2,
  ExternalLink,
  Search,
  Send,
  RefreshCw,
  Star,
  Lock,
  Folder,
  FileCode,
  ChevronRight,
  ChevronUp,
  Save,
  FilePlus2,
  FolderPlus,
  Trash2,
  Navigation,
  GitPullRequest,
  CircleDot,
  GitCommit,
  X,
  RotateCcw,
  Users,
  Phone,
  Globe,
  Plus,
  Radio,
  Box,
} from "lucide-react";
import DiplomatTab from "@/components/mcp/DiplomatTab";
import CadTab from "@/components/mcp/CadTab";
import { useJarvisStore } from "@/store/jarvis.store";

type McpKey = "whatsapp" | "diplomat" | "markprototype" | "github" | "filesystem" | "googlemaps";

async function postMcp(body: any): Promise<any> {
  const send = () =>
    fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  let res: Response;
  try {
    res = await send();
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    await new Promise((r) => setTimeout(r, 400));
    res = await send();
  }
  return res.json();
}

// ── Shared Apple-style primitives ───────────────────────────────
const glassCard =
  "rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur-2xl shadow-[0_8px_40px_-12px_rgba(0,0,0,0.8)]";
const subtleInput =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-cyan-400/60 focus:bg-black/40 focus:ring-2 focus:ring-cyan-400/20";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-500/90 px-4 py-2.5 text-sm font-medium text-white shadow-[0_0_20px_-4px_rgba(34,211,238,0.6)] transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-40";
const ghostBtn =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm text-white/80 transition hover:border-cyan-400/40 hover:bg-white/[0.07] hover:text-white disabled:opacity-40";

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { id: string; label: string; icon?: React.ReactNode }[];
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-2xl border border-white/10 bg-black/30 p-1">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`relative inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-medium transition ${
            value === o.id ? "text-white" : "text-white/50 hover:text-white/80"
          }`}
        >
          {value === o.id && (
            <motion.span
              layoutId="mcp-seg"
              className="absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/15"
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
          <span className="relative z-10 flex items-center gap-1.5">
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      <div className="text-white/25">{icon}</div>
      <p className="text-sm text-white/60">{title}</p>
      {hint && <p className="max-w-sm text-xs text-white/35">{hint}</p>}
    </div>
  );
}

function ErrorBar({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">
      {message}
    </div>
  );
}

export default function McpHubPanel() {
  const [activeMcp, setActiveMcp] = useState<McpKey>("whatsapp");

  // A "call <number>" command sets this; we open Diplomat with it prefilled.
  const pendingDiplomatNumber = useJarvisStore((s) => s.pendingDiplomatNumber);
  const setPendingDiplomatNumber = useJarvisStore((s) => s.setPendingDiplomatNumber);
  const [dialSeed, setDialSeed] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingDiplomatNumber) return;
    setDialSeed(pendingDiplomatNumber);
    setActiveMcp("diplomat");
    setPendingDiplomatNumber(null);
  }, [pendingDiplomatNumber, setPendingDiplomatNumber]);

  // ── GitHub ──
  const [ghMode, setGhMode] = useState<"user" | "search">("user");
  const [ghQuery, setGhQuery] = useState("");
  const [ghRepos, setGhRepos] = useState<any[]>([]);
  const [ghLoading, setGhLoading] = useState(false);
  const [ghError, setGhError] = useState<string | null>(null);
  const [ghRepo, setGhRepo] = useState<any | null>(null);
  const [ghView, setGhView] = useState<"overview" | "code" | "issues" | "pulls" | "commits">("overview");
  const [ghDetail, setGhDetail] = useState<any | null>(null);
  const [ghContents, setGhContents] = useState<any[]>([]);
  const [ghCodePath, setGhCodePath] = useState("");
  const [ghFile, setGhFile] = useState<{ path: string; content: string; html_url: string } | null>(null);
  const [ghPanelLoading, setGhPanelLoading] = useState(false);
  const [ghPanelError, setGhPanelError] = useState<string | null>(null);

  // ── Filesystem ──
  const [fsRoots, setFsRoots] = useState<any[]>([]);
  const [fsPath, setFsPath] = useState<string>("");
  const [fsParent, setFsParent] = useState<string | null>(null);
  const [fsWritable, setFsWritable] = useState(false);
  const [fsEntries, setFsEntries] = useState<any[]>([]);
  const [fsLoading, setFsLoading] = useState(false);
  const [fsError, setFsError] = useState<string | null>(null);
  const [fsFile, setFsFile] = useState<any | null>(null);
  const [fsDraft, setFsDraft] = useState("");
  const [fsSaving, setFsSaving] = useState(false);
  const [fsSearch, setFsSearch] = useState("");
  const [fsResults, setFsResults] = useState<any[]>([]);

  // ── Maps ──
  const [mapQuery, setMapQuery] = useState("");
  const [mapLocation, setMapLocation] = useState("");
  const [mapPlaces, setMapPlaces] = useState<any[]>([]);
  const [mapSource, setMapSource] = useState("");
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [dirFrom, setDirFrom] = useState("");
  const [dirTo, setDirTo] = useState("");
  const [dirResult, setDirResult] = useState<any | null>(null);
  const [dirLoading, setDirLoading] = useState(false);
  const [showDirections, setShowDirections] = useState(false);

  // ── WhatsApp ──
  const [waStatus, setWaStatus] = useState<any>(null);
  const [waChats, setWaChats] = useState<any[]>([]);
  const [waContacts, setWaContacts] = useState<any[]>([]);
  const [waContact, setWaContact] = useState("");
  const [waMessage, setWaMessage] = useState("");
  const [waSending, setWaSending] = useState(false);
  const [waFlash, setWaFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [waBusy, setWaBusy] = useState(false);

  const waState: "connected" | "syncing" | "awaiting_qr" | "offline" = waStatus?.isReady
    ? "connected"
    : waStatus?.status === "awaiting_qr"
    ? "awaiting_qr"
    : waStatus?.isAuthenticated
    ? "syncing"
    : "offline";

  const flash = (ok: boolean, text: string) => {
    setWaFlash({ ok, text });
    setTimeout(() => setWaFlash(null), 5000);
  };

  // ── WhatsApp loaders ──
  const loadWa = useCallback(async () => {
    const st = await postMcp({ mcp: "whatsapp", action: "get_status" });
    setWaStatus(st);
    if (st?.isReady) {
      const [chats, contacts] = await Promise.all([
        postMcp({ mcp: "whatsapp", action: "list_chats" }),
        postMcp({ mcp: "whatsapp", action: "list_contacts" }),
      ]);
      setWaChats(Array.isArray(chats?.data) ? chats.data : []);
      setWaContacts(Array.isArray(contacts?.data) ? contacts.data : []);
    } else {
      setWaChats([]);
      setWaContacts([]);
    }
  }, []);

  const waAction = async (action: string, label: string) => {
    setWaBusy(true);
    try {
      const r = await postMcp({ mcp: "whatsapp", action });
      if (r.success) flash(true, `${label} — QR refreshed. Scan it now.`);
      else flash(false, r.error || `${label} failed.`);
      await loadWa();
    } finally {
      setWaBusy(false);
    }
  };

  const sendWa = async () => {
    if (!waContact || !waMessage.trim()) return;
    setWaSending(true);
    try {
      const json = await postMcp({
        mcp: "whatsapp",
        action: "send_message",
        params: { contact: waContact, message: waMessage },
      });
      if (json.success) {
        flash(true, `Sent to ${json.data?.recipient || waContact} at ${json.data?.deliveredAt || "now"}.`);
        setWaMessage("");
      } else {
        flash(false, json.error || "Send failed.");
      }
    } finally {
      setWaSending(false);
    }
  };

  // ── GitHub loaders ──
  const loadGhRepos = useCallback(async () => {
    setGhLoading(true);
    setGhError(null);
    try {
      const params = ghMode === "search" ? { query: ghQuery.trim() } : { username: ghQuery.trim() };
      const json = await postMcp({ mcp: "github", action: "list_repos", params });
      if (json.success && Array.isArray(json.data)) {
        setGhRepos(json.data);
      } else {
        setGhError(json.error || "Unable to fetch repositories.");
        setGhRepos([]);
      }
    } catch (e: any) {
      setGhError(e?.message || "Network error fetching repositories.");
    } finally {
      setGhLoading(false);
    }
  }, [ghMode, ghQuery]);

  const openRepo = async (repoFullName: string) => {
    setGhRepo({ full_name: repoFullName });
    setGhView("overview");
    setGhDetail(null);
    setGhContents([]);
    setGhFile(null);
    setGhCodePath("");
    setGhPanelLoading(true);
    setGhPanelError(null);
    try {
      const json = await postMcp({ mcp: "github", action: "get_repo", params: { repo: repoFullName } });
      if (json.success) setGhDetail(json.data);
      else setGhPanelError(json.error || "Could not load repository.");
    } finally {
      setGhPanelLoading(false);
    }
  };

  const loadRepoView = useCallback(
    async (view: string, pathOverride?: string) => {
      if (!ghRepo) return;
      setGhPanelLoading(true);
      setGhPanelError(null);
      try {
        const repo = ghRepo.full_name;
        if (view === "code") {
          const json = await postMcp({ mcp: "github", action: "list_contents", params: { repo, path: pathOverride ?? ghCodePath } });
          if (json.success) setGhContents(Array.isArray(json.data) ? json.data : [json.data]);
          else setGhPanelError(json.error || "Could not read repository contents.");
        } else if (view === "issues") {
          const json = await postMcp({ mcp: "github", action: "list_issues", params: { repo } });
          if (json.success) setGhContents(json.data || []);
          else setGhPanelError(json.error || "Could not load issues.");
        } else if (view === "pulls") {
          const json = await postMcp({ mcp: "github", action: "list_pulls", params: { repo } });
          if (json.success) setGhContents(json.data || []);
          else setGhPanelError(json.error || "Could not load pull requests.");
        } else if (view === "commits") {
          const json = await postMcp({ mcp: "github", action: "list_commits", params: { repo } });
          if (json.success) setGhContents(json.data || []);
          else setGhPanelError(json.error || "Could not load commits.");
        }
      } finally {
        setGhPanelLoading(false);
      }
    },
    [ghRepo, ghCodePath]
  );

  const createGhIssue = async () => {
    if (!ghRepo) return;
    const title = window.prompt("New issue title:");
    if (!title) return;
    const body = window.prompt("Issue body (optional):") || "";
    const json = await postMcp({ mcp: "github", action: "create_issue", params: { repo: ghRepo.full_name, title, body } });
    if (json.success) {
      window.open(json.data.html_url, "_blank", "noopener");
      loadRepoView("issues");
    } else {
      setGhPanelError(json.error || "Could not create issue.");
    }
  };

  const createGhPr = async () => {
    if (!ghRepo) return;
    const title = window.prompt("New pull request title:");
    if (!title) return;
    const head = window.prompt("Head branch (where your changes are):");
    if (!head) return;
    const base = window.prompt("Base branch (target, e.g. main):", "main");
    if (!base) return;
    const json = await postMcp({ mcp: "github", action: "create_pr", params: { repo: ghRepo.full_name, title, head, base } });
    if (json.success) {
      window.open(json.data.html_url, "_blank", "noopener");
      loadRepoView("pulls");
    } else {
      setGhPanelError(json.error || "Could not create pull request.");
    }
  };

  const openGhFile = async (pathInRepo: string, htmlUrl?: string) => {
    if (!ghRepo) return;
    const json = await postMcp({ mcp: "github", action: "get_file", params: { repo: ghRepo.full_name, path: pathInRepo } });
    if (json.success && json.data?.content !== undefined) {
      setGhFile({ path: pathInRepo, content: json.data.content || "(empty file)", html_url: json.data.html_url || htmlUrl || "" });
    } else {
      setGhPanelError(json.error || "Could not read that file.");
    }
  };

  // ── Filesystem loaders ──
  const loadRoots = useCallback(async () => {
    const json = await postMcp({ mcp: "filesystem", action: "list_roots" });
    if (json.success) setFsRoots(json.data || []);
  }, []);

  const loadDir = useCallback(async (dirPath?: string) => {
    setFsLoading(true);
    setFsError(null);
    try {
      const json = await postMcp({ mcp: "filesystem", action: "list_dir", params: { path: dirPath || fsPath || "." } });
      if (json.success) {
        setFsEntries(json.data || []);
        setFsPath(json.cwd);
        setFsParent(json.parentPath ?? null);
        setFsWritable(!!json.writable);
        setFsFile(null);
        setFsResults([]);
      } else {
        setFsError(json.error || "Could not list directory.");
      }
    } catch (e: any) {
      setFsError(e?.message || "Network error listing directory.");
    } finally {
      setFsLoading(false);
    }
  }, [fsPath]);

  const openFsFile = async (fullPath: string) => {
    const json = await postMcp({ mcp: "filesystem", action: "read_file", params: { filePath: fullPath } });
    if (json.success) {
      setFsFile({ path: json.filePath, name: fullPath.split(/[\\/]/).pop(), content: json.data, writable: json.writable, isBinary: json.isBinary });
      setFsDraft(typeof json.data === "string" ? json.data : "");
    } else {
      setFsError(json.error || "Could not read file.");
    }
  };

  const saveFsFile = async () => {
    if (!fsFile) return;
    setFsSaving(true);
    try {
      const json = await postMcp({ mcp: "filesystem", action: "write_file", params: { filePath: fsFile.path, content: fsDraft } });
      if (json.success) {
        setFsFile({ ...fsFile, content: fsDraft });
        setFsError(null);
        setTimeout(() => setFsError(null), 1);
      } else {
        setFsError(json.error || "Could not save file.");
      }
    } finally {
      setFsSaving(false);
    }
  };

  const newFsFile = async () => {
    const name = window.prompt("New file name (created in the project folder):");
    if (!name) return;
    const json = await postMcp({ mcp: "filesystem", action: "write_file", params: { filePath: name, content: "" } });
    if (json.success) loadDir();
    else setFsError(json.error || "Could not create file.");
  };

  const newFsFolder = async () => {
    const name = window.prompt("New folder name (created in the project folder):");
    if (!name) return;
    const json = await postMcp({ mcp: "filesystem", action: "create_dir", params: { path: name } });
    if (json.success) loadDir();
    else setFsError(json.error || "Could not create folder.");
  };

  const deleteFs = async (fullPath: string) => {
    if (!window.confirm(`Delete ${fullPath}? This cannot be undone.`)) return;
    const json = await postMcp({ mcp: "filesystem", action: "delete", params: { path: fullPath } });
    if (json.success) loadDir();
    else setFsError(json.error || "Could not delete.");
  };

  const runFsSearch = async () => {
    if (!fsSearch.trim()) return;
    const json = await postMcp({ mcp: "filesystem", action: "search", params: { query: fsSearch.trim(), root: fsPath || undefined } });
    if (json.success) setFsResults(json.data || []);
    else setFsError(json.error || "Search failed.");
  };

  // ── Maps loaders ──
  const searchMaps = async () => {
    const q = mapQuery.trim();
    if (!q) return;
    setMapLoading(true);
    setMapError(null);
    try {
      const json = await postMcp({ mcp: "googlemaps", action: "search_places", params: { query: q, location: mapLocation.trim() || undefined } });
      if (json.success) {
        setMapPlaces(json.data || []);
        setMapSource(json.source || "");
      } else {
        setMapPlaces([]);
        setMapError(json.error || "Search failed.");
      }
    } catch (e: any) {
      setMapError(e?.message || "Network error searching places.");
    } finally {
      setMapLoading(false);
    }
  };

  const runDirections = async () => {
    if (!dirFrom.trim() || !dirTo.trim()) return;
    setDirLoading(true);
    setDirResult(null);
    try {
      const json = await postMcp({ mcp: "googlemaps", action: "get_directions", params: { origin: dirFrom, destination: dirTo } });
      if (json.success) setDirResult(json.data);
      else setMapError(json.error || "Could not get directions.");
    } finally {
      setDirLoading(false);
    }
  };

  useEffect(() => {
    loadWa();
    loadRoots();
    const t = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") loadWa();
    }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While a QR is pending, poll quickly so it appears the moment the daemon
  // mints it (a slow 15s poll made QR generation feel "forever").
  useEffect(() => {
    if (waState !== "awaiting_qr") return;
    const t = setInterval(loadWa, 2000);
    return () => clearInterval(t);
  }, [waState, loadWa]);

  // Refresh GitHub code view when switching to it.
  useEffect(() => {
    if (ghRepo && ghView !== "overview") loadRepoView(ghView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghView, ghRepo]);

  const tabs: { id: McpKey; label: string; icon: React.ReactNode; blurb: string }[] = [
    { id: "whatsapp", label: "WhatsApp", icon: <MessageSquare className="h-4 w-4 text-emerald-400" />, blurb: "Headless daemon" },
    { id: "diplomat", label: "Diplomat", icon: <Radio className="h-4 w-4 text-cyan-400" />, blurb: "Voice calling agent" },
    { id: "markprototype", label: "Mark CAD", icon: <Box className="h-4 w-4 text-amber-400" />, blurb: "Text-to-3D print" },
    { id: "github", label: "GitHub", icon: <GitBranch className="h-4 w-4 text-purple-400" />, blurb: "Any repo" },
    { id: "filesystem", label: "Filesystem", icon: <FolderTree className="h-4 w-4 text-blue-400" />, blurb: "Read · write" },
    { id: "googlemaps", label: "Maps", icon: <MapPin className="h-4 w-4 text-emerald-400" />, blurb: "Live places" },
  ];

  const crumbs = fsPath ? fsPath.split(/[\\/]/).filter(Boolean) : [];

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 p-4 md:p-6 text-white">
      {/* Header */}
      <div className={`${glassCard} overflow-hidden`}>
        <div className="flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400/30 to-blue-600/10 ring-1 ring-cyan-400/30">
              <Layers className="h-6 w-6 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Model Context Protocol (MCP) Hub</h1>
              <p className="text-sm text-white/45">
                Live tool integrations · {tabs.find((t) => t.id === activeMcp)?.blurb}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
            Real data & live hardware · zero mock fallbacks
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
        {tabs.map((t) => {
          const active = activeMcp === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveMcp(t.id)}
              className={`group flex items-center gap-2.5 rounded-2xl border p-3 text-left transition ${
                active
                  ? "border-cyan-400/40 bg-cyan-400/[0.08] shadow-[0_0_30px_-10px_rgba(34,211,238,0.6)]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
              }`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl transition ${
                  active ? "bg-cyan-400/20 text-cyan-200" : "bg-white/5 text-white/50 group-hover:text-white/80"
                }`}
              >
                {t.icon}
              </span>
              <span className="overflow-hidden">
                <span className="block truncate text-xs font-medium">{t.label}</span>
                <span className="block truncate text-[10px] text-white/40">{t.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeMcp}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {/* ═══════════ PROJECT DIPLOMAT ═══════════ */}
          {activeMcp === "diplomat" && <DiplomatTab initialNumber={dialSeed} />}

          {/* ═══════════ MARK PROTOTYPE 3D CAD ═══════════ */}
          {activeMcp === "markprototype" && <CadTab />}

          {/* ═══════════ WHATSAPP ═══════════ */}
          {activeMcp === "whatsapp" && (
            <div className={`${glassCard} space-y-6 p-6`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                      waState === "connected"
                        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                        : "border-amber-400/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${waState === "connected" ? "bg-emerald-400" : "bg-amber-400"}`} />
                    {waState === "connected"
                      ? "Connected"
                      : waState === "syncing"
                      ? "Syncing…"
                      : waState === "awaiting_qr"
                      ? "Awaiting QR scan"
                      : "Daemon offline"}
                  </span>
                  {waState === "offline" && (
                    <span className="text-xs text-white/40 font-mono">npm run whatsapp:server</span>
                  )}
                </div>
                <button type="button" className={ghostBtn} onClick={() => waAction("reset", "Session reset")} disabled={waBusy}>
                  <RotateCcw className={`h-4 w-4 ${waBusy ? "animate-spin" : ""}`} /> Reset session
                </button>
              </div>

              {waState === "awaiting_qr" && (
                <div className="flex flex-col items-center gap-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.05] p-6 sm:flex-row sm:items-center">
                  {waStatus?.qrCode ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={waStatus.qrCode} alt="WhatsApp QR" className="h-44 w-44 rounded-2xl border border-white/15 bg-white p-2" />
                  ) : (
                    <div className="grid h-44 w-44 place-items-center rounded-2xl border border-white/10 text-xs text-white/40">
                      Generating QR…
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-white/80">Link this device</p>
                    <p className="text-xs text-white/50">
                      Open WhatsApp → Settings → Linked devices → Link a device, and scan this code.
                    </p>
                    <p className="text-xs text-white/35">
                      If WhatsApp says &ldquo;couldn&apos;t link device&rdquo;, press <span className="text-amber-300">Reset session</span> and scan the fresh code.
                    </p>
                  </div>
                </div>
              )}

              {waFlash && (
                <div
                  className={`flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
                    waFlash.ok
                      ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200"
                      : "border-rose-400/25 bg-rose-500/10 text-rose-200"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" /> {waFlash.text}
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                {/* Sender */}
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-white/85">
                    <Send className="h-4 w-4 text-cyan-300" /> Send a message
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] uppercase tracking-wide text-white/40">Recipient (name or number)</label>
                    <input
                      list="wa-contacts"
                      value={waContact}
                      onChange={(e) => setWaContact(e.target.value)}
                      placeholder="e.g. Mom, Rahul, or 9196…"
                      className={subtleInput}
                    />
                    <datalist id="wa-contacts">
                      {waContacts.map((c, i) => (
                        <option key={i} value={c.name} />
                      ))}
                    </datalist>
                    <p className="text-[11px] text-white/35">
                      Type a contact name — no phone number needed. The daemon resolves it from your real contacts.
                    </p>
                  </div>
                  <textarea
                    rows={3}
                    value={waMessage}
                    onChange={(e) => setWaMessage(e.target.value)}
                    placeholder="Your message…"
                    className={`${subtleInput} resize-none`}
                  />
                  <button type="button" className={`${primaryBtn} w-full`} onClick={sendWa} disabled={waSending || !waContact || !waMessage.trim()}>
                    <Send className={`h-4 w-4 ${waSending ? "animate-pulse" : ""}`} />
                    {waSending ? "Sending…" : "Send via background daemon"}
                  </button>
                </div>

                {/* Contacts / chats */}
                <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-medium text-white/85">
                      <Users className="h-4 w-4 text-cyan-300" /> Contacts
                    </div>
                    <span className="text-[11px] text-white/35">{waContacts.length} saved</span>
                  </div>
                  <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                    {waContacts.length === 0 && (
                      <p className="py-4 text-center text-xs text-white/35">
                        {waState === "connected" ? "No saved contacts found." : "Connect WhatsApp to load contacts."}
                      </p>
                    )}
                    {waContacts.slice(0, 200).map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setWaContact(c.name)}
                        className="flex w-full items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-left transition hover:border-cyan-400/30 hover:bg-white/[0.05]"
                      >
                        <span className="truncate text-sm text-white/80">{c.name}</span>
                        <span className="ml-2 shrink-0 font-mono text-[11px] text-white/35">{c.number}</span>
                      </button>
                    ))}
                  </div>
                  {waChats.length > 0 && (
                    <>
                      <div className="flex items-center gap-2 pt-1 text-xs font-medium text-white/60">
                        <MessageSquare className="h-3.5 w-3.5" /> Recent chats
                      </div>
                      <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                        {waChats.slice(0, 20).map((c, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setWaContact(c.name)}
                            className="flex w-full items-start justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-left transition hover:border-cyan-400/30 hover:bg-white/[0.05]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-white/80">{c.name}</span>
                              <span className="block truncate text-[11px] text-white/35">{c.lastMessage}</span>
                            </span>
                            {c.unreadCount > 0 && (
                              <span className="shrink-0 rounded-full bg-cyan-500 px-1.5 text-[10px] font-semibold text-white">{c.unreadCount}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ GITHUB ═══════════ */}
          {activeMcp === "github" && (
            <div className={`${glassCard} space-y-5 p-6`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <Segmented
                  value={ghMode}
                  onChange={(v) => setGhMode(v as any)}
                  options={[
                    { id: "user", label: "By user / org" },
                    { id: "search", label: "Search repos" },
                  ]}
                />
                <span className="text-[11px] text-white/35 font-mono">Rate-limited only without GITHUB_TOKEN</span>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={ghQuery}
                  onChange={(e) => setGhQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadGhRepos()}
                  placeholder={ghMode === "search" ? "Search repositories (e.g. react, jarvis, nextjs)" : "Username or org (e.g. vercel, facebook, torvalds)"}
                  className={subtleInput}
                />
                <button type="button" className={primaryBtn} onClick={loadGhRepos} disabled={ghLoading || !ghQuery.trim()}>
                  <Search className={`h-4 w-4 ${ghLoading ? "animate-spin" : ""}`} /> {ghLoading ? "Fetching…" : "Fetch"}
                </button>
              </div>

              <ErrorBar message={ghError} />

              <AnimatePresence mode="wait">
                {!ghRepo ? (
                  <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2">
                    {ghRepos.length === 0 && !ghLoading && (
                      <Empty
                        icon={<GitBranch className="h-7 w-7" />}
                        title="No repositories loaded"
                        hint="Enter a GitHub user, org, or search term. Every public repo on GitHub is reachable; add GITHUB_TOKEN for private repos and issue creation."
                      />
                    )}
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ghRepos.map((r, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => openRepo(r.full_name)}
                          className="flex flex-col gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-cyan-400/30 hover:bg-white/[0.06]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate font-mono text-sm text-white/90">{r.full_name}</span>
                            {r.private && <Lock className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
                          </div>
                          <p className="line-clamp-2 text-xs text-white/45">{r.description}</p>
                          <div className="mt-1 flex items-center gap-3 text-[11px] text-white/45">
                            {r.language && <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono">{r.language}</span>}
                            <span className="inline-flex items-center gap-1">
                              <Star className="h-3 w-3 text-amber-300" /> {r.stars}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <CircleDot className="h-3 w-3" /> {r.open_issues}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div key="repo" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    <div className="mb-3 flex items-center gap-2">
                      <button type="button" className={ghostBtn} onClick={() => setGhRepo(null)}>
                        ← All repos
                      </button>
                      <span className="truncate font-mono text-sm text-white/85">{ghRepo.full_name}</span>
                      {ghDetail && (
                        <a href={ghDetail.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-cyan-300 hover:text-cyan-200">
                          <ExternalLink className="h-3.5 w-3.5" /> GitHub
                        </a>
                      )}
                      <div className="ml-auto flex items-center gap-2">
                        <button type="button" className={ghostBtn} style={{ padding: "0.3rem 0.7rem" }} onClick={createGhIssue}>
                          <Plus className="h-3.5 w-3.5" /> Issue
                        </button>
                        <button type="button" className={ghostBtn} style={{ padding: "0.3rem 0.7rem" }} onClick={createGhPr}>
                          <GitPullRequest className="h-3.5 w-3.5" /> PR
                        </button>
                      </div>
                    </div>

                    <Segmented
                      value={ghView}
                      onChange={(v) => {
                        setGhView(v as any);
                        if (v !== "code") setGhFile(null);
                      }}
                      options={[
                        { id: "overview", label: "Overview" },
                        { id: "code", label: "Code" },
                        { id: "issues", label: "Issues", icon: <CircleDot className="h-3 w-3" /> },
                        { id: "pulls", label: "PRs", icon: <GitPullRequest className="h-3 w-3" /> },
                        { id: "commits", label: "Commits", icon: <GitCommit className="h-3 w-3" /> },
                      ]}
                    />

                    <ErrorBar message={ghPanelError} />

                    <div className="mt-4">
                      {ghPanelLoading && <p className="py-6 text-center text-sm text-white/40">Loading…</p>}

                      {!ghPanelLoading && ghView === "overview" && ghDetail && (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                              { label: "Stars", value: ghDetail.stars },
                              { label: "Forks", value: ghDetail.forks },
                              { label: "Open issues", value: ghDetail.open_issues },
                              { label: "Watchers", value: ghDetail.watchers },
                            ].map((s) => (
                              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                                <div className="text-lg font-semibold">{s.value ?? "—"}</div>
                                <div className="text-[11px] text-white/40">{s.label}</div>
                              </div>
                            ))}
                          </div>
                          <p className="text-sm text-white/70">{ghDetail.description || "No description."}</p>
                          <div className="flex flex-wrap gap-2 text-[11px] text-white/50">
                            {ghDetail.language && <span className="rounded-full bg-white/5 px-2 py-1 font-mono">{ghDetail.language}</span>}
                            {ghDetail.license && <span className="rounded-full bg-white/5 px-2 py-1">{ghDetail.license}</span>}
                            <span className="rounded-full bg-white/5 px-2 py-1">default: {ghDetail.default_branch}</span>
                            {ghDetail.archived && <span className="rounded-full bg-amber-500/15 px-2 py-1 text-amber-300">archived</span>}
                          </div>
                        </div>
                      )}

                      {!ghPanelLoading && ghView === "code" && (
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-black/20">
                            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 font-mono text-xs text-white/50">
                              <button type="button" onClick={() => { setGhCodePath(""); setGhFile(null); }} className="hover:text-cyan-300">
                                {ghRepo.full_name}
                              </button>
                              {ghCodePath && <span>/ {ghCodePath}</span>}
                            </div>
                            <div className="max-h-80 space-y-1 overflow-y-auto p-2">
                              {ghContents.length === 0 && <p className="p-3 text-center text-xs text-white/35">Empty directory.</p>}
                              {ghContents.map((f: any, i: number) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => {
                                    if (f.type === "dir") {
                                      setGhCodePath(f.path);
                                      setGhFile(null);
                                      loadRepoView("code", f.path);
                                    } else {
                                      openGhFile(f.path, f.html_url);
                                    }
                                  }}
                                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-white/75 transition hover:bg-white/[0.06] hover:text-white"
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    {f.type === "dir" ? <Folder className="h-4 w-4 shrink-0 text-cyan-300" /> : <FileCode className="h-4 w-4 shrink-0 text-white/40" />}
                                    <span className="truncate font-mono text-xs">{f.name}</span>
                                  </span>
                                  {f.size != null && <span className="shrink-0 font-mono text-[10px] text-white/30">{f.size} B</span>}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-black/30 p-3">
                            {ghFile ? (
                              <>
                                <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2 font-mono text-xs text-cyan-300">
                                  <span className="truncate">{ghFile.path}</span>
                                  <a href={ghFile.html_url} target="_blank" rel="noreferrer" className="text-white/40 hover:text-cyan-300">
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </div>
                                <pre className="max-h-72 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-white/80">{ghFile.content.slice(0, 20000)}</pre>
                              </>
                            ) : (
                              <div className="grid h-48 place-items-center text-xs text-white/30">Select a file to inspect it</div>
                            )}
                          </div>
                        </div>
                      )}

                      {!ghPanelLoading && (ghView === "issues" || ghView === "pulls" || ghView === "commits") && (
                        <div className="space-y-2">
                          {ghContents.length === 0 && (
                            <Empty
                              icon={ghView === "issues" ? <CircleDot className="h-7 w-7" /> : ghView === "pulls" ? <GitPullRequest className="h-7 w-7" /> : <GitCommit className="h-7 w-7" />}
                              title={`No ${ghView} found`}
                            />
                          )}
                          {ghContents.map((item: any, i: number) => (
                            <a
                              key={i}
                              href={item.html_url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 transition hover:border-cyan-400/30 hover:bg-white/[0.06]"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm text-white/85">
                                    {ghView === "commits" ? item.message : `#${item.number} ${item.title}`}
                                  </p>
                                  <p className="mt-0.5 text-[11px] text-white/40">
                                    {ghView === "commits"
                                      ? `${item.author} · ${item.sha}`
                                      : `${item.user || "unknown"}${item.state ? ` · ${item.state}` : ""}${item.base ? ` · ${item.head} → ${item.base}` : ""}`}
                                  </p>
                                </div>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-white/30" />
                              </div>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* ═══════════ FILESYSTEM ═══════════ */}
          {activeMcp === "filesystem" && (
            <div className={`${glassCard} space-y-5 p-6`}>
              <div className="flex flex-wrap gap-2">
                {fsRoots.map((r) => (
                  <button
                    key={r.path}
                    type="button"
                    onClick={() => loadDir(r.path)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                      fsPath === r.path
                        ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                        : "border-white/10 bg-white/[0.03] text-white/60 hover:border-white/20 hover:text-white/90"
                    }`}
                  >
                    <FolderTree className="h-3.5 w-3.5" /> {r.label}
                  </button>
                ))}
                {fsRoots.length === 0 && <span className="text-xs text-white/35">Loading roots…</span>}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2">
                  <input
                    value={fsPath}
                    onChange={(e) => setFsPath(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && loadDir(fsPath)}
                    placeholder="Absolute or project-relative path…"
                    className="flex-1 bg-transparent font-mono text-xs text-white/85 outline-none"
                  />
                </div>
                <button type="button" className={primaryBtn} onClick={() => loadDir(fsPath)} disabled={fsLoading}>
                  <RefreshCw className={`h-4 w-4 ${fsLoading ? "animate-spin" : ""}`} /> Open
                </button>
                <div className="flex gap-2">
                  <button type="button" className={ghostBtn} onClick={() => loadDir(fsParent || fsPath)} disabled={!fsParent}>
                    <ChevronUp className="h-4 w-4" /> Up
                  </button>
                  <button type="button" className={ghostBtn} onClick={newFsFile}>
                    <FilePlus2 className="h-4 w-4" /> File
                  </button>
                  <button type="button" className={ghostBtn} onClick={newFsFolder}>
                    <FolderPlus className="h-4 w-4" /> Folder
                  </button>
                </div>
              </div>

              {/* Breadcrumb */}
              <div className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-white/40">
                {crumbs.map((c, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <ChevronRight className="h-3 w-3" />}
                    <span className="text-white/60">{c}</span>
                  </React.Fragment>
                ))}
                {!fsWritable && <span className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300">read-only (outside project)</span>}
              </div>

              <div className="flex gap-2">
                <input
                  value={fsSearch}
                  onChange={(e) => setFsSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runFsSearch()}
                  placeholder="Search filenames in this folder…"
                  className={subtleInput}
                />
                <button type="button" className={ghostBtn} onClick={runFsSearch}>
                  <Search className="h-4 w-4" /> Find
                </button>
              </div>

              <ErrorBar message={fsError} />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-black/20">
                  <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[11px] text-white/40">
                    <span className="truncate font-mono">{fsPath || "—"}</span>
                    <span>{fsResults.length > 0 ? `${fsResults.length} matches` : `${fsEntries.length} items`}</span>
                  </div>
                  <div className="max-h-80 space-y-0.5 overflow-y-auto p-2">
                    {(fsResults.length > 0 ? fsResults : fsEntries).map((e: any, i: number) => {
                      const full = e.path || (fsPath ? `${fsPath.replace(/[\\/]$/, "")}/${e.name}` : e.name);
                      return (
                        <div key={i} className="group flex items-center justify-between rounded-xl px-2 py-1.5 transition hover:bg-white/[0.06]">
                          <button
                            type="button"
                            onClick={() => (e.isDirectory ? loadDir(full) : openFsFile(full))}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            {e.isDirectory ? <Folder className="h-4 w-4 shrink-0 text-cyan-300" /> : <FileCode className="h-4 w-4 shrink-0 text-white/40" />}
                            <span className="truncate font-mono text-xs text-white/75">{e.name}</span>
                          </button>
                          <div className="flex items-center gap-2">
                            {e.size != null && <span className="font-mono text-[10px] text-white/30">{Math.max(1, Math.round(e.size / 1024))} KB</span>}
                            {e.writable && (
                              <button type="button" onClick={() => deleteFs(full)} className="opacity-0 transition group-hover:opacity-100" title="Delete">
                                <Trash2 className="h-3.5 w-3.5 text-rose-300/70 hover:text-rose-300" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {fsEntries.length === 0 && fsResults.length === 0 && (
                      <p className="p-4 text-center text-xs text-white/35">Pick a folder above to browse.</p>
                    )}
                  </div>
                </div>

                {/* Viewer / editor */}
                <div className="rounded-2xl border border-white/10 bg-black/30">
                  {fsFile ? (
                    <div className="flex h-full flex-col">
                      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
                        <span className="truncate font-mono text-[11px] text-cyan-300">{fsFile.name}</span>
                        <div className="flex items-center gap-2">
                          {fsFile.writable && !fsFile.isBinary && (
                            <button type="button" className={primaryBtn} style={{ padding: "0.35rem 0.75rem" }} onClick={saveFsFile} disabled={fsSaving}>
                              <Save className="h-3.5 w-3.5" /> {fsSaving ? "Saving…" : "Save"}
                            </button>
                          )}
                          <button type="button" onClick={() => setFsFile(null)} className="text-white/40 hover:text-white">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      {fsFile.writable && !fsFile.isBinary ? (
                        <textarea
                          value={fsDraft}
                          onChange={(e) => setFsDraft(e.target.value)}
                          spellCheck={false}
                          className="h-80 w-full resize-none bg-transparent p-3 font-mono text-[11px] leading-relaxed text-white/85 outline-none"
                        />
                      ) : (
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 font-mono text-[11px] leading-relaxed text-white/70">
                          {typeof fsFile.content === "string" ? fsFile.content.slice(0, 20000) : ""}
                        </pre>
                      )}
                    </div>
                  ) : (
                    <div className="grid h-56 place-items-center text-xs text-white/30">Select a file to inspect or edit</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ═══════════ MAPS ═══════════ */}
          {activeMcp === "googlemaps" && (
            <div className={`${glassCard} space-y-5 p-6`}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={mapQuery}
                  onChange={(e) => setMapQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchMaps()}
                  placeholder="What are you looking for? e.g. pizza places, dentist, petrol pump"
                  className={subtleInput}
                />
                <input
                  value={mapLocation}
                  onChange={(e) => setMapLocation(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchMaps()}
                  placeholder="Where? e.g. Bagalkot, Indiranagar Bangalore"
                  className={`${subtleInput} sm:max-w-[260px]`}
                />
                <button type="button" className={primaryBtn} onClick={searchMaps} disabled={mapLoading || !mapQuery.trim()}>
                  <Search className={`h-4 w-4 ${mapLoading ? "animate-spin" : ""}`} /> {mapLoading ? "Searching…" : "Search"}
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                {mapSource && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-white/45">
                    <Globe className="h-3.5 w-3.5 text-cyan-300" /> {mapSource}
                  </span>
                )}
                <button type="button" className={ghostBtn} onClick={() => setShowDirections((s) => !s)}>
                  <Navigation className="h-4 w-4" /> Directions
                </button>
              </div>

              <ErrorBar message={mapError} />

              <AnimatePresence>
                {showDirections && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input value={dirFrom} onChange={(e) => setDirFrom(e.target.value)} placeholder="From" className={subtleInput} />
                        <input value={dirTo} onChange={(e) => setDirTo(e.target.value)} placeholder="To" className={subtleInput} />
                        <button type="button" className={primaryBtn} onClick={runDirections} disabled={dirLoading}>
                          <Navigation className={`h-4 w-4 ${dirLoading ? "animate-spin" : ""}`} /> Go
                        </button>
                      </div>
                      {dirResult && (
                        <div className="space-y-2 text-sm">
                          <p className="text-white/80">
                            {dirResult.distanceKm} km · about {dirResult.durationMin} min by car
                          </p>
                          <p className="text-xs text-white/45">
                            {dirResult.origin} → {dirResult.destination}
                          </p>
                          <button
                            type="button"
                            className={ghostBtn}
                            onClick={() => dirResult.mapsUrl && window.open(dirResult.mapsUrl, "_blank", "noopener")}
                          >
                            <MapPin className="h-4 w-4" /> Open in Google Maps
                          </button>
                          {dirResult.steps?.length > 0 && (
                            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-white/60">
                              {dirResult.steps.slice(0, 12).map((s: string, i: number) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ol>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="grid gap-3 sm:grid-cols-2">
                {mapPlaces.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => p.mapsUrl && window.open(p.mapsUrl, "_blank", "noopener")}
                    className="group flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:border-cyan-400/30 hover:bg-white/[0.06]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium text-white/90">{p.name}</h3>
                      {p.rating != null && (
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-300">
                          <Star className="h-3 w-3 fill-amber-300" /> {p.rating}
                        </span>
                      )}
                    </div>
                    {p.category && <span className="w-fit rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">{p.category}</span>}
                    <p className="text-xs text-white/50">{p.address}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-white/40">
                      {p.totalRatings != null && <span>{p.totalRatings} reviews</span>}
                      {p.priceLevel && <span>{p.priceLevel}</span>}
                      {p.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" /> {p.phone}
                        </span>
                      )}
                    </div>
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-cyan-300 opacity-70 transition group-hover:opacity-100">
                      <MapPin className="h-3.5 w-3.5" /> Open in Maps
                    </span>
                  </button>
                ))}
              </div>

              {mapPlaces.length === 0 && !mapLoading && (
                <Empty
                  icon={<MapPin className="h-7 w-7" />}
                  title="Search real places anywhere"
                  hint="Results come from live Google Maps data, anchored to the location you type — e.g. “pizza places” in “Bagalkot”. Click a result to open it in Maps."
                />
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
