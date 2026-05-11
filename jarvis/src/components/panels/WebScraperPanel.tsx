"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Globe,
  Search,
  Plane,
  ShoppingCart,
  Newspaper,
  Loader2,
  ExternalLink,
  DollarSign,
  Check,
  X,
  AlertCircle,
} from "lucide-react";

interface ScrapedData {
  title: string;
  description: string;
  price?: string;
  availability?: string;
  image?: string;
  links: { text: string; href: string }[];
  tables: any[];
}

export default function WebScraperPanel() {
  const [url, setUrl] = useState("");
  const [type, setType] = useState<"flight" | "product" | "news" | "general">(
    "general"
  );
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScrapedData | null>(null);

  const handleScrape = async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, type }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.data);
      }
    } catch (err) {
      console.error("Scraping failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case "flight":
        return <Plane className="w-4 h-4" />;
      case "product":
        return <ShoppingCart className="w-4 h-4" />;
      case "news":
        return <Newspaper className="w-4 h-4" />;
      default:
        return <Globe className="w-4 h-4" />;
    }
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-emerald-900/20 to-teal-900/20 rounded-2xl border border-emerald-500/30 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-emerald-500/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Globe className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-emerald-400">Web Scraper</h3>
            <p className="text-xs text-emerald-400/60">Live Data Extraction</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Type Selector */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { id: "general", icon: Globe, label: "General" },
            { id: "flight", icon: Plane, label: "Flight" },
            { id: "product", icon: ShoppingCart, label: "Product" },
            { id: "news", icon: Newspaper, label: "News" },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id as typeof type)}
              className={`p-2 rounded-lg text-xs font-medium flex flex-col items-center gap-1 transition-all ${
                type === t.id
                  ? "bg-emerald-500 text-white"
                  : "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {/* URL Input */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-emerald-400/60" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Enter URL to scrape..."
              className="w-full pl-12 pr-4 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-white placeholder-emerald-400/40 focus:border-emerald-400 focus:outline-none"
            />
          </div>

          <button
            onClick={handleScrape}
            disabled={loading || !url}
            className="w-full py-3 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl text-white font-medium flex items-center justify-center gap-2 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Scraping...
              </>
            ) : (
              <>
                {getTypeIcon()}
                Scrape {type.charAt(0).toUpperCase() + type.slice(1)}
              </>
            )}
          </button>
        </div>

        {/* Results */}
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-emerald-500/5 rounded-xl p-4 border border-emerald-500/20 space-y-4"
          >
            {/* Title & Description */}
            <div>
              <h4 className="text-lg font-bold text-white mb-1">{result.title}</h4>
              <p className="text-sm text-emerald-100/70">{result.description}</p>
            </div>

            {/* Product-specific data */}
            {type === "product" && (result.price || result.availability) && (
              <div className="grid grid-cols-2 gap-3">
                {result.price && (
                  <div className="bg-emerald-500/10 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-emerald-400 mb-1">
                      <DollarSign className="w-4 h-4" />
                      <span className="text-xs font-medium">Price</span>
                    </div>
                    <p className="text-lg font-bold text-white">{result.price}</p>
                  </div>
                )}
                {result.availability && (
                  <div className="bg-emerald-500/10 rounded-lg p-3"
                  >
                    <div className="flex items-center gap-2 text-emerald-400 mb-1">
                      {result.availability.toLowerCase().includes("in stock") ?
                        <Check className="w-4 h-4 text-green-400" /> :
                        <X className="w-4 h-4 text-red-400" />
                      }
                      <span className="text-xs font-medium">Availability</span>
                    </div>
                    <p className="text-sm text-white">{result.availability}</p>
                  </div>
                )}
              </div>
            )}

            {/* Image */}
            {result.image && (
              <img
                src={result.image}
                alt={result.title}
                className="w-full rounded-lg border border-emerald-500/20"
              />
            )}

            {/* Links */}
            {result.links.length > 0 && (
              <div>
                <h5 className="text-sm font-medium text-emerald-400 mb-2">
                  Found Links
                </h5>
                <div className="space-y-1">
                  {result.links.slice(0, 5).map((link, idx) => (
                    <a
                      key={idx}
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 p-2 bg-emerald-500/10 rounded-lg text-xs text-emerald-100/70 hover:bg-emerald-500/20 transition-all"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span className="truncate">{link.text || link.href}</span>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Tables */}
            {result.tables.length > 0 && (
              <div>
                <h5 className="text-sm font-medium text-emerald-400 mb-2">
                  Data Tables
                </h5>
                {result.tables.map((table, idx) => (
                  <div
                    key={idx}
                    className="overflow-x-auto bg-emerald-500/5 rounded-lg p-2"
                  >
                    <table className="w-full text-xs">
                      <tbody>
                        {table.slice(0, 5).map((row: string[], rIdx: number) => (
                          <tr
                            key={rIdx}
                            className={
                              rIdx === 0 ? "border-b border-emerald-500/20" : ""
                            }
                          >
                            {row.map((cell: string, cIdx: number) => (
                              <td
                                key={cIdx}
                                className={`p-2 ${
                                  rIdx === 0
                                    ? "font-medium text-emerald-400"
                                    : "text-emerald-100/70"
                                }`}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* Tips */}
        {!result && (
          <div className="bg-emerald-500/5 rounded-xl p-4 border border-emerald-500/20">
            <h4 className="text-sm font-medium text-emerald-400 mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              Use Cases
            </h4>
            <div className="space-y-2 text-xs text-emerald-100/60">
              <div className="flex items-start gap-2">
                <Plane className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-200">Flight Status</p>
                  <p>&ldquo;Is my flight on time?&rdquo; - Scrape airline website</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <ShoppingCart className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-200">Price Tracking</p>
                  <p>Monitor product prices across sites</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Newspaper className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <p className="font-medium text-emerald-200">News Extraction</p>
                  <p>Extract article content without ads</p>
                </div>
              </div>
            </div>          </div>
        )}
      </div>
    </div>
  );
}
