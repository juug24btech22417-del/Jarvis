"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldAlert, Terminal, CheckSquare, Bell, X, Copy, Lock, Sparkles, Check } from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

export default function SentinelSuggestionWidget() {
  const activeSuggestion = useJarvisStore((s) => s.activeSuggestion);
  const clearActiveSuggestion = useJarvisStore((s) => s.clearActiveSuggestion);
  const [copied, setCopied] = useState(false);
  const [success, setSuccess] = useState(false);
  const [chatId, setChatId] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(25); // 25 seconds auto-dismiss

  // Fetch allowed chat ID for Telegram reminders
  useEffect(() => {
    async function fetchChatId() {
      try {
        const res = await fetch("/api/telegram/notify");
        const data = await res.json();
        if (data.allowedChatIds && data.allowedChatIds.length > 0) {
          setChatId(data.allowedChatIds[0]);
        }
      } catch (err) {
        console.error("Failed to fetch chat ID for reminders:", err);
      }
    }
    fetchChatId();
  }, []);

  // Timer for auto-dismiss
  useEffect(() => {
    if (!activeSuggestion) return;
    setTimeLeft(25);
    setSuccess(false);
    setCopied(false);

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          clearActiveSuggestion();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [activeSuggestion, clearActiveSuggestion]);

  if (!activeSuggestion) return null;

  const { type, title, details, comment, metadata } = activeSuggestion;

  // Visual configuration mapping
  const config = {
    security_risk: {
      border: "border-red-500/40 bg-slate-950/80 shadow-[0_0_20px_rgba(239,68,68,0.2)]",
      glowText: "text-red-400 drop-shadow-[0_0_8px_rgba(239,68,68,0.5)]",
      icon: <ShieldAlert className="w-5 h-5 text-red-400" />,
      accent: "bg-red-500",
      buttonText: "Lock System",
      buttonIcon: <Lock className="w-4 h-4 mr-1.5" />,
      action: async () => {
        try {
          await fetch("/api/os/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: "lock" }),
          });
          setSuccess(true);
          setTimeout(() => {
            clearActiveSuggestion();
          }, 1500);
        } catch (err) {
          console.error("Failed to lock system:", err);
        }
      },
    },
    debug: {
      border: "border-purple-500/40 bg-slate-950/80 shadow-[0_0_20px_rgba(168,85,247,0.2)]",
      glowText: "text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]",
      icon: <Terminal className="w-5 h-5 text-purple-400" />,
      accent: "bg-purple-500",
      buttonText: "Copy Command",
      buttonIcon: <Copy className="w-4 h-4 mr-1.5" />,
      action: async () => {
        const cmd = metadata?.command || details;
        await navigator.clipboard.writeText(cmd);
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
          clearActiveSuggestion();
        }, 1500);
      },
    },
    task: {
      border: "border-cyan-500/40 bg-slate-950/80 shadow-[0_0_20px_rgba(6,182,212,0.2)]",
      glowText: "text-cyan-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]",
      icon: <CheckSquare className="w-5 h-5 text-cyan-400" />,
      accent: "bg-cyan-500",
      buttonText: "Add Task",
      buttonIcon: <CheckSquare className="w-4 h-4 mr-1.5" />,
      action: async () => {
        try {
          const res = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title,
              priority: "normal",
              completed: false,
            }),
          });
          if (res.ok) {
            setSuccess(true);
            setTimeout(() => {
              clearActiveSuggestion();
            }, 1500);
          }
        } catch (err) {
          console.error("Failed to create task:", err);
        }
      },
    },
    reminder: {
      border: "border-amber-500/40 bg-slate-950/80 shadow-[0_0_20px_rgba(245,158,11,0.2)]",
      glowText: "text-amber-400 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]",
      icon: <Bell className="w-5 h-5 text-amber-400" />,
      accent: "bg-amber-500",
      buttonText: "Set Reminder",
      buttonIcon: <Bell className="w-4 h-4 mr-1.5" />,
      action: async () => {
        try {
          if (!chatId) {
            console.error("No active chatId found for reminder creation.");
            return;
          }
          // Set reminder for tomorrow
          const fireAt = new Date();
          fireAt.setDate(fireAt.getDate() + 1);
          fireAt.setHours(9, 0, 0, 0); // 9:00 AM tomorrow

          const res = await fetch("/api/telegram/reminders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatId,
              text: title,
              fireAt: fireAt.toISOString(),
            }),
          });
          if (res.ok) {
            setSuccess(true);
            setTimeout(() => {
              clearActiveSuggestion();
            }, 1500);
          }
        } catch (err) {
          console.error("Failed to set reminder:", err);
        }
      },
    },
  }[type] || {
    border: "border-slate-500/40 bg-slate-950/80 shadow-[0_0_20px_rgba(100,116,139,0.2)]",
    glowText: "text-slate-400",
    icon: <Sparkles className="w-5 h-5 text-slate-400" />,
    accent: "bg-slate-500",
    buttonText: "Acknowledge",
    buttonIcon: <Check className="w-4 h-4 mr-1.5" />,
    action: () => clearActiveSuggestion(),
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -50, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className={`fixed top-6 right-6 z-[60] w-96 rounded-xl border p-5 backdrop-blur-xl transition-all duration-300 ${config.border}`}
      >
        {/* Progress bar line for auto-dismiss */}
        <div className="absolute top-0 left-0 right-0 h-1 overflow-hidden rounded-t-xl bg-slate-800">
          <motion.div
            initial={{ width: "100%" }}
            animate={{ width: `${(timeLeft / 25) * 100}%` }}
            transition={{ duration: 1, ease: "linear" }}
            className={`h-full ${config.accent}`}
          />
        </div>

        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-slate-900/60 rounded-lg border border-slate-800">
              {config.icon}
            </div>
            <span className={`font-orbitron text-xs font-bold uppercase tracking-wider ${config.glowText}`}>
              SENTINEL EYES
            </span>
          </div>
          <button
            onClick={clearActiveSuggestion}
            className="p-1 rounded-full text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          {comment && (
            <p className="text-slate-300 text-xs italic font-medium leading-relaxed bg-slate-900/40 p-2.5 rounded-lg border border-slate-800/40">
              "{comment}"
            </p>
          )}

          <div className="space-y-1">
            <h4 className="text-white text-sm font-bold tracking-tight">{title}</h4>
            <p className="text-slate-400 text-xs leading-normal line-clamp-3">{details}</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-4 flex items-center gap-2 justify-end">
          <button
            onClick={clearActiveSuggestion}
            className="px-3 py-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 text-xs font-semibold tracking-wide transition-all"
          >
            Dismiss
          </button>

          <button
            onClick={config.action}
            disabled={success || copied}
            className={`px-3 py-1.5 rounded-lg text-white font-semibold text-xs tracking-wide flex items-center shadow-lg transition-all duration-300 ${
              success || copied
                ? "bg-emerald-600 border border-emerald-500/40 shadow-emerald-950/20"
                : `${config.accent} hover:brightness-110 active:scale-95 shadow-indigo-950/20`
            }`}
          >
            {success ? (
              <>
                <Check className="w-4 h-4 mr-1.5" />
                Done
              </>
            ) : copied ? (
              <>
                <Check className="w-4 h-4 mr-1.5" />
                Copied
              </>
            ) : (
              <>
                {config.buttonIcon}
                {config.buttonText}
              </>
            )}
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
