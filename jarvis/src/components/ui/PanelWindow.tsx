"use client";

/**
 * PanelWindow — every JARVIS panel lives in a movable, resizable window.
 *
 * Panels used to be fixed-size modals: 17 hand-rolled `fixed inset-0` wrappers
 * in page.tsx plus a dozen panels that positioned themselves at a hardcoded
 * `w-[420px] h-[650px]`. This puts all of them in one window frame instead:
 *
 *   - drag the title strip to move it anywhere in the viewport
 *   - drag any of the 8 edges/corners to resize it, down to 320×220
 *   - the geometry is remembered per panel id in localStorage
 *   - double-click the strip to snap back to the default size/position
 *   - clicking a window raises it (no more "everything is modal")
 *
 * The frame deliberately does NOT re-implement each panel's own chrome. A panel
 * that wraps itself in a full-screen overlay keeps that markup; the frame
 * detects it (`firstElementChild.fixed`) and the CSS in globals.css neutralises
 * the fixed positioning so the overlay fills the window instead of the screen.
 * Panel markup therefore needs no changes to become a window — only the mount
 * site in page.tsx changes.
 */

import { AnimatePresence, motion } from "framer-motion";
import { GripHorizontal, Maximize2, Minimize2, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const STORE_KEY = "jarvis:panel-windows:v1";
/** Smallest a window may be dragged to. Chat-heavy panels are unusable below. */
const MIN_W = 320;
const MIN_H = 220;
/** Keep windows off the very edge of the screen. */
const MARGIN = 8;
/** Bands owned by the HUD: the app dock above, the command bar below. */
const TOP_GUARD = 56;
const BOTTOM_GUARD = 88;

export type PanelWindowSize = { w: number; h: number };
type Geometry = { x: number; y: number; w: number; h: number };
type DragState = {
  kind: "move" | "resize";
  dir: string;
  px: number;
  py: number;
  from: Geometry;
};

// Windows stack above the HUD (CommandBar is z-50) but below toasts/overlays.
let zTop = 46;
/** Opens cascade slightly so five windows are never perfectly on top of each other. */
let cascade = 0;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), Math.max(lo, hi));

function area() {
  if (typeof window === "undefined") {
    return { left: MARGIN, top: TOP_GUARD, right: 1280 - MARGIN, bottom: 800 - BOTTOM_GUARD };
  }
  return {
    left: MARGIN,
    top: TOP_GUARD,
    right: window.innerWidth - MARGIN,
    bottom: window.innerHeight - BOTTOM_GUARD,
  };
}

function fit(g: Geometry): Geometry {
  const a = area();
  const w = clamp(g.w, MIN_W, Math.max(MIN_W, a.right - a.left));
  const h = clamp(g.h, MIN_H, Math.max(MIN_H, a.bottom - a.top));
  return {
    w,
    h,
    x: clamp(g.x, a.left, Math.max(a.left, a.right - w)),
    y: clamp(g.y, a.top, Math.max(a.top, a.bottom - h)),
  };
}

function readAll(): Record<string, Geometry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, Geometry>) : {};
  } catch {
    return {};
  }
}

function persist(id: string, g: Geometry) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ ...readAll(), [id]: g }));
  } catch {
    // Storage full or disabled — the window still works, it just forgets.
  }
}

function defaultGeometry(size?: PanelWindowSize, stagger = 0): Geometry {
  const a = area();
  const availW = Math.max(MIN_W, a.right - a.left);
  const availH = Math.max(MIN_H, a.bottom - a.top);
  const w = clamp(size?.w ?? 860, MIN_W, availW);
  const h = clamp(size?.h ?? 620, MIN_H, availH);
  return fit({
    w,
    h,
    x: a.left + Math.max(0, (availW - w) / 2) + stagger,
    y: a.top + Math.max(0, (availH - h) / 2) + stagger,
  });
}

const HANDLES: Array<[string, string]> = [
  ["n", "top-0 left-2 right-2 h-1.5 cursor-ns-resize"],
  ["s", "bottom-0 left-2 right-2 h-1.5 cursor-ns-resize"],
  ["w", "left-0 top-2 bottom-2 w-1.5 cursor-ew-resize"],
  ["e", "right-0 top-2 bottom-2 w-1.5 cursor-ew-resize"],
  ["nw", "top-0 left-0 w-3 h-3 cursor-nwse-resize"],
  ["ne", "top-0 right-0 w-3 h-3 cursor-nesw-resize"],
  ["sw", "bottom-0 left-0 w-3 h-3 cursor-nesw-resize"],
  ["se", "bottom-0 right-0 w-3 h-3 cursor-nwse-resize"],
];

function WindowFrame({
  id,
  title,
  size,
  showClose,
  onClose,
  children,
}: {
  id: string;
  title?: string;
  size?: PanelWindowSize;
  showClose: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  /** The rect currently painted. Authoritative during a drag, when React is not re-rendering. */
  const liveRef = useRef<Geometry | null>(null);

  const [geo, setGeo] = useState<Geometry | null>(null);
  const [z, setZ] = useState(0);
  const [active, setActive] = useState(false);
  const [overlay, setOverlay] = useState(false);
  /** Filling the available area; the previous rect is kept for restore. */
  const [maximized, setMaximized] = useState(false);
  const restoreRef = useRef<Geometry | null>(null);

  const paint = useCallback((g: Geometry) => {
    const el = frameRef.current;
    if (!el) return;
    el.style.left = `${g.x}px`;
    el.style.top = `${g.y}px`;
    el.style.width = `${g.w}px`;
    el.style.height = `${g.h}px`;
  }, []);

  const commit = useCallback(
    (g: Geometry) => {
      liveRef.current = g;
      setGeo(g);
      persist(id, g);
    },
    [id]
  );

  // Restore the previous geometry (or start centred), then raise this window.
  useLayoutEffect(() => {
    const stored = readAll()[id];
    const g = stored ? fit(stored) : defaultGeometry(size, (cascade++ % 5) * 26);
    liveRef.current = g;
    setGeo(g);
    setZ(++zTop);
    paint(g);
    // `size` is the panel's preferred starting size; it must not re-position a
    // window the user has already placed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // A panel that wraps itself in a full-screen overlay still needs the CSS that
  // collapses that overlay into the window body. Detect it instead of asking 16
  // panels to declare it. `geo` is in the deps because the body does not exist
  // until the first geometry lands.
  useLayoutEffect(() => {
    const first = bodyRef.current?.firstElementChild;
    setOverlay(!!first && first.classList.contains("fixed"));
  }, [children, geo]);

  // Keep every window on screen when the browser window changes size.
  useEffect(() => {
    const onResize = () => {
      const cur = liveRef.current;
      if (!cur) return;
      const g = fit(cur);
      paint(g);
      commit(g);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [paint, commit]);

  const bringToFront = useCallback(() => {
    setZ(++zTop);
  }, []);

  const beginDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, kind: "move" | "resize", dir = "") => {
      if (e.button !== 0) return;
      const from = liveRef.current;
      if (!from) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Older/synthetic pointers may not support capture; the frame still
        // receives the moves through bubbling.
      }
      dragRef.current = { kind, dir, px: e.clientX, py: e.clientY, from };
      setActive(true);
      setZ(++zTop);
    },
    []
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const a = area();
      const dx = e.clientX - d.px;
      const dy = e.clientY - d.py;
      let next: Geometry;

      if (d.kind === "move") {
        next = {
          ...d.from,
          x: clamp(d.from.x + dx, a.left, Math.max(a.left, a.right - d.from.w)),
          y: clamp(d.from.y + dy, a.top, Math.max(a.top, a.bottom - d.from.h)),
        };
      } else {
        let left = d.from.x;
        let top = d.from.y;
        let right = d.from.x + d.from.w;
        let bottom = d.from.y + d.from.h;

        if (d.dir.includes("e")) right = clamp(right + dx, left + MIN_W, a.right);
        if (d.dir.includes("s")) bottom = clamp(bottom + dy, top + MIN_H, a.bottom);
        if (d.dir.includes("w")) left = clamp(left + dx, a.left, right - MIN_W);
        if (d.dir.includes("n")) top = clamp(top + dy, a.top, bottom - MIN_H);

        next = { x: left, y: top, w: right - left, h: bottom - top };
      }

      liveRef.current = next;
      paint(next);
    },
    [paint]
  );

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setActive(false);
    if (liveRef.current) commit(liveRef.current);
  }, [commit]);

  const resetGeometry = useCallback(() => {
    const g = defaultGeometry(size, 0);
    setMaximized(false);
    restoreRef.current = null;
    paint(g);
    commit(g);
  }, [size, paint, commit]);

  /**
   * Fill the usable area (between the HUD bands) and back again.
   *
   * Panels with real content — the meeting bot's notes, galleries and Q&A — need
   * the whole screen sometimes. Maximising deliberately does not overwrite the
   * remembered geometry, so restoring returns the window exactly where it was.
   */
  const toggleMaximize = useCallback(() => {
    if (!maximized) {
      const a = area();
      restoreRef.current = liveRef.current;
      const g = fit({ x: a.left, y: a.top, w: a.right - a.left, h: a.bottom - a.top });
      liveRef.current = g;
      setGeo(g);
      paint(g);
      setMaximized(true);
      setZ(++zTop);
      return;
    }
    const previous = restoreRef.current || defaultGeometry(size, 0);
    restoreRef.current = null;
    liveRef.current = previous;
    setMaximized(false);
    paint(previous);
    commit(previous);
  }, [maximized, size, paint, commit]);

  if (!geo) return null;

  // While a drag is in flight React must paint the live rect, not the last
  // committed one — otherwise any incidental re-render snaps the window back.
  const rect = dragRef.current && liveRef.current ? liveRef.current : geo;

  // The frame itself deliberately does NOT use `overflow-hidden`: that also
  // clips hit-testing, which made the corner resize handles dead inside the
  // 12px border radius. The strip and the body round/clip themselves instead.
  return (
    <motion.div
      ref={frameRef}
      role="dialog"
      aria-label={title ?? id}
      aria-modal="false"
      data-panel-window={id}
      data-panel-active={active ? "true" : "false"}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.13 } }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "fixed",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex: z,
      }}
      onPointerDownCapture={bringToFront}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`flex flex-col rounded-xl border bg-[#02060c]/92 backdrop-blur-2xl transition-[border-color,box-shadow] duration-200 ${
        active
          ? "border-reactor-core/45 shadow-[0_0_38px_rgba(0,212,255,0.18),0_26px_80px_-24px_rgba(0,0,0,0.95)]"
          : "border-reactor-core/20 shadow-[0_18px_60px_-24px_rgba(0,0,0,0.9)]"
      }`}
    >
      {/* Title strip — also the window's URL bar: drag here, double-click to
          snap back to the default size. */}
      <div
        data-panel-window-strip
        onPointerDown={(e) => beginDrag(e, "move")}
        onDoubleClick={resetGeometry}
        title="Drag to move · double-click to reset"
        className="flex h-7 shrink-0 cursor-grab touch-none select-none items-center gap-2 rounded-t-xl border-b border-reactor-core/15 bg-black/45 px-2 active:cursor-grabbing"
      >
        <GripHorizontal className="h-3 w-3 shrink-0 text-reactor-core/45" />
        {title && (
          <span className="truncate font-orbitron text-[9px] uppercase tracking-[0.22em] text-text-secondary/70">
            {title}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={toggleMaximize}
          aria-label={maximized ? `Restore ${title ?? id}` : `Maximize ${title ?? id}`}
          data-panel-maximize
          className="rounded p-0.5 text-text-secondary/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          {maximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
        </button>
        {showClose && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            aria-label={`Close ${title ?? id}`}
            className="rounded p-0.5 text-text-secondary/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* The panel itself. `data-panel-fill` tells globals.css whether the first
          child is a full-screen overlay that has to be collapsed into the
          window, or a panel that can simply fill it. */}
      <div
        ref={bodyRef}
        data-panel-window-body
        data-panel-fill={overlay ? "overlay" : "self"}
        className="relative min-h-0 flex-1 overflow-hidden rounded-b-xl"
      >
        {children}
      </div>

      {HANDLES.map(([dir, cls]) => (
        <div
          key={dir}
          data-panel-resize={dir}
          onPointerDown={(e) => beginDrag(e, "resize", dir)}
          className={`absolute z-30 touch-none ${cls}`}
        />
      ))}
    </motion.div>
  );
}

export default function PanelWindow({
  id,
  title,
  open,
  onClose,
  size,
  showClose = true,
  keepMounted = false,
  children,
}: {
  /** Stable key for the saved geometry and the e2e hooks. */
  id: string;
  title?: string;
  open: boolean;
  onClose: () => void;
  /** Preferred size the first time the window opens. */
  size?: PanelWindowSize;
  /** Panels that already render their own ✕ pass false. */
  showClose?: boolean;
  /**
   * Keep the panel mounted while the window is hidden. For panels whose own
   * effects have to keep running while closed (the Command Deck watches for new
   * tasks and re-opens itself).
   */
  keepMounted?: boolean;
  children: ReactNode;
}) {
  const frame = (
    <WindowFrame
      key={id}
      id={id}
      title={title}
      size={size}
      showClose={showClose}
      onClose={onClose}
    >
      {children}
    </WindowFrame>
  );

  if (keepMounted) {
    return <div style={{ display: open ? undefined : "none" }}>{frame}</div>;
  }

  return <AnimatePresence>{open && frame}</AnimatePresence>;
}
