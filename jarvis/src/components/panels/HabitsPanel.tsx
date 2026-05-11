"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Target, X, Check, TrendingUp, TrendingDown, Award, Flame, Calendar, Plus, Trash2 } from "lucide-react";

interface Habit {
  id: string;
  name: string;
  description: string;
  target: string;
  category: string;
  streak: number;
  completedToday: boolean;
  failedAttempts: number;
}

interface Stats {
  totalHabits: number;
  completedToday: number;
  completionRate: number;
  activeStreaks: number;
  longestStreak: number;
}

export default function HabitsPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newHabit, setNewHabit] = useState({ name: "", description: "", category: "custom" });
  const [sarcasticComment, setSarcasticComment] = useState<string | null>(null);

  // Fetch habits on mount
  useEffect(() => {
    fetchHabits();
  }, []);

  const fetchHabits = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/habits");
      const data = await res.json();
      if (data.success) {
        setHabits(data.habits);
      }

      const statsRes = await fetch("/api/habits?action=stats");
      const statsData = await statsRes.json();
      if (statsData.success) {
        setStats(statsData.stats);
      }
    } catch (error) {
      console.error("[Habits] Fetch failed:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateHabit = async () => {
    if (!newHabit.name) return;

    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          habit: newHabit,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setHabits([...habits, data.habit]);
        setSarcasticComment(data.sarcasticComment);
        setNewHabit({ name: "", description: "", category: "custom" });
        setShowAddForm(false);
        fetchHabits();
      }
    } catch (error) {
      console.error("[Habits] Create failed:", error);
    }
  };

  const handleCompleteHabit = async (habitId: string) => {
    try {
      const res = await fetch("/api/habits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete",
          habitId,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setHabits(habits.map(h =>
          h.id === habitId ? { ...h, completedToday: true, streak: h.streak + 1 } : h
        ));
        setSarcasticComment(data.sarcasticComment);
        fetchHabits();
      }
    } catch (error) {
      console.error("[Habits] Complete failed:", error);
    }
  };

  const handleDeleteHabit = async (habitId: string) => {
    try {
      await fetch(`/api/habits?id=${habitId}`, { method: "DELETE" });
      setHabits(habits.filter(h => h.id !== habitId));
      fetchHabits();
    } catch (error) {
      console.error("[Habits] Delete failed:", error);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'health': return '🏥';
      case 'fitness': return '💪';
      case 'productivity': return '📈';
      case 'learning': return '📚';
      case 'social': return '👥';
      default: return '📌';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'health': return 'text-green-400 bg-green-500/20';
      case 'fitness': return 'text-red-400 bg-red-500/20';
      case 'productivity': return 'text-blue-400 bg-blue-500/20';
      case 'learning': return 'text-purple-400 bg-purple-500/20';
      case 'social': return 'text-pink-400 bg-pink-500/20';
      default: return 'text-text-secondary bg-panel-glass/50';
    }
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
          <Target className="w-6 h-6 text-reactor-core" />
          <div>
            <h2 className="font-orbitron text-reactor-core font-bold">REALITY CHECK</h2>
            <div className="flex items-center gap-2">
              <Flame className="w-3 h-3 text-orange-500" />
              <span className="text-xs text-text-secondary font-rajdhani">
                {stats?.activeStreaks || 0} active streaks
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

      {/* Sarcastic Comment Banner */}
      <AnimatePresence>
        {sarcasticComment && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="p-3 bg-reactor-core/10 border-b border-reactor-core/30"
          >
            <p className="text-sm text-reactor-core font-rajdhani italic">
              {sarcasticComment}
            </p>
            <button
              onClick={() => setSarcasticComment(null)}
              className="text-xs text-text-secondary mt-1 hover:text-text-primary"
            >
              dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 p-4 border-b border-panel-border">
        <div className="bg-panel-glass/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-orbitron text-reactor-core">{stats?.completedToday || 0}/{stats?.totalHabits || 0}</p>
          <p className="text-xs text-text-secondary font-rajdhani">Today&apos;s Progress</p>
        </div>
        <div className="bg-panel-glass/30 rounded-lg p-3 text-center">
          <p className="text-2xl font-orbitron text-orange-500">{stats?.longestStreak || 0}</p>
          <p className="text-xs text-text-secondary font-rajdhani">Best Streak</p>
        </div>
      </div>

      {/* Habits List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-rajdhani font-bold text-text-primary">Your Habits</h3>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-2 hover:bg-reactor-core/20 rounded transition-colors"
          >
            <Plus className="w-4 h-4 text-reactor-core" />
          </button>
        </div>

        {/* Add Habit Form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-4 space-y-3"
            >
              <input
                type="text"
                value={newHabit.name}
                onChange={(e) => setNewHabit({ ...newHabit, name: e.target.value })}
                placeholder="Habit name (e.g., 'Exercise')"
                className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
              />
              <input
                type="text"
                value={newHabit.description}
                onChange={(e) => setNewHabit({ ...newHabit, description: e.target.value })}
                placeholder="Description (optional)"
                className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
              />
              <select
                value={newHabit.category}
                onChange={(e) => setNewHabit({ ...newHabit, category: e.target.value })}
                className="w-full bg-panel-glass/50 border border-panel-border rounded-lg px-3 py-2 text-text-primary font-rajdhani focus:outline-none focus:border-reactor-core"
              >
                <option value="health">Health</option>
                <option value="fitness">Fitness</option>
                <option value="productivity">Productivity</option>
                <option value="learning">Learning</option>
                <option value="social">Social</option>
                <option value="custom">Custom</option>
              </select>
              <button
                onClick={handleCreateHabit}
                className="w-full py-2 bg-reactor-core/20 hover:bg-reactor-core/30 rounded-lg transition-colors font-rajdhani text-reactor-core"
              >
                Create Habit
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Habits */}
        {loading ? (
          <div className="text-center text-text-secondary font-rajdhani py-8">
            Loading your failures...
          </div>
        ) : habits.length === 0 ? (
          <div className="text-center text-text-secondary font-rajdhani py-8">
            <Target className="w-12 h-12 mx-auto mb-2 opacity-20" />
            <p>No habits yet</p>
            <p className="text-xs mt-2">Add one to start disappointing yourself</p>
          </div>
        ) : (
          <div className="space-y-3">
            {habits.map((habit) => (
              <div
                key={habit.id}
                className={`p-3 rounded-lg border transition-colors ${
                  habit.completedToday
                    ? "bg-green-500/10 border-green-500/30"
                    : "bg-panel-glass/30 border-panel-border"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="text-xl">{getCategoryIcon(habit.category)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-rajdhani font-bold truncate ${
                        habit.completedToday ? "text-green-400" : "text-text-primary"
                      }`}>
                        {habit.name}
                      </p>
                      <div className="flex items-center gap-3 text-xs">
                        <span className={`px-2 py-0.5 rounded ${getCategoryColor(habit.category)}`}>
                          {habit.category}
                        </span>
                        {habit.streak > 0 && (
                          <span className="flex items-center gap-1 text-orange-500">
                            <Flame className="w-3 h-3" />
                            {habit.streak} day{habit.streak !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!habit.completedToday ? (
                      <button
                        onClick={() => handleCompleteHabit(habit.id)}
                        className="p-2 bg-green-500/20 hover:bg-green-500/30 rounded transition-colors"
                        title="Complete"
                      >
                        <Check className="w-4 h-4 text-green-400" />
                      </button>
                    ) : (
                      <div className="p-2 bg-green-500/20 rounded">
                        <Check className="w-4 h-4 text-green-400" />
                      </div>
                    )}
                    <button
                      onClick={() => handleDeleteHabit(habit.id)}
                      className="p-2 hover:bg-accent-red/20 rounded transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4 text-accent-red" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
