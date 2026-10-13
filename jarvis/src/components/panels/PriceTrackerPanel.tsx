"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingDown,
  TrendingUp,
  DollarSign,
  Plus,
  Trash2,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Package,
  Target,
} from "lucide-react";

interface PriceHistory {
  date: string;
  price: number;
}

interface TrackedProduct {
  id: string;
  asin: string;
  title: string;
  imageUrl: string | null;
  currentPrice: number | null;
  lowestPrice: number | null;
  highestPrice: number | null;
  targetPrice: number | null;
  currency: string;
  url: string;
  priceHistory: PriceHistory[];
  // Added when tracking moved server-side: the loop keeps sampling with the
  // panel closed, and per-product errors are surfaced instead of swallowed.
  source: string;
  active: boolean;
  checkCount: number;
  intervalMin: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  hitTarget: boolean;
}

interface TrackerStatus {
  running: boolean;
  intervalMin: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  lastTickDurationMs: number | null;
  tickCount: number;
  lastError: string | null;
  engine: string;
  keepaConfigured: boolean;
  amazonDomain: string;
  note: string;
}

export default function PriceTrackerPanel() {
  const [products, setProducts] = useState<TrackedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAsin, setNewAsin] = useState("");
  const [newTargetPrice, setNewTargetPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [alerts, setAlerts] = useState<{ product: string; currentPrice: number; targetPrice: number }[]>([]);
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { asin: string; title: string; priceText: string | null; price: number | null; imageUrl: string | null; url: string }[]
  >([]);
  const [searching, setSearching] = useState(false);

  const fetchProducts = useCallback(async () => {
    try {
      const response = await fetch("/api/price-tracker");
      const data = await response.json();

      if (data.success) {
        setProducts(data.products);
        setStatus(data.status ?? null);
      } else {
        setError(data.error || "Failed to fetch products");
      }
    } catch (err) {
      setError("Failed to fetch products");
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh every product now (server-side, so this works with the panel
  // closed too — the button is a nudge, not the mechanism).
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/price-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update" }),
      });
      const data = await res.json();
      if (data.success) {
        setProducts(data.products ?? []);
        setStatus(data.status ?? null);
      } else {
        setError(data.error || "Refresh failed");
      }
    } catch {
      setError("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const checkAlerts = useCallback(async () => {
    try {
      const response = await fetch("/api/price-tracker?action=alerts");
      const data = await response.json();
      if (data.success) {
        setAlerts(data.alerts);
      }
    } catch (err) {
      console.error("Failed to check alerts:", err);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    checkAlerts();
  }, [fetchProducts, checkAlerts]);

  const handleAddProduct = async () => {
    if (!newAsin) return;
    setAdding(true);

    try {
      const response = await fetch("/api/price-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          asin: newAsin,
          targetPrice: newTargetPrice ? parseFloat(newTargetPrice) : undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setProducts((prev) => [...prev, data.product]);
        setNewAsin("");
        setNewTargetPrice("");
        setShowAddForm(false);
      } else {
        setError(data.error || "Failed to add product");
      }
    } catch (err) {
      setError("Failed to add product");
    } finally {
      setAdding(false);
    }
  };

  // Search by name. Amazon serves a reduced layout to automated browsers on
  // its results page (titles yes, prices no), so results are candidates — the
  // authoritative price is read from the product page when one is added.
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch("/api/price-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search", query: searchQuery.trim() }),
      });
      const data = await res.json();
      if (data.success) setSearchResults(data.products ?? []);
      else {
        setSearchResults([]);
        setError(data.error || "Search failed");
      }
    } catch {
      setError("Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleAddResult = async (asin: string, targetPrice?: number) => {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/price-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add", asin, targetPrice }),
      });
      const data = await res.json();
      if (data.success) {
        setSearchResults((prev) => prev.filter((p) => p.asin !== asin));
        await fetchProducts();
        if (data.warning) setError(data.warning);
      } else {
        setError(data.error || "Failed to add product");
      }
    } catch {
      setError("Failed to add product");
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveProduct = async (asin: string) => {
    try {
      await fetch("/api/price-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", asin }),
      });
      setProducts((prev) => prev.filter((p) => p.asin !== asin));
    } catch (err) {
      setError("Failed to remove product");
    }
  };

  const formatPrice = (price: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(price);
  };

  const getPriceChange = (product: TrackedProduct) => {
    if (product.priceHistory.length < 2 || product.currentPrice === null) return 0;
    const current = product.currentPrice;
    const previous = product.priceHistory[product.priceHistory.length - 2].price;
    if (!previous) return 0;
    return ((current - previous) / previous) * 100;
  };

  // A price the server could not read is null, not zero — showing "$0.00" for
  // an unreachable product would look like the deal of the century.
  const formatMaybePrice = (price: number | null, currency: string) =>
    price === null ? "—" : formatPrice(price, currency);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Ambient Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-cyan-500/10 via-blue-500/5 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Header */}
      <div className="relative p-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group">
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl blur-lg opacity-50 group-hover:opacity-70 transition-opacity" />
              <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500/90 to-teal-600/90 backdrop-blur-xl border border-white/20 flex items-center justify-center shadow-2xl">
                <TrendingDown className="w-6 h-6 text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold bg-gradient-to-r from-white via-emerald-100 to-teal-200 bg-clip-text text-transparent">
                Price Tracker
              </h3>
              <p className="text-xs text-emerald-300/60 font-medium tracking-wide uppercase">
                Amazon Price Monitor
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAddForm(true)}
            disabled={products.length >= 10}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-semibold flex items-center gap-2 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 transition-all shadow-lg shadow-emerald-500/25"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>

        {status && (
          <div className="mt-4 flex flex-wrap items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm">
            <span
              className={`flex items-center gap-1.5 text-xs font-medium ${
                status.running ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${status.running ? "bg-emerald-400" : "bg-rose-400"}`} />
              {status.running ? "Background loop running" : "Background loop stopped"}
            </span>
            <span className="text-xs text-white/50">
              engine: <span className="text-white/80">{status.engine}</span>
            </span>
            <span className="text-xs text-white/50">
              every {status.intervalMin} min
            </span>
            {status.lastTickAt && (
              <span className="text-xs text-white/40">last check {new Date(status.lastTickAt).toLocaleTimeString()}</span>
            )}
            <span className="ml-auto text-[11px] text-white/40">Keeps running with this panel closed</span>
            <button
              onClick={refreshAll}
              disabled={refreshing}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs text-white flex items-center gap-1.5 disabled:opacity-50 transition"
            >
              <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
              Check now
            </button>
          </div>
        )}

        {status && !status.keepaConfigured && (
          <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 backdrop-blur-sm">
            <p className="text-xs text-amber-300/80 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Prices are read from the live {status.amazonDomain} product page. Amazon sometimes serves a bot wall — a
                blocked check is recorded as an error on the product, never replaced with a made-up price. Add
                KEEPA_API_KEY to .env.local for reliable history.
              </span>
            </p>
          </div>
        )}

        {alerts.length > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-sm">
            <p className="text-sm text-emerald-300 font-semibold flex items-center gap-2">
              <Target className="w-4 h-4" />
              {alerts.length} price drop{alerts.length > 1 ? 's' : ''} detected!
            </p>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 overflow-auto px-6 pb-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 mb-4"
            >
              <p className="text-sm text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {error}
              </p>
            </motion.div>
          )}

          {/* Add Product Form */}
          <AnimatePresence>
            {showAddForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 p-5 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10"
              >
                <h4 className="text-sm font-semibold text-white/80 mb-3 flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-400" />
                  Add Amazon Product
                </h4>

                {/* Search by name — the ASIN field alone is where the old
                    tracker felt broken (a dead ASIN silently produced no price). */}
                <div className="mb-3">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSearch();
                      }}
                      placeholder={'Search by name, e.g. "anker usb c cable"'}
                      className="flex-1 px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                    />
                    <button
                      onClick={handleSearch}
                      disabled={searching || !searchQuery.trim()}
                      className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/20 text-white text-sm flex items-center gap-2 disabled:opacity-50 transition-all"
                    >
                      <RefreshCw className={`w-4 h-4 ${searching ? "animate-spin" : ""}`} />
                      Search
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-white/40">
                    Results are candidates with live ASINs; the price is read from the product page when you add one.
                  </p>
                  {searchResults.length > 0 && (
                    <div className="mt-3 max-h-64 space-y-2 overflow-auto pr-1">
                      {searchResults.map((r) => (
                        <div key={r.asin} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-2.5">
                          {r.imageUrl && (
                            <img src={r.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-white/85">{r.title}</p>
                            <p className="text-[10px] text-white/40">
                              {r.asin}
                              {r.priceText ? ` · ${r.priceText}` : " · price read on add"}
                            </p>
                          </div>
                          <button
                            onClick={() => handleAddResult(r.asin)}
                            disabled={adding}
                            className="shrink-0 rounded-lg bg-emerald-500/90 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-emerald-400 disabled:opacity-50 transition"
                          >
                            Track
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <input
                    type="text"
                    value={newAsin}
                    onChange={(e) => setNewAsin(e.target.value)}
                    placeholder="…or paste an ASIN / Amazon product URL"
                    className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                  />
                  <input
                    type="number"
                    value={newTargetPrice}
                    onChange={(e) => setNewTargetPrice(e.target.value)}
                    placeholder="Target price (optional)"
                    className="w-full px-4 py-3 bg-black/20 border border-white/10 rounded-xl text-white placeholder-white/30 focus:border-white/30 focus:outline-none text-sm transition-all"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleAddProduct}
                      disabled={adding || !newAsin}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold flex items-center justify-center gap-2 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 transition-all"
                    >
                      {adding ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <>
                          <Plus className="w-4 h-4" />
                          Track Product
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowAddForm(false)}
                      className="px-4 py-3 rounded-xl bg-white/5 text-white/70 hover:bg-white/10 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Products List */}
          <div className="space-y-3">
            {products.length === 0 ? (
              <div className="p-8 rounded-3xl bg-white/5 border border-white/10 text-center">
                <Package className="w-12 h-12 text-white/20 mx-auto mb-4" />
                <p className="text-white/60 mb-2">No products tracked yet</p>
                <button
                  onClick={() => setShowAddForm(true)}
                  className="text-emerald-400 hover:text-emerald-300 text-sm font-medium"
                >
                  Add your first product
                </button>
              </div>
            ) : (
              products.map((product) => {
                const priceChange = getPriceChange(product);
                const isAlert =
                  product.currentPrice !== null && product.targetPrice !== null && product.currentPrice <= product.targetPrice;

                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`p-4 rounded-2xl bg-white/5 backdrop-blur-xl border ${
                      isAlert
                        ? "border-emerald-500/50 bg-emerald-500/5"
                        : "border-white/10"
                    } hover:bg-white/10 transition-all group`}
                  >
                    <div className="flex gap-4">
                      {/* Product Image */}
                      <div className="w-20 h-20 rounded-xl bg-white/10 flex-shrink-0 overflow-hidden">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Package className="w-8 h-8 text-white/30 m-6" />
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-white/80 truncate">
                            {product.title}
                          </h4>
                          <button
                            onClick={() => handleRemoveProduct(product.asin)}
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-white/40 hover:text-red-400 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="mt-2 flex items-baseline gap-2">
                          <span className="text-2xl font-bold text-white">
                            {formatMaybePrice(product.currentPrice, product.currency)}
                          </span>
                          {priceChange !== 0 && (
                            <span
                              className={`text-xs font-medium flex items-center gap-0.5 ${
                                priceChange < 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }`}
                            >
                              {priceChange < 0 ? (
                                <TrendingDown className="w-3 h-3" />
                              ) : (
                                <TrendingUp className="w-3 h-3" />
                              )}
                              {Math.abs(priceChange).toFixed(1)}%
                            </span>
                          )}
                        </div>

                        {/* Price Range & Target */}
                        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-white/50">
                          <span className="flex items-center gap-1">
                            <TrendingDown className="w-3 h-3" />
                            Low: {formatMaybePrice(product.lowestPrice, product.currency)}
                          </span>
                          <span className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3" />
                            High: {formatMaybePrice(product.highestPrice, product.currency)}
                          </span>
                          <span
                            className={`flex items-center gap-1 ${
                              isAlert ? "text-emerald-400 font-medium" : ""
                            }`}
                          >
                            <Target className="w-3 h-3" />
                            Target: {formatMaybePrice(product.targetPrice, product.currency)}
                            {isAlert && " ✓"}
                          </span>
                        </div>

                        {/* Last check failed — say so instead of showing a stale number as if it were fresh. */}
                        {product.lastError && (
                          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/80">
                            <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                            {product.lastError}
                            {product.lastCheckedAt && (
                              <span className="text-white/30">· {new Date(product.lastCheckedAt).toLocaleTimeString()}</span>
                            )}
                          </p>
                        )}

                        {/* Mini Price Chart */}
                        {product.priceHistory.length > 1 && (
                          <div className="mt-3 h-8 flex items-end gap-0.5">
                            {product.priceHistory.slice(-10).map((point, idx) => {
                              const min = Math.min(
                                ...product.priceHistory.map((p) => p.price)
                              );
                              const max = Math.max(
                                ...product.priceHistory.map((p) => p.price)
                              );
                              const height =
                                max === min
                                  ? 50
                                  : ((point.price - min) / (max - min)) * 100;
                              return (
                                <div
                                  key={idx}
                                  className="flex-1 bg-emerald-500/40 rounded-t hover:bg-emerald-400/60 transition-colors"
                                  style={{ height: `${Math.max(height, 10)}%` }}
                                  title={`${formatPrice(point.price, product.currency)}`}
                                />
                              );
                            })}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="mt-3 flex gap-2">
                          <a
                            href={product.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View on Amazon
                          </a>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>

          {/* Max Products Info */}
          {products.length > 0 && (
            <p className="mt-4 text-center text-xs text-white/40">
              {products.length}/10 products tracked
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
