"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

  // Already-announced completions live in a ref: as state it was a dependency of
  // the polling effect, so every alarm re-subscribed the loop.
  const announced = useRef<Set<string>>(new Set());
  const onTimerCompleteRef = useRef(onTimerComplete);
  useEffect(() => {
    onTimerCompleteRef.current = onTimerComplete;
  }, [onTimerComplete]);

  // Fetch active timers
  const fetchTimers = useCallback(async () => {
    try {
      const response = await fetch("/api/timer", { cache: "no-store" });
      const data = await response.json();
      if (data.success) {
        setTimers(data.timers || []);
      }
    } catch (error) {
      console.error("[TimerPanel] Failed to fetch timers:", error);
    }
  }, []);

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

  // ── Polling for timers ───────────────────────────────────────────────────
  // ONE self-limiting round at a time. The old loop fired every 1s AND depended
  // on [fetchTimers, checkCompleted]; checkCompleted changed identity with the
  // parent's inline onTimerComplete prop, so the effect re-subscribed on every
  // Jarvis re-render and launched a fresh GET+POST pair each time. Measured in
  // the running app: ~6 /api/timer requests per second, 85+ requests in flight
  // and still climbing. Those held every one of the browser's ~6 connections to
  // the origin, so the MediaPipe wasm and the face/hand models — and /api/chat —
  // never got a socket. That is the whole "loading model… forever" bug: fix the
  // loop, not the tracker.
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      // Latency can be longer than the interval; never stack a second round on
      // top of one that is still open.
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await fetchTimers();
        const response = await fetch("/api/timer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check" }),
          cache: "no-store",
        });
        const data = await response.json();
        if (cancelled || !data?.success || !Array.isArray(data.triggered)) return;
        for (const label of data.triggered as string[]) {
          if (announced.current.has(label)) continue;
          announced.current.add(label);
          onTimerCompleteRef.current?.(label);
        }
      } catch (error) {
        console.error("[TimerPanel] Failed to check timers:", error);
      } finally {
        inFlight = false;
      }
    };

    void poll();
    // 2s keeps alarms prompt; the in-flight guard above is what makes the
    // cadence safe, so latency can never grow the queue.
    const interval = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [fetchTimers]);

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
