"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Video, ChevronUp } from "lucide-react";

/**
 * The way back into a running meeting.
 *
 * The bot's session is owned by the server (the MeetingBotService singleton
 * behind /api/meeting), so closing the automation panel only closes a *view* —
 * the bot keeps sitting in the call, transcribing and chatting. Before this
 * pill there was no way back in except reopening the panel and hunting for the
 * Bot tab, so a panel that was merely closed looked like the bot had left.
 *
 * It polls the same status endpoint the panel polls and renders itself ONLY
 * while a session is genuinely active, so it can never become a dead button.
 */

interface MeetingStatusPillProps {
  /** Opens the automation panel on its meeting tab. */
  onOpen: () => void;
  /** True while the automation panel is already on screen showing the bot. */
  hidden?: boolean;
}

interface BotStatus {
  isActive: boolean;
  isRecording: boolean;
  captionsCollected: number;
  platform: string | null;
}

const PLATFORM_LABEL: Record<string, string> = {
  "google-meet": "Google Meet",
  zoom: "Zoom",
};

const POLL_MS = 4000;

export default function MeetingStatusPill({ onOpen, hidden = false }: MeetingStatusPillProps) {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/meeting", { cache: "no-store" });
        const data = await res.json();
        if (cancelledRef.current) return;
        setStatus({
          isActive: Boolean(data.isActive),
          isRecording: Boolean(data.isRecording),
          captionsCollected: Number(data.captionsCollected) || 0,
          platform: typeof data.platform === "string" ? data.platform : null,
        });
      } catch {
        // Server restarting — keep the last known state and retry next tick.
      }
    };

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(timer);
    };
  }, []);

  const inMeeting = Boolean(status?.isActive) && !hidden;
  const platform = status?.platform ? PLATFORM_LABEL[status.platform] ?? status.platform : "a meeting";

  return (
    <AnimatePresence>
      {inMeeting && (
        <motion.div
          key="meeting-status-pill"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
          // Centre-aligned wrapper: the transform stays on this element so the
          // inner button keeps its own layout (no translate-x clash).
          className="fixed top-14 left-0 right-0 z-[70] flex justify-center pointer-events-none"
        >
          <button
            type="button"
            onClick={onOpen}
            title="Open the meeting bot controls"
            className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-emerald-400/40 bg-[#04121f]/90 px-4 py-2 backdrop-blur-xl shadow-[0_0_18px_rgba(16,185,129,0.25)] transition-colors hover:border-emerald-300/70 hover:bg-[#062033]/95"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <Video className="h-4 w-4 text-emerald-400" />
            <span className="font-orbitron text-[11px] font-bold uppercase tracking-wider text-emerald-200">
              In {platform}
            </span>
            <span className="hidden sm:inline text-[11px] text-white/50">
              {status?.captionsCollected ?? 0} captions
              {status?.isRecording ? " · live" : ""}
            </span>
            <span className="flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
              Open
              <ChevronUp className="h-3 w-3" />
            </span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
