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
} from "lucide-react";

export default function MeetingBotPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; notionUrl?: string | null } | null>(null);
  const [formData, setFormData] = useState({
    url: "",
    id: "",
    password: "",
  });
  const [chatMessage, setChatMessage] = useState("");
  const [botActive, setBotActive] = useState(false);
  const [captionsCount, setCaptionsCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [notionUrl, setNotionUrl] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);  // Chrome needs Google sign-in
  const lastJoinParamsRef = useRef<{ url: string; id: string; password: string } | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Check bot status on mount and poll while active
  useEffect(() => {
    checkBotStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (botActive) {
      // Poll status every 3.5 seconds while bot is active
      pollRef.current = setInterval(checkBotStatus, 3500);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [botActive]);

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
      }
    } catch {
      // API might not be ready yet
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
          setFormData({ url: "", id: "", password: "" });
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
        setStatusMessage("Generating AI summary with Gemini & syncing to Notion...");

        // Actively poll every 2s for up to 20s to catch the newly created Notion link
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
          if (attempts >= 10) {
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 space-y-6"
    >
      {/* Header with Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30">
            <Video className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white/80 block">Meeting Bot Control</span>
            {detectedPlatform && !botActive && (
              <span className="text-[10px] text-cyan-400 font-mono tracking-wider uppercase">
                Detected: {detectedPlatform}
              </span>
            )}
          </div>
        </div>

        {/* Live Status Indicator */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            botActive
              ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-400"
              : "bg-white/5 border border-white/10 text-white/40"
          }`}
        >
          {botActive ? (
            <>
              <Wifi className="w-3 h-3" />
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              In Meeting
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3" />
              Idle
            </>
          )}
        </div>
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

      {/* Result Feedback & Notion Link */}
      <AnimatePresence>
        {(result || notionUrl) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`p-3.5 rounded-xl space-y-2 text-sm ${
              result && !result.success
                ? "bg-red-500/10 border border-red-500/30 text-red-300"
                : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
