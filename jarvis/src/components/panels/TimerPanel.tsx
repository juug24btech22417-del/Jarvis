"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Timer, Bell, X, Clock } from "lucide-react";

interface TimerData {
  id: string;
  endTime: number;
  label: string;
  isAlarm: boolean;
  remaining: number;
  remainingSeconds?: number;
}

interface TimerPanelProps {
  onTimerComplete?: (label: string) => void;
}

export default function TimerPanel({ onTimerComplete }: TimerPanelProps) {
  const [timers, setTimers] = useState<TimerData[]>([]);
  const [completedTimers, setCompletedTimers] = useState<string[]>([]);

  // Fetch active timers
  const fetchTimers = useCallback(async () => {
    try {
      const response = await fetch("/api/timer");
      const data = await response.json();
      if (data.success) {
        setTimers(data.timers || []);
      }
    } catch (error) {
      console.error("[TimerPanel] Failed to fetch timers:", error);
    }
  }, []);

  // Check for completed timers
  const checkCompleted = useCallback(async () => {
    try {
      const response = await fetch("/api/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check" }),
      });
      const data = await response.json();
      if (data.success && data.triggered && data.triggered.length > 0) {
        // Notify for each completed timer
        data.triggered.forEach((label: string) => {
          if (!completedTimers.includes(label)) {
            setCompletedTimers(prev => [...prev, label]);
            onTimerComplete?.(label);
          }
        });
      }
    } catch (error) {
      console.error("[TimerPanel] Failed to check timers:", error);
    }
  }, [completedTimers, onTimerComplete]);

  // Cancel a timer
  const cancelTimer = async (timerId: string) => {
    try {
      await fetch("/api/timer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", timerId }),
      });
      fetchTimers();
    } catch (error) {
      console.error("[TimerPanel] Failed to cancel timer:", error);
    }
  };

  // Format remaining time
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  // Polling for timers
  useEffect(() => {
    fetchTimers();
    const interval = setInterval(() => {
      fetchTimers();
      checkCompleted();
    }, 1000);
    return () => clearInterval(interval);
  }, [fetchTimers, checkCompleted]);

  if (timers.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-24 right-6 z-40 w-72"
    >
      <div className="holographic-panel p-4">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-5 h-5 text-reactor-core" />
          <span className="font-orbitron text-reactor-core font-bold">ACTIVE TIMERS</span>
        </div>

        <div className="space-y-2 max-h-48 overflow-y-auto">
          <AnimatePresence>
            {timers.map((timer) => (
              <motion.div
                key={timer.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="flex items-center justify-between bg-panel-glass/50 p-2 rounded border border-panel-border"
              >
                <div className="flex items-center gap-2">
                  {timer.isAlarm ? (
                    <Bell className="w-4 h-4 text-accent-yellow" />
                  ) : (
                    <Timer className="w-4 h-4 text-reactor-core" />
                  )}
                  <div className="flex flex-col">
                    <span className="text-sm text-text-primary truncate max-w-[120px]">
                      {timer.label}
                    </span>
                    <span className="text-xs text-reactor-core font-mono">
                      {formatTime(timer.remainingSeconds || Math.ceil((timer.endTime - Date.now()) / 1000))}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => cancelTimer(timer.id)}
                  className="p-1 hover:bg-accent-red/20 rounded transition-colors"
                  title="Cancel timer"
                >
                  <X className="w-4 h-4 text-accent-red" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
