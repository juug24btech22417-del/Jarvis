"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Video,
  Link as LinkIcon,
  Key,
  Loader2,
  CheckCircle2,
  AlertCircle,
  MessageSquare,
  Send,
  Power,
  PhoneOff,
  Wifi,
  WifiOff,
  FileText,
  ExternalLink,
  BookOpen,
  User,
  Mail,
  Phone,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Eye,
  Image as ImageIcon,
  Play,
  RefreshCw,
  Sparkles,
  HelpCircle,
  Clock,
  Layers,
  Download,
  Wand2,
  Quote,
  Lightbulb,
  ChevronRight,
  FileSpreadsheet,
} from "lucide-react";

export default function MeetingBotPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; notionUrl?: string | null } | null>(null);
  const [formData, setFormData] = useState({
    url: "",
    id: "",
    password: "",
    name: "Dhruv",
    email: "dhruvbijapur@gmail.com",
    phone: "9606571200",
  });
  const [showUserDetails, setShowUserDetails] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [botActive, setBotActive] = useState(false);
  const [captionsCount, setCaptionsCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [notionUrl, setNotionUrl] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);  // Chrome needs Google sign-in

  // ── Auto-attend from Google Calendar ──
  const [autoJoin, setAutoJoin] = useState<AutoJoinStatus | null>(null);
  const [autoJoinBusy, setAutoJoinBusy] = useState(false);
  const [autoJoinOpen, setAutoJoinOpen] = useState(false);
  // ── What the bot is capturing off the shared screen ──
  const [liveVisuals, setLiveVisuals] = useState<VisualThumb[]>([]);
  const [visualsCaptured, setVisualsCaptured] = useState(0);
  const [lastSummary, setLastSummary] = useState<MeetingSummaryView | null>(null);

  // ── Chat with this meeting ──
  const [qa, setQa] = useState<QaAvailability | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [thread, setThread] = useState<QaThreadEntry[]>([]);
  const [openCitation, setOpenCitation] = useState<string | null>(null);

  // ── Revision kit ──
  const [kit, setKit] = useState<KitSummary | null>(null);
  const [kitBusy, setKitBusy] = useState(false);
  const [kitError, setKitError] = useState<string | null>(null);

  // Two columns only when the window is actually wide enough for them; the
  // panel is resizable, so viewport breakpoints would lie.
  const [wide, setWide] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const lastJoinParamsRef = useRef<{ url: string; id: string; password: string } | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Check bot status on mount and poll continuously
  useEffect(() => {
    checkBotStatus();
    pollRef.current = setInterval(checkBotStatus, botActive ? 2000 : 3500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [botActive]);

  // Auto-attend state is cheap to fetch (no calendar call) — refresh it on a
  // slow loop so the panel reflects joins the scheduler made on its own.
  useEffect(() => {
    loadAutoJoin();
    const id = setInterval(loadAutoJoin, 20_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || 0;
      setWide(width >= 980);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleBringToFront = async () => {
    try {
      await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bring-to-front" }),
      });
    } catch {}
  };

  const checkBotStatus = async () => {
    try {
      const res = await fetch("/api/meeting");
      const data = await res.json();
      setBotActive(data.isActive || false);
      setCaptionsCount(data.captionsCollected || 0);
      setIsRecording(data.isRecording || false);
      if (data.statusMessage) {
        setStatusMessage(data.statusMessage);
      }
      if (data.lastResult?.notionUrl) {
        setNotionUrl(data.lastResult.notionUrl);
      } else if (!data.lastResult) {
        setNotionUrl(null);
        setLastSummary(null);
      }

      setLiveVisuals(Array.isArray(data.visuals) ? data.visuals : []);
      setVisualsCaptured(Number(data.visualsCaptured) || 0);
      setQa(data.qa || null);
      setKit(data.studyKit || null);
      if (data.lastResult?.summary) {
        const summary = data.lastResult.summary as MeetingSummaryView;
        setLastSummary({ ...summary, visuals: summary.visuals || [] });
        setVisualsCaptured(summary.visuals?.length || 0);
      }
    } catch {
      // API might not be ready yet
    }
  };

  const loadAutoJoin = async () => {
    try {
      const res = await fetch("/api/meeting/autojoin", { cache: "no-store" });
      const data = await res.json();
      if (data?.success) setAutoJoin(data as AutoJoinStatus);
    } catch {
      // Server restarting — the next poll picks it up.
    }
  };

  /** Normalise the two response shapes the auto-join route returns. */
  const applyAutoJoinResponse = (data: any) => {
    const status = data?.status && typeof data.status === "object" ? data.status : data;
    if (status && typeof status === "object" && "settings" in status) {
      setAutoJoin(status as AutoJoinStatus);
    }
  };

  const patchAutoJoin = async (patch: Record<string, unknown>) => {
    setAutoJoinBusy(true);
    try {
      const res = await fetch("/api/meeting/autojoin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "settings", settings: patch }),
      });
      const data = await res.json();
      applyAutoJoinResponse(data);
      if (data?.success === false) {
        setResult({ success: false, message: data.error || "Could not save auto-attend settings." });
      }
    } catch {
      setResult({ success: false, message: "Could not reach the auto-attend service." });
    } finally {
      setAutoJoinBusy(false);
    }
  };

  const checkCalendarNow = async () => {
    setAutoJoinBusy(true);
    try {
      const res = await fetch("/api/meeting/autojoin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      const data = await res.json();
      applyAutoJoinResponse(data);
      if (data?.calendarAuthenticated === false) {
        setResult({
          success: false,
          message: "Google Calendar isn't connected — connect it in the Connected panel so the bot can see your meetings.",
        });
      }
    } catch {
      setResult({ success: false, message: "Calendar check failed." });
    } finally {
      setAutoJoinBusy(false);
    }
  };

  const joinCalendarEvent = async (eventId: string) => {
    setAutoJoinBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/meeting/autojoin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join-now", eventId }),
      });
      const data = await res.json();
      applyAutoJoinResponse(data);
      if (data?.joined) {
        setResult({ success: true, message: `Dispatching the bot to "${data.joinedTitle}"...` });
        setBotActive(true);
        setStatusMessage("Joining meeting and enabling captions...");
        checkBotStatus();
      } else {
        setResult({ success: false, message: data?.error || "Could not join that meeting." });
      }
    } catch {
      setResult({ success: false, message: "Could not reach the auto-attend service." });
    } finally {
      setAutoJoinBusy(false);
    }
  };

  const handleChat = async () => {
    if (!chatMessage) return;
    setLoading(true);
    try {
      const res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: chatMessage }),
      });
      const data = await res.json();
      setResult({ success: data.success, message: data.message || data.error });
      if (data.success) setChatMessage("");
    } catch (err) {
      setResult({ success: false, message: "Failed to send message" });
    } finally {
      setLoading(false);
    }
  };

  const detectedPlatform = formData.url.includes("meet.google.com")
    ? "Google Meet"
    : formData.url.includes("zoom.us") || formData.id.trim()
    ? "Zoom"
    : null;

  const isWebinar = formData.url.toLowerCase().includes("webinar");

  const handleJoin = async () => {
    const cleanUrl = formData.url.trim();
    const cleanId = formData.id.trim().replace(/[\s-]+/g, "");
    const cleanPassword = formData.password.trim();

    if (!cleanUrl && !cleanId) {
      setResult({ success: false, message: "Please provide a meeting link or Zoom Meeting ID" });
      return;
    }

    setLoading(true);
    setResult(null);
    setStatusMessage("Connecting to meeting...");

    try {
      const res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          url: cleanUrl,
          credentials: {
            id: cleanId,
            password: cleanPassword,
            name: formData.name.trim() || 'Dhruv',
            email: formData.email.trim() || 'dhruvbijapur@gmail.com',
            phone: formData.phone.trim() || '9606571200',
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.needsSignIn) {
          // Native Chrome opened to Google sign-in — keep bot inactive so user sees the sign in banner & controls
          setNeedsSignIn(true);
          setBotActive(false);
          setResult({ success: true, message: data.message });
          setStatusMessage("Waiting for Google sign-in in native Chrome window...");
        } else {
          setNeedsSignIn(false);
          setResult({ success: true, message: data.message });
          setBotActive(true);
          setStatusMessage("Joining meeting and enabling captions...");
          setFormData((prev) => ({ ...prev, url: "", id: "", password: "" }));
        }
      } else {
        setNeedsSignIn(false);
        setResult({ success: false, message: data.error || "Failed to join meeting" });
        setStatusMessage("");
      }
    } catch (err: any) {
      setResult({
        success: false,
        message: "Could not reach the meeting bot server. Make sure JARVIS is running.",
      });
      setStatusMessage("");
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    setLoading(true);
    setResult(null);
    setNotionUrl(null); // Clear old Notion link so user doesn't click the stale meeting notes!
    setLastSummary(null);
    setLiveVisuals([]);

    try {
      const res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave" }),
      });

      const data = await res.json();
      if (data.success) {
        setResult({
          success: true,
          message: data.message,
        });
        setBotActive(false);
        // The visual pass (vision model over every kept slide/diagram frame) runs
        // before the summary, so this takes noticeably longer than a text-only
        // meeting — say so instead of looking stuck.
        setStatusMessage(
          visualsCaptured > 0
            ? `Reading ${visualsCaptured} captured slide/frame(s), then writing the summary & syncing to Notion...`
            : "Generating AI summary with Gemini & syncing to Notion..."
        );

        // Actively poll every 2s for up to 90s to catch the new summary + Notion link
        let attempts = 0;
        const pollNotion = setInterval(async () => {
          attempts++;
          try {
            const statusRes = await fetch("/api/meeting");
            const statusData = await statusRes.json();
            if (statusData.lastResult?.notionUrl) {
              setNotionUrl(statusData.lastResult.notionUrl);
              setStatusMessage("");
              clearInterval(pollNotion);
            }
          } catch {}
          if (attempts >= 45) {
            clearInterval(pollNotion);
            setStatusMessage("");
          }
        }, 2000);
      } else {
        setResult({ success: false, message: data.error || "Failed to leave meeting" });
      }
    } catch {
      setResult({ success: false, message: "Network error while leaving" });
    } finally {
      setLoading(false);
    }
  };

  const handleOpenGoogleLogin = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open-google-login" }),
      });
      const data = await res.json();
      setResult({ success: data.success, message: data.message || data.error });
    } catch {
      setResult({ success: false, message: "Failed to open Chrome sign-in window." });
    } finally {
      setLoading(false);
    }
  };

  /** Ask the saved transcript a question. Answers cite real transcript lines. */
  const askQuestion = async (raw?: string) => {
    const text = (raw ?? question).trim();
    if (!text || asking) return;
    setAsking(true);
    setQuestion("");
    const startedAt = performance.now();
    try {
      const res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ask", question: text }),
      });
      const data = await res.json();
      const ms = Math.round(performance.now() - startedAt);
      setThread((prev) => [
        ...prev,
        {
          id: `q-${Date.now()}-${prev.length}`,
          question: text,
          answer: data.success ? String(data.answer || "") : String(data.error || "No answer."),
          citations: data.success ? ((data.citations || []) as QaCitation[]) : [],
          followUps: data.success ? ((data.followUps || []) as string[]) : [],
          ms,
          cached: Boolean(data.cached),
          error: !data.success,
        },
      ]);
    } catch {
      setThread((prev) => [
        ...prev,
        {
          id: `q-${Date.now()}-${prev.length}`,
          question: text,
          answer: "The panel could not reach the meeting service.",
          citations: [],
          followUps: [],
          ms: Math.round(performance.now() - startedAt),
          error: true,
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const generateKit = async (refresh = false) => {
    if (kitBusy) return;
    setKitBusy(true);
    setKitError(null);
    try {
      const res = await fetch("/api/meeting/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generate", refresh }),
      });
      const data = await res.json();
      if (!data.success) {
        setKitError(String(data.error || "Could not build the revision kit."));
        return;
      }
      setKit({
        flashcards: Number(data.flashcards) || 0,
        formulas: Number(data.formulas) || 0,
        generatedAt: String(data.generatedAt || new Date().toISOString()),
      });
    } catch {
      setKitError("The panel could not reach the meeting service.");
    } finally {
      setKitBusy(false);
    }
  };

  const qaReady = Boolean(qa?.available);
  const suggestedQuestions = [
    "What was the main takeaway?",
    "List every number, formula or deadline mentioned",
    "What should I do next?",
  ];

  return (
    <div ref={shellRef} className="relative flex h-full min-h-0 flex-col bg-[#03080f] text-white">
      {/* HUD atmosphere: two soft light sources, no images, no layout cost. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(900px 320px at 8% -12%, rgba(34,211,238,0.14), transparent 60%), radial-gradient(700px 300px at 96% -6%, rgba(217,70,239,0.12), transparent 62%)",
        }}
      />

      {/* Header */}
      <header className="relative flex shrink-0 flex-wrap items-center gap-3 border-b border-cyan-400/10 bg-black/30 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative p-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 shadow-[0_0_18px_-6px_rgba(34,211,238,0.7)]">
            <Video className="w-5 h-5 text-cyan-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-orbitron text-[11px] uppercase tracking-[0.22em] text-white/85">
                Meeting Bot
              </span>
              {detectedPlatform && !botActive && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-cyan-400/25 text-cyan-300/90 uppercase tracking-wider">
                  {detectedPlatform}
                </span>
              )}
            </div>
            <span className="block text-[10px] text-white/40 truncate">
              {botActive
                ? statusMessage || "In meeting"
                : qaReady
                ? `${qa?.turns || 0} transcript lines ready to question`
                : "Dispatch the bot or let auto-attend walk it in"}
            </span>
          </div>
        </div>

        <span className="flex-1" />

        <div className="flex items-center gap-2 flex-wrap">
          {/* Idle shows the finished session's numbers, not a wall of zeroes. */}
          <span className="text-[10px] px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-white/55 font-mono">
            {captionsCount || qa?.turns || 0} lines
          </span>
          <span className="text-[10px] px-2 py-1 rounded-lg border border-fuchsia-400/20 bg-fuchsia-400/[0.06] text-fuchsia-200/80 font-mono">
            {visualsCaptured || lastSummary?.visuals?.length || 0} captures
          </span>
          <span
            className={`flex items-center gap-2 px-2.5 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wider border ${
              botActive
                ? "bg-emerald-500/15 border-emerald-400/30 text-emerald-300"
                : "bg-white/[0.04] border-white/10 text-white/40"
            }`}
          >
            {botActive ? (
              <>
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                <Wifi className="w-3 h-3" />
                Live
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3" />
                Idle
              </>
            )}
          </span>
          {botActive && (
            <button
              type="button"
              onClick={handleBringToFront}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/10 bg-white/[0.04] text-[10px] text-white/60 hover:text-white hover:border-cyan-400/30 transition-colors"
            >
              <ExternalLink className="w-3 h-3 text-cyan-300" />
              Focus
            </button>
          )}
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div
          className={`mx-auto w-full max-w-[1280px] px-4 py-4 ${
            wide
              ? "grid grid-cols-[minmax(340px,0.82fr)_minmax(0,1.35fr)] items-start gap-5"
              : "flex flex-col gap-5"
          }`}
        >
          {/* ── Left column: setup, calendar, live controls ── */}
          <div className="min-w-0 flex flex-col gap-4">
            {!botActive && qaReady && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-cyan-300/80" />
                  <span className="font-orbitron text-[9px] uppercase tracking-[0.2em] text-white/50">
                    Last session
                  </span>
                </div>
                <p className="text-[11px] text-white/70 truncate">
                  {qa?.title || "Finished meeting"}
                </p>
                <p className="text-[10px] text-white/35">
                  {qa?.turns || 0} transcript lines · {qa?.visuals || 0} captures — notes, questions
                  and the revision kit are on the right.
                </p>
              </div>
            )}

      {/* ── Auto-attend from Google Calendar ── */}
      <div className="rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setAutoJoinOpen((v) => !v)}
            className="flex items-center gap-3 text-left min-w-0"
          >
            <div
              className={`p-2 rounded-lg border shrink-0 ${
                autoJoin?.enabled
                  ? "bg-emerald-500/20 border-emerald-500/30"
                  : "bg-white/5 border-white/10"
              }`}
            >
              <CalendarClock
                className={`w-5 h-5 ${autoJoin?.enabled ? "text-emerald-400" : "text-white/40"}`}
              />
            </div>
            <div className="min-w-0">
              <span className="text-sm font-semibold text-white/80 block">
                Auto-Attend from Google Calendar
              </span>
              <span className="text-[10px] text-white/40 block truncate">
                {autoJoin?.enabled
                  ? autoJoin.nextWindowLabel
                    ? `Next linked meeting ${autoJoin.nextWindowLabel} — the bot will walk in by itself`
                    : `Watching your calendar${
                        autoJoin.lastTickAt ? ` (checked ${formatEventTime(autoJoin.lastTickAt)})` : ""
                      }`
                  : "Off — the bot only joins when you dispatch it"}
              </span>
            </div>
            {autoJoinOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-white/30 shrink-0" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-white/30 shrink-0" />
            )}
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={Boolean(autoJoin?.enabled)}
            aria-label="Toggle auto-attend"
            disabled={autoJoinBusy || !autoJoin}
            onClick={() => patchAutoJoin({ enabled: !autoJoin?.enabled })}
            className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
              autoJoin?.enabled ? "bg-emerald-500/70" : "bg-white/15"
            }`}
          >
            <span
              className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                autoJoin?.enabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </div>

        {autoJoinOpen && (
          <div className="space-y-3 pt-1 border-t border-white/5">
            {/* Platform switches + timing */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={autoJoinBusy}
                onClick={() =>
                  patchAutoJoin({
                    platforms: {
                      googleMeet: !autoJoin?.settings.platforms.googleMeet,
                      zoom: autoJoin?.settings.platforms.zoom,
                    },
                  })
                }
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${
                  autoJoin?.settings.platforms.googleMeet
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                    : "bg-white/5 border-white/10 text-white/35"
                }`}
              >
                Google Meet
              </button>
              <button
                type="button"
                disabled={autoJoinBusy}
                onClick={() =>
                  patchAutoJoin({
                    platforms: {
                      googleMeet: autoJoin?.settings.platforms.googleMeet,
                      zoom: !autoJoin?.settings.platforms.zoom,
                    },
                  })
                }
                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-semibold border transition-all ${
                  autoJoin?.settings.platforms.zoom
                    ? "bg-cyan-500/20 border-cyan-500/40 text-cyan-300"
                    : "bg-white/5 border-white/10 text-white/35"
                }`}
              >
                Zoom
              </button>

              <label className="flex items-center gap-1.5 text-[10px] text-white/40 ml-auto">
                Join
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={autoJoin?.settings.joinLeadSeconds ?? 20}
                  onChange={(e) => patchAutoJoin({ joinLeadSeconds: Number(e.target.value) })}
                  className="w-14 px-2 py-1 bg-black/20 border border-white/10 rounded-lg text-white text-[11px] focus:outline-none focus:border-cyan-500/50"
                />
                s early
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={checkCalendarNow}
                disabled={autoJoinBusy}
                className="flex-1 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 text-[11px] font-medium transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                {autoJoinBusy ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3 text-cyan-400" />
                )}
                Check calendar now
              </button>
              <button
                type="button"
                onClick={loadAutoJoin}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 text-[11px] transition-all"
                title="Refresh this list"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>

            {autoJoin?.calendarAuthenticated === false && (
              <p className="text-[10px] text-amber-300/80 leading-relaxed">
                Google Calendar isn&apos;t connected, so the bot can&apos;t see your meetings yet.
                Connect it in the Connected panel and this list fills in.
              </p>
            )}

            {!autoJoin?.upcoming.length && autoJoin?.calendarAuthenticated && (
              <p className="text-[10px] text-white/35 leading-relaxed">
                No upcoming events with a Meet or Zoom link in the next few days.
              </p>
            )}

            {!!autoJoin?.upcoming.length && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-white/35">
                  <span>Upcoming meetings</span>
                  {autoJoin?.lastJoined && (
                    <span className="text-emerald-400/80 normal-case tracking-normal">
                      Last: {autoJoin.lastJoined.title} · {formatEventTime(autoJoin.lastJoined.joinedAt)}
                    </span>
                  )}
                </div>
                {autoJoin.upcoming.slice(0, 4).map((ev) => (
                  <div
                    key={ev.id || ev.title}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/20 border border-white/5"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-white/80 truncate">
                          {ev.title}
                        </span>
                        {ev.platform && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 shrink-0">
                            {ev.platform}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-white/40">
                        {formatEventTime(ev.start)}
                        {ev.reason === "too-early" && ev.startsInMs != null
                          ? ` · ${countdownLabel(ev.startsInMs)}`
                          : ""}
                      </div>
                      <p className="text-[10px] text-white/35 truncate">{ev.message}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full border ${badgeClass(ev.badge)}`}
                      >
                        {ev.badge}
                      </span>
                      {ev.url && !botActive && (
                        <button
                          type="button"
                          disabled={autoJoinBusy}
                          onClick={() => joinCalendarEvent(ev.id)}
                          className="px-2 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-[10px] font-semibold hover:bg-cyan-500/30 transition-all flex items-center gap-1 disabled:opacity-50"
                        >
                          <Play className="w-2.5 h-2.5" />
                          Join
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {botActive && (
              <p className="text-[10px] text-cyan-300/70 leading-relaxed">
                Auto-attend is paused while the bot is in a meeting — it rejoins the watch
                automatically once you leave.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Google Sign-In Banner — shown when Chrome needs authentication */}
      {needsSignIn && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-amber-500/10 border border-amber-500/40 p-4 space-y-3"
        >
          <div className="flex items-start gap-3">
            <div className="text-2xl">🔑</div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-400">Google Sign-In Required</p>
              <p className="text-xs text-amber-300/80 leading-relaxed">
                Google blocks sign-in when automated browser tools are detected. To avoid this, JARVIS has launched a <strong className="text-white">secure, clean native Chrome window</strong> (no automation flags).
              </p>
              <p className="text-xs text-amber-300/70 leading-relaxed">
                Sign in with <span className="font-mono text-amber-200 font-bold">dhruvbijapur67@gmail.com</span> in that window. Once done, click the button below to join the meeting immediately!
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <button
              onClick={handleOpenGoogleLogin}
              disabled={loading}
              type="button"
              className="py-2.5 px-3 rounded-xl bg-white/5 border border-white/10 text-white/80 text-xs font-semibold hover:bg-white/10 transition-all flex items-center justify-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Re-open Clean Sign-In
            </button>
            <button
              onClick={async () => {
                setNeedsSignIn(false);
                setLoading(true);
                handleJoin();
              }}
              disabled={loading}
              type="button"
              className="py-2.5 px-3 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/10"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              I&apos;ve Signed In → Join Meeting Now
            </button>
          </div>
        </motion.div>
      )}

      {/* CAPTCHA / Action Notification Banner */}
      {statusMessage && statusMessage.includes("CAPTCHA") && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl bg-amber-500/15 border border-amber-500/50 p-4 space-y-3 shadow-lg shadow-amber-500/10"
        >
          <div className="flex items-start gap-3">
            <div className="text-2xl">🤖</div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-amber-300">Security Verification Required</p>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                Zoom presented a security verification for this webinar. The Chrome window has been brought to your screen.
              </p>
              <p className="text-xs text-amber-200/80 leading-relaxed">
                Please complete the verification checkbox/puzzle in the Zoom window. JARVIS will automatically detect when it's done and enter the room!
              </p>
            </div>
          </div>
          <button
            onClick={handleBringToFront}
            type="button"
            className="w-full py-2.5 px-3 rounded-xl bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-bold hover:bg-amber-500/30 transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/10"
          >
            <ExternalLink className="w-4 h-4 text-amber-400" />
            Bring Zoom Window to Front
          </button>
        </motion.div>
      )}

      {/* Join Form (only show when bot is NOT active) */}
      {!botActive && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-white/50 font-medium ml-1">Meeting Link (Google Meet or Zoom)</label>
            <div className="relative">
              <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://meet.google.com/... or https://zoom.us/j/..."
                className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-white/30">
            <div className="h-[1px] bg-white/10 flex-1" />
            <span>OR ZOOM ID & PASS</span>
            <div className="h-[1px] bg-white/10 flex-1" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-white/50 font-medium ml-1">Meeting ID</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 text-xs font-bold">
                  #
                </div>
                <input
                  type="text"
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  placeholder="894 7086 1004"
                  className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-white/50 font-medium ml-1">Passcode (if required)</label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••"
                  className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
                />
              </div>
            </div>
          </div>

          {/* Participant / Webinar Registration Details */}
          <div className="pt-2 border-t border-white/5 space-y-2">
            <button
              type="button"
              onClick={() => setShowUserDetails(!showUserDetails)}
              className="flex items-center justify-between w-full text-xs text-cyan-400/90 hover:text-cyan-300 font-medium transition-colors py-1"
            >
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-cyan-400" />
                {isWebinar ? "Webinar Registration Details (Auto-fill)" : "Webinar / Participant Details"}
              </span>
              <span className="text-[10px] text-white/40 hover:text-white/60">
                {showUserDetails || isWebinar ? "▲ Collapse" : "▼ Edit Name, Email & Phone"}
              </span>
            </button>

            {(showUserDetails || isWebinar) && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1"
              >
                <div className="space-y-1">
                  <label className="text-[11px] text-white/50 font-medium ml-1">Your Name</label>
                  <div className="relative">
                    <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="Dhruv"
                      className="w-full pl-8 pr-3 py-2 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-xs transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-white/50 font-medium ml-1">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="dhruvbijapur@gmail.com"
                      className="w-full pl-8 pr-3 py-2 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-xs transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-white/50 font-medium ml-1">Mobile / Phone</label>
                  <div className="relative">
                    <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="9606571200"
                      className="w-full pl-8 pr-3 py-2 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-xs transition-all"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      )}

      {/* Live Stats & Chat (show when bot IS active) */}
      {botActive && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/20">
                <FileText className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white/60 uppercase">Live Dialogue Captured</div>
                <div className="text-lg font-bold text-white flex items-center gap-2">
                  {captionsCount} entries
                  {isRecording && <span className="text-xs font-normal text-emerald-400">● Transcribing</span>}
                </div>
                {statusMessage && (
                  <p className="text-[11px] text-cyan-300/80 mt-0.5">{statusMessage}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleBringToFront}
              type="button"
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-xs font-medium transition-all flex items-center gap-1.5 shadow-sm"
              title="Bring meeting Chrome window to the foreground"
            >
              <ExternalLink className="w-3.5 h-3.5 text-cyan-400" />
              Focus Window
            </button>
          </div>

          {/* Live capture of what is being shown on the shared screen */}
          <div className="p-4 rounded-2xl bg-fuchsia-500/5 border border-fuchsia-500/20 space-y-3">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4 text-fuchsia-300" />
              <span className="text-xs font-semibold text-white/60 uppercase">
                Screen Captures
              </span>
              <span className="ml-auto text-[10px] text-fuchsia-300/80">
                {visualsCaptured} kept
              </span>
            </div>
            <p className="text-[10px] text-white/40 leading-relaxed">
              Diagrams, slides and worked problems are captured as they appear and attached to
              the meeting summary — only frames that actually changed are kept.
            </p>
            {liveVisuals.length > 0 ? (
              <VisualGrid visuals={liveVisuals} />
            ) : (
              <p className="text-[10px] text-white/30">
                Nothing worth keeping shared yet. Start a screen share and the frames show up
                here within a few seconds.
              </p>
            )}
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="w-4 h-4 text-white/50" />
              <span className="text-xs font-semibold text-white/60 uppercase">Meeting Chat</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleChat()}
                placeholder="Send a message into the meeting..."
                className="flex-1 px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-white placeholder-white/30 text-sm focus:outline-none focus:border-cyan-500/50 transition-all"
              />
              <button
                onClick={handleChat}
                disabled={loading || !chatMessage}
                className="px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Button */}
      {botActive ? (
        <button
          onClick={handleLeave}
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-red-400 hover:to-rose-500 disabled:opacity-50 transition-all shadow-lg shadow-red-500/25"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <PhoneOff className="w-4 h-4" />
              Leave & Sync Notes to Notion
            </>
          )}
        </button>
      ) : (
        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/25"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting to Meeting...
            </>
          ) : (
            <>
              <Video className="w-4 h-4" />
              Dispatch Meeting Bot
            </>
          )}
        </button>
      )}

          </div>

          {/* ── Right column: what the meeting produced / can answer ── */}
          <div className="min-w-0 flex flex-col gap-4">
            {!result && !notionUrl && !lastSummary && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 space-y-4">
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-cyan-300" />
                  <span className="font-orbitron text-[10px] uppercase tracking-[0.2em] text-white/60">
                    Meeting intelligence
                  </span>
                </div>
                <p className="text-xs text-white/45 leading-relaxed">
                  {botActive
                    ? "JARVIS is in the call. Detailed notes, the diagram gallery, question answering and the revision kit all land here the moment the bot leaves."
                    : "Nothing captured yet. Once JARVIS attends a meeting, this side holds the notes, the diagrams it kept, a box you can question about the transcript, and a revision kit."}
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {[
                    { icon: FileText, label: "Detailed notes", hint: "Chronological, with quotes" },
                    { icon: Eye, label: "Diagram gallery", hint: "Only frames that changed" },
                    { icon: HelpCircle, label: "Ask the transcript", hint: "Answers with timestamps" },
                    { icon: Layers, label: "Revision kit", hint: "Flashcards + formula sheet" },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-start gap-2.5 rounded-xl border border-white/[0.07] bg-black/25 px-3 py-2.5"
                    >
                      <item.icon className="w-3.5 h-3.5 text-cyan-300/80 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-white/70">{item.label}</div>
                        <div className="text-[10px] text-white/35">{item.hint}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

      {/* Result Feedback & Notion Link */}
      <AnimatePresence>
        {(result || notionUrl || lastSummary) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`rounded-2xl border p-4 space-y-3 text-sm ${
              result && !result.success
                ? "border-red-500/30 bg-red-500/[0.06] text-red-200"
                : "border-cyan-400/15 bg-white/[0.04] text-white/80"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {result && !result.success ? (
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-400" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
              )}
              <span className="flex-1">{result?.message || "Notes synced to Notion database."}</span>
            </div>

            {!notionUrl && statusMessage && (
              <div className="flex items-center gap-2 text-xs text-emerald-300/90 pt-1 font-medium">
                <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                <span>{statusMessage}</span>
              </div>
            )}

            {(result?.notionUrl || notionUrl) && (
              <a
                href={result?.notionUrl || notionUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-xs font-semibold transition-colors mt-1"
              >
                <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
                View Notes in Notion
                <ExternalLink className="w-3 h-3 text-emerald-400" />
              </a>
            )}

            {/* The summary itself, with the diagrams that were shown */}
            {lastSummary && (
              <div className="pt-1 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-300" />
                    <span className="font-orbitron text-[10px] uppercase tracking-[0.2em] text-white/60">
                      Meeting notes
                    </span>
                  </div>
                  <span className="text-[9px] font-mono text-white/35">
                    {summaryWords(lastSummary)} words
                    {lastSummary.sections?.length ? ` · ${lastSummary.sections.length} sections` : ""}
                  </span>
                </div>

                {/* Long notes scroll inside the card instead of stretching
                    the panel taller than the screen. */}
                <div className="max-h-[440px] overflow-y-auto pr-1 space-y-3.5">
                  {lastSummary.summary && (
                    <div className="space-y-2">
                      {lastSummary.summary
                        .split(/\n{2,}/)
                        .filter(Boolean)
                        .map((paragraph, i) => (
                          <p key={i} className="text-xs text-white/70 leading-relaxed">
                            {paragraph}
                          </p>
                        ))}
                    </div>
                  )}

                  {!!lastSummary.keyTopics?.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {lastSummary.keyTopics.slice(0, 12).map((topic) => (
                        <span
                          key={topic}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300/90"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  )}

                  {!!lastSummary.sections?.length && (
                    <div className="space-y-3">
                      <div className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                        Detailed Notes
                      </div>
                      {lastSummary.sections.map((section, i) => (
                        <div key={`${section.heading}-${i}`} className="space-y-1.5 border-l border-white/10 pl-2.5">
                          <div className="text-[11px] font-semibold text-cyan-200/90">
                            {section.heading}
                          </div>
                          {section.body
                            .split(/\n{2,}/)
                            .filter(Boolean)
                            .map((paragraph, p) => (
                              <p key={p} className="text-[11px] text-white/65 leading-relaxed">
                                {paragraph}
                              </p>
                            ))}
                          {!!section.bullets?.length && (
                            <ul className="list-disc pl-4 space-y-0.5">
                              {section.bullets.map((bullet, b) => (
                                <li key={b} className="text-[11px] text-white/60 leading-relaxed">
                                  {bullet}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {!!lastSummary.visuals?.length ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-[11px] font-semibold text-fuchsia-300/90">
                        <ImageIcon className="w-3 h-3" />
                        Diagrams &amp; visuals from the call ({lastSummary.visuals.length})
                      </div>
                      <VisualGrid visuals={lastSummary.visuals} />
                    </div>
                  ) : (
                    <p className="text-[10px] text-white/35">
                      No diagrams or shared visuals were captured in this meeting.
                    </p>
                  )}

                  {!!lastSummary.highlights?.length && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                        <Quote className="w-3 h-3 text-fuchsia-300/80" />
                        Key Moments
                      </div>
                      {lastSummary.highlights.map((quote, i) => (
                        <p
                          key={i}
                          className="text-[11px] text-white/60 leading-relaxed italic border-l-2 border-fuchsia-500/40 pl-2.5"
                        >
                          {quote}
                        </p>
                      ))}
                    </div>
                  )}

                  {!!lastSummary.decisions?.length && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                        Decisions
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {lastSummary.decisions.map((decision, i) => (
                          <li key={i} className="text-[11px] text-white/65 leading-relaxed">
                            {decision}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!!lastSummary.actionItems?.length && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                        Action Items
                      </div>
                      {lastSummary.actionItems.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 text-[11px] leading-relaxed">
                          <span className="mt-1 w-1.5 h-1.5 rounded-full bg-cyan-400/70 shrink-0" />
                          <span className="text-white/65">
                            {item.task}
                            <span className="text-white/35">
                              {" "}
                              · {item.assignee || "Unassigned"} · {item.due || "TBD"}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!!lastSummary.openQuestions?.length && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                        Open Questions
                      </div>
                      <ul className="list-disc pl-4 space-y-0.5">
                        {lastSummary.openQuestions.map((question, i) => (
                          <li key={i} className="text-[11px] text-white/60 leading-relaxed">
                            {question}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!!lastSummary.concepts?.length && (
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                        <Lightbulb className="w-3 h-3 text-amber-300/80" />
                        Key Concepts
                      </div>
                      {lastSummary.concepts.map((concept, i) => (
                        <p key={i} className="text-[11px] text-white/60 leading-relaxed">
                          <span className="text-cyan-200/90 font-semibold">{concept.term}</span>
                          {" — "}
                          {concept.explanation}
                        </p>
                      ))}
                    </div>
                  )}

                  {lastSummary.nextSteps && (
                    <div className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                        Next Steps
                      </div>
                      <p className="text-[11px] text-white/65 leading-relaxed whitespace-pre-line">
                        {lastSummary.nextSteps}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

            {/* ── Chat with this meeting ── */}
            <div className="rounded-2xl border border-cyan-400/15 bg-white/[0.035] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-cyan-300" />
                <span className="font-orbitron text-[10px] uppercase tracking-[0.2em] text-white/60">
                  Ask this meeting
                </span>
                <span className="ml-auto text-[10px] font-mono text-white/30">
                  {qaReady
                    ? `${qa?.turns || 0} lines · ${qa?.visuals || 0} visuals`
                    : "no transcript"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      askQuestion();
                    }
                  }}
                  disabled={!qaReady || asking}
                  placeholder={
                    qaReady
                      ? "Ask anything that was said or shown…"
                      : "Attend a meeting first — answers come from the transcript"
                  }
                  className="flex-1 min-w-0 px-3 py-2 bg-black/35 border border-white/10 rounded-lg text-xs text-white placeholder-white/25 focus:outline-none focus:border-cyan-400/45 disabled:opacity-50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => askQuestion()}
                  disabled={!qaReady || asking || !question.trim()}
                  title="Ask (Enter)"
                  className="px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400/30 text-cyan-200 transition-colors disabled:opacity-40"
                >
                  {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>

              {qaReady && thread.length === 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {suggestedQuestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => askQuestion(suggestion)}
                      className="text-[10px] px-2 py-1 rounded-full border border-white/10 bg-white/[0.04] text-white/50 hover:text-cyan-200 hover:border-cyan-400/30 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              {!!thread.length && (
                <div
                  className={`flex flex-col gap-3 ${
                    thread.length > 2 ? "max-h-[460px] overflow-y-auto pr-1" : ""
                  }`}
                >
                  {[...thread].reverse().map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-white/[0.07] bg-black/30 p-3 space-y-2"
                    >
                      <div className="flex items-start gap-1.5">
                        <ChevronRight className="w-3 h-3 text-cyan-300 mt-0.5 shrink-0" />
                        <span className="text-[11px] font-semibold text-white/75">
                          {entry.question}
                        </span>
                      </div>
                      <p
                        className={`text-[11.5px] leading-relaxed whitespace-pre-line ${
                          entry.error ? "text-amber-300/80" : "text-white/70"
                        }`}
                      >
                        {entry.answer}
                      </p>

                      {!!entry.citations.length && (
                        <div className="flex flex-wrap gap-1.5">
                          {entry.citations.map((citation) => {
                            const key = `${entry.id}-${citation.line}-${citation.visual ?? 0}`;
                            const open = openCitation === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setOpenCitation(open ? null : key)}
                                title={`${citation.speaker} at ${citation.clock}`}
                                className={`flex items-center gap-1 text-[9.5px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                                  open
                                    ? "border-cyan-400/50 bg-cyan-400/15 text-cyan-100"
                                    : "border-white/10 bg-white/[0.04] text-white/45 hover:text-cyan-200 hover:border-cyan-400/30"
                                }`}
                              >
                                <Clock className="w-2.5 h-2.5" />
                                {citation.clock || "on screen"}
                                {citation.clock && <span className="text-white/30">·</span>}
                                <span className="max-w-[88px] truncate">{citation.speaker}</span>
                              </button>
                            );
                          })}
                          {entry.citations
                            .filter((citation) => citation.visual)
                            .map((citation) => (
                              <a
                                key={`v-${entry.id}-${citation.visual}`}
                                href={citation.imageUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[9.5px] px-1.5 py-0.5 rounded border border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200/80 hover:bg-fuchsia-400/20 transition-colors"
                              >
                                <Eye className="w-2.5 h-2.5" /> Visual #{citation.visual}
                              </a>
                            ))}
                        </div>
                      )}

                      {entry.citations
                        .filter(
                          (citation) =>
                            openCitation === `${entry.id}-${citation.line}-${citation.visual ?? 0}`
                        )
                        .map((citation) => (
                          <div
                            key={`open-${citation.line}`}
                            className="rounded-lg border-l-2 border-cyan-400/50 bg-cyan-400/[0.06] px-2.5 py-2 space-y-1"
                          >
                            <div className="text-[9px] uppercase tracking-wider text-cyan-300/70">
                              {citation.clock} · {citation.speaker}
                            </div>
                            <p className="text-[11px] text-white/65 leading-relaxed">
                              {citation.quote}
                            </p>
                          </div>
                        ))}

                      {!!entry.followUps?.length && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {entry.followUps.map((followUp) => (
                            <button
                              key={followUp}
                              type="button"
                              onClick={() => askQuestion(followUp)}
                              className="text-[9.5px] px-2 py-0.5 rounded-full border border-white/10 text-white/40 hover:text-cyan-200 hover:border-cyan-400/30 transition-colors"
                            >
                              {followUp}
                            </button>
                          ))}
                        </div>
                      )}

                      {!entry.error && (
                        <div className="text-[9px] font-mono text-white/25">
                          {entry.cached ? "cached answer" : `${(entry.ms / 1000).toFixed(1)}s`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Revision kit ── */}
            <div className="rounded-2xl border border-fuchsia-400/15 bg-white/[0.035] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-fuchsia-300" />
                <span className="font-orbitron text-[10px] uppercase tracking-[0.2em] text-white/60">
                  Revision kit
                </span>
                {kit && (
                  <span className="ml-auto text-[10px] font-mono text-white/30">
                    {kit.flashcards} cards · {kit.formulas} formulas
                  </span>
                )}
              </div>

              {kit ? (
                <>
                  <p className="text-[11px] text-white/45 leading-relaxed">
                    Built from this meeting's transcript. The CSV imports straight into Anki; the
                    markdown sheet prints the formulas on one page.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href="/api/meeting/study?format=csv"
                      download
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 text-[11px] font-semibold text-fuchsia-100 hover:bg-fuchsia-400/20 transition-colors"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" />
                      Flashcards (.csv)
                    </a>
                    <a
                      href="/api/meeting/study?format=md"
                      download
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-400/20 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Formula sheet (.md)
                    </a>
                    <button
                      type="button"
                      onClick={() => generateKit(true)}
                      disabled={kitBusy}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-white/10 text-[11px] text-white/50 hover:text-white hover:border-white/25 transition-colors disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${kitBusy ? "animate-spin" : ""}`} />
                      Rebuild
                    </button>
                  </div>
                  <div className="text-[9px] font-mono text-white/25">
                    generated {new Date(kit.generatedAt).toLocaleTimeString()}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-white/45 leading-relaxed">
                    Turn the transcript into flashcards for spaced repetition and a one-page sheet
                    of every formula that came up.
                  </p>
                  <button
                    type="button"
                    onClick={() => generateKit()}
                    disabled={kitBusy || !qaReady || botActive}
                    title={botActive ? "Available once the bot leaves the meeting" : undefined}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10 text-[11px] font-semibold text-fuchsia-100 hover:bg-fuchsia-400/20 transition-colors disabled:opacity-40"
                  >
                    {kitBusy ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Building from transcript…
                      </>
                    ) : (
                      <>
                        <Wand2 className="w-3.5 h-3.5" /> Generate revision kit
                      </>
                    )}
                  </button>
                  {kitError && <p className="text-[10px] text-amber-300/80">{kitError}</p>}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────── shared types for the new sections ────────────────── */

interface GalleryVisual {
  id: string;
  clock: string;
  imageUrl: string;
  source?: string;
  timestamp?: string;
  /** Present only after the vision pass — live thumbnails have no captions yet. */
  title?: string;
  type?: string;
  description?: string;
  textOnScreen?: string;
  transcriptContext?: string;
}

type VisualThumb = GalleryVisual;

/** Total prose in the summary, so a thin 5-line recap is obvious at a glance. */
function summaryWords(summary: MeetingSummaryView): number {
  const parts = [
    summary.summary,
    summary.nextSteps || "",
    ...(summary.sections || []).map((s) => `${s.heading}\n${s.body}\n${(s.bullets || []).join("\n")}`),
  ];
  return parts.join(" ").split(/\s+/).filter(Boolean).length;
}

interface QaCitation {
  line: number;
  clock: string;
  speaker: string;
  quote: string;
  visual?: number;
  visualTitle?: string;
  imageUrl?: string;
}

interface QaThreadEntry {
  id: string;
  question: string;
  answer: string;
  citations: QaCitation[];
  followUps: string[];
  ms: number;
  cached?: boolean;
  error?: boolean;
}

interface QaAvailability {
  available: boolean;
  turns: number;
  live: boolean;
  title?: string | null;
  visuals: number;
}

interface KitSummary {
  flashcards: number;
  formulas: number;
  generatedAt: string;
}

interface MeetingSummaryView {
  summary: string;
  keyTopics?: string[];
  decisions?: string[];
  actionItems?: Array<{ task: string; assignee?: string; due?: string }>;
  nextSteps?: string;
  visuals?: GalleryVisual[];
  /** Chronological narrative notes — the long-form part of the summary. */
  sections?: Array<{ heading: string; body: string; bullets?: string[] }>;
  highlights?: string[];
  openQuestions?: string[];
  concepts?: Array<{ term: string; explanation: string }>;
}

interface AutoJoinEventView {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  platform: string | null;
  url: string | null;
  badge: string;
  reason: string;
  message: string;
  willJoin: boolean;
  startsInMs: number | null;
}

interface AutoJoinStatus {
  enabled: boolean;
  calendarAuthenticated: boolean;
  settings: {
    enabled: boolean;
    platforms: { googleMeet: boolean; zoom: boolean };
    joinLeadSeconds: number;
    joinGraceSeconds: number;
    pollSeconds: number;
  };
  upcoming: AutoJoinEventView[];
  nextEvent: AutoJoinEventView | null;
  nextWindowLabel: string | null;
  lastJoined: { title: string; url: string; joinedAt: string; platform: string } | null;
  lastTickAt: string | null;
  lastError: string | null;
  handledCount: number;
}

/** Thumbnail wall of captured slides/diagrams; each opens full size. */
function VisualGrid({ visuals }: { visuals: GalleryVisual[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {visuals.map((visual) => (
        <a
          key={visual.id}
          href={visual.imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group rounded-xl overflow-hidden border border-white/10 bg-black/30 hover:border-cyan-500/40 transition-all"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={visual.imageUrl}
            alt={visual.title || "Captured meeting visual"}
            loading="lazy"
            className="w-full h-36 object-cover bg-black/40"
          />
          <div className="p-2.5 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-white/80 truncate">
                {visual.title || `Frame ${visual.clock}`}
              </span>
              {visual.type && (
                <span className="text-[9px] uppercase tracking-wider text-fuchsia-300/80 shrink-0">
                  {visual.type}
                </span>
              )}
            </div>
            {visual.description && (
              <p className="text-[10px] text-white/50 leading-relaxed">{visual.description}</p>
            )}
            <span className="text-[9px] font-mono text-white/30 block">{visual.clock}</span>
          </div>
        </a>
      ))}
    </div>
  );
}

function formatEventTime(iso: string | null): string {
  if (!iso) return "no time";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `in ${minutes || total}m`;
  return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function badgeClass(badge: string): string {
  switch (badge) {
    case "Joining":
      return "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";
    case "Scheduled":
      return "bg-cyan-500/15 border-cyan-500/40 text-cyan-300";
    case "Attended":
      return "bg-emerald-500/10 border-emerald-500/30 text-emerald-300/80";
    case "Platform off":
    case "Finished":
    case "Cancelled":
      return "bg-amber-500/10 border-amber-500/30 text-amber-300/80";
    default:
      return "bg-white/5 border-white/10 text-white/40";
  }
}
