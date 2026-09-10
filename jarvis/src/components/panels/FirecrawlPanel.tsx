"use client";

import React, { useState, useEffect, useCallback } from "react";
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
  Coins,
  RefreshCw,
  Eye,
  Code2,
} from "lucide-react";
import Markdown from "./Markdown";

// ─── Types ───────────────────────────────────────────────────────────

type FirecrawlAction = "scrape" | "crawl" | "map" | "search" | "extract" | "batch";

interface ScrapeResult {
  success: boolean;
  url: string;
  title: string;
  markdown: string;
  metadata?: Record<string, any>;
  error?: string;
  source?: "cache" | "api";
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

interface SearchItem {
  url: string;
  title: string;
  description: string;
  markdown?: string;
}

interface SearchResult {
  success: boolean;
  results: SearchItem[];
  total: number;
  error?: string;
}

interface ExtractResult {
  success: boolean;
  data: { extracted?: unknown; _meta?: Record<string, unknown> } & Record<string, unknown>;
  error?: string;
}

interface BatchResult {
  success: boolean;
  total: number;
  succeeded: number;
  results: ScrapeResult[];
}

interface Credits {
  remainingCredits?: number | null;
  planCredits?: number | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Colorized JSON view — classic token regex, all React nodes (XSS-safe). */
function ColorizedJson({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? "undefined";
  const re = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={k++} className="text-white/60">{text.slice(last, m.index)}</span>);
    const tok = m[0];
    let cls = "text-amber-300"; // numbers
    if (tok.startsWith('"')) cls = tok.trimEnd().endsWith(":") ? "text-cyan-300" : "text-emerald-300";
    else if (tok === "true" || tok === "false") cls = "text-purple-300";
    else if (tok === "null") cls = "text-white/30";
    out.push(<span key={k++} className={cls}>{tok}</span>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(<span key={k++} className="text-white/60">{text.slice(last)}</span>);
  return <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words">{out}</pre>;
}

// ─── Component ───────────────────────────────────────────────────────

export default function FirecrawlPanel() {
  const [action, setAction] = useState<FirecrawlAction>("scrape");
  const [url, setUrl] = useState("");
  const [batchUrls, setBatchUrls] = useState("");
  const [maxPages, setMaxPages] = useState(10);
  const [maxDepth, setMaxDepth] = useState(2);
  const [searchLimit, setSearchLimit] = useState(5);
  const [scrapeSearchResults, setScrapeSearchResults] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [extractionPrompt, setExtractionPrompt] = useState("");
  const [schemaText, setSchemaText] = useState("");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [extractResult, setExtractResult] = useState<ExtractResult | null>(null);
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);
  const [mapResult, setMapResult] = useState<MapResult | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedPage, setExpandedPage] = useState<number | null>(null);
  const [expandedSearch, setExpandedSearch] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [noiseReduction, setNoiseReduction] = useState(true);
  const [refreshCache, setRefreshCache] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [credits, setCredits] = useState<Credits | null>(null);

  const clearResults = () => {
    setScrapeResult(null);
    setExtractResult(null);
    setCrawlResult(null);
    setMapResult(null);
    setSearchResult(null);
    setBatchResult(null);
    setError(null);
    setExpandedPage(null);
    setExpandedSearch(null);
    setShowRaw(false);
  };

  const fetchCredits = useCallback(async () => {
    try {
      const res = await fetch("/api/firecrawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "credits" }),
      });
      const data = await res.json();
      if (data.success) {
        setCredits({ remainingCredits: data.remainingCredits, planCredits: data.planCredits });
      }
    } catch {
      // badge is cosmetic; failures are silent
    }
  }, []);

  useEffect(() => {
    fetchCredits();
  }, [fetchCredits]);

  const handleExecute = async () => {
    if (action !== "batch" && !url.trim()) return;
    if (action === "batch" && !batchUrls.trim()) return;

    // Validate JSON schema before spending credits on extract.
    let schema: Record<string, unknown> | null = null;
    if (action === "extract" && schemaText.trim()) {
      try {
        schema = JSON.parse(schemaText);
        setSchemaError(null);
      } catch (e) {
        setSchemaError(`Schema is not valid JSON: ${(e as Error).message}`);
        return;
      }
    }
    if (action === "extract" && !schema && !extractionPrompt.trim()) {
      setSchemaError("Write a prompt or a JSON schema describing what to extract.");
      return;
    }

    setLoading(true);
    clearResults();

    try {
      const body: Record<string, unknown> = { action, options: {} };
      const opts = body.options as Record<string, unknown>;

      if (action === "batch") {
        body.urls = batchUrls.split("\n").map((u) => u.trim()).filter(Boolean);
      } else if (action === "search") {
        opts.query = url.trim();
        opts.limit = searchLimit;
        opts.scrapeResults = scrapeSearchResults;
      } else {
        body.url = url.startsWith("http") ? url : `https://${url}`;
      }

      if (action === "scrape") {
        opts.onlyMainContent = noiseReduction;
        opts.refreshCache = refreshCache;
      }
      if (action === "crawl") {
        opts.maxPages = maxPages;
        opts.maxDepth = maxDepth;
        opts.onlyMainContent = noiseReduction;
      }
      if (action === "map") {
        opts.search = searchFilter || undefined;
      }
      if (action === "extract") {
        opts.prompt = extractionPrompt || undefined;
        if (schema) opts.schema = schema;
      }

      const res = await fetch("/api/firecrawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error || `Request failed (${res.status})`);
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
        case "search":
          setSearchResult(data);
          break;
        case "batch":
          setBatchResult(data);
          break;
      }
      fetchCredits(); // each run burns credits — keep the badge honest
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const actions: { id: FirecrawlAction; icon: React.ElementType; label: string; desc: string; longDesc: string }[] = [
    { id: "scrape", icon: FileText, label: "Scrape", desc: "URL → Markdown", longDesc: "Convert any URL into clean, LLM-ready Markdown. Bypasses anti-bot systems and renders JavaScript content." },
    { id: "crawl", icon: Layers, label: "Crawl", desc: "Entire site", longDesc: "Recursively scan a website to extract content from sub-pages. Depth and page count are respected this time." },
    { id: "map", icon: Map, label: "Map", desc: "Discover URLs", longDesc: "Rapidly discover reachable URLs on a domain. Filter with a keyword to narrow the sitemap." },
    { id: "search", icon: Search, label: "Search", desc: "Web search", longDesc: "Search the web and optionally scrape every result — research-grade data in one call." },
    { id: "extract", icon: Sparkles, label: "Extract", desc: "Structured", longDesc: "Server-side AI extraction: describe the data in plain language or JSON schema, get clean structured output." },
    { id: "batch", icon: Download, label: "Batch", desc: "Multi-URL", longDesc: "Queue many URLs into Firecrawl's native batch job and collect every page in one pass." },
  ];

  const creditsTone =
    credits?.remainingCredits == null
      ? "text-white/50 border-white/10 bg-white/5"
      : credits.remainingCredits > 50
        ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
        : credits.remainingCredits > 10
          ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
          : "text-red-300 border-red-500/30 bg-red-500/10";

  const md = scrapeResult?.markdown || "";

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-indigo-500/10 via-purple-500/5 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1s" }} />
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

          {/* Credits badge — live balance, color-coded */}
          <button
            onClick={fetchCredits}
            title={credits ? `Plan: ${credits.planCredits ?? "?"} credits — click to refresh` : "Click to refresh"}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full backdrop-blur-md border transition-all hover:brightness-125 ${creditsTone}`}
          >
            <Coins className="w-3 h-3" />
            <span className="text-xs font-semibold font-mono">
              {credits?.remainingCredits != null ? `${credits.remainingCredits} credits` : "credits —"}
            </span>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="mt-6 grid grid-cols-6 gap-1.5 p-1.5 rounded-2xl bg-black/20 backdrop-blur-xl border border-white/10">
          {actions.map((a) => {
            const Icon = a.icon;
            const isActive = action === a.id;
            return (
              <button
                key={a.id}
                onClick={() => { setAction(a.id); clearResults(); }}
                className={`relative flex flex-col items-center gap-1 px-1 py-2.5 rounded-xl transition-all duration-300 ${
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

          {/* URL / Query Input */}
          {action !== "batch" ? (
            <div className="relative group">
              {action === "search" ? (
                <Search className="absolute left-4 top-3.5 w-4 h-4 text-cyan-400/50 group-focus-within:text-cyan-400 transition-colors" />
              ) : (
                <Globe className="absolute left-4 top-3.5 w-4 h-4 text-cyan-400/50 group-focus-within:text-cyan-400 transition-colors" />
              )}
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  action === "scrape" ? "Enter URL to scrape..." :
                  action === "crawl" ? "Enter website to crawl..." :
                  action === "map" ? "Enter domain to map..." :
                  action === "search" ? "What do you want to find on the web?" :
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

          {/* Extract: prompt + schema */}
          {action === "extract" && (
            <div className="space-y-2.5">
              <div className="relative group">
                <Sparkles className="absolute left-4 top-3.5 w-4 h-4 text-cyan-400/50 group-focus-within:text-cyan-400 transition-colors" />
                <textarea
                  value={extractionPrompt}
                  onChange={(e) => setExtractionPrompt(e.target.value)}
                  placeholder="What data should I extract? e.g. 'Extract the product name, current price and rating'"
                  className="w-full pl-12 pr-4 py-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:bg-white/8 focus:outline-none text-sm transition-all resize-none h-20"
                />
              </div>
              <textarea
                value={schemaText}
                onChange={(e) => { setSchemaText(e.target.value); setSchemaError(null); }}
                placeholder={'Optional JSON schema — e.g. {"name": "string", "price": "number"}'}
                className="w-full px-4 py-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl text-cyan-100/90 placeholder-white/25 focus:border-cyan-500/50 focus:outline-none text-xs font-mono transition-all resize-none h-16"
              />
              {schemaError && (
                <p className="text-[11px] text-amber-300/90 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" /> {schemaError}
                </p>
              )}
            </div>
          )}

          {/* Options Row */}
          {(action === "scrape" || action === "crawl" || action === "search") && (
            <div className="flex items-center gap-3 flex-wrap">
              {action === "crawl" && (
                <>
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs text-white/60">Pages:</span>
                    <input
                      type="number"
                      value={maxPages}
                      onChange={(e) => setMaxPages(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
                      className="w-14 px-2 py-1 bg-black/20 border border-white/10 rounded-lg text-white text-sm focus:border-cyan-500/50 focus:outline-none text-center"
                      min={1} max={50}
                    />
                  </div>
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
                    <Globe className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs text-white/60">Depth:</span>
                    <input
                      type="number"
                      value={maxDepth}
                      onChange={(e) => setMaxDepth(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
                      className="w-12 px-2 py-1 bg-black/20 border border-white/10 rounded-lg text-white text-sm focus:border-cyan-500/50 focus:outline-none text-center"
                      min={1} max={5}
                    />
                  </div>
                </>
              )}
              {action === "search" && (
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10">
                  <Search className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs text-white/60">Results:</span>
                  <input
                    type="number"
                    value={searchLimit}
                    onChange={(e) => setSearchLimit(Math.max(1, Math.min(10, parseInt(e.target.value) || 5)))}
                    className="w-12 px-2 py-1 bg-black/20 border border-white/10 rounded-lg text-white text-sm focus:border-cyan-500/50 focus:outline-none text-center"
                    min={1} max={10}
                  />
                </div>
              )}
              <ToggleChip
                active={noiseReduction}
                onClick={() => setNoiseReduction(!noiseReduction)}
                icon={<Zap className={`w-3.5 h-3.5 ${noiseReduction ? "fill-cyan-400" : ""}`} />}
                label="Noise Reduction"
              />
              {action === "scrape" && (
                <ToggleChip
                  active={refreshCache}
                  onClick={() => setRefreshCache(!refreshCache)}
                  icon={<RefreshCw className="w-3.5 h-3.5" />}
                  label="Bypass Cache"
                />
              )}
              {action === "search" && (
                <ToggleChip
                  active={scrapeSearchResults}
                  onClick={() => setScrapeSearchResults(!scrapeSearchResults)}
                  icon={<FileText className="w-3.5 h-3.5" />}
                  label="Scrape Results"
                />
              )}
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
                placeholder="Filter URLs by keyword (sent to the API — server-side filtering)..."
                className="w-full pl-12 pr-4 py-2.5 bg-white/5 backdrop-blur-md border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-cyan-500/50 focus:outline-none text-xs transition-all"
              />
            </div>
          )}

          {/* Execute Button */}
          <button
            onClick={handleExecute}
            disabled={loading || (action !== "batch" && !url.trim()) || (action === "batch" && !batchUrls.trim())}
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
                   action === "search" ? "Search Web" :
                   action === "extract" ? "Extract Data" :
                   "Batch Scrape"}
                </span>
              </>
            )}
          </button>

          {/* Mission Briefing */}
          <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-2 opacity-10 group-hover:opacity-20 transition-opacity">
              <Sparkles className="w-8 h-8 text-cyan-400" />
            </div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Mission Briefing</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed italic">
              {actions.find((a) => a.id === action)?.longDesc}
            </p>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 backdrop-blur-md text-red-300 text-sm flex items-start gap-3"
              >
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">{error}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── SCRAPE RESULT ──────────────────────────── */}
          {scrapeResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
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
                  <div className="ml-3 flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setShowRaw(!showRaw)}
                      title={showRaw ? "Show rendered" : "Show raw markdown"}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                    >
                      {showRaw ? <Eye className="w-4 h-4 text-cyan-400" /> : <Code2 className="w-4 h-4 text-cyan-400" />}
                    </button>
                    <button
                      onClick={() => copyToClipboard(md)}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                      title="Copy markdown"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-cyan-400" />}
                    </button>
                    <button
                      onClick={() => downloadText(`${(scrapeResult.title || "scrape").replace(/[^\w-]+/g, "_").slice(0, 40)}.md`, md, "text/markdown")}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                      title="Download .md"
                    >
                      <Download className="w-4 h-4 text-cyan-400" />
                    </button>
                  </div>
                </div>

                {/* Stats Row */}
                <div className="flex gap-2 flex-wrap mb-4">
                  <StatChip color="cyan" label={`${md.length.toLocaleString()} chars`} />
                  <StatChip color="blue" label={`${md.split("\n").length} lines`} />
                  {scrapeResult.source && (
                    <StatChip color="purple" label={scrapeResult.source === "cache" ? "from cache" : "fresh"} />
                  )}
                  {scrapeResult.metadata?.statusCode && (
                    <StatChip color="green" label={`HTTP ${scrapeResult.metadata.statusCode}`} />
                  )}
                </div>

                {/* Content — rendered markdown or raw */}
                <div className="p-4 rounded-2xl bg-black/30 border border-white/5 max-h-[28rem] overflow-auto">
                  {showRaw ? (
                    <pre className="text-xs text-white/70 whitespace-pre-wrap font-mono leading-relaxed">{md}</pre>
                  ) : (
                    <Markdown content={md} />
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* ─── SEARCH RESULT ──────────────────────────── */}
          {searchResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 flex items-center justify-center">
                    <Search className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <span className="text-sm font-bold text-white">Search Complete</span>
                    <p className="text-[10px] text-white/40">{searchResult.total} results found</p>
                  </div>
                </div>
                <button
                  onClick={() => copyToClipboard(searchResult.results.map((r) => `${r.title}\n${r.url}\n${r.description}`).join("\n\n"))}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                  title="Copy all results"
                >
                  <Copy className="w-4 h-4 text-cyan-400" />
                </button>
              </div>

              {searchResult.results.map((r, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedSearch(expandedSearch === idx ? null : idx)}
                    className="w-full p-4 flex items-start gap-3 hover:bg-white/5 transition-all text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-[10px] font-mono text-cyan-300 flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-white font-medium truncate block hover:text-cyan-300">{r.title}</span>
                      <a href={r.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                         className="text-[10px] text-cyan-500/70 hover:text-cyan-400 truncate block mt-0.5">
                        {r.url}
                      </a>
                      <p className="text-xs text-white/50 line-clamp-2 mt-1.5 leading-relaxed">{r.description}</p>
                    </div>
                    {r.markdown && (
                      <span className="flex-shrink-0 mt-1">
                        {expandedSearch === idx ? <ChevronUp className="w-4 h-4 text-cyan-400" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
                      </span>
                    )}
                  </button>
                  <AnimatePresence>
                    {expandedSearch === idx && r.markdown && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-white/10"
                      >
                        <div className="p-4 max-h-72 overflow-auto">
                          <Markdown content={r.markdown.slice(0, 8000)} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
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
                      <p className="text-[10px] text-white/40">Structured JSON — server-side AI extraction</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyToClipboard(JSON.stringify(extractResult.data?.extracted ?? extractResult.data, null, 2))}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                      title="Copy JSON"
                    >
                      {copied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4 text-purple-400" />}
                    </button>
                    <button
                      onClick={() => downloadText("extracted.json", JSON.stringify(extractResult.data?.extracted ?? extractResult.data, null, 2), "application/json")}
                      className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                      title="Download JSON"
                    >
                      <Download className="w-4 h-4 text-purple-400" />
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-black/30 border border-white/5 max-h-96 overflow-auto">
                  <ColorizedJson value={extractResult.data?.extracted ?? extractResult.data} />
                </div>

                {extractResult.data?._meta && (
                  <p className="mt-3 text-[10px] text-white/30 truncate">
                    {typeof extractResult.data._meta === "object" && (extractResult.data._meta as any).title
                      ? `Source: ${(extractResult.data._meta as any).title}`
                      : ""}
                  </p>
                )}
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
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadText(
                      "crawl_export.md",
                      crawlResult.pages.map((p) => `# ${p.title}\n${p.url}\n\n${p.markdown}`).join("\n\n---\n\n"),
                      "text/markdown"
                    )}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                    title="Download all pages as .md"
                  >
                    <Download className="w-4 h-4 text-cyan-400" />
                  </button>
                  <span className="text-2xl font-bold text-cyan-400">{crawlResult.totalPages}</span>
                </div>
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
                        <span className="text-sm text-white font-medium truncate block">{page.title || "Untitled"}</span>
                        <span className="text-[10px] text-white/30 truncate block">{page.url}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-[10px] text-white/30">{(page.markdown || "").length.toLocaleString()} chars</span>
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
                          <div className="flex justify-end gap-2 mb-2">
                            <a href={page.url} target="_blank" rel="noopener noreferrer"
                               className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-all" title="Open page">
                              <ExternalLink className="w-3 h-3 text-cyan-400" />
                            </a>
                            <button onClick={() => copyToClipboard(page.markdown || "")} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-all" title="Copy markdown">
                              <Copy className="w-3 h-3 text-cyan-400" />
                            </button>
                          </div>
                          <div className="p-3 rounded-xl bg-black/30 border border-white/5 max-h-72 overflow-auto">
                            <Markdown content={page.markdown || ""} />
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
                    <p className="text-[10px] text-white/40">{mapResult.total} URLs discovered{searchFilter ? ` · filtered by "${searchFilter}"` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadText("sitemap.txt", mapResult.urls.join("\n"), "text/plain")}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                    title="Download URL list"
                  >
                    <Download className="w-4 h-4 text-cyan-400" />
                  </button>
                  <button onClick={() => copyToClipboard(mapResult.urls.join("\n"))} className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all">
                    <Copy className="w-4 h-4 text-cyan-400" />
                  </button>
                </div>
              </div>

              <div className="rounded-2xl bg-white/5 backdrop-blur-md border border-white/10 overflow-hidden max-h-72 overflow-auto">
                {mapResult.urls.slice(0, 100).map((mapUrl, idx) => (
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
              {mapResult.total > 100 && (
                <p className="text-[10px] text-white/30 text-center">... and {mapResult.total - 100} more URLs (use Download for the full list)</p>
              )}
            </motion.div>
          )}

          {/* ─── BATCH RESULT ──────────────────────────── */}
          {batchResult && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
              <div className="p-4 rounded-2xl bg-white/5 backdrop-blur-xl border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {batchResult.succeeded > 0 ? (
                    <CheckCircle2 className="w-5 h-5 text-cyan-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-red-400" />
                  )}
                  <span className="text-sm text-white">
                    <strong className="text-cyan-300">{batchResult.succeeded}</strong> / {batchResult.total} scraped
                  </span>
                </div>
                <button
                  onClick={() => downloadText(
                    "batch_export.md",
                    batchResult.results.filter((r) => r.success).map((r) => `# ${r.title}\n${r.url}\n\n${r.markdown}`).join("\n\n---\n\n"),
                    "text/markdown"
                  )}
                  className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                  title="Download all pages as .md"
                >
                  <Download className="w-4 h-4 text-cyan-400" />
                </button>
              </div>

              {batchResult.results.map((result, idx) => (
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
                      <div className="min-w-0 text-left">
                        <span className="text-xs text-white truncate block">{result.title || result.url}</span>
                        {result.error && <span className="text-[10px] text-red-300/70 truncate block">{result.error}</span>}
                      </div>
                    </div>
                    {expandedPage === idx ? <ChevronUp className="w-3 h-3 text-cyan-400" /> : <ChevronDown className="w-3 h-3 text-white/30" />}
                  </button>
                  <AnimatePresence>
                    {expandedPage === idx && result.success && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-white/10 p-4 max-h-72 overflow-auto"
                      >
                        <Markdown content={result.markdown || ""} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Empty State */}
          {!scrapeResult && !crawlResult && !mapResult && !searchResult && !extractResult && !batchResult && !error && !loading && (
            <div className="flex flex-col items-center justify-center text-center py-8">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/30 to-blue-500/30 rounded-full blur-2xl" />
                <Zap className="w-14 h-14 text-white/15 relative" />
              </div>
              <p className="text-white/40 text-sm mb-2">
                {action === "search" ? "Ask anything — the web is the database" : "Enter a URL and select a mode"}
              </p>
              <p className="text-white/20 text-xs max-w-xs">
                Firecrawl converts any website into clean, structured, LLM-ready data with anti-bot evasion and JS rendering.
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
                {action === "crawl" ? "Crawling pages..." :
                 action === "map" ? "Mapping domain..." :
                 action === "search" ? "Searching the web..." :
                 action === "extract" ? "Extracting structured data..." :
                 action === "batch" ? "Batch scraping..." :
                 "Scraping page..."}
              </p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Small UI atoms ──────────────────────────────────────────────────

function ToggleChip({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl border transition-all ${
        active
          ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
          : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
      }`}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

function StatChip({ color, label }: { color: "cyan" | "blue" | "green" | "purple"; label: string }) {
  const tones = {
    cyan: "bg-cyan-500/10 border-cyan-500/20 text-cyan-300",
    blue: "bg-blue-500/10 border-blue-500/20 text-blue-300",
    green: "bg-green-500/10 border-green-500/20 text-green-300",
    purple: "bg-purple-500/10 border-purple-500/20 text-purple-300",
  };
  return (
    <div className={`px-3 py-1.5 rounded-full border ${tones[color]}`}>
      <span className="text-[10px] font-semibold">{label}</span>
    </div>
  );
}
