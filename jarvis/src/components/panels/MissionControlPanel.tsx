"use client";

// Mission Control v5 — command deck.
//
// Left: mission composer + live DAG timeline (with cost/risk preview, specialist
//       delegations, per-step output, checkpoint answers, final report).
// Right: live feed + mission history + artifacts + follow-up chat.
//
// v5 additions:
//  - Planner cost/risk preview before approval
//  - Autonomous-browser / delegate / video step identities
//  - Artifacts panel (screenshots, files, links, video briefs)
//  - Post-mission conversational follow-up scoped to the mission
//  - One-click video brief
//  - "Partial" completion state
//  - JARVIS-styled motion throughout

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Send,
  Check,
  Loader2,
  Sparkles,
  RotateCcw,
  Globe,
  Search,
  Brain,
  FileText,
  Save,
  Bell,
  MousePointerClick,
  ExternalLink,
  HelpCircle,
  Activity,
  Radar,
  Zap,
  Music,
  Cloud,
  MapPin,
  Video,
  CheckSquare,
  History,
  Clock,
  ChevronDown,
  ChevronUp,
  Rocket,
  Timer,
  Terminal,
  Eye,
  FolderSearch,
  FileOutput,
  CircleAlert,
  CircleCheck,
  MinusCircle,
  Camera,
  KeyRound,
  Play,
  Bot,
  Clapperboard,
  Download,
  MessageSquare,
  Gauge,
  ShieldAlert,
  Image as ImageIcon,
  Monitor,
  Radio,
  FlaskConical,
  Server,
} from "lucide-react";
import { STEP_KIND_LABELS, type AgentJob, type JobStatus, type MissionArtifact, type BrowserRecording } from "@/lib/agent/types";
import type { MissionEvent } from "@/lib/agent/events";
import { useJarvisStore } from "@/store/jarvis.store";
import Markdown from "@/components/panels/Markdown";
import MissionOpsCard from "@/components/panels/MissionOpsCard";

interface MissionControlPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Phase = "idle" | "planning" | "preview" | "running" | "done" | "error";

interface HistoryItem {
  id: string;
  goal: string;
  status: JobStatus;
  createdAt: number;
  finishedAt?: number;
  partial?: boolean;
  creditsUsed?: number;
}

const STATUS_COLOR: Record<JobStatus, string> = {
  planning: "text-text-secondary",
  awaiting_approval: "text-accent-amber",
  running: "text-reactor-core",
  paused_checkpoint: "text-accent-amber",
  done: "text-accent-green",
  failed: "text-accent-red",
  cancelled: "text-text-secondary/60",
};

const STATUS_LABEL: Record<JobStatus, string> = {
  planning: "Planning…",
  awaiting_approval: "Awaiting approval",
  running: "Running",
  paused_checkpoint: "Waiting for you",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

const RISK_STYLE: Record<string, string> = {
  low: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  medium: "border-accent-amber/40 bg-accent-amber/10 text-accent-amber",
  high: "border-accent-red/40 bg-accent-red/10 text-accent-red",
};

/**
 * Only genuinely critical goals keep the approval gate: things that run code
 * or commands on this PC. Sign-ins, replays and every browser/website action
 * run immediately — waiting for a nod on those was pure friction.
 */
const CRITICAL_RE =
  /\b(shell|terminal|command line|run the (command|script)|execute the (command|script)|npm install|install|uninstall|restart the (server|dev)|registry|sudo|admin|format the|wipe|delete (the )?(folder|directory|file))\b/i;
const isCritical = (text: string) => CRITICAL_RE.test(text);

const EXAMPLES: Array<{ icon: React.ReactNode; text: string; heavy: boolean }> = [
  { icon: <Video className="w-3 h-3" />, text: "Find the best free movie to watch tonight and open it", heavy: false },
  { icon: <Globe className="w-3 h-3" />, text: "Open Amazon in a real browser, search for a USB-C hub under ₹2000, and report the top 3 with prices", heavy: false },
  { icon: <Bot className="w-3 h-3" />, text: "Research the latest NVIDIA GPU, compare it with the previous generation, and write me a two-minute video brief", heavy: false },
  { icon: <Radar className="w-3 h-3" />, text: "Check the price of the Sony WH-1000XM5 on Flipkart and Amazon and tell me the cheapest", heavy: false },
  { icon: <KeyRound className="w-3 h-3" />, text: "Sign in to LinkedIn and then tell me which of my connections changed jobs this month", heavy: false },
  { icon: <Play className="w-3 h-3" />, text: "Replay my saved browser recording \"Daily orders\" and tell me what changed", heavy: false },
  { icon: <Music className="w-3 h-3" />, text: "Find today's weather, play matching music on Spotify, and open tech news on YouTube", heavy: false },
  { icon: <FlaskConical className="w-3 h-3" />, text: "Research the best mechanical keyboard under 5000, extract the specs of the top pick, save it to notes and send it to my Telegram", heavy: false },
  { icon: <Terminal className="w-3 h-3" />, text: "Open my project in VS Code and check whether my dev server is running", heavy: true },
  { icon: <Server className="w-3 h-3" />, text: "Start my dev server and tell me when it's up", heavy: true },
  { icon: <FolderSearch className="w-3 h-3" />, text: "My Downloads folder is a mess — sort it into folders (dry run first)", heavy: true },
];

// Icon per step kind — gives each step a visual identity in the plan.
const KIND_ICON: Record<string, React.ReactNode> = {
  firecrawl_search: <Search className="w-3 h-3" />,
  web_search: <Search className="w-3 h-3" />,
  web_scrape: <Globe className="w-3 h-3" />,
  firecrawl_extract: <Brain className="w-3 h-3" />,
  change_tracking: <Activity className="w-3 h-3" />,
  llm_decide: <Brain className="w-3 h-3" />,
  llm_summarize: <FileText className="w-3 h-3" />,
  deep_research: <Radar className="w-3 h-3" />,
  memory_store: <Save className="w-3 h-3" />,
  notify: <Bell className="w-3 h-3" />,
  playwright_action: <MousePointerClick className="w-3 h-3" />,
  browser_open: <ExternalLink className="w-3 h-3" />,
  checkpoint: <HelpCircle className="w-3 h-3" />,
  spotify_action: <Music className="w-3 h-3" />,
  weather_lookup: <Cloud className="w-3 h-3" />,
  maps_open: <MapPin className="w-3 h-3" />,
  youtube_open: <Video className="w-3 h-3" />,
  notes_create: <FileText className="w-3 h-3" />,
  task_create: <CheckSquare className="w-3 h-3" />,
  file_save: <Save className="w-3 h-3" />,
  timer_set: <Timer className="w-3 h-3" />,
  telegram_send: <Send className="w-3 h-3" />,
  shell_command: <Terminal className="w-3 h-3" />,
  vision_inspect: <Eye className="w-3 h-3" />,
  file_list: <FolderSearch className="w-3 h-3" />,
  file_open: <FileOutput className="w-3 h-3" />,
  browser_act: <Globe className="w-3 h-3" />,
  browser_screenshot: <Camera className="w-3 h-3" />,
  browser_login: <KeyRound className="w-3 h-3" />,
  browser_replay: <Play className="w-3 h-3" />,
  delegate: <Bot className="w-3 h-3" />,
  video_brief: <Clapperboard className="w-3 h-3" />,
  dev_server_start: <Server className="w-3 h-3" />,
  dev_server_stop: <Server className="w-3 h-3" />,
  dev_server_status: <Radio className="w-3 h-3" />,
  file_organize: <FolderSearch className="w-3 h-3" />,
  repo_inspect: <FlaskConical className="w-3 h-3" />,
};

interface FeedItem {
  key: string;
  at: number;
  message: string;
  tone: "info" | "start" | "ok" | "error" | "warn";
}

/** Relative time for the history rail ("just now", "4m ago", "2h ago", date). */
function relTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** URL that serves a stored artifact file through the guarded API route. */
function artifactUrl(a: MissionArtifact): string {
  if (a.kind === "url") return a.value;
  return `/api/agent/artifact?path=${encodeURIComponent(a.value)}`;
}

const ARTIFACT_LABEL: Record<MissionArtifact["kind"], string> = {
  file: "File",
  note: "Note",
  url: "Link",
  image: "Image",
  report: "Report",
  video: "Video",
};

export default function MissionControlPanel({ isOpen, onClose }: MissionControlPanelProps) {
  const [goal, setGoal] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [job, setJob] = useState<AgentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [checkpointPick, setCheckpointPick] = useState("");
  const [checkpointQuestion, setCheckpointQuestion] = useState<string | null>(null);
  const [checkpointOptions, setCheckpointOptions] = useState<string[]>([]);
  const [autoOpened, setAutoOpened] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [now, setNow] = useState(Date.now());
  const [followupInput, setFollowupInput] = useState("");
  const [followupBusy, setFollowupBusy] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [recordings, setRecordings] = useState<BrowserRecording[]>([]);
  const [recName, setRecName] = useState("");
  const [recUrl, setRecUrl] = useState("");
  const [liveRecId, setLiveRecId] = useState<string | null>(null);
  const [recBusy, setRecBusy] = useState(false);
  const [aborting, setAborting] = useState(false);
  // Show the real Chromium window while autonomous browser steps run.
  const [watch, setWatch] = useState(false);
  // Live frame metadata streamed out of the running browser step.
  const [liveMeta, setLiveMeta] = useState<{
    active: boolean;
    hasFrame: boolean;
    url?: string;
    title?: string;
    action?: string;
    stepId?: string;
    seq?: number;
  } | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const historyRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef<HTMLDivElement | null>(null);
  const autoOpenedRef = useRef<Set<string>>(new Set());
  // When we open a recent mission from history, suppress the toast for its
  // already-seen live events.
  const historyAtRef = useRef<Map<string, number>>(new Map());

  // Goal handed over from the CommandBar (voice / chat) — auto-run on open.
  const pendingGoal = useJarvisStore((s) => s.pendingMissionGoal);
  const setPendingMissionGoal = useJarvisStore((s) => s.setPendingMissionGoal);

  /* ── live event stream (SSE) ─────────────────────────────────────── */

  const stopStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const startStream = useCallback(
    (jobId: string) => {
      stopStream();
      const es = new EventSource(`/api/agent/events?jobId=${encodeURIComponent(jobId)}`);
      esRef.current = es;
      es.addEventListener("mission", (ev: MessageEvent<string>) => {
        try {
          const e = JSON.parse(ev.data) as MissionEvent;
          if (e.type === "checkpoint") {
            const opts = Array.isArray(e.data?.options) ? (e.data?.options as unknown[]).map(String).slice(0, 5) : [];
            setCheckpointQuestion(e.message);
            setCheckpointOptions(opts);
          }

          // Toast only for events that arrive after we opened the mission.
          const seenAt = historyAtRef.current.get(jobId);
          const fresh = !seenAt || e.at >= seenAt + 2_000;

          const tone: FeedItem["tone"] =
            e.type === "error" ? "error" : e.type === "checkpoint" ? "warn" : e.type === "step_started" ? "start" : e.type === "step_finished" ? "ok" : "info";
          setFeed((prev) => {
            if (prev.some((x) => x.key === `s${e.seq}`)) return prev;
            return [...prev, { key: `s${e.seq}`, at: e.at, message: e.message, tone }].slice(-120);
          });
          if (fresh && e.type === "error") {
            setError((prev) => prev ?? e.message.slice(0, 200));
          }

          // Vocalizer: if the event includes speech text speak it aloud.
          const speakText = e.data?.speakText;
          if (typeof window !== "undefined" && window.speechSynthesis && typeof speakText === "string" && speakText) {
            try {
              window.speechSynthesis.cancel();
              const u = new SpeechSynthesisUtterance(speakText);
              u.rate = 1.0;
              u.pitch = 1.0;
              window.speechSynthesis.speak(u);
            } catch {
              // speech synthesis blocked or unavailable
            }
          }

          // Client-side opener: browser_open steps queue URLs in the event
          // payload; window.open them on the gesture chain we still have.
          const openUrls = e.data?.openUrls;
          if (e.type === "log" && Array.isArray(openUrls)) {
            const urls = (openUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("http"));
            for (const u of urls) {
              if (!autoOpenedRef.current.has(u)) {
                autoOpenedRef.current.add(u);
                window.open(u, "_blank", "noopener");
              }
            }
            if (urls.length > 0) setAutoOpened((prev) => [...prev, ...urls]);
          }
        } catch {
          // malformed event — skip
        }
      });
      es.onerror = () => {
        // EventSource auto-reconnects; the server replays the buffer and
        // we dedupe on seq.
      };
    },
    [stopStream]
  );

  useEffect(() => {
    return () => {
      stopStream();
      if (pollRef.current) clearInterval(pollRef.current);
      if (historyRef.current) clearInterval(historyRef.current);
    };
  }, [stopStream]);

  /* ── status polling (source of truth for job state) ──────────────── */

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/agent?jobId=${encodeURIComponent(jobId)}`);
          if (!res.ok) return;
          const j: AgentJob = await res.json();
          setJob(j);
          if (j.status === "paused_checkpoint") {
            setCheckpointPick(""); // reset the free-text answer field
          } else {
            setCheckpointQuestion(null);
            setCheckpointOptions([]);
          }
          if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
            // A cancelled mission is a neutral outcome, not an error state.
            setPhase(j.status === "failed" ? "error" : "done");
            stopPolling();
            stopStream();
            setLiveMeta(null);
            void refreshHistory();
          }
        } catch {
          // ignore
        }
      }, 1200);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [stopPolling, stopStream]
  );

  /* ── mission history rail ────────────────────────────────────────── */

  const refreshHistory = useCallback(async () => {
    try {
      // Lightweight summaries keep the 4s poll cheap even with 100s of missions.
      const res = await fetch("/api/agent?summary=1");
      if (!res.ok) return;
      const data = await res.json();
      const jobs: HistoryItem[] = Array.isArray(data?.jobs) ? data.jobs : [];
      setHistory(jobs.slice(0, 30));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshHistory();
    historyRef.current = setInterval(() => {
      void refreshHistory();
      setNow(Date.now());
    }, 4000);
    return () => {
      if (historyRef.current) {
        clearInterval(historyRef.current);
        historyRef.current = null;
      }
    };
  }, [isOpen, refreshHistory]);

  /* ── actions ─────────────────────────────────────────────────────── */

  const submitGoal = async (g?: string) => {
    const text = (g ?? goal).trim();
    if (!text) return;
    setError(null);
    setPhase("planning");
    setJob(null);
    setFeed([]);
    setExpandedStep(null);
    autoOpenedRef.current = new Set();
    setAutoOpened([]);
    setFollowupInput("");
    // Critical (PC-executing) goals keep the approval gate; everything else
    // rides the fast lane. The server re-checks this — a plan that runs shell
    // commands is always gated regardless of what the panel asks for.
    const critical = isCritical(text);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: text, auto: !critical, watch }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j: AgentJob = await res.json();
      setJob(j);
      void refreshHistory();
      if (j.status === "failed") {
        setError(j.error || "Planning failed");
        setPhase("error");
      } else if (j.status === "running") {
        setPhase("running");
        startStream(j.id);
        startPolling(j.id);
      } else if (j.status === "awaiting_approval") {
        setPhase("preview");
      } else {
        setPhase("preview");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  };

  const approve = async () => {
    if (!job) return;
    setPhase("running");
    setFeed([]);
    startStream(job.id);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "approve" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j: AgentJob = await res.json();
      setJob(j);
      if (j.status === "awaiting_approval") {
        // Server refused fast-lane (interactive/PC step) — stay on the gate.
        setPhase("preview");
        stopStream();
        return;
      }
      if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
        setPhase(j.status === "done" ? "done" : "error");
        stopStream();
        return;
      }
      startPolling(j.id);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      stopStream();
    }
  };

  const cancel = async () => {
    if (!job || aborting) return;
    setAborting(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "cancel" }),
      });
      if (res.ok) {
        const j: AgentJob = await res.json();
        // Keep the mission on screen as cancelled — wiping it made the button
        // feel like it did nothing.
        setJob(j);
      }
    } catch {
      // ignore
    }
    // An in-flight browser step stops cooperatively, so poll until the server
    // settles the job instead of assuming the abort landed instantly.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 800));
      try {
        const res = await fetch(`/api/agent?jobId=${encodeURIComponent(job.id)}`);
        if (!res.ok) break;
        const j: AgentJob = await res.json();
        setJob(j);
        if (j.status === "cancelled" || j.status === "done" || j.status === "failed") break;
      } catch {
        break;
      }
    }
    stopPolling();
    stopStream();
    setAborting(false);
    setPhase("done");
    setLiveMeta(null);
    void refreshHistory();
  };

  const resume = async (pick: string) => {
    if (!job || !pick.trim()) return;
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "resume", pick: pick.trim() }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const j: AgentJob = await res.json();
      setJob(j);
      setCheckpointQuestion(null);
      setCheckpointOptions([]);
      if (j.status === "done" || j.status === "failed" || j.status === "cancelled") {
        setPhase(j.status === "done" ? "done" : "error");
        stopPolling();
        stopStream();
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const reset = () => {
    stopPolling();
    stopStream();
    setJob(null);
    setPhase("idle");
    setError(null);
    setGoal("");
    setFeed([]);
    setCheckpointQuestion(null);
    setCheckpointOptions([]);
    setFollowupInput("");
  };

  /** Open a mission from the history rail. */
  const openJob = async (jobId: string) => {
    stopPolling();
    stopStream();
    setError(null);
    setExpandedStep(null);
    setCheckpointQuestion(null);
    setCheckpointOptions([]);
    setFollowupInput("");
    try {
      const res = await fetch(`/api/agent?jobId=${encodeURIComponent(jobId)}`);
      if (!res.ok) throw new Error("Mission not found (server restarted?)");
      const j: AgentJob = await res.json();
      historyAtRef.current.set(jobId, Date.now());
      setJob(j);
      setGoal(j.goal);
      autoOpenedRef.current = new Set();
      setAutoOpened([]);

      // Rebuild the feed from stored step results.
      const items: FeedItem[] = [];
      for (const r of j.results) {
        const step = j.plan?.steps.find((s) => s.id === r.stepId);
        const title = step?.title ?? r.stepId;
        if (r.status === "ok") {
          const out = r.result as Record<string, unknown> | undefined;
          const note = typeof out?.summary === "string" ? String(out.summary).slice(0, 100) : "";
          items.push({ key: `r${r.stepId}`, at: r.finishedAt, message: `${title} — done${note ? `: ${note}` : ""}`, tone: "ok" });
        } else if (r.status === "error") {
          items.push({ key: `r${r.stepId}`, at: r.finishedAt, message: `${title} — failed: ${(r.error ?? "").slice(0, 90)}`, tone: "error" });
        } else {
          items.push({ key: `r${r.stepId}`, at: r.finishedAt, message: `Skipped: ${title}`, tone: "warn" });
        }
      }
      setFeed(items);

      if (j.status === "running" || j.status === "paused_checkpoint" || j.status === "planning") {
        setPhase(j.status === "planning" ? "planning" : "running");
        startStream(j.id);
        startPolling(j.id);
      } else {
        setPhase(j.status === "failed" ? "error" : "done");
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /* ── follow-up conversation ──────────────────────────────────────── */

  const sendFollowup = async () => {
    if (!job || !followupInput.trim() || followupBusy) return;
    const message = followupInput.trim();
    setFollowupBusy(true);
    setFollowupInput("");
    // Optimistically show the user's turn.
    setJob((prev) =>
      prev ? { ...prev, followups: [...(prev.followups ?? []), { role: "user", content: message, at: Date.now() }] } : prev
    );
    try {
      const res = await fetch("/api/agent/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setJob((prev) => (prev ? { ...prev, followups: data.turns ?? prev.followups } : prev));
    } catch (e) {
      setJob((prev) =>
        prev
          ? {
              ...prev,
              followups: [
                ...(prev.followups ?? []),
                { role: "assistant", content: `⚠️ ${(e as Error).message}`, at: Date.now() },
              ],
            }
          : prev
      );
    } finally {
      setFollowupBusy(false);
    }
  };

  /* ── video brief ─────────────────────────────────────────────────── */

  const makeVideoBrief = async () => {
    if (!job || briefBusy) return;
    setBriefBusy(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, action: "video_brief" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (typeof data.path === "string") {
        setJob((prev) =>
          prev
            ? {
                ...prev,
                artifacts: [
                  ...(prev.artifacts ?? []),
                  { id: `brief_${Date.now()}`, kind: "video", label: "Mission video brief", value: data.path, at: Date.now() },
                ],
              }
            : prev
        );
        window.open(`/api/agent/artifact?path=${encodeURIComponent(data.path)}`, "_blank", "noopener");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBriefBusy(false);
    }
  };

  /* ── browser cookbook (record → replay) ──────────────────────────── */

  const loadRecordings = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/record");
      if (!res.ok) return;
      const data = await res.json();
      setRecordings(Array.isArray(data?.recordings) ? data.recordings : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadRecordings();
  }, [isOpen, loadRecordings]);

  const startRec = async () => {
    if (!/^https?:\/\//.test(recUrl.trim())) {
      setError("Enter a full http(s) URL to start recording.");
      return;
    }
    setRecBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/agent/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", name: recName.trim() || recUrl.trim(), url: recUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLiveRecId(data.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecBusy(false);
    }
  };

  const stopRec = async () => {
    if (!liveRecId) return;
    setRecBusy(true);
    try {
      const res = await fetch("/api/agent/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", id: liveRecId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setLiveRecId(null);
      setRecName("");
      setRecUrl("");
      await loadRecordings();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRecBusy(false);
    }
  };

  const runRecording = (rec: BrowserRecording) => {
    const g = `Replay my saved browser recording "${rec.name}" — it starts at ${rec.startUrl} and has ${rec.steps.length} recorded steps`;
    setGoal(g);
    void submitGoal(g);
  };

  const deleteRecording = async (rec: BrowserRecording) => {
    try {
      await fetch("/api/agent/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: rec.id }),
      });
      await loadRecordings();
    } catch {
      // ignore
    }
  };

  /* ── derived ─────────────────────────────────────────────────────── */

  // Goal handed off from the CommandBar — auto-plan when the panel opens.
  useEffect(() => {
    if (!isOpen) return;
    const g = pendingGoal?.trim();
    if (!g) return;
    if (!(phase === "idle" || phase === "done" || phase === "error")) return;
    setPendingMissionGoal(null);
    setGoal(g);
    void submitGoal(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingGoal]);

  const status = job?.status;
  const doneSteps = job?.results.filter((r) => r.status === "ok").length ?? 0;
  const totalSteps = job?.plan?.steps.length ?? 0;
  const progress = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
  const fastLane = job?.auto === true;
  const estimate = job?.plan?.estimate;

  const elapsedLabel = useMemo(() => {
    if (!job?.startedAt) return null;
    const end = job.finishedAt ?? (phase === "running" ? now : job.finishedAt ?? Date.now());
    const s = Math.max(0, Math.round((end - job.startedAt) / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }, [job, phase, now]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [feed]);

  useEffect(() => {
    const el = followRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job?.followups]);

  /* ── live browser view ───────────────────────────────────────────── */

  useEffect(() => {
    const jobId = job?.id;
    if (!jobId || phase !== "running") {
      setLiveMeta(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/agent/live?jobId=${encodeURIComponent(jobId)}&meta=1`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLiveMeta(data);
      } catch {
        // browser step may not have started yet
      }
    };
    void poll();
    const t = setInterval(poll, 1400);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [job?.id, phase]);

  // All step findings / summaries — the "Mission findings" report block.
  const summaryResult = useMemo(() => {
    if (!job) return null;
    const blocks: string[] = [];
    for (const r of job.results) {
      if (r.status !== "ok") continue;
      const out = r.result as Record<string, unknown> | undefined;
      const s = out?.summary;
      if (typeof s === "string" && s.trim()) {
        blocks.push(s.trim());
      } else if (out?.content && typeof out.content === "string" && out.content.trim()) {
        blocks.push(out.content.trim());
      } else if (Array.isArray(out?.ingredients)) {
        blocks.push(
          `### 📋 Ingredients\n\n` + (out.ingredients as unknown[]).map((i) => `- ${typeof i === "string" ? i : JSON.stringify(i)}`).join("\n")
        );
      }
    }
    if (blocks.length === 0) return null;
    return { stepId: "all", summary: blocks.join("\n\n---\n\n") };
  }, [job]);

  const artifacts = job?.artifacts ?? [];
  const imageArtifacts = artifacts.filter((a) => a.kind === "image");
  const otherArtifacts = artifacts.filter((a) => a.kind !== "image");

  const working = phase === "planning" || phase === "running";
  const showComposer = phase === "idle" || phase === "done" || phase === "error";

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 16 }}
          transition={{ type: "spring", stiffness: 320, damping: 30, mass: 0.7 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-2xl"
        >
          <div className="relative w-full max-w-5xl h-[88vh] rounded-[26px] overflow-hidden border border-white/10 shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),0_0_80px_-10px_rgba(0,243,255,0.18)] bg-deep-space/90 backdrop-blur-xl flex flex-col">
            {/* animated top beam + ambient glass */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-reactor-core to-transparent opacity-70" />
            <div className="absolute -top-16 left-1/4 w-1/2 h-24 bg-reactor-core/10 blur-3xl pointer-events-none" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/[0.045] via-transparent to-transparent" />

            {/* header */}
            <header className="relative flex items-center gap-3 px-5 py-4 border-b border-white/[0.07] flex-shrink-0">
              <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-reactor-core/10 border border-reactor-core/40">
                <Radar className="w-5 h-5 text-reactor-core" />
                {phase === "running" && (
                  <span className="absolute inset-0 rounded-lg border border-reactor-core/60 animate-ping opacity-40" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-orbitron text-sm tracking-[0.2em] uppercase text-reactor-core">Mission Control</h2>
                <p className="text-[10px] font-rajdhani text-text-secondary/60 tracking-wider uppercase">
                  firecrawl × playwright · supervisored agent grid
                </p>
              </div>
              {status && (
                <span
                  className={`ml-2 text-[10px] font-rajdhani uppercase tracking-widest px-2 py-0.5 rounded-full border ${
                    status === "running"
                      ? "border-reactor-core/50 bg-reactor-core/10 text-reactor-core"
                      : STATUS_COLOR[status] + " border-current/30 bg-current/5"
                  }`}
                >
                  {STATUS_LABEL[status]}
                </span>
              )}
              {job?.partial && status === "done" && (
                <span className="flex items-center gap-1 text-[9px] font-rajdhani uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent-amber/50 bg-accent-amber/10 text-accent-amber">
                  <ShieldAlert className="w-3 h-3" /> Partial
                </span>
              )}
              {fastLane && phase === "running" && (
                <span className="flex items-center gap-1 text-[9px] font-rajdhani uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent-amber/50 bg-accent-amber/10 text-accent-amber">
                  <Rocket className="w-3 h-3" /> Fast lane
                </span>
              )}
              {elapsedLabel && (
                <span className="hidden sm:flex items-center gap-1 text-[10px] font-rajdhani text-text-secondary/60 tracking-wider">
                  <Clock className="w-3 h-3" /> {elapsedLabel}
                </span>
              )}
              <button onClick={onClose} className="ml-auto p-1.5 hover:bg-accent-red/20 rounded-md transition-colors" title="Close">
                <X className="w-4 h-4 text-text-secondary/70" />
              </button>
            </header>

            {/* progress bar */}
            {job?.plan && (
              <div className="relative h-0.5 w-full bg-panel-border/20 flex-shrink-0">
                <motion.div
                  className="h-full bg-gradient-to-r from-reactor-core to-reactor-glow"
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.4 }}
                />
                {working && progress === 0 && (
                  <div className="absolute inset-0 overflow-hidden">
                    <div className="h-full w-1/3 bg-reactor-core/40 animate-shimmer" />
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-1 min-h-0">
              {/* ── main column ── */}
              <div className="flex-1 min-w-0 overflow-y-auto p-5 space-y-4">
                {/* ── goal composer ── */}
                {showComposer ? (
                  <section className="space-y-3">
                    <div className="relative">
                      <textarea
                        value={goal}
                        onChange={(e) => setGoal(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submitGoal();
                          }
                        }}
                        rows={2}
                        placeholder="Tell JARVIS the mission — e.g. “find the best free React course and open the best one”"
                        className="w-full bg-white/[0.035] border border-white/[0.09] rounded-2xl px-4 py-3.5 text-sm font-rajdhani text-text-primary placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/50 focus:ring-1 focus:ring-reactor-core/25 focus:bg-white/[0.05] transition-colors resize-none pr-12"
                      />
                      <button
                        onClick={() => submitGoal()}
                        disabled={!goal.trim()}
                        className="absolute right-3 bottom-3 p-2 bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 rounded-lg text-reactor-core disabled:opacity-30 transition-colors"
                        title="Launch mission"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>

                    {/* watch-live toggle: visible Chromium + in-panel frames */}
                    {phase === "idle" && (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setWatch((v) => !v)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-rajdhani uppercase tracking-wider transition-all ${
                            watch
                              ? "border-reactor-core/60 bg-reactor-core/15 text-reactor-core shadow-[0_0_18px_rgba(0,243,255,0.18)]"
                              : "border-panel-border/40 bg-panel-glass/30 text-text-secondary/70 hover:text-text-primary"
                          }`}
                          title="Open a visible browser window for autonomous browser steps"
                        >
                          <Monitor className="w-3 h-3" /> {watch ? "Watching browser" : "Watch browser"}
                        </button>
                        <span className="text-[9px] font-rajdhani text-text-secondary/45">
                          {watch ? "a real Chromium window will open — watch it, or watch here" : "off — browser runs headless (still streamed here)"}
                        </span>
                      </div>
                    )}

                    {phase === "idle" && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {EXAMPLES.map((ex) => (
                          <button
                            key={ex.text}
                            onClick={() => {
                              setGoal(ex.text);
                              submitGoal(ex.text);
                            }}
                            className="group flex items-center gap-2 text-left text-[10px] font-rajdhani px-3 py-2 rounded-xl border border-white/[0.07] bg-white/[0.025] text-text-secondary/80 hover:text-text-primary hover:border-reactor-core/35 hover:bg-reactor-core/[0.06] transition-all"
                          >
                            <span className="flex-shrink-0 text-reactor-core/60 group-hover:text-reactor-core">{ex.icon}</span>
                            <span className="flex-1 min-w-0 line-clamp-2 leading-snug">{ex.text}</span>
                            {ex.heavy ? (
                              <span className="ml-1 flex-shrink-0 self-start text-[8px] uppercase tracking-wider text-accent-amber/70 border border-accent-amber/30 rounded px-1">gate</span>
                            ) : (
                              <span className="ml-1 flex-shrink-0 self-start text-[8px] uppercase tracking-wider text-accent-green/70 border border-accent-green/30 rounded px-1">auto</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* ── browser cookbook: record once, replay forever ── */}
                    {phase === "idle" && (
                      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 space-y-2">
                        <div className="flex items-center gap-1.5 text-[10px] font-orbitron text-text-secondary/70 uppercase tracking-widest">
                          <Clapperboard className="w-3 h-3" /> Browser cookbook
                          <span className="ml-auto flex items-center gap-1 text-[8px] font-rajdhani text-text-secondary/40 normal-case tracking-normal">
                            <KeyRound className="w-2.5 h-2.5" /> record once, replay forever
                          </span>
                        </div>

                        {liveRecId ? (
                          <div className="flex items-center gap-2">
                            <span className="flex items-center gap-1.5 text-[10px] font-rajdhani text-accent-amber">
                              <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse" />
                              Recording — drive the browser window, then stop.
                            </span>
                            <button
                              onClick={stopRec}
                              disabled={recBusy}
                              className="ml-auto px-2.5 py-1 bg-accent-red/20 border border-accent-red/40 rounded text-accent-red text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-40"
                            >
                              Stop &amp; save
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              value={recName}
                              onChange={(e) => setRecName(e.target.value)}
                              placeholder="Name (e.g. Daily orders)"
                              className="flex-1 bg-deep-space/60 border border-panel-border/40 rounded px-2.5 py-1.5 text-[11px] font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60"
                            />
                            <input
                              value={recUrl}
                              onChange={(e) => setRecUrl(e.target.value)}
                              placeholder="https://… starting page"
                              className="flex-1 bg-deep-space/60 border border-panel-border/40 rounded px-2.5 py-1.5 text-[11px] font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60"
                            />
                            <button
                              onClick={startRec}
                              disabled={recBusy}
                              className="px-3 py-1.5 bg-reactor-core/15 border border-reactor-core/40 rounded text-reactor-core text-[10px] font-rajdhani uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-40"
                            >
                              {recBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Record
                            </button>
                          </div>
                        )}

                        {recordings.length > 0 && (
                          <div className="space-y-1 pt-1">
                            {recordings.map((r) => (
                              <div key={r.id} className="flex items-center gap-2 text-[10px] font-rajdhani">
                                <Play className="w-2.5 h-2.5 text-reactor-core/60 flex-shrink-0" />
                                <span className="truncate text-text-primary/85">{r.name}</span>
                                <span className="flex-shrink-0 text-text-secondary/40 text-[8px] uppercase tracking-wider">
                                  {r.steps.length} steps · {r.runs || 0} runs
                                </span>
                                <button onClick={() => runRecording(r)} className="ml-auto text-reactor-core hover:text-reactor-core/80 uppercase text-[9px] tracking-wider">
                                  run
                                </button>
                                <button onClick={() => void deleteRecording(r)} className="text-text-secondary/40 hover:text-accent-red uppercase text-[9px] tracking-wider">
                                  del
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                ) : (
                  /* compact goal strip while working */
                  <section className="flex items-center gap-2 bg-panel-glass/30 border border-panel-border/30 rounded-lg px-3 py-2">
                    <Sparkles className="w-3.5 h-3.5 text-reactor-core flex-shrink-0" />
                    <span className="text-xs font-rajdhani text-text-primary truncate flex-1">{job?.goal}</span>
                    {fastLane && phase === "running" && (
                      <span className="flex items-center gap-1 text-[9px] font-rajdhani uppercase tracking-widest text-accent-amber border border-accent-amber/40 bg-accent-amber/10 rounded-full px-2 py-0.5">
                        <Rocket className="w-3 h-3" /> fast lane
                      </span>
                    )}
                    {phase === "running" && (
                      <button
                        onClick={cancel}
                        disabled={aborting}
                        className="flex items-center gap-1 text-[10px] font-rajdhani uppercase tracking-wider text-accent-red/80 hover:text-accent-red disabled:opacity-50 transition-colors"
                        title="Stop this mission — long browser steps stop immediately"
                      >
                        {aborting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CircleAlert className="w-3 h-3" />}
                        {aborting ? "aborting…" : "abort"}
                      </button>
                    )}
                  </section>
                )}

                {/* ── live systems card: managed dev servers + tidy-up undo ── */}
                <MissionOpsCard isOpen={isOpen} />

                {/* ── planning indicator ── */}
                {phase === "planning" && (
                  <div className="flex items-center gap-2 text-text-secondary/80 text-xs font-rajdhani">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-reactor-core" />
                    Decomposing the mission into steps…
                  </div>
                )}

                {/* ── error ── */}
                {phase === "error" && error && (
                  <div className="text-xs font-rajdhani text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg p-3">{error}</div>
                )}

                {/* ── live browser view ── */}
                {phase === "running" && (liveMeta?.hasFrame || liveMeta?.active) && (
                  <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-2"
                  >
                    <div className="flex items-center gap-2 text-[10px] font-orbitron uppercase tracking-widest text-reactor-core">
                      <Radio className="w-3 h-3" /> Live browser
                      <span className="flex items-center gap-1 text-[9px] text-accent-red normal-case tracking-normal">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-pulse" /> live
                      </span>
                      <span className="ml-auto text-[9px] font-rajdhani normal-case tracking-normal text-text-secondary/50">
                        {liveMeta?.action ? `last: ${liveMeta.action}`.slice(0, 60) : "starting…"}
                      </span>
                    </div>
                    <div className="relative rounded-xl overflow-hidden border border-reactor-core/30 bg-black shadow-[0_0_40px_rgba(0,243,255,0.10)]">
                      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-reactor-core/70 to-transparent" />
                      {liveMeta?.hasFrame ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`/api/agent/live?jobId=${encodeURIComponent(job?.id ?? "")}&seq=${liveMeta.seq ?? 0}`}
                          alt="live browser frame"
                          className="w-full max-h-[46vh] object-cover object-top"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-40 gap-2 text-[10px] font-rajdhani text-text-secondary/60">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-reactor-core" /> waiting for the browser step…
                        </div>
                      )}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-1.5 pt-6">
                        <div className="text-[9px] font-rajdhani text-text-primary/80 truncate">{liveMeta?.title || "—"}</div>
                        <div className="text-[8px] font-mono text-text-secondary/50 truncate">{liveMeta?.url}</div>
                      </div>
                    </div>
                  </motion.section>
                )}

                {/* ── plan preview / live step timeline ── */}
                {job?.plan && phase !== "planning" && (
                  <motion.section
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-widest flex items-center gap-1.5 truncate">
                          <Sparkles className="w-3 h-3 flex-shrink-0" /> {job.plan.summary}
                        </div>
                        {totalSteps > 0 && phase !== "preview" && (
                          <span className="text-[9px] font-rajdhani text-text-secondary/50 uppercase tracking-wider">
                            {doneSteps}/{totalSteps} · {progress}%
                          </span>
                        )}
                        {/* cost / risk preview */}
                        {estimate && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="text-[9px] font-rajdhani uppercase tracking-wider px-1.5 py-0.5 rounded border border-panel-border/40 bg-panel-glass/30 text-text-secondary/70 flex items-center gap-1">
                              <Gauge className="w-2.5 h-2.5" /> ~{estimate.credits} credits
                            </span>
                            <span className="text-[9px] font-rajdhani uppercase tracking-wider px-1.5 py-0.5 rounded border border-panel-border/40 bg-panel-glass/30 text-text-secondary/70 flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" /> ~{estimate.seconds}s
                            </span>
                            <span className={`text-[9px] font-rajdhani uppercase tracking-wider px-1.5 py-0.5 rounded border ${RISK_STYLE[estimate.risk] ?? ""} flex items-center gap-1`}>
                              <ShieldAlert className="w-2.5 h-2.5" /> {estimate.risk}
                            </span>
                          </div>
                        )}
                        {estimate?.riskReasons?.length ? (
                          <span className="text-[9px] font-rajdhani text-text-secondary/45">
                            {estimate.riskReasons.join(" · ")}
                          </span>
                        ) : null}
                      </div>
                      {phase === "preview" && (
                        <div className="flex-shrink-0 flex items-center gap-1.5">
                          <button
                            onClick={cancel}
                            disabled={aborting}
                            className="px-2.5 py-1 bg-deep-space/60 hover:bg-accent-red/15 border border-panel-border/40 hover:border-accent-red/40 rounded-md text-text-secondary/70 hover:text-accent-red text-[10px] font-rajdhani uppercase tracking-widest transition-colors disabled:opacity-40"
                          >
                            Discard
                          </button>
                          <button
                            onClick={approve}
                            className="px-3 py-1 bg-accent-green/20 hover:bg-accent-green/30 border border-accent-green/40 rounded-md text-accent-green text-[10px] font-rajdhani uppercase tracking-widest flex items-center gap-1.5 transition-colors"
                          >
                            <Check className="w-3 h-3" /> Approve & launch
                          </button>
                        </div>
                      )}
                    </div>

                    {/* timeline with connector spine */}
                    <ol className="relative space-y-1.5 pl-1">
                      <span className="absolute left-[13px] top-2 bottom-2 w-px bg-panel-border/30" aria-hidden />
                      {job.plan.steps.map((s, i) => {
                        const result = job.results.find((r) => r.stepId === s.id);
                        const state =
                          result?.status === "ok"
                            ? "ok"
                            : result?.status === "error"
                              ? "error"
                              : result?.status === "skipped"
                                ? "skipped"
                                : phase === "running" && isActiveStep(job, s.id)
                                  ? "active"
                                  : "pending";
                        const hasOutput = result?.status === "ok" && result.result != null && Object.keys(result.result as Record<string, unknown>).length > 0;
                        const open = expandedStep === s.id;
                        const isSpecialist = s.kind === "delegate";
                        return (
                          <motion.li
                            key={s.id}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.25 }}
                            className="relative"
                          >
                            <div
                              className={`relative rounded-lg border px-3 py-2 transition-colors ${
                                state === "active"
                                  ? "border-reactor-core/60 bg-reactor-core/10"
                                  : state === "ok"
                                    ? "border-accent-green/25 bg-accent-green/5"
                                    : state === "error"
                                      ? "border-accent-red/40 bg-accent-red/10"
                                      : state === "skipped"
                                        ? "border-panel-border/20 bg-deep-space/30 opacity-60"
                                        : "border-panel-border/30 bg-deep-space/40"
                              } ${isSpecialist ? "border-l-2 border-l-reactor-core/50" : ""}`}
                            >
                              <button onClick={() => hasOutput && setExpandedStep(open ? null : s.id)} className="w-full flex items-start gap-2.5 text-left" disabled={!hasOutput}>
                                <span
                                  className={`relative z-10 mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-orbitron border ${
                                    state === "ok"
                                      ? "bg-accent-green/20 border-accent-green/40 text-accent-green"
                                      : state === "error"
                                        ? "bg-accent-red/20 border-accent-red/40 text-accent-red"
                                        : state === "active"
                                          ? "bg-reactor-core/20 border-reactor-core/50 text-reactor-core"
                                          : "bg-deep-space border-panel-border/40 text-text-secondary/50"
                                  }`}
                                >
                                  {state === "ok" ? (
                                    <CircleCheck className="w-3 h-3" />
                                  ) : state === "error" ? (
                                    <CircleAlert className="w-3 h-3" />
                                  ) : state === "skipped" ? (
                                    <MinusCircle className="w-3 h-3" />
                                  ) : state === "active" ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    i + 1
                                  )}
                                </span>
                                <span className="flex-1 min-w-0">
                                  <span className="block text-[11px] font-rajdhani text-text-primary leading-snug">{s.title}</span>
                                  <span className="mt-0.5 flex items-center gap-1 text-[9px] text-text-secondary/50 uppercase tracking-wider">
                                    {KIND_ICON[s.kind]}
                                    {STEP_KIND_LABELS[s.kind]}
                                    {s.dependsOn?.length ? ` · after ${s.dependsOn.length}` : ""}
                                  </span>
                                  {result?.error && <span className="block text-[10px] text-accent-red/80 mt-1">{result.error}</span>}
                                </span>
                                {hasOutput && open ? <ChevronUp className="w-3 h-3 text-text-secondary/60 mt-1" /> : hasOutput ? <ChevronDown className="w-3 h-3 text-text-secondary/60 mt-1" /> : null}
                              </button>

                              {/* expandable step output */}
                              <AnimatePresence initial={false}>
                                {open && hasOutput && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-2 pt-2 border-t border-panel-border/30">
                                      <StepOutput result={result!.result} />
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>

                              {/* active shimmer */}
                              {state === "active" && (
                                <span className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none">
                                  <span className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-reactor-core/10 to-transparent animate-shimmer" />
                                </span>
                              )}
                            </div>
                          </motion.li>
                        );
                      })}
                    </ol>
                  </motion.section>
                )}

                {/* ── specialist delegations ── */}
                {job?.delegations?.length ? (
                  <section className="space-y-2">
                    <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-widest flex items-center gap-1.5">
                      <Bot className="w-3 h-3" /> Specialist agents
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {job.delegations.map((d, i) => (
                        <motion.div
                          key={`${d.role}-${i}`}
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.25 }}
                          className={`rounded-lg border px-3 py-2 ${
                            d.status === "ok" ? "border-accent-green/25 bg-accent-green/5" : "border-accent-red/35 bg-accent-red/10"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Bot className="w-3 h-3 text-reactor-core" />
                            <span className="text-[10px] font-orbitron uppercase tracking-widest text-reactor-core">{d.role}</span>
                            <span className="ml-auto text-[9px] font-rajdhani uppercase tracking-wider text-text-secondary/50">
                              {d.steps.length} step{d.steps.length === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="mt-1 text-[10px] font-rajdhani text-text-secondary/70 line-clamp-2">{d.goal}</div>
                          <div className="mt-1.5 space-y-0.5">
                            {d.steps.map((st) => (
                              <div key={st.id} className="flex items-center gap-1.5 text-[9px] font-rajdhani text-text-secondary/55">
                                {st.status === "ok" ? (
                                  <CircleCheck className="w-2.5 h-2.5 text-accent-green/70" />
                                ) : st.status === "error" ? (
                                  <CircleAlert className="w-2.5 h-2.5 text-accent-red/70" />
                                ) : (
                                  <MinusCircle className="w-2.5 h-2.5 text-text-secondary/40" />
                                )}
                                <span className="truncate">{st.title}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {/* ── checkpoint dialog ── */}
                {status === "paused_checkpoint" && phase === "running" && (
                  <motion.section
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-xl border border-accent-amber/40 bg-accent-amber/5 p-3 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-[10px] font-orbitron uppercase tracking-widest text-accent-amber">
                      <HelpCircle className="w-3.5 h-3.5" /> JARVIS needs your input
                    </div>
                    <p className="text-xs font-rajdhani text-text-primary">{checkpointQuestion ?? "How should I proceed?"}</p>
                    {checkpointOptions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {checkpointOptions.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => resume(opt)}
                            className="px-2.5 py-1 bg-accent-amber/10 hover:bg-accent-amber/25 border border-accent-amber/40 rounded-full text-[11px] font-rajdhani text-accent-amber transition-colors"
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={checkpointPick}
                        onChange={(e) => setCheckpointPick(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && checkpointPick.trim()) resume(checkpointPick);
                        }}
                        placeholder="…or type your own answer"
                        className="flex-1 bg-deep-space/60 border border-panel-border/40 rounded px-2.5 py-1.5 text-xs font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-accent-amber/60"
                      />
                      <button
                        onClick={() => resume(checkpointPick)}
                        disabled={!checkpointPick.trim()}
                        className="px-3 py-1.5 bg-accent-amber/20 hover:bg-accent-amber/30 border border-accent-amber/40 rounded text-accent-amber text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-30 transition-colors"
                      >
                        Answer
                      </button>
                    </div>
                  </motion.section>
                )}

                {/* ── final summary / report ── */}
                {(phase === "done" || (phase === "error" && job?.plan)) && (
                  <section className="space-y-2">
                    {phase === "done" && summaryResult && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="rounded-xl border border-reactor-core/30 bg-reactor-core/5 p-4"
                      >
                        <div className="text-[10px] font-orbitron text-reactor-core uppercase tracking-widest mb-2 flex items-center gap-1.5">
                          <Zap className="w-3 h-3" /> Mission findings
                        </div>
                        <Markdown content={summaryResult.summary} className="text-xs font-rajdhani text-text-primary/90" />
                      </motion.div>
                    )}

                    {phase === "done" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={`flex items-center gap-2 text-xs font-rajdhani ${job?.status === "cancelled" ? "text-text-secondary/70" : job?.partial ? "text-accent-amber" : "text-accent-green"}`}>
                          {job?.status === "cancelled" ? <MinusCircle className="w-3.5 h-3.5" /> : job?.partial ? <ShieldAlert className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          {job?.status === "cancelled" ? "Mission aborted" : job?.partial ? "Mission completed with issues" : "Mission complete"}
                          {elapsedLabel && <span className="text-[10px] text-text-secondary/50">· {elapsedLabel}</span>}
                          {job?.creditsUsed != null && job.creditsUsed > 0 && (
                            <span className="text-[10px] text-text-secondary/50">· {job.creditsUsed} credits</span>
                          )}
                        </div>
                        <button
                          onClick={makeVideoBrief}
                          disabled={briefBusy}
                          className="px-2.5 py-1 bg-reactor-core/15 border border-reactor-core/40 rounded-md text-reactor-core hover:bg-reactor-core/25 text-[10px] font-rajdhani uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-40"
                        >
                          {briefBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clapperboard className="w-3 h-3" />} Video brief
                        </button>
                        <button
                          onClick={reset}
                          className="px-2.5 py-1 bg-panel-glass/40 border border-panel-border/40 rounded-md text-text-secondary/80 hover:text-text-primary text-[10px] font-rajdhani uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                        >
                          <RotateCcw className="w-3 h-3" /> New mission
                        </button>
                      </div>
                    )}

                    {autoOpened.length > 0 && (
                      <div className="rounded-xl border border-panel-border/30 bg-panel-glass/30 p-3">
                        <div className="text-[10px] font-orbitron text-text-secondary/70 uppercase tracking-widest mb-1.5">Opened in your browser ({autoOpened.length})</div>
                        <div className="space-y-1">
                          {autoOpened.map((u) => (
                            <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11px] font-rajdhani text-cyan-400 hover:text-cyan-300 truncate">
                              <ExternalLink className="w-3 h-3 flex-shrink-0" /> {u}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* ── artifacts ── */}
                    {artifacts.length > 0 && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-panel-border/30 bg-panel-glass/20 p-3 space-y-2">
                        <div className="text-[10px] font-orbitron text-text-secondary/70 uppercase tracking-widest flex items-center gap-1.5">
                          <ImageIcon className="w-3 h-3" /> Artifacts ({artifacts.length})
                        </div>
                        {imageArtifacts.length > 0 && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {imageArtifacts.map((a, i) => (
                              <motion.a
                                key={a.id}
                                href={artifactUrl(a)}
                                target="_blank"
                                rel="noopener noreferrer"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: Math.min(i * 0.05, 0.3) }}
                                className="group relative rounded-lg overflow-hidden border border-panel-border/40 hover:border-reactor-core/50 transition-colors"
                                title={a.label}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={artifactUrl(a)} alt={a.label} loading="lazy" className="w-full h-24 object-cover group-hover:scale-105 transition-transform duration-300" />
                                <span className="absolute bottom-0 inset-x-0 bg-black/60 text-[8px] font-rajdhani text-text-primary/80 px-1.5 py-0.5 truncate">{a.label}</span>
                              </motion.a>
                            ))}
                          </div>
                        )}
                        {otherArtifacts.length > 0 && (
                          <div className="space-y-1">
                            {otherArtifacts.map((a) => (
                              <a
                                key={a.id}
                                href={artifactUrl(a)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-[11px] font-rajdhani text-cyan-400 hover:text-cyan-300 truncate"
                              >
                                {a.kind === "video" ? <Clapperboard className="w-3 h-3 flex-shrink-0" /> : a.kind === "file" ? <Download className="w-3 h-3 flex-shrink-0" /> : <ExternalLink className="w-3 h-3 flex-shrink-0" />}
                                <span className="text-text-secondary/50 uppercase text-[8px] tracking-wider flex-shrink-0">{ARTIFACT_LABEL[a.kind]}</span>
                                {a.label}
                              </a>
                            ))}
                          </div>
                        )}
                      </motion.div>
                    )}

                    {/* ── follow-up conversation ── */}
                    {phase === "done" && (
                      <div className="rounded-xl border border-panel-border/30 bg-panel-glass/20 p-3 space-y-2">
                        <div className="text-[10px] font-orbitron text-text-secondary/70 uppercase tracking-widest flex items-center gap-1.5">
                          <MessageSquare className="w-3 h-3" /> Ask about this mission
                        </div>
                        {(job?.followups?.length ?? 0) > 0 && (
                          <div ref={followRef} className="max-h-52 overflow-y-auto space-y-2 pr-1">
                            {job!.followups!.map((t, i) => (
                              <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className={t.role === "user" ? "text-right" : ""}
                              >
                                <div
                                  className={`inline-block max-w-[90%] rounded-lg px-2.5 py-1.5 text-[11px] font-rajdhani text-left ${
                                    t.role === "user"
                                      ? "bg-reactor-core/15 border border-reactor-core/30 text-text-primary"
                                      : "bg-deep-space/60 border border-panel-border/40 text-text-primary/90"
                                  }`}
                                >
                                  {t.role === "assistant" ? <Markdown content={t.content} /> : t.content}
                                </div>
                              </motion.div>
                            ))}
                            {followupBusy && (
                              <div className="flex items-center gap-1.5 text-[10px] font-rajdhani text-text-secondary/60">
                                <Loader2 className="w-3 h-3 animate-spin text-reactor-core" /> thinking…
                              </div>
                            )}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={followupInput}
                            onChange={(e) => setFollowupInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") sendFollowup();
                            }}
                            placeholder="e.g. compare the top two, or send this to Telegram"
                            disabled={followupBusy}
                            className="flex-1 bg-deep-space/60 border border-panel-border/40 rounded px-2.5 py-1.5 text-xs font-rajdhani placeholder:text-text-secondary/40 focus:outline-none focus:border-reactor-core/60 disabled:opacity-50"
                          />
                          <button
                            onClick={sendFollowup}
                            disabled={!followupInput.trim() || followupBusy}
                            className="px-3 py-1.5 bg-reactor-core/20 hover:bg-reactor-core/30 border border-reactor-core/40 rounded text-reactor-core text-[10px] font-rajdhani uppercase tracking-wider disabled:opacity-30 transition-colors"
                          >
                            Ask
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </div>

              {/* ── right rail: live feed + history ── */}
              <aside className="hidden md:flex w-56 lg:w-60 flex-shrink-0 border-l border-panel-border/30 bg-black/20 flex-col min-h-0">
                <div className="p-3 border-b border-panel-border/20">
                  <div className="text-[10px] font-orbitron text-text-secondary/60 uppercase tracking-widest flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-reactor-core/70" /> Live feed
                  </div>
                  <div ref={feedRef} className="mt-2 max-h-56 overflow-y-auto space-y-1 font-mono text-[9px] leading-relaxed">
                    {feed.length === 0 ? (
                      <div className="text-text-secondary/30">—</div>
                    ) : (
                      feed.map((f) => (
                        <motion.div key={f.key} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} className="flex gap-1.5 items-start">
                          <span className="text-text-secondary/30 flex-shrink-0">{new Date(f.at).toLocaleTimeString([], { hour12: false })}</span>
                          <span
                            className={
                              f.tone === "error"
                                ? "text-accent-red"
                                : f.tone === "warn"
                                  ? "text-accent-amber"
                                  : f.tone === "start"
                                    ? "text-reactor-core"
                                    : f.tone === "ok"
                                      ? "text-accent-green/80"
                                      : "text-text-secondary/85"
                            }
                          >
                            {f.message}
                          </span>
                        </motion.div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-3">
                  <div className="text-[10px] font-orbitron text-text-secondary/60 uppercase tracking-widest flex items-center gap-1.5 mb-2">
                    <History className="w-3 h-3 text-reactor-core/70" /> Missions
                  </div>
                  <div className="space-y-1">
                    {history.length === 0 && <div className="text-[10px] font-rajdhani text-text-secondary/30">No missions yet</div>}
                    {history.map((h) => {
                      const active = h.status === "running" || h.status === "planning" || h.status === "paused_checkpoint";
                      const isCurrent = job?.id === h.id;
                      return (
                        <button
                          key={h.id}
                          onClick={() => void openJob(h.id)}
                          className={`w-full text-left rounded-lg px-2 py-1.5 border transition-colors ${
                            isCurrent ? "border-reactor-core/40 bg-reactor-core/10" : "border-transparent hover:border-panel-border/40 hover:bg-panel-glass/30"
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                h.status === "done"
                                  ? h.partial
                                    ? "bg-accent-amber"
                                    : "bg-accent-green"
                                  : h.status === "failed"
                                    ? "bg-accent-red"
                                    : h.status === "cancelled"
                                      ? "bg-text-secondary/40"
                                      : "bg-reactor-core animate-pulse"
                              }`}
                            />
                            <span className="flex-1 min-w-0 text-[10px] font-rajdhani text-text-primary/90 truncate">{h.goal}</span>
                          </div>
                          <div className="mt-0.5 pl-3 flex items-center gap-1.5 text-[8px] font-rajdhani uppercase tracking-wider text-text-secondary/40">
                            <span>{STATUS_LABEL[h.status]}</span>
                            {active && <span className="text-reactor-core/70">· live</span>}
                            <span className="ml-auto">{relTime(h.createdAt)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <footer className="px-3 py-2 border-t border-panel-border/20 text-[8px] font-rajdhani text-text-secondary/40 uppercase tracking-widest">
                  Say “mission: …” in the command bar
                </footer>
              </aside>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── helpers ───────────────────────────────────────────────────────── */

/** A step is "active" if it has no result yet while the job is running. */
function isActiveStep(job: AgentJob, stepId: string): boolean {
  return !job.results.some((r) => r.stepId === stepId);
}

/** Renders a step's result JSON in a compact, readable way. */
function StepOutput({ result }: { result: unknown }) {
  const out = result as Record<string, unknown> | undefined;
  if (!out || typeof out !== "object") {
    return <div className="text-[11px] font-rajdhani text-text-secondary/70">{String(result)}</div>;
  }

  // llm_summarize / deep_research / change_tracking summaries
  if (typeof out.summary === "string" && out.summary) {
    return <Markdown content={out.summary.slice(0, 3000)} className="text-[11px] font-rajdhani text-text-primary/85" />;
  }

  // search results
  if (Array.isArray(out.results) && out.results.length > 0) {
    return (
      <div className="space-y-1">
        {(out.results as Array<Record<string, unknown>>).slice(0, 8).map((r, i) => (
          <a key={i} href={String(r.url ?? "#")} target="_blank" rel="noopener noreferrer" className="block text-[11px] font-rajdhani text-cyan-400 hover:text-cyan-300 truncate">
            {String(r.title ?? r.url ?? "result")}
          </a>
        ))}
      </div>
    );
  }

  // opened urls
  if (Array.isArray(out.urls)) {
    return (
      <div className="space-y-1">
        {(out.urls as string[]).map((u) => (
          <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="block text-[11px] font-rajdhani text-cyan-400 hover:text-cyan-300 truncate">
            {u}
          </a>
        ))}
      </div>
    );
  }

  // fallback: pretty JSON, compact
  return (
    <pre className="text-[10px] font-mono text-text-secondary/80 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{JSON.stringify(out, null, 2).slice(0, 1500)}</pre>
  );
}
