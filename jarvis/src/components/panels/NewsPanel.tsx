"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Newspaper,
  X,
  ExternalLink,
  Clock,
  ChevronRight,
  Globe,
  Cpu,
  Trophy,
  Film,
  HeartPulse,
  Briefcase,
  Beaker,
} from "lucide-react";
import gsap from "gsap";

interface Article {
  title: string;
  source: string;
  description: string;
  publishedAt: string;
  url: string;
  urlToImage?: string;
}

interface NewsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Category =
  | "general"
  | "technology"
  | "business"
  | "sports"
  | "entertainment"
  | "health"
  | "science";

interface CategoryInfo {
  label: string;
  icon: React.ReactNode;
  color: string;
}

const categories: Record<Category, CategoryInfo> = {
  general: { label: "General", icon: <Globe className="w-4 h-4" />, color: "text-reactor-core" },
  technology: { label: "Tech", icon: <Cpu className="w-4 h-4" />, color: "text-accent-amber" },
  business: { label: "Business", icon: <Briefcase className="w-4 h-4" />, color: "text-accent-green" },
  sports: { label: "Sports", icon: <Trophy className="w-4 h-4" />, color: "text-accent-red" },
  entertainment: { label: "Entertainment", icon: <Film className="w-4 h-4" />, color: "text-purple-400" },
  health: { label: "Health", icon: <HeartPulse className="w-4 h-4" />, color: "text-pink-400" },
  science: { label: "Science", icon: <Beaker className="w-4 h-4" />, color: "text-cyan-400" },
};

export default function NewsPanel({ isOpen, onClose }: NewsPanelProps) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<Category>("technology");
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Fetch news
  const fetchNews = useCallback(async (category: Category) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/news?category=${category}&country=us`,
        { next: { revalidate: 300 } }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch news");
      }

      const data = await response.json();
      if (data.success) {
        setArticles(data.articles);
        setLastUpdated(new Date());
      } else {
        throw new Error(data.error || "Failed to fetch news");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch news");
      // Set empty articles on error
      setArticles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and category change
  useEffect(() => {
    if (isOpen) {
      fetchNews(activeCategory);
      gsap.fromTo(
        ".news-panel",
        { opacity: 0, scale: 0.95, y: 20 },
        { opacity: 1, scale: 1, y: 0, duration: 0.3, ease: "power2.out" }
      );
    }
  }, [isOpen, activeCategory, fetchNews]);

  // Format relative time
  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  // Get category color
  const getCategoryColor = (category: Category) => {
    return categories[category].color;
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="news-panel w-full max-w-3xl max-h-[85vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="holographic-panel flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="p-6 border-b border-panel-border flex-shrink-0">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-full bg-reactor-core/20">
                    <Newspaper className="w-6 h-6 text-reactor-core" />
                  </div>
                  <div>
                    <h2 className="font-orbitron text-reactor-core font-bold text-lg">
                      NEWS BRIEFING
                    </h2>
                    <p className="font-rajdhani text-text-secondary text-sm">
                      {lastUpdated
                        ? `Updated ${getRelativeTime(lastUpdated.toISOString())}`
                        : "Fetching latest..."}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-panel-glass rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-text-secondary" />
                </button>
              </div>

              {/* Category Tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {(Object.keys(categories) as Category[]).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-rajdhani text-sm whitespace-nowrap transition-colors ${
                      activeCategory === cat
                        ? `bg-panel-glass ${categories[cat].color} border border-panel-border`
                        : "text-text-secondary hover:text-text-primary hover:bg-panel-glass/50"
                    }`}
                  >
                    {categories[cat].icon}
                    {categories[cat].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* Error */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-4 bg-accent-amber/20 border border-accent-amber/50 rounded-lg"
                >
                  <p className="text-accent-amber text-sm">
                    {error}. Using demo mode.
                  </p>
                </motion.div>
              )}

              {/* Loading */}
              {loading && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-12 h-12 border-4 border-reactor-core border-t-transparent rounded-full animate-spin mb-4" />
                  <p className="font-rajdhani text-text-secondary">
                    Gathering intelligence...
                  </p>
                </div>
              )}

              {/* Articles Grid */}
              {!loading && articles.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Featured Article (First) */}
                  {articles[0] && (
                    <motion.article
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="md:col-span-2 bg-panel-glass/50 rounded-xl border border-panel-border overflow-hidden group hover:border-reactor-core/50 transition-colors"
                    >
                      <button
                        onClick={() => setSelectedArticle(articles[0])}
                        className="w-full text-left"
                      >
                        <div className="p-5">
                          <div className="flex items-center gap-2 mb-3">
                            <span
                              className={`text-xs font-rajdhani font-bold ${getCategoryColor(
                                activeCategory
                              )}`}
                            >
                              {categories[activeCategory].label.toUpperCase()}
                            </span>
                            <span className="text-text-secondary/30">•</span>
                            <span className="font-rajdhani text-xs text-text-secondary/50 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {getRelativeTime(articles[0].publishedAt)}
                            </span>
                          </div>

                          <h3 className="font-orbitron text-lg text-text-primary mb-2 group-hover:text-reactor-core transition-colors">
                            {articles[0].title}
                          </h3>

                          <p className="font-rajdhani text-text-secondary text-sm line-clamp-2">
                            {articles[0].description || "No description available."}
                          </p>

                          <div className="flex items-center justify-between mt-4">
                            <span className="font-rajdhani text-xs text-text-secondary/50">
                              {articles[0].source}
                            </span>
                            <span className="flex items-center gap-1 font-rajdhani text-xs text-reactor-core">
                              Read More
                              <ChevronRight className="w-4 h-4" />
                            </span>
                          </div>
                        </div>
                      </button>
                    </motion.article>
                  )}

                  {/* Other Articles */}
                  {articles.slice(1).map((article, index) => (
                    <motion.article
                      key={article.title + index}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="bg-panel-glass/30 rounded-xl border border-panel-border/50 overflow-hidden group hover:border-reactor-core/30 transition-colors"
                    >
                      <button
                        onClick={() => setSelectedArticle(article)}
                        className="w-full text-left p-4"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-rajdhani text-xs text-text-secondary/50">
                            {article.source}
                          </span>
                          <span className="text-text-secondary/30">•</span>
                          <span className="font-rajdhani text-xs text-text-secondary/50">
                            {getRelativeTime(article.publishedAt)}
                          </span>
                        </div>

                        <h4 className="font-rajdhani text-text-primary font-medium mb-2 line-clamp-2 group-hover:text-reactor-core transition-colors">
                          {article.title}
                        </h4>

                        <p className="font-rajdhani text-text-secondary/70 text-xs line-clamp-2">
                          {article.description || "No description available."}
                        </p>
                      </button>
                    </motion.article>
                  ))}
                </div>
              )}

              {/* Empty State */}
              {!loading && articles.length === 0 && (
                <div className="text-center py-12">
                  <Newspaper className="w-16 h-16 text-text-secondary/30 mx-auto mb-4" />
                  <p className="font-rajdhani text-text-secondary">
                    No articles found
                  </p>
                  <p className="font-rajdhani text-text-secondary/50 text-sm mt-2">
                    Try a different category
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-panel-border flex-shrink-0">
              <p className="text-xs text-text-secondary/40 text-center">
                Powered by NewsAPI.org • News updates every 5 minutes
              </p>
            </div>
          </div>
        </motion.div>

        {/* Article Detail Modal */}
        <AnimatePresence>
          {selectedArticle && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
              onClick={() => setSelectedArticle(null)}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="holographic-panel p-6 max-w-lg w-full max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-4">
                  <span
                    className={`text-xs font-rajdhani font-bold ${getCategoryColor(
                      activeCategory
                    )}`}
                  >
                    {categories[activeCategory].label.toUpperCase()}
                  </span>
                  <button
                    onClick={() => setSelectedArticle(null)}
                    className="p-2 hover:bg-panel-glass rounded-full transition-colors"
                  >
                    <X className="w-5 h-5 text-text-secondary" />
                  </button>
                </div>

                <h3 className="font-orbitron text-xl text-text-primary mb-4">
                  {selectedArticle.title}
                </h3>

                <p className="font-rajdhani text-text-secondary mb-6">
                  {selectedArticle.description || "No description available."}
                </p>

                <div className="flex items-center justify-between mb-6">
                  <div className="font-rajdhani text-sm text-text-secondary/50">
                    <span>{selectedArticle.source}</span>
                    <span className="mx-2">•</span>
                    <span>
                      {new Date(selectedArticle.publishedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <a
                  href={selectedArticle.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 bg-reactor-core/20 hover:bg-reactor-core/40 border border-reactor-core/50 rounded-lg font-orbitron text-reactor-core transition-colors"
                >
                  Read Full Article
                  <ExternalLink className="w-4 h-4" />
                </a>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
