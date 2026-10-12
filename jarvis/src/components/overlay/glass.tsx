"use client";

// Glass primitives for the stealth overlay.
//
// The overlay floats over a live call, so every surface is a frosted layer over
// the desktop rather than a solid panel: translucent white fill, a light
// border, an inner top highlight, and a real backdrop blur. Keeping the recipe
// in one place is what makes the whole HUD feel like ONE system instead of a
// pile of boxes — and it means a tweak to the glass lands everywhere.
//
// `-webkit-app-region: no-drag` is applied to everything interactive: the
// header is the window's drag handle (see overlay/main.js), and a control
// without that rule would silently turn into a window-drag region.

import type { ReactNode } from "react";

export const NO_DRAG = "[-webkit-app-region:no-drag]";

/** The base frosted surface. */
export const GLASS =
  "relative rounded-2xl border border-white/[0.12] bg-white/[0.055] backdrop-blur-2xl backdrop-saturate-150 " +
  "shadow-[0_8px_32px_rgba(0,0,0,0.38)]";

/** A hairline highlight along the top edge — the cue that reads as "glass". */
export const GLASS_SHEEN =
  "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px " +
  "before:bg-gradient-to-r before:from-transparent before:via-white/35 before:to-transparent";

/** Frosted pill button. `active` fills it with the reactor accent. */
export function GlassButton({
  children,
  onClick,
  title,
  active,
  disabled,
  tone = "neutral",
  size = "md",
  className = "",
  type = "button",
  dataAttr,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  tone?: "neutral" | "accent" | "danger" | "success";
  size?: "xs" | "sm" | "md";
  className?: string;
  type?: "button" | "submit";
  dataAttr?: string;
}) {
  const height = size === "md" ? "h-8" : size === "sm" ? "h-7" : "h-6";
  const pad = size === "md" ? "px-3" : "px-2.5";
  const text = size === "xs" ? "text-[9px]" : "text-[10px]";
  const filled = active
    ? tone === "danger"
      ? "bg-accent-red/25 border-accent-red/60 text-accent-red"
      : tone === "success"
      ? "bg-accent-green/20 border-accent-green/50 text-accent-green"
      : "bg-reactor-core/20 border-reactor-core/60 text-reactor-core"
    : "bg-white/[0.06] border-white/[0.12] text-text-secondary/80 hover:bg-white/[0.12] hover:text-text-primary";
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      disabled={disabled}
      data-attr={dataAttr}
      className={`${NO_DRAG} shrink-0 inline-flex items-center justify-center gap-1.5 rounded-full border ${height} ${pad} ${text} font-rajdhani tracking-[0.12em] transition-all duration-150 active:scale-[0.97] disabled:opacity-30 disabled:pointer-events-none ${filled} ${className}`}
    >
      {children}
    </button>
  );
}

/** Small square icon button (header controls). */
export function GlassIcon({
  children,
  onClick,
  title,
  active,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`${NO_DRAG} shrink-0 grid place-items-center w-7 h-7 rounded-full border transition-all duration-150 active:scale-95 ${
        active
          ? "border-reactor-core/60 bg-reactor-core/20 text-reactor-core"
          : "border-white/[0.12] bg-white/[0.05] text-text-secondary/70 hover:bg-white/[0.12] hover:text-text-primary"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** A live audio level meter.
 *
 * Deliberately NOT driven by React state: a meter that re-renders the tree
 * eleven times a second while an answer is streaming is exactly how a HUD stops
 * feeling fast. The parent writes to `barRef.current.style.transform` from the
 * capture callback and React never sees it. */
export function LevelMeter({
  label,
  barRef,
  dotRef,
  tone = "accent",
}: {
  label: string;
  barRef?: React.RefObject<HTMLDivElement>;
  dotRef?: React.RefObject<HTMLSpanElement>;
  tone?: "accent" | "danger" | "success";
}) {
  const colour = tone === "danger" ? "bg-accent-red" : tone === "success" ? "bg-accent-green" : "bg-reactor-core";
  return (
    <div className={`${NO_DRAG} flex items-center gap-1.5`}>
      <span
        ref={dotRef}
        className="w-1.5 h-1.5 rounded-full bg-white/25 transition-colors duration-150"
        data-vad="idle"
      />
      <span className="font-rajdhani text-[9px] tracking-[0.14em] text-text-secondary/60 w-[3.2rem]">
        {label}
      </span>
      <span className="relative block w-14 h-1 rounded-full bg-white/10 overflow-hidden">
        <span
          ref={barRef}
          className={`absolute inset-y-0 left-0 w-full origin-left ${colour} rounded-full`}
          style={{ transform: "scaleX(0)", transition: "transform 90ms linear" }}
        />
      </span>
    </div>
  );
}

/** A tick-box used by the proactive-trigger settings. */
export function GlassToggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      title={detail}
      className={`${NO_DRAG} w-full flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-colors ${
        checked ? "border-reactor-core/40 bg-reactor-core/10" : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07]"
      }`}
    >
      <span
        className={`w-3.5 h-3.5 rounded-[5px] border grid place-items-center text-[9px] leading-none ${
          checked ? "border-reactor-core/70 bg-reactor-core/30 text-reactor-core" : "border-white/20 text-transparent"
        }`}
      >
        ✓
      </span>
      <span className="font-rajdhani text-[10px] tracking-wide text-text-primary/85">{label}</span>
    </button>
  );
}

/** The frosted sheet used for the privacy / brain / keys panel and the mode
 * picker. Rendered in-flow (not a portal) — the window is small and a fixed
 * sheet would fight the layout. */
export function GlassSheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className={`${GLASS} ${GLASS_SHEEN} ${NO_DRAG} mt-2 p-3`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="font-orbitron text-[9px] tracking-[0.3em] text-reactor-core/80">{title}</span>
        <GlassIcon onClick={onClose} title="Close panel" className="ml-auto">
          ✕
        </GlassIcon>
      </div>
      <div className="space-y-2.5 max-h-[46vh] overflow-y-auto overscroll-contain pr-0.5">{children}</div>
      {footer ? <div className="mt-2.5">{footer}</div> : null}
    </div>
  );
}
