"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Globe,
  Map,
  FileText,
  Layers,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Copy,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Search,
  Download,
  Zap,
} from "lucide-react";

type FirecrawlAction = "scrape" | "crawl" | "map" | "extract" | "batch";

interface ScrapeResult {
  success: boolean;
  url: string;
  title: string;
  markdown: string;
  metadata?: Record<string, any>;
  error?: string;
}

interface CrawlResult {
  success: boolean;
  totalPages: number;
  pages: { url: string; title: string; markdown: string }[];
  error?: string;
}

interface MapResult {
  success: boolean;
  urls: string[];
  total: number;
  error?: string;
}

export default function FirecrawlPanel() {
  const [action, setAction] = useState<FirecrawlAction>("scrape");
  const [url, setUrl] = useState("");
  const [batchUrls, setBatchUrls] = useState("");
  const [maxPages, setMaxPages] = useState(10);
  const [searchFilter, setSearchFilter] = useState("");
  const [extractionPrompt, setExtractionPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [extractResult, setExtractResult] = useState<any | null>(null);
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);
  const [mapResult, setMapResult] = useState<MapResult | null>(null);
  const [batchResults, setBatchResults] = useState<ScrapeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [noiseReduction, setNoiseReduction] = useState(true);

  const clearResults = () => {
    setScrapeResult(null);
    setExtractResult(null);
    setCrawlResult(null);
    setMapResult(null);
    setBatchResults(null);
    setError(null);
  };

  const handleExecute = async () => {
    if (!url && action !== "batch") return;
    if (action === "batch" && !batchUrls.trim()) return;

    setLoading(true);
    clearResults();

    try {
      const body: any = { action };

      if (action === "batch") {
        body.urls = batchUrls.split("\n").map((u) => u.trim()).filter(Boolean);
      } else {
        body.url = url.startsWith("http") ? url : `https://${url}`;
      }

      if (action === "scrape" || action === "crawl") {
        body.options = { ...body.options, onlyMainContent: noiseReduction };
      }
      if (action === "extract" && extractionPrompt) {
        body.options = { ...body.options, prompt: extractionPrompt };
      }

      const res = await fetch("/api/firecrawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Operation failed");
        return;
      }

      switch (action) {
        case "scrape":
          setScrapeResult(data);
          break;
        case "extract":
          setExtractResult(data);
          break;
        case "crawl":
          setCrawlResult(data);
          break;
        case "map":
          setMapResult(data);
          break;
        case "batch":
          setBatchResults(data.results || []);
          break;
      }
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const actions: { id: FirecrawlAction; icon: React.ElementType; label: string; desc: string; longDesc: string }[] = [
    { 
      id: "scrape", 
      icon: FileText, 
      label: "Scrape", 
      desc: "URL → Markdown",
      longDesc: "Convert any URL into clean, LLM-ready Markdown. Automatically bypasses anti-bot systems and renders JavaScript content."
    },
    { 
      id: "crawl", 
      icon: Layers, 
      label: "Crawl", 
      desc: "Entire site",
      longDesc: "Recursively scan a whole website to extract content from all sub-pages. Perfect for building research datasets or archiving blogs."
    },
    { 
      id: "map", 
      icon: Map, 
      label: "Map", 
      desc: "Discover URLs",
      longDesc: "Rapidly discover every reachable URL on a domain. Maps out site structure and identifies all available endpoints."
    },
    { 
      id: "extract", 
      icon: Sparkles, 
      label: "Extract", 
      desc: "Structured",
      longDesc: "Use AI to pull specific data points (like prices, reviews, or contact info) into a structured format from any webpage."
    },
    { 
      id: "batch", 
      icon: Download, 
      label: "Batch", 
      desc: "Multi-URL",
      longDesc: "Process multiple URLs simultaneously. Paste a list of links and extract data from all of them in a single operation."
    },
  ];

  const md = scrapeResult?.markdown || '';

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Header */}
      <div className="relative p-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/90 to-blue-600/90 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl">
                <Zap className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white via-cyan-100 to-cyan-200 bg-clip-text text-transparent">
                Firecrawl
              </h3>
              <p className="text-xs text-cyan-300/60 font-medium tracking-wide uppercase">
                Web Intelligence Engine
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 backdrop-blur-md border border-white/10">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span className="text-xs text-cyan-200/70">AI-Powered</span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mt-6 flex gap-1.5 p-1.5 rounded-2xl bg-black/20 backdrop-blur-xl border border-white/10">
          {actions.map((a) => {
            const Icon = a.icon;
            const isActive = action === a.id;
            return (
              <button
                key={a.id}
                onClick={() => { setAction(a.id); clearResults(); }}
                className={`relative flex-1 flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl transition-all duration-300 ${
                  isActive ? "text-white" : "text-white/40 hover:text-white/70 hover:bg-white/5"
                }`}
              >
                {isActive && (
                  <motion.div
                    layoutId="fcTab"
                    className="absolute inset-0 bg-gradient-to-br from-cyan-500/80 to-blue-600/80 rounded-xl border border-white/20 shadow-lg"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10"><Icon className="w-4 h-4" /></span>
                <span className="relative z-10 text-[9px] font-semibold tracking-wider uppercase">{a.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent space-y-4">

          {/* URL Input */}
          {action !== "batch" ? (
            <div className="relative group">
              <Globe className="absolute left-4 top-3.5 w-4 h-4 text-cyan-400/50 group-focus-within:text-cyan-400 transition-colors" />
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  action === "scrape" ? "Enter URL to scrape..." :
                  action === "crawl" ? "Enter website to crawl..." :
                  action === "map" ? "Enter domain to map..." :
                  "Enter URL to extract from..."
                }
                className="w-full pl-12 pr-4 py-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:bg-white/8 focus:outline-none text-sm transition-all"
                onKeyDown={(e) => e.key === "Enter" && handleExecute()}
              />
            </div>
          ) : (
            <textarea
              value={batchUrls}
              onChange={(e) => setBatchUrls(e.target.value)}
              placeholder={"Enter URLs (one per line):\nhttps://example1.com\nhttps://example2.com"}
              className="w-full px-4 py-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-sm transition-all resize-none h-28"
            />
          )}

          {/* Extraction Prompt */}
          {action === "extract" && (
            <div className="relative group">
              <Sparkles className="absolute left-4 top-3.5 w-4 h-4 text-cyan-400/50 group-focus-within:text-cyan-400 transition-colors" />
              <textarea
                value={extractionPrompt}
                onChange={(e) => setExtractionPrompt(e.target.value)}
                placeholder="What data should I extract? (e.g., 'Extract all product names and their prices from the page')"
                className="w-full pl-12 pr-4 py-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:bg-white/8 focus:outline-none text-sm transition-all resize-none h-20"
              />
            </div>
          )}

          {/* Options Row */}
          {(action === "scrape" || action === "crawl") && (
            <div className="flex items-center gap-4">
              {action === "crawl" && (
                <div className="flex-1 flex items-center gap-3 p-3 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs text-white/60">Max pages:</span>
                  <input
                    type="number"
                    value={maxPages}
                    onChange={(e) => setMaxPages(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                    className="w-16 px-2 py-1 bg-black/20 border border-white/10 rounded-lg text-white text-sm focus:border-cyan-500/50 focus:outline-none text-center"
                    min={1} max={50}
                  />
                </div>
              )}
              <button
                onClick={() => setNoiseReduction(!noiseReduction)}
                className={`flex items-center gap-2 px-4 py-3 rounded-2xl border transition-all ${
                  noiseReduction 
                    ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400" 
                    : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                }`}
              >
                <Zap className={`w-3.5 h-3.5 ${noiseReduction ? "fill-cyan-400" : ""}`} />
                <span className="text-xs font-medium">Noise Reduction</span>
              </button>
            </div>
          )}

          {/* Map Search Filter */}
          {action === "map" && (
            <div className="relative group">
              <Search className="absolute left-4 top-2.5 w-4 h-4 text-cyan-400/50" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter URLs by keyword..."
                className="w-full pl-12 pr-4 py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-xs transition-all"
              />
            </div>
          )}

          {/* Execute Button */}
          <button
            onClick={handleExecute}
            disabled={loading || (!url && action !== "batch") || (action === "batch" && !batchUrls.trim())}
            className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl text-white font-semibold flex items-center justify-center gap-2 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-lg shadow-cyan-500/20"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{action === "crawl" ? "Crawling site..." : "Processing..."}</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>
                  {action === "scrape" ? "Scrape URL" :
                   action === "crawl" ? "Crawl Website" :
                   action === "map" ? "Map Domain" :
                   action === "extract" ? "Extract Data" :
                   "Batch Scrape"}
                </span>
              </>
            )}
          </button>

          {/* Mission Briefing (Description) */}
          <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
              <Sparkles className="w-8 h-8 text-cyan-400" />
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Mission Briefing</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed italic">
              {actions.find(a => a.id === action)?.longDesc}
            </p>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 backdrop-blur-md text-red-300 text-sm flex items-center gap-3"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── SCRAPE RESULT ──────────────────────────── */}
          {scrapeResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              {/* Title Card */}
              <div className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
                <div className="flex items-start justify-between mb-3">
                  <div className="min-w-0 flex-1">
                    <h4 className="text-lg font-bold text-white truncate">{scrapeResult.title || "Untitled"}</h4>
                    <a href={scrapeResult.url} target="_blank" rel="noopener noreferrer"
                       className="text-xs text-cyan-400/70 hover:text-cyan-400 flex items-center gap-1 mt-1 truncate">
                      <ExternalLink className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{scrapeResult.url}</span>
                    </a>
                  </div>
                  <button
                    onClick={() => copyToClipboard(md)}
                    className="ml-3 p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all flex-shrink-0"
                    title="Copy markdown"
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-cyan-400" />}
                  </button>
                </div>

                {/* Stats Row */}
                <div className="flex gap-3 mb-4">
                  <div className="px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                    <span className="text-[10px] font-semibold text-cyan-300">{md.length.toLocaleString()} chars</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20">
                    <span className="text-[10px] font-semibold text-blue-300">{md.split("\n").length} lines</span>
                  </div>
                  {scrapeResult.metadata?.statusCode && (
                    <div className="px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
                      <span className="text-[10px] font-semibold text-green-300">HTTP {scrapeResult.metadata.statusCode}</span>
                    </div>
                  )}
                </div>

                {/* Markdown Preview */}
                <div className="p-4 rounded-2xl bg-black/30 border border-white/5 max-h-72 overflow-auto">
                  <pre className="text-xs text-white/70 whitespace-pre-wrap font-mono leading-relaxed">
                    {md.slice(0, 3000)}
                    {md.length > 3000 && (
                      <span className="text-cyan-400/40">
                        {"\n\n"}── {(md.length - 3000).toLocaleString()} more characters ──
                      </span>
                    )}
                  </pre>
                </div>
              </div>
            </motion.div>
          )}

          {/* ─── EXTRACT RESULT ─────────────────────────── */}
          {extractResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500/20 to-blue-500/20 border border-purple-500/20 flex items-center justify-center">
                      <Sparkles className="w-5 h-5 text-purple-400" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-white">Extracted Intelligence</h4>
                      <p className="text-[10px] text-white/40">Structured JSON Output</p>
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(extractResult.data, null, 2))}
                    className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                  >
                    <Copy className="w-4 h-4 text-purple-400" />
                  </button>
                </div>

                <div className="p-4 rounded-2xl bg-black/30 border border-white/5 max-h-96 overflow-auto">
                  <pre className="text-[11px] text-purple-200/80 font-mono leading-relaxed">
                    {JSON.stringify(extractResult.data, null, 2)}
                  </pre>
                </div>

                <div className="mt-4 flex justify-end">
                  <button className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-semibold hover:bg-purple-500/30 transition-all">
                    <Download className="w-3.5 h-3.5" />
                    Save to Intelligence Vault
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* ─── CRAWL RESULT ──────────────────────────── */}
          {crawlResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white">Crawl Complete</span>
                    <p className="text-[10px] text-white/40">{crawlResult.totalPages} pages extracted</p>
                  </div>
                </div>
                <span className="text-2xl font-bold text-cyan-400">{crawlResult.totalPages}</span>
              </div>

              {crawlResult.pages.map((page, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedPage(expandedPage === idx ? null : idx)}
                    className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="min-w-0 text-left">
                        <span className="text-sm text-white font-medium truncate block">{page.title || 'Untitled'}</span>
                        <span className="text-[10px] text-white/30 truncate block">{page.url}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-[10px] text-white/30">{(page.markdown || '').length.toLocaleString()} chars</span>
                      {expandedPage === idx ? <ChevronUp className="w-4 h-4 text-cyan-400" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
                    </div>
                  </button>
                  <AnimatePresence>
                    {expandedPage === idx && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-white/10"
                      >
                        <div className="p-4">
                          <div className="flex justify-end mb-2">
                            <button onClick={() => copyToClipboard(page.markdown || '')} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-all">
                              <Copy className="w-3 h-3 text-cyan-400" />
                            </button>
                          </div>
                          <div className="p-3 rounded-xl bg-black/30 border border-white/5 max-h-52 overflow-auto">
                            <pre className="text-[11px] text-white/60 whitespace-pre-wrap font-mono">
                              {(page.markdown || '').slice(0, 2000)}
                              {(page.markdown || '').length > 2000 && "\n\n── truncated ──"}
                            </pre>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* ─── MAP RESULT ─────────────────────────────── */}
          {mapResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 flex items-center justify-center">
                    <Map className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white">Sitemap Complete</span>
                    <p className="text-[10px] text-white/40">{mapResult.total} URLs discovered</p>
                  </div>
                </div>
                <button onClick={() => copyToClipboard(mapResult.urls.join("\n"))} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all">
                  <Copy className="w-4 h-4 text-cyan-400" />
                </button>
              </div>

              <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 overflow-hidden max-h-72 overflow-auto">
                {mapResult.urls.slice(0, 50).map((mapUrl, idx) => (
                  <a
                    key={idx}
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 text-xs text-white/60 hover:bg-white/5 hover:text-cyan-400 transition-all border-b border-white/5 last:border-b-0"
                  >
                    <ExternalLink className="w-3 h-3 flex-shrink-0 text-cyan-400/40" />
                    <span className="truncate">{mapUrl}</span>
                  </a>
                ))}
              </div>
              {mapResult.total > 50 && (
                <p className="text-[10px] text-white/30 text-center">... and {mapResult.total - 50} more URLs</p>
              )}
            </motion.div>
          )}

          {/* ─── BATCH RESULT ──────────────────────────── */}
          {batchResults && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                <span className="text-sm text-white">
                  <strong>{batchResults.filter(r => r.success).length}</strong> / {batchResults.length} scraped
                </span>
              </div>

              {batchResults.map((result, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedPage(expandedPage === idx ? null : idx)}
                    className="w-full p-4 flex items-center justify-between hover:bg-white/5 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {result.success ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
                      <span className="text-xs text-white truncate">{result.title || result.url}</span>
                    </div>
                    {expandedPage === idx ? <ChevronUp className="w-3 h-3 text-cyan-400" /> : <ChevronDown className="w-3 h-3 text-white/30" />}
                  </button>
                  <AnimatePresence>
                    {expandedPage === idx && result.success && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-white/10 p-4"
                      >
                        <div className="p-3 rounded-xl bg-black/30 border border-white/5 max-h-52 overflow-auto">
                          <pre className="text-[11px] text-white/60 whitespace-pre-wrap font-mono">
                            {(result.markdown || '').slice(0, 2000)}
                          </pre>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Empty State */}
          {!scrapeResult && !crawlResult && !mapResult && !batchResults && !error && !loading && (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/30 to-blue-500/30 rounded-full blur-2xl" />
                <Zap className="w-14 h-14 text-white/15 relative" />
              </div>
              <p className="text-white/40 text-sm mb-2">Enter a URL and select a mode</p>
              <p className="text-white/20 text-xs max-w-xs">
                Firecrawl converts any website into clean, LLM-ready data with anti-bot evasion and JS rendering.
              </p>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-8 gap-4"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-cyan-500/20 rounded-full blur-xl animate-pulse" />
                <Loader2 className="w-10 h-10 text-cyan-400 animate-spin relative" />
              </div>
              <p className="text-sm text-cyan-200/60 font-medium tracking-wide">
                {action === "crawl" ? "Crawling pages..." : action === "map" ? "Mapping domain..." : "Extracting data..."}
              </p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
