"use client";

// HUD widget rail — the widgets you generated, always visible on the main HUD.
//
// Compact, collapsible, read-only glance cards. Values refresh from the same
// /api/widgets source the panel uses; clicking the header opens the full panel
// where you can edit, add items and delete.
//
// Sits clear of the top-left app dock (the dock owns the first ~110px of the
// screen), so the two never overlap.

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LayoutGrid, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import WidgetCard from "@/components/widgets/WidgetCard";
import type { WidgetSpec } from "@/lib/widgets/spec";
import { useJarvisStore } from "@/store/jarvis.store";

export default function WidgetRail() {
  const [widgets, setWidgets] = useState<WidgetSpec[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const setActivePanel = useJarvisStore((s) => s.setActivePanel);

  const load = useCallback(async (refresh = false) => {
    try {
      const res = await fetch(refresh ? "/api/widgets?refresh=1" : "/api/widgets", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.widgets)) setWidgets(data.widgets);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void load();
    // Live widgets (api/tasks/notes) re-read every 2 minutes; cheap JSON reads.
    const t = setInterval(() => void load(true), 120_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <motion.aside
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
      data-testid="widget-rail"
      className="hidden lg:flex fixed left-4 top-[8.5rem] bottom-28 z-30 flex-col gap-2 w-56 pointer-events-auto"
    >
      {/* The label opens the widgets panel; the chevron only folds the rail.
          This is the desktop's Widgets button — the panel itself holds every
          editor, so there is no separate launcher near the app dock. */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => setActivePanel("widgets")}
          className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/[0.07] bg-black/30 backdrop-blur-md text-[9px] font-orbitron uppercase tracking-widest text-text-secondary/70 hover:text-reactor-core hover:border-reactor-core/35 transition-colors outline-none focus-visible:!outline-none"
          title="Open widgets (build, edit, delete)"
        >
          <LayoutGrid className="w-3 h-3" />
          Widgets
          <span className="ml-auto text-text-secondary/50">{widgets.length}</span>
        </button>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="px-1 py-1 rounded-lg border border-white/[0.07] bg-black/30 backdrop-blur-md text-text-secondary/60 hover:text-reactor-core transition-colors outline-none focus-visible:!outline-none"
          title={collapsed ? "Expand the rail" : "Collapse the rail"}
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </div>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2"
          >
            {widgets.length === 0 && (
              <p className="text-[9px] font-rajdhani text-text-secondary/45 px-2 leading-relaxed">
                No widgets yet — say “build me a panel that tracks …”, or open Widgets above and add a blank one.
              </p>
            )}
            {widgets.slice(0, 6).map((w) => (
              <div key={w.id} onClick={() => setActivePanel("widgets")} className="cursor-pointer" title="Open widgets">
                <WidgetCard widget={w} size="rail" />
              </div>
            ))}
            {widgets.length > 6 && (
              <button
                onClick={() => setActivePanel("widgets")}
                className="w-full text-[9px] font-rajdhani uppercase tracking-widest text-text-secondary/50 hover:text-reactor-core py-1"
              >
                +{widgets.length - 6} more
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.aside>
  );
}
