"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  Video,
  Link2,
  Loader2,
  Copy,
  Check,
  Type,
  Clock,
  AlignLeft,
} from "lucide-react";

interface SummaryResult {
  type: "youtube" | "article" | "text";
  summary: string;
  originalLength: number;
  summaryLength: number;
  metadata?: Record<string, string>;
}

export default function SummarizerPanel() {
  const [activeTab, setActiveTab] = useState<"youtube" | "article" | "text">("youtube");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSummarize = async () => {
    if (!input) return;
    setLoading(true);
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: activeTab,
          url: activeTab !== "text" ? input : undefined,
          text: activeTab === "text" ? input : undefined,
          maxLength: 200,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data);
      }
    } catch (err) {
      console.error("Failed to summarize:", err);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (result?.summary) {
      navigator.clipboard.writeText(result.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const formatSummary = (text: string) => {
    // Convert bullet points to proper format
    return text.split("\n").map((line, idx) => (
      <div key={idx} className="flex gap-2 mb-2">
        {line.trim().startsWith("-") || line.trim().startsWith("•") ? (
          <>
            <span className="text-cyan-400 mt-1">•</span>
            <span className="text-cyan-100/80">{line.trim().replace(/^[-•]\s*/, "")}</span>
          </>
        ) : (
          <span className="text-cyan-100/80">{line}</span>
        )}
      </div>
    ));
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-cyan-900/20 to-teal-900/20 rounded-2xl border border-cyan-500/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-cyan-500/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center">
            <AlignLeft className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-cyan-400">Content Summarizer</h3>
            <p className="text-xs text-cyan-400/60">TL;DR for Videos & Articles</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Tab Selector */}
        <div className="flex gap-2 p-1 bg-cyan-500/10 rounded-xl">
          {[
            { id: "youtube", icon: Video, label: "YouTube" },
            { id: "article", icon: Link2, label: "Article" },
            { id: "text", icon: Type, label: "Text" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as typeof activeTab);
                setInput("");
                setResult(null);
              }}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-cyan-500 text-white"
                  : "text-cyan-400 hover:bg-cyan-500/10"
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Input Area */}
        <div className="space-y-3">
          <div className="relative">
            {
              activeTab === "youtube" ? (
                <Video className="absolute left-4 top-3.5 w-5 h-5 text-cyan-400/60" />
              ) : activeTab === "article" ? (
                <Link2 className="absolute left-4 top-3.5 w-5 h-5 text-cyan-400/60" />
              ) : (
                <Type className="absolute left-4 top-3.5 w-5 h-5 text-cyan-400/60" />
              )
            }
            {
              activeTab === "text" ? (
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Paste your text here to summarize..."
                  className="w-full h-40 pl-12 pr-4 py-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-white placeholder-cyan-400/40 focus:border-cyan-400 focus:outline-none resize-none"
                />
              ) : (
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    activeTab === "youtube"
                      ? "Paste YouTube video URL..."
                      : "Paste article URL..."
                  }
                  className="w-full pl-12 pr-4 py-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl text-white placeholder-cyan-400/40 focus:border-cyan-400 focus:outline-none"
                />
              )
            }
          </div>

          <button
            onClick={handleSummarize}
            disabled={loading || !input}
            className="w-full py-3 bg-gradient-to-r from-cyan-500 to-teal-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-cyan-400 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <FileText className="w-5 h-5" />
                Summarize
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-cyan-500/5 rounded-xl p-4 border border-cyan-500/20 space-y-4"
          >
            {/* Stats */}
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-1 text-cyan-400/60">
                <AlignLeft className="w-3 h-3" />
                <span>Original: {result.originalLength.toLocaleString()} chars</span>
              </div>
              <div className="flex items-center gap-1 text-cyan-400/60">
                <Clock className="w-3 h-3" />
                <span>Summary: {result.summaryLength.toLocaleString()} chars</span>
              </div>
              <div className="ml-auto text-cyan-400 font-medium">
                {Math.round(
                  (1 - result.summaryLength / result.originalLength) * 100
                )}
                % reduction
              </div>
            </div>

            {/* Summary Text */}
            <div className="prose prose-invert max-w-none">
              {formatSummary(result.summary)}
            </div>

            {/* Metadata */}
            {result.metadata?.title && (
              <div className="text-xs text-cyan-400/60 border-t border-cyan-500/20 pt-3">
                <p>Source: {result.metadata.title}</p>
                {result.metadata.author && <p>Author: {result.metadata.author}</p>}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={copyToClipboard}
                className="flex-1 py-2 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Copy
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Tips */}
        {!result && (
          <div className="bg-cyan-500/5 rounded-xl p-4 border border-cyan-500/20">
            <h4 className="text-sm font-medium text-cyan-400 mb-3">
              Supported Content
            </h4>
            <ul className="space-y-2 text-xs text-cyan-100/60">
              <li>• YouTube videos with captions/transcripts</li>
              <li>• News articles and blog posts</li>
              <li>• Long text documents</li>
              <li>• Research papers and reports</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
