"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, FileSearch, Loader2, CheckCircle2, AlertCircle, Globe } from "lucide-react";

export default function ResearchPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [query, setQuery] = useState("");

  const handleResearch = async () => {
    if (!query) return;
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: data.message });
        setQuery("");
      } else {
        setResult({ success: false, message: data.error || "Research failed to start" });
      }
    } catch (err) {
      setResult({ success: false, message: "Network error occurred" });
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
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-violet-500/20 border border-violet-500/30">
          <Globe className="w-5 h-5 text-violet-400" />
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-white/80">Deep Research Agent</span>
          <span className="text-[10px] text-white/40 uppercase tracking-wider">Autonomous Intelligence</span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="What should JARVIS research for you? (e.g. 'The future of AI agents in 2026')"
            className="w-full pl-10 pr-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-violet-500/50 focus:outline-none text-sm transition-all resize-none h-24"
          />
        </div>

        <button
          onClick={handleResearch}
          disabled={loading || !query}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white font-semibold flex items-center justify-center gap-2 hover:from-violet-400 hover:to-fuchsia-500 disabled:opacity-50 transition-all shadow-lg shadow-violet-500/25"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><FileSearch className="w-4 h-4" /> Launch Deep Research</>}
        </button>
      </div>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`p-3 rounded-xl flex items-center gap-3 text-sm ${
              result.success ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400" : "bg-red-500/10 border border-red-500/30 text-red-400"
            }`}
          >
            {result.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {result.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
        <p className="text-[10px] text-white/40 leading-relaxed">
          JARVIS will autonomously search the web, extract atomic facts, synthesize a report, and save it directly to your Notion. This process takes a few minutes.
        </p>
      </div>
    </motion.div>
  );
}
