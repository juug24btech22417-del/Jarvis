"use client";

import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Circle, AlertCircle, Clock, Calendar } from "lucide-react";
import HolographicPanel from "../ui/HolographicPanel";
import { useJarvisStore } from "@/store/jarvis.store";
import { animateStagger, addHoverScale, createEnergyBurst } from "@/lib/animations/gsap";

interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  priority: string;
  dueDate?: Date | null;
}

export default function TaskPanel() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const { tasks: storeTasks } = useJarvisStore();
  const tasksRef = useRef<HTMLDivElement>(null);
  const completedTaskRef = useRef<HTMLDivElement>(null);

  // Load tasks from API
  useEffect(() => {
    const loadTasks = async () => {
      try {
        const response = await fetch("/api/tasks");
        if (response.ok) {
          const data = await response.json();
          setTasks(data);
        }
      } catch (error) {
        console.error("Error loading tasks:", error);
      }
    };
    loadTasks();
  }, [storeTasks]);

  // GSAP stagger animation for tasks
  useLayoutEffect(() => {
    if (tasksRef.current) {
      const taskItems = tasksRef.current.querySelectorAll('.task-item');
      animateStagger(taskItems, 0.08);
    }
  }, [tasks]);

  // Add hover effects to task items
  useEffect(() => {
    if (tasksRef.current) {
      const items = tasksRef.current.querySelectorAll('.task-card');
      items.forEach((item) => {
        addHoverScale(item as HTMLElement, 1.02);
      });
    }
  }, [tasks]);

  const handleToggle = async (taskId: string, e?: React.MouseEvent) => {
    // Energy burst animation on complete
    if (e && e.currentTarget) {
      createEnergyBurst(e.currentTarget as HTMLElement);
    }

    try {
      const response = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: taskId }),
      });
      if (response.ok) {
        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, completed: !t.completed } : t))
        );
      }
    } catch (error) {
      console.error("Error toggling task:", error);
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case "critical":
        return <AlertCircle className="w-4 h-4 text-accent-red" />;
      case "high":
        return <AlertCircle className="w-4 h-4 text-accent-amber" />;
      case "someday":
        return <Clock className="w-4 h-4 text-text-secondary" />;
      default:
        return <Circle className="w-4 h-4 text-text-secondary" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "critical":
        return "border-accent-red";
      case "high":
        return "border-accent-amber";
      default:
        return "border-panel-border";
    }
  };

  const todayTasks = tasks.filter(
    (t) =>
      !t.completed &&
      (!t.dueDate ||
        new Date(t.dueDate).toDateString() === new Date().toDateString())
  );

  return (
    <div className="fixed right-6 top-24 bottom-32 w-80 z-40">
      <HolographicPanel
        title="TASK MANAGER"
        direction="right"
        delay={0.6}
        className="h-full flex flex-col"
      >
        <div ref={tasksRef} className="flex-1 overflow-y-auto space-y-4">
          {/* Today's tasks */}
          <div>
            <div className="flex items-center gap-2 mb-3 text-text-secondary text-xs font-orbitron tracking-wider">
              <Calendar className="w-3 h-3" />
              TODAY&apos;S MISSIONS
              <span className="ml-auto text-reactor-core">
                {todayTasks.length} PENDING
              </span>
            </div>

            {todayTasks.length > 0 ? (
              <div className="space-y-2">
                {todayTasks.map((task, index) => (
                  <div
                    key={task.id}
                    className={`task-item task-card flex items-start gap-3 p-3 rounded border ${getPriorityColor(
                      task.priority
                    )} bg-panel-glass/30 hover:bg-panel-glass/50 transition-colors cursor-pointer`}
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <button
                      onClick={(e) => handleToggle(task.id, e)}
                      className="mt-0.5 hover:opacity-70 transition-opacity"
                    >
                      {task.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-accent-green" />
                      ) : (
                        getPriorityIcon(task.priority)
                      )}
                    </button>

                    <div className="flex-1">
                      <p
                        className={`text-sm ${
                          task.completed
                            ? "text-text-secondary line-through"
                            : "text-text-primary"
                        }`}
                      >
                        {task.title}
                      </p>
                      {task.dueDate && (
                        <span className="text-xs text-text-secondary/70">
                          {new Date(task.dueDate).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 text-accent-green/30 mx-auto mb-2" />
                <p className="text-text-secondary/50 text-sm">
                  All missions complete, Boss.
                </p>
                <p className="text-text-secondary/30 text-xs mt-1">
                  Say &quot;Remind me to...&quot; to add tasks
                </p>
              </div>
            )}
          </div>

          {/* Quick add hint */}
          <div className="mt-4 pt-4 border-t border-panel-border/30">
            <p className="text-text-secondary/40 text-xs text-center">
              Voice commands:
            </p>
            <div className="mt-2 flex flex-wrap gap-2 justify-center">
              {[
                '"What are my tasks?"',
                '"Remind me at 6pm"',
                '"Mark task complete"',
              ].map((cmd, index) => (
                <span
                  key={cmd}
                  className="text-[10px] px-2 py-1 rounded-full bg-panel-glass text-text-secondary/50 hover:bg-reactor-core/20 hover:text-reactor-core transition-colors"
                  style={{ animationDelay: `${index * 0.1}s` }}
                >
                  {cmd}
                </span>
              ))}
            </div>
          </div>
        </div>
      </HolographicPanel>
    </div>
  );
}
