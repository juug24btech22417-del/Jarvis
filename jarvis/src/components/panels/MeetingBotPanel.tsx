"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Video,
  Link,
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
} from "lucide-react";

export default function MeetingBotPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [formData, setFormData] = useState({
    url: "",
    id: "",
    password: "",
  });
  const [chatMessage, setChatMessage] = useState("");
  const [botActive, setBotActive] = useState(false);
  const [captionsCount, setCaptionsCount] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
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
      // Poll status every 5 seconds to update caption count
      pollRef.current = setInterval(checkBotStatus, 5000);
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

  const handleJoin = async () => {
    if (!formData.url && !formData.id) {
      setResult({ success: false, message: "Please provide a meeting link or ID" });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "join",
          url: formData.url || `https://zoom.us/j/${formData.id}`,
          credentials: {
            id: formData.id,
            password: formData.password,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: data.message });
        setBotActive(true);
        setFormData({ url: "", id: "", password: "" });
      } else {
        setResult({ success: false, message: data.error || "Failed to join meeting" });
      }
    } catch (err: any) {
      setResult({
        success: false,
        message: "Could not reach the meeting bot server. Make sure the app is running.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = async () => {
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "leave" }),
      });

      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: data.message });
        setBotActive(false);
      } else {
        setResult({ success: false, message: data.error || "Failed to leave meeting" });
      }
    } catch {
      setResult({ success: false, message: "Network error while leaving" });
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
          <span className="text-sm font-semibold text-white/80">Meeting Bot Control</span>
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

      {/* Join Form (only show when bot is NOT active) */}
      {!botActive && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-white/50 font-medium ml-1">Meeting Link</label>
            <div className="relative">
              <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                placeholder="https://meet.google.com/... or Zoom link"
                className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-white/50 font-medium ml-1">Meeting ID (Zoom)</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 text-xs font-bold">
                  #
                </div>
                <input
                  type="text"
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  placeholder="123 456 789"
                  className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-sm transition-all"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-white/50 font-medium ml-1">Password</label>
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

      {/* Chat Section & Live Stats (show when bot IS active) */}
      {botActive && (
        <div className="space-y-4">
          <div className="p-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/20 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-cyan-500/20">
                <FileText className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-white/60 uppercase">Live Captions Captured</div>
                <div className="text-lg font-bold text-white flex items-center gap-2">
                  {captionsCount} 
                  {isRecording && <span className="text-xs font-normal text-emerald-400">Scraping...</span>}
                </div>
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
              placeholder="Send a message via JARVIS..."
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
          className="w-full py-3 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-red-400 hover:to-rose-500 disabled:opacity-50 transition-all shadow-lg shadow-red-500/25"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <PhoneOff className="w-4 h-4" />
              Leave Meeting
            </>
          )}
        </button>
      ) : (
        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 transition-all shadow-lg shadow-cyan-500/25"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Connecting...
            </>
          ) : (
            <>
              <Video className="w-4 h-4" />
              Dispatch Bot
            </>
          )}
        </button>
      )}

      {/* Result Feedback */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`p-3 rounded-xl flex items-start gap-3 text-sm ${
              result.success
                ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                : "bg-red-500/10 border border-red-500/30 text-red-400"
            }`}
          >
            {result.success ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            )}
            <span>{result.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
