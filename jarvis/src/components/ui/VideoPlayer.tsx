"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play } from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

export default function VideoPlayer() {
  const { currentVideo, clearCurrentVideo } = useJarvisStore();
  const [hasActivated, setHasActivated] = useState(false);

  if (!currentVideo) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="fixed bottom-4 right-4 z-50 bg-slate-900/95 border border-cyan-500/30
                   rounded-lg overflow-hidden shadow-2xl shadow-cyan-500/20"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-cyan-500/20">
          <div className="flex-1 min-w-0 mr-2">
            <p className="text-xs text-cyan-400 font-medium truncate">
              {currentVideo.title}
            </p>
            <p className="text-[10px] text-cyan-400/60 truncate">
              {currentVideo.channel}
            </p>
          </div>
          <button
            onClick={clearCurrentVideo}
            className="p-1 hover:bg-red-500/20 rounded transition-colors group"
            title="Close video"
          >
            <X className="w-4 h-4 text-cyan-400 group-hover:text-red-400" />
          </button>
        </div>

        {/* Video iframe */}
        <div className="relative">
          {!hasActivated && (
            <div
              onClick={() => setHasActivated(true)}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/80 backdrop-blur-sm cursor-pointer group transition-all hover:bg-slate-900/60"
            >
              <div className="p-4 rounded-full bg-cyan-500/20 group-hover:scale-110 transition-transform">
                <Play className="w-12 h-12 text-cyan-400 fill-cyan-400" />
              </div>
              <p className="mt-4 text-sm font-medium text-cyan-400 animate-pulse">Click to Play Music</p>
            </div>
          )}
          <iframe
            width="400"
            height="225"
            src={hasActivated ? `${currentVideo.embedUrl}?autoplay=1&enablejsapi=1` : ""}
            title={currentVideo.title}
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="bg-black"
          />
        </div>

        {/* Glow effect */}
        <div className="absolute inset-0 pointer-events-none rounded-lg ring-1 ring-cyan-500/20" />
      </motion.div>
    </AnimatePresence>
  );
}
