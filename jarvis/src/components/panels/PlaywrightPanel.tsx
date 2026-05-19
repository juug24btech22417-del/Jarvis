"use client";

import { motion } from "framer-motion";
import { X, Camera, MousePointer2, FileText } from "lucide-react";
import { useJarvisStore } from "@/store/jarvis.store";

interface PlaywrightPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PlaywrightPanel({ isOpen, onClose }: PlaywrightPanelProps) {
  const { playwrightLogs, currentScreenshot } = useJarvisStore();

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100 }}
      className="fixed top-4 right-4 z-50 w-96 h-[600px] bg-slate-900/95 border border-cyan-500/30
                 rounded-xl overflow-hidden shadow-2xl shadow-cyan-500/20 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 border-b border-cyan-500/20">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-medium text-cyan-400">Playwright Browser</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-red-500/20 rounded transition-colors">
          <X className="w-4 h-4 text-cyan-400" />
        </button>
      </div>

      {/* Screenshot View */}
      <div className="flex-1 bg-black overflow-hidden relative group">
        {currentScreenshot ? (
          <img
            src={currentScreenshot}
            alt="Browser View"
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-cyan-400/40 p-8 text-center">
            <MousePointer2 className="w-12 h-12 mb-4 animate-pulse" />
            <p className="text-sm font-medium">No active browser session</p>
            <p className="text-xs mt-2">JARVIS will render screenshots here</p>
          </div>
        )}
        <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-cyan-500/10" />
      </div>

      {/* Logs/Output Area */}
      <div className="h-48 bg-slate-950/80 border-t border-cyan-500/20 p-4 overflow-y-auto font-mono text-xs">
        <div className="flex items-center gap-2 mb-3 text-cyan-400/60">
          <FileText className="w-3 h-3" />
          <span>Activity Log</span>
        </div>
        <div className="space-y-2">
          {playwrightLogs && playwrightLogs.length > 0 ? (
            playwrightLogs.map((log, i) => (
              <div key={i} className="text-cyan-100/80 border-l-2 border-cyan-500/30 pl-2">
                <span className="text-cyan-500/50 mr-2">[{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>
                {log}
              </div>
            ))
          ) : (
            <p className="text-slate-600 italic">Waiting for browser actions...</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}
