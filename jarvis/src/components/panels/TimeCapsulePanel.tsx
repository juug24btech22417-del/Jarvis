"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Hourglass, X, Plus, Calendar, Search, TrendingUp, MapPin, Cloud, Smile, Frown, Minus } from "lucide-react";

interface Entry {
  id: string;
  type: string;
  content: string;
  mood?: string;
  weather?: string;
  location?: string;
  tags: string[];
  createdAt: number;
}

const MOODS = [
  { id: 'happy', icon: Smile, color: 'text-green-400' },
  { id: 'sad', icon: Frown, color: 'text-blue-400' },
  { id: 'anxious', icon: TrendingUp, color: 'text-yellow-400' },
  { id: 'excited', icon: TrendingUp, color: 'text-orange-400' },
  { id: 'tired', icon: Minus, color: 'text-gray-400' },
  { id: 'motivated', icon: TrendingUp, color: 'text-red-400' },
  { id: 'stressed', icon: TrendingUp, color: 'text-purple-400' },
  { id: 'calm', icon: Minus, color: 'text-cyan-400' },
  { id: 'angry', icon: TrendingUp, color: 'text-red-600' },
  { id: 'neutral', icon: Minus, color: 'text-text-secondary' },
];

export default function TimeCapsulePanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [onThisDay, setOnThisDay] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEntry, setNewEntry] = useState({ content: "", mood: "neutral", weather: "", location: "", tags: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [insight, setInsight] = useState<string | null>(null);

  // Fetch entries on mount
  useEffect(() => {
    fetchEntries();
    fetchOnThisDay();
  }, []);

  const fetchEntries = async () => {
    try {
      const res = await fetch("/api/timecapsule?limit=50");
      const data = await res.json();
      if (data.success) {
        setEntries(data.entries);
      }
    } catch (error) {
      console.error("[TimeCapsule] Fetch failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOnThisDay = async () => {
    try {
      const res = await fetch("/api/timecapsule?action=onthisday");
      const data = await res.json();
      if (data.success && data.entries.length > 0) {
        setOnThisDay(data.entries);
      }
    } catch (error) {
      console.error("[TimeCapsule] On this day failed:", error);
    }
  };

  const handleCreateEntry = async () => {
    if (!newEntry.content.trim()) return;

    try {
      const res = await fetch("/api/timecapsule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "text",
          content: newEntry.content,
          mood: newEntry.mood,
          weather: newEntry.weather,
          location: newEntry.location,
          tags: newEntry.tags.split(',').map(t => t.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();

      if (data.success) {
        setEntries([data.entry, ...entries]);
        setInsight(data.insight);
        setNewEntry({ content: "", mood: "neutral", weather: "", location: "", tags: "" });
        setShowAddForm(false);
      }
    } catch (error) {
      console.error("[TimeCapsule] Create failed:", error);
    }
  };

  const handleDeleteEntry = async (entryId: string) => {
    try {
      await fetch(`/api/timecapsule?id=${entryId}`, { method: "DELETE" });
      setEntries(entries.filter(e => e.id !== entryId));
    } catch (error) {
      console.error("[TimeCapsule] Delete failed:", error);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const getMoodIcon = (moodId: string) => {
    const mood = MOODS.find(m => m.id === moodId);
    if (!mood) return null;
    const Icon = mood.icon;
    return <Icon className={`w-4 h-4 ${mood.color}`} />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 400 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 400 }}
      className="fixed right-0 top-0 h-full w-96 bg-panel-bg/95 backdrop-blur-sm border-l border-panel-border z-40"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-panel-border">
        <div className="flex items-center gap-3">
          <Hourglass className="w-6 h-6 text-reactor-core" />
          <div>
            <h2 className="font-orbitron text-reactor-core font-bold">TIME CAPSULE</h2>
            <div className="flex items-center gap-2">
              <Calendar className="w-3 h-3 text-text-secondary" />
              <span className="text-xs text-text-secondary font-rajdhani">
                {entries.length} memories captured
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-accent-red/20 rounded transition-colors"
        >
          <X className="w-4 h-4 text-accent-red" />
        </button>
      </div>

      {/* Insight Banner */}
      <AnimatePresence>
        {insight && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="p-3 bg-reactor-core/10 border-b border-reactor-core/30"
          >
            <p className="text-sm text-reactor-core font-rajdhani italic">{insight}</p>
            <button
              onClick={() => setInsight(null)}
              className="text-xs text-text-secondary mt-1 hover:text-text-primary"
            >
              dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* On This Day */}
      {onThisDay.length > 0 && (
        <div className="p-4 border-b border-panel-border bg-reactor-core/5">
          <h3 className="font-rajdhani font-bold text-text-primary mb-2 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-reactor-core" />
            On This Day
          </h3>
          <div className="space-y-2">
            {onThisDay.map((entry) => (
              <div key={entry.id} className="text-sm font-rajdhani text-text-secondary">
                <p className="text-text-primary">{entry.content}</p>
                <p className="text-xs mt-1">{formatTime(entry.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="relative flex-1 mr-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories..."
              className="w-full bg-panel-glass/50 border border-panel-border rounded-lg pl-10 pr-3 py-2 text-text-primary font-rajdhani text-sm focus:outline-none focus:border-reactor-core"
            />
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-2 bg-reactor-core/20 hover:bg-reactor-core/30 rounded transition-colors"
          >
            <Plus className="w-4 h-4 text-reactor-core" />
          </button>
        </div>

        {/* Add Entry Form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-4 space-y-3"
            >
              <textarea
                value={newEntry.content}
                onChange={(e) => setNewEntry({ ...newEntry, content: e.target.value })}
                placeholder="What's on your mind, Boss?"
                rows={3}
                className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core resize-none"
              />

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newEntry.mood}
                  onChange={(e) => setNewEntry({ ...newEntry, mood: e.target.value })}
                  className="bg-panel-glass/50 border border-panel-border rounded-lg px-2 py-2 text-text-primary font-rajdhani text-sm focus:outline-none focus:border-reactor-core"
                >
                  {MOODS.map(mood => (
                    <option key={mood.id} value={mood.id}>{mood.id}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={newEntry.weather}
                  onChange={(e) => setNewEntry({ ...newEntry, weather: e.target.value })}
                  placeholder="Weather"
                  className="bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani text-sm focus:outline-none focus:border-reactor-core"
                />
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={newEntry.location}
                  onChange={(e) => setNewEntry({ ...newEntry, location: e.target.value })}
                  placeholder="Location"
                  className="flex-1 bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani text-sm focus:outline-none focus:border-reactor-core"
                />
              </div>

              <input
                type="text"
                value={newEntry.tags}
                onChange={(e) => setNewEntry({ ...newEntry, tags: e.target.value })}
                placeholder="Tags (comma-separated)"
                className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani text-sm focus:outline-none focus:border-reactor-core"
              />

              <button
                onClick={handleCreateEntry}
                className="w-full py-2 bg-reactor-core/20 hover:bg-reactor-core/30 rounded-lg transition-colors font-rajdhani text-reactor-core"
              >
                Capture Memory
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Entries List */}
        {loading ? (
          <div className="text-center text-text-secondary font-rajdhani py-8">
            Loading memories...
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center text-text-secondary font-rajdhani py-8">
            <Hourglass className="w-12 h-12 mx-auto mb-2 opacity-20" />
            <p>No memories yet</p>
            <p className="text-xs mt-2">Capture your first moment</p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="p-3 rounded-lg border border-panel-border bg-panel-glass/30"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getMoodIcon(entry.mood || 'neutral')}
                    <span className="text-xs text-text-secondary font-rajdhani">
                      {formatTime(entry.createdAt)}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteEntry(entry.id)}
                    className="p-1 hover:bg-accent-red/20 rounded transition-colors"
                  >
                    <X className="w-3 h-3 text-accent-red" />
                  </button>
                </div>
                <p className="text-text-primary font-rajdhani whitespace-pre-wrap">{entry.content}</p>
                {(entry.weather || entry.location || entry.tags.length > 0) && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {entry.weather && (
                      <span className="text-xs text-text-secondary flex items-center gap-1">
                        <Cloud className="w-3 h-3" />{entry.weather}
                      </span>
                    )}
                    {entry.location && (
                      <span className="text-xs text-text-secondary flex items-center gap-1">
                        <MapPin className="w-3 h-3" />{entry.location}
                      </span>
                    )}
                    {entry.tags.map((tag, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 bg-panel-glass/50 text-text-secondary rounded">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
