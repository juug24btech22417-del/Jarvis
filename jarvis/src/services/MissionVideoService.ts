// Mission → cinematic video brief (brag-grade, themed).
//
// Not a slide deck: one running timeline where every frame moves. Camera
// pushes/pans on every shot, whip/punch/glitch/wipe cuts between shots,
// full-bleed mission screenshots with Ken Burns, counting readouts, animated
// data bars, a continuous ticker, film grain, letterbox and a music bed with
// SFX on the cuts.
//
// Every brief picks a THEME deterministically from the mission id — palette,
// typography, texture, motion character, cut bias, audio and hook layout all
// change, so two missions never look like the same video. The visuals are also
// audio-reactive: the music is routed through a WebAudio analyser that drives
// the glow pulse and the EQ strip (graceful no-op if WebAudio is unavailable).
//
// NO narration: briefs are read, not spoken.
//
// For a true rendered MP4, point the HyperFrames/brag CLI at the returned HTML.

import fs from "fs";
import path from "path";
import type { AgentJob } from "@/lib/agent/types";
import { saveArtifact } from "@/lib/agent/artifacts";

/* ─────────────────────────── themes ─────────────────────────── */

export type Cut = "whip" | "punch" | "glitch" | "wipe" | "cut";

/** How the big type arrives — the loudest per-theme difference. */
export type TitleEnter = "slam" | "decode" | "type" | "rise" | "dissolve" | "stack";

export interface VideoTheme {
  id: string;
  name: string;
  /** Three accent pairs, cycled across shots. */
  accents: Array<[string, string]>;
  palette: {
    bg1: string;
    bg2: string;
    bg3: string;
    text: string;
    muted: string;
    panel: string;
    border: string;
    rule: string;
  };
  font: {
    display: string;
    body: string;
    kicker: string;
    displayWeight: number;
    displayTracking: string;
    kickerTracking: string;
    uppercaseKicker: boolean;
    uppercaseTitle: boolean;
  };
  texture: {
    grid: "grid" | "dots" | "none" | "scanlines";
    gridColor: string;
    grain: number;
    letterbox: string;
    radius: number;
    glow: number;
    vignette: number;
  };
  motion: {
    /** Multiplier on camera travel. */
    energy: number;
    /** Preferred cut types, cycled. */
    cuts: Cut[];
  };
  audio: { sfxSet: "interface" | "ui"; volume: number };
  hook: "center" | "left" | "split";
  /** Title personality: entrance move + whether the gradient fill is used. */
  title: { enter: TitleEnter; gradient: boolean };
}

const SERIF = `'Iowan Old Style','Palatino Linotype','Book Antiqua',Georgia,serif`;
const MONO = `'JetBrains Mono','SF Mono',Consolas,'Courier New',monospace`;
const SANS = `'Inter','SF Pro Display','Segoe UI',system-ui,sans-serif`;
const ROUND = `'SF Pro Rounded','Nunito','Segoe UI',system-ui,sans-serif`;
const CONDENSED = `'Arial Narrow','Roboto Condensed',Impact,'Haettenschweiler',sans-serif`;
const DIDOT = `'Didot','Bodoni MT','Playfair Display',Georgia,serif`;

export const VIDEO_THEMES: VideoTheme[] = [
  {
    id: "neo-cyan",
    name: "JARVIS HUD",
    accents: [
      ["#00f3ff", "#7c5cff"],
      ["#5ffbff", "#00a3ff"],
      ["#22d3ee", "#a78bfa"],
    ],
    palette: {
      bg1: "#061324",
      bg2: "#03060d",
      bg3: "rgba(0,243,255,.20)",
      text: "#eafbff",
      muted: "#7fa8bd",
      panel: "rgba(0,243,255,.10)",
      border: "rgba(0,243,255,.24)",
      rule: "linear-gradient(90deg,#00f3ff,#5ffbff,transparent)",
    },
    font: { display: SANS, body: SANS, kicker: MONO, displayWeight: 850, displayTracking: "-.03em", kickerTracking: ".5em", uppercaseKicker: true, uppercaseTitle: false },
    texture: { grid: "grid", gridColor: "rgba(0,243,255,.30)", grain: 0.055, letterbox: "3.2vh", radius: 18, glow: 1, vignette: 0.9 },
    motion: { energy: 1, cuts: ["whip", "punch", "glitch"] },
    audio: { sfxSet: "interface", volume: 0.5 },
    hook: "left",
    title: { enter: "decode", gradient: true },
  },
  {
    id: "editorial",
    name: "Editorial",
    accents: [
      ["#f2e9dc", "#c9a227"],
      ["#f7f3ec", "#9a8f7a"],
      ["#e8dcc8", "#c9a227"],
    ],
    palette: {
      bg1: "#0c0b09",
      bg2: "#050505",
      bg3: "rgba(201,162,39,.10)",
      text: "#f5efe4",
      muted: "#9c9384",
      panel: "rgba(245,239,228,.05)",
      border: "rgba(245,239,228,.16)",
      rule: "linear-gradient(90deg,#c9a227,transparent)",
    },
    font: { display: SERIF, body: SERIF, kicker: SANS, displayWeight: 600, displayTracking: "-.01em", kickerTracking: ".42em", uppercaseKicker: true, uppercaseTitle: false },
    texture: { grid: "none", gridColor: "transparent", grain: 0.035, letterbox: "5vh", radius: 4, glow: 0.35, vignette: 1 },
    motion: { energy: 0.55, cuts: ["wipe", "cut", "punch"] },
    audio: { sfxSet: "interface", volume: 0.38 },
    hook: "center",
    title: { enter: "rise", gradient: false },
  },
  {
    id: "sunset",
    name: "Sunset Pop",
    accents: [
      ["#ffb37a", "#ff5d8f"],
      ["#ffd6a5", "#ff8fab"],
      ["#ffe0b2", "#c084fc"],
    ],
    palette: {
      bg1: "#3b1046",
      bg2: "#12061d",
      bg3: "rgba(255,93,143,.22)",
      text: "#fff6f0",
      muted: "#e0b7c8",
      panel: "rgba(255,255,255,.08)",
      border: "rgba(255,255,255,.18)",
      rule: "linear-gradient(90deg,#ffb37a,#ff5d8f,transparent)",
    },
    font: { display: ROUND, body: SANS, kicker: ROUND, displayWeight: 800, displayTracking: "-.02em", kickerTracking: ".34em", uppercaseKicker: true, uppercaseTitle: false },
    texture: { grid: "dots", gridColor: "rgba(255,255,255,.16)", grain: 0.05, letterbox: "2vh", radius: 30, glow: 1.15, vignette: 0.75 },
    motion: { energy: 1.15, cuts: ["punch", "punch", "whip"] },
    audio: { sfxSet: "ui", volume: 0.5 },
    hook: "center",
    title: { enter: "slam", gradient: true },
  },
  {
    id: "terminal",
    name: "CRT Terminal",
    accents: [
      ["#5cff9d", "#0affc3"],
      ["#a8ff60", "#5cff9d"],
      ["#7dffb0", "#00d4a0"],
    ],
    palette: {
      bg1: "#020703",
      bg2: "#000000",
      bg3: "rgba(92,255,157,.16)",
      text: "#d9ffe8",
      muted: "#6fbf8c",
      panel: "rgba(92,255,157,.08)",
      border: "rgba(92,255,157,.26)",
      rule: "linear-gradient(90deg,#5cff9d,transparent)",
    },
    font: { display: MONO, body: MONO, kicker: MONO, displayWeight: 700, displayTracking: ".02em", kickerTracking: ".34em", uppercaseKicker: true, uppercaseTitle: true },
    texture: { grid: "scanlines", gridColor: "rgba(92,255,157,.14)", grain: 0.09, letterbox: "2.4vh", radius: 2, glow: 1.25, vignette: 0.95 },
    motion: { energy: 0.8, cuts: ["glitch", "cut", "glitch"] },
    audio: { sfxSet: "interface", volume: 0.45 },
    hook: "left",
    title: { enter: "type", gradient: false },
  },
  {
    id: "luxe",
    name: "Noir Luxe",
    accents: [
      ["#e8d6a4", "#b8923f"],
      ["#f3e7c9", "#c9a227"],
      ["#dcc98f", "#8f7431"],
    ],
    palette: {
      bg1: "#0a1020",
      bg2: "#04060c",
      bg3: "rgba(232,214,164,.12)",
      text: "#f6f1e4",
      muted: "#8f8a7a",
      panel: "rgba(232,214,164,.06)",
      border: "rgba(232,214,164,.22)",
      rule: "linear-gradient(90deg,#e8d6a4,transparent)",
    },
    font: { display: DIDOT, body: SANS, kicker: SANS, displayWeight: 500, displayTracking: ".02em", kickerTracking: ".5em", uppercaseKicker: true, uppercaseTitle: false },
    texture: { grid: "none", gridColor: "transparent", grain: 0.03, letterbox: "6vh", radius: 2, glow: 0.5, vignette: 1.05 },
    motion: { energy: 0.45, cuts: ["cut", "wipe", "cut"] },
    audio: { sfxSet: "ui", volume: 0.35 },
    hook: "center",
    title: { enter: "dissolve", gradient: false },
  },
  {
    id: "kinetic",
    name: "Kinetic Poster",
    accents: [
      ["#ffe9d6", "#ff3b30"],
      ["#ffd166", "#ff3b30"],
      ["#f5f0e6", "#1d4ed8"],
    ],
    palette: {
      bg1: "#141414",
      bg2: "#0a0a0a",
      bg3: "rgba(255,59,48,.18)",
      text: "#fff8f0",
      muted: "#b9b3ab",
      panel: "rgba(255,255,255,.07)",
      border: "rgba(255,255,255,.22)",
      rule: "linear-gradient(90deg,#ff3b30,#ffd166,transparent)",
    },
    font: { display: CONDENSED, body: SANS, kicker: CONDENSED, displayWeight: 900, displayTracking: "-.01em", kickerTracking: ".3em", uppercaseKicker: true, uppercaseTitle: true },
    texture: { grid: "none", gridColor: "transparent", grain: 0.04, letterbox: "2.2vh", radius: 6, glow: 0.85, vignette: 0.8 },
    motion: { energy: 1.3, cuts: ["punch", "cut", "whip"] },
    audio: { sfxSet: "ui", volume: 0.52 },
    hook: "split",
    title: { enter: "stack", gradient: false },
  },
];

function hashOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < (seed || "").length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic theme pick so re-rendering a mission stays consistent. */
export function pickTheme(seed: string, explicit?: string): VideoTheme {
  if (explicit) {
    const found = VIDEO_THEMES.find((t) => t.id === explicit);
    if (found) return found;
  }
  return VIDEO_THEMES[hashOf(seed) % VIDEO_THEMES.length];
}

/* Recently used looks, so back-to-back briefs never repeat a template. */
const THEME_LEDGER = path.join(process.cwd(), ".jarvis-data", "brief-themes.json");

export function readThemeLedger(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(THEME_LEDGER, "utf8")) as { recent?: unknown };
    return Array.isArray(raw.recent) ? raw.recent.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function rememberTheme(id: string): void {
  try {
    const next = [id, ...readThemeLedger().filter((t) => t !== id)].slice(0, VIDEO_THEMES.length - 1);
    fs.mkdirSync(path.dirname(THEME_LEDGER), { recursive: true });
    fs.writeFileSync(THEME_LEDGER, JSON.stringify({ recent: next }, null, 2), "utf8");
  } catch {
    // A missing ledger only costs us rotation, never a render.
  }
}

/**
 * Pick a theme for a brief, skipping the looks used by recent briefs, then
 * remember the choice. Two consecutive briefs therefore never share a
 * template — different palette, typography, texture and motion every time.
 */
export function pickFreshTheme(seed: string, explicit?: string): VideoTheme {
  if (explicit) {
    const found = VIDEO_THEMES.find((t) => t.id === explicit);
    if (found) return found;
  }
  const recent = readThemeLedger();
  const unused = VIDEO_THEMES.filter((t) => !recent.includes(t.id));
  const pool = unused.length ? unused : VIDEO_THEMES;
  const chosen = pool[hashOf(`${seed}:${recent.length}`) % pool.length];
  rememberTheme(chosen.id);
  return chosen;
}

/* ─────────────────────────── audio ─────────────────────────── */

const MUSIC_TRACKS = [
  "happy-beats-business-moves-vol-1-by-ende-dot-app.mp3",
  "happy-beats-business-moves-vol-9-by-ende-dot-app.mp3",
  "happy-beats-business-moves-vol-10-by-ende-dot-app.mp3",
  "happy-beats-business-moves-vol-11-by-ende-dot-app.mp3",
  "happy-beats-business-moves-vol-12-by-ende-dot-app.mp3",
];

const SFX_SETS = {
  interface: {
    click: "sfx/interface/click_002.ogg",
    switch: "sfx/interface/switch_004.ogg",
    bong: "sfx/interface/bong_001.ogg",
    glitch: "sfx/interface/glitch_002.ogg",
    drop: "sfx/interface/drop_003.ogg",
  },
  ui: {
    click: "sfx/ui/click3.ogg",
    switch: "sfx/ui/switch5.ogg",
    bong: "sfx/ui/switch12.ogg",
    glitch: "sfx/ui/rollover2.ogg",
    drop: "sfx/ui/switch1.ogg",
  },
} as const;

export type SfxCue = keyof (typeof SFX_SETS)["interface"];

function assetUrl(baseUrl: string, relPath: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/agent/brag-asset?file=${encodeURIComponent(relPath)}`;
}

function artifactUrl(baseUrl: string, absPath: string): string {
  return `${baseUrl.replace(/\/$/, "")}/api/agent/artifact?path=${encodeURIComponent(absPath)}`;
}

/* ─────────────────────────── storyboard ─────────────────────────── */

export type ShotKind = "hook" | "fullbleed" | "reveal" | "metrics" | "highlight" | "artifacts" | "outro";
export type Camera = "in" | "out" | "panLeft" | "panRight" | "punch";

export interface Metric {
  label: string;
  display: string;
  weight: number;
}

export interface VideoScene {
  kind: ShotKind;
  kicker: string;
  heading: string;
  lines: string[];
  stats?: Array<{ label: string; value: string }>;
  metrics?: Metric[];
  image?: string;
  cam: Camera;
  cut: Cut;
  durationMs: number;
  /** Absolute start of the shot on the (beat-quantised) timeline. */
  startMs?: number;
  /** True when this shot's cut landed on a strong music cue. */
  strong?: boolean;
  sfx: SfxCue;
  accent: [string, string];
}

export interface Slide {
  kind: "title" | "bullet" | "quote" | "outro";
  heading: string;
  lines: string[];
}

/* ─────────────────────────── beat grid ─────────────────────────── */

/**
 * The brag asset library ships a cue file per track (tempo, detected beats and
 * the strong cues worth landing a cut on). Quantising the cut list onto that
 * grid is the difference between a video that merely plays music and one that
 * feels *edited* to it. If the cue file is missing we synthesise an even grid
 * so the rhythm still holds.
 */
export interface BeatGrid {
  tempo: number;
  /** Absolute beat times in ms, ascending. */
  beats: number[];
  /** Subset of beats that are worth landing a cut on (ms). */
  strong: number[];
  source: "cue" | "fallback";
}

const CUE_CACHE = new Map<string, BeatGrid>();

/** Pure: turn a brag `.music-cues.json` payload into a grid (null if unusable). */
export function parseCueJson(raw: unknown): BeatGrid | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as { tempo?: unknown; beats?: unknown; strongCues?: unknown };
  const rows = Array.isArray(data.beats) ? data.beats : [];
  const beats = rows
    .map((b) => (typeof b === "number" ? b : Number((b as { time?: unknown })?.time)))
    .filter((t) => Number.isFinite(t) && t >= 0)
    .map((t) => Math.round(t * 1000))
    .sort((a, b) => a - b)
    .filter((t, i, arr) => i === 0 || t > arr[i - 1]);
  if (beats.length < 8) return null;
  const strongRows = Array.isArray(data.strongCues) ? data.strongCues : [];
  const strong = strongRows
    .map((b) => Number((b as { time?: unknown })?.time))
    .filter((t) => Number.isFinite(t) && t >= 0)
    .map((t) => Math.round(t * 1000))
    .sort((a, b) => a - b);
  return { tempo: Number(data.tempo) || 120, beats, strong, source: "cue" };
}

function bragAssetsRoot(): string | null {
  const roots = [
    path.join(process.cwd(), "..", ".agents", "skills", "brag", "assets"),
    path.join(process.cwd(), ".agents", "skills", "brag", "assets"),
    process.env.BRAG_ASSETS_DIR ?? "",
  ];
  for (const r of roots) {
    if (!r) continue;
    try {
      if (fs.existsSync(r)) return path.resolve(r);
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Cue grid for a music file, falling back to an even 120bpm grid. */
export function loadBeatGrid(track: string): BeatGrid {
  const cached = CUE_CACHE.get(track);
  if (cached) return cached;
  let grid: BeatGrid | null = null;
  try {
    const root = bragAssetsRoot();
    if (root) {
      const cue = path.join(root, "music", "cues", `${track.replace(/\.mp3$/i, "")}.music-cues.json`);
      if (fs.existsSync(cue)) grid = parseCueJson(JSON.parse(fs.readFileSync(cue, "utf8")));
    }
  } catch {
    grid = null;
  }
  if (!grid) {
    grid = {
      tempo: 120,
      beats: Array.from({ length: 160 }, (_, i) => i * 500),
      strong: [],
      source: "fallback",
    };
  }
  CUE_CACHE.set(track, grid);
  return grid;
}

function beatsFor(kind: ShotKind, authored: number, beat: number): number {
  const min = kind === "hook" ? 3 : 2;
  const max = kind === "hook" || kind === "reveal" ? 8 : 7;
  const want = Math.round(authored / beat) || min;
  return Math.min(max, Math.max(min, want));
}

/**
 * Re-time the storyboard so every cut lands on a beat. The hook holds until
 * the track's first beat (tracks usually open with a bar of intro), then each
 * shot runs a whole number of beats.
 */
export function snapScenesToBeats(scenes: VideoScene[], grid: BeatGrid): VideoScene[] {
  const beats = grid.beats;
  if (!scenes.length || beats.length < 4) return scenes;
  const beat = Math.round(60000 / (grid.tempo || 120));
  const nearest = (t: number) =>
    beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0]);
  const out: VideoScene[] = [];
  let cursor = 0;
  for (const s of scenes) {
    const take = beatsFor(s.kind, s.durationMs, beat);
    let end = nearest(cursor + take * beat);
    if (end <= cursor) end = cursor + beat * Math.max(2, take);
    const startMs = cursor;
    cursor = end;
    out.push({
      ...s,
      startMs,
      durationMs: end - startMs,
      strong: grid.strong.some((t) => Math.abs(t - startMs) < 120),
    });
  }
  return out;
}

function stripMarkdown(s: string): string {
  return (s || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/^\s*[-*•]\s+/gm, "")
    .trim();
}

function toLines(body: string, max = 3): string[] {
  return stripMarkdown(body)
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2 && !/^[-–—•]+$/.test(l))
    .map((l) => (l.length > 108 ? `${l.slice(0, 105)}…` : l))
    .slice(0, max);
}

function hookLine(goal: string): string {
  const g = (goal || "Mission").replace(/\s+/g, " ").trim();
  if (g.length <= 42) return g;
  return `${g.slice(0, 39)}…`;
}

/**
 * Headline for the hook shot. The brag law is "no generic language": strip the
 * command filler so the big type reads like a claim, not a request.
 */
export function hookHeadline(goal: string): string {
  const raw = (goal || "Mission").replace(/\s+/g, " ").trim();
  const stripped = raw
    .replace(/^(please\s+|hey\s+jarvis[,:]?\s+|jarvis[,:]?\s+|can you\s+|could you\s+|i want (you )?to\s+)/i, "")
    .replace(
      /^(research|analyse|analyze|summari[sz]e|compare|investigate|evaluate|assess|review|compile|gather|write|draft|build|make|create|set up|track|check|find|look up|search for|get|tell me)\s+(me\s+)?(a|an|the|my|some)?\s*/i,
      ""
    )
    .trim();
  const base = stripped.length > 6 ? stripped : raw;
  if (base.length <= 46) return base;
  const cut = base.slice(0, 46);
  const sp = cut.lastIndexOf(" ");
  return `${sp > 22 ? cut.slice(0, sp) : cut}…`;
}

function stepBody(job: AgentJob, stepId: string): string {
  const r = job.results.find((x) => x.stepId === stepId);
  const out = r?.result as Record<string, unknown> | undefined;
  if (typeof out?.summary === "string") return out.summary;
  if (typeof out?.content === "string") return out.content;
  if (typeof out?.markdown === "string") return out.markdown;
  if (typeof out?.answer === "string") return out.answer;
  return "";
}

function elapsedLabel(job: AgentJob): string {
  if (!job.startedAt || !job.finishedAt) return "—";
  const s = Math.max(1, Math.round((job.finishedAt - job.startedAt) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Pull comparable numbers out of the findings so a metrics shot can animate them. */
export function extractMetrics(lines: string[]): Metric[] {
  const found: Array<{ label: string; display: string; num: number }> = [];
  for (const line of lines) {
    const m = line.match(/(?:₹|Rs\.?|\$|€|£|\bINR\b)?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|x|×|k|m|b|gb|mb|kb|ms|s|min|hrs?|hours?|points?|stars?|₹)?/i);
    if (!m) continue;
    const num = parseFloat(m[1].replace(/,/g, ""));
    if (!isFinite(num) || num <= 0) continue;
    found.push({ label: line.replace(/\s+/g, " ").slice(0, 54), display: m[1] + (m[2] ? ` ${m[2]}` : ""), num });
    if (found.length >= 4) break;
  }
  if (found.length < 2) return [];
  const max = Math.max(...found.map((f) => f.num));
  return found.map((f) => ({ label: f.label, display: f.display, weight: Math.max(0.12, f.num / max) }));
}

/**
 * Build the running storyboard. Camera + cut are chosen from the theme's
 * motion character so each theme moves differently.
 */
export function buildScenes(
  job: AgentJob,
  topic?: string,
  theme: VideoTheme = VIDEO_THEMES[0],
  grid?: BeatGrid
): VideoScene[] {
  const ok = job.results.filter((r) => r.status === "ok");
  const stepById = new Map((job.plan?.steps ?? []).map((s) => [s.id, s]));
  const when = new Date(job.createdAt).toLocaleDateString([], { month: "short", day: "numeric" });
  const scenes: VideoScene[] = [];
  const camSeq: Camera[] = ["punch", "in", "out", "panRight", "panLeft", "in"];
  const camAt = (i: number): Camera => camSeq[i % camSeq.length];
  const cutAt = (i: number): Cut => theme.motion.cuts[i % theme.motion.cuts.length];
  const accentAt = (i: number) => theme.accents[i % theme.accents.length];

  scenes.push({
    kind: "hook",
    kicker: `MISSION BRIEF · ${theme.name}`,
    heading: hookHeadline(topic || job.goal),
    lines: [
      `${ok.length} step${ok.length === 1 ? "" : "s"} delivered · ${elapsedLabel(job)} · ${when}`,
    ],
    cam: camAt(0),
    cut: cutAt(0),
    durationMs: 2600,
    sfx: "glitch",
    accent: accentAt(0),
  });

  // Show the thing: the mission's own screenshot, full bleed.
  const shot = (job.artifacts ?? []).filter((a) => a.kind === "image").slice(-1)[0];
  if (shot) {
    scenes.push({
      kind: "fullbleed",
      kicker: "LIVE CAPTURE",
      heading: shot.label.slice(0, 60),
      lines: toLines(String(stepBody(job, shot.stepId ?? "")), 1),
      image: shot.value,
      cam: "in",
      cut: cutAt(1),
      durationMs: 3400,
      sfx: "switch",
      accent: accentAt(1),
    });
  }

  scenes.push({
    kind: "reveal",
    kicker: "THE BRIEF",
    heading: (job.plan?.summary || "Mission summary").slice(0, 78),
    lines: [`${ok.length} of ${job.results.length} steps delivered`, job.partial ? "Completed with gaps" : "All systems nominal"],
    stats: [
      { label: "steps", value: String(ok.length) },
      { label: "credits", value: String(job.creditsUsed ?? 0) },
      { label: "runtime", value: elapsedLabel(job) },
    ],
    cam: camAt(scenes.length),
    cut: cutAt(scenes.length),
    durationMs: 4000,
    sfx: "drop",
    accent: accentAt(2),
  });

  const allLines = ok.flatMap((r) => toLines(stepBody(job, r.stepId), 3));
  const metrics = extractMetrics(allLines);
  if (metrics.length >= 2) {
    scenes.push({
      kind: "metrics",
      kicker: "BY THE NUMBERS",
      heading: "What the findings say",
      lines: [],
      metrics,
      cam: camAt(scenes.length),
      cut: cutAt(scenes.length),
      durationMs: 3400,
      sfx: "switch",
      accent: accentAt(0),
    });
  }

  for (const r of ok) {
    const lines = toLines(stepBody(job, r.stepId), 3);
    if (lines.length === 0) continue;
    const title = stepById.get(r.stepId)?.title ?? r.stepId;
    const n = scenes.filter((s) => s.kind === "highlight").length;
    scenes.push({
      kind: "highlight",
      kicker: `FINDING ${String(n + 1).padStart(2, "0")}`,
      heading: title.length > 64 ? `${title.slice(0, 61)}…` : title,
      lines,
      cam: camAt(scenes.length),
      cut: cutAt(scenes.length),
      durationMs: 2500 + lines.length * 260,
      sfx: "switch",
      accent: accentAt(n + 1),
    });
    if (n + 1 >= 3) break;
  }

  if (job.artifacts?.length) {
    scenes.push({
      kind: "artifacts",
      kicker: "DELIVERED",
      heading: `${job.artifacts.length} artifact${job.artifacts.length === 1 ? "" : "s"}`,
      lines: job.artifacts.slice(0, 5).map((a) => `${a.label}  ·  ${a.kind}`),
      cam: camAt(scenes.length),
      cut: cutAt(scenes.length),
      durationMs: 3000,
      sfx: "click",
      accent: accentAt(1),
    });
  }

  scenes.push({
    kind: "outro",
    kicker: "END OF BRIEF",
    heading: job.partial ? "Mission delivered — with notes" : "Mission complete",
    lines: [(job.goal.length > 84 ? `${job.goal.slice(0, 81)}…` : job.goal) || "JARVIS", "JARVIS · always on"],
    cam: "out",
    cut: "glitch",
    durationMs: 3400,
    sfx: "bong",
    accent: accentAt(0),
  });

  // Cut on the music: quantise every shot onto the track's real beat grid.
  return grid ? snapScenesToBeats(scenes, grid) : scenes;
}

/** Simple deck adapter over the storyboard. */
export function buildSlides(job: AgentJob, topic?: string): Slide[] {
  return buildScenes(job, topic).map<Slide>((s) => ({
    kind: s.kind === "hook" ? "title" : s.kind === "outro" ? "outro" : s.kind === "reveal" ? "quote" : "bullet",
    heading: s.heading,
    lines: s.lines.length ? s.lines : (s.metrics ?? []).map((m) => `${m.label} — ${m.display}`),
  }));
}

/* ─────────────────────────── markup ─────────────────────────── */

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CAM_CLASS: Record<Camera, string> = {
  in: "cam-in",
  out: "cam-out",
  panLeft: "cam-pan-l",
  panRight: "cam-pan-r",
  punch: "cam-punch",
};

/**
 * Big type, split so it can arrive per word (or per character for the typing
 * themes). This is where each theme's personality is loudest.
 */
function titleSpans(text: string, enter: TitleEnter): string {
  const words = escapeHtml(text).split(" ").filter(Boolean);
  if (enter !== "type") {
    return words
      .map((w, i) => `<span class="w" style="--wd:${(i * 0.07).toFixed(2)}s">${w}</span>`)
      .join(" ");
  }
  let n = 0;
  return words
    .map((w) => {
      const chars = [...w]
        .map((c) => `<span class="ch" style="--cd:${(n++ * 0.028).toFixed(3)}s">${c}</span>`)
        .join("");
      n += 1; // the space costs a tick too
      return `<span class="w">${chars}</span>`;
    })
    .join(" ");
}

function sceneMarkup(s: VideoScene, i: number, baseUrl: string, theme: VideoTheme): string {
  const [a1, a2] = s.accent;
  const enter = theme.title.enter;
  const fill = theme.title.gradient ? "grad" : "solid";
  const caret = enter === "type" ? '<span class="caret"></span>' : "";
  const attrs = `style="--a1:${a1};--a2:${a2};--dur:${s.durationMs + 500}ms"
    data-index="${i}" data-dur="${s.durationMs}" data-start="${s.startMs ?? 0}"
    data-strong="${s.strong ? 1 : 0}" data-cam="${CAM_CLASS[s.cam]}" data-cut="${s.cut}" data-sfx="${s.sfx}"`;
  const kicker = `<div class="kicker"><span class="rec"></span>${escapeHtml(s.kicker)}</div>`;
  const depth = (d: number) => `style="--depth:${d}"`;

  if (s.kind === "hook") {
    return `<section class="shot hook" ${attrs}>
      <div class="layer" ${depth(0.35)}>
        ${kicker}
        <h1 class="title ${fill} enter-${enter}"><span class="stack">${titleSpans(s.heading, enter)}</span>${caret}</h1>
        <div class="rule"></div>
        <p class="sub">${escapeHtml(s.lines[0] ?? "")}</p>
      </div>
      <div class="leak"></div>
    </section>`;
  }

  if (s.kind === "fullbleed") {
    return `<section class="shot fullbleed" ${attrs}>
      <div class="media"><img src="${escapeHtml(artifactUrl(baseUrl, s.image ?? ""))}" alt=""/></div>
      <div class="scrim"></div>
      <div class="lower layer" ${depth(0.2)}>
        ${kicker}
        <h2>${escapeHtml(s.heading)}</h2>
        ${s.lines[0] ? `<p class="sub">${escapeHtml(s.lines[0])}</p>` : ""}
      </div>
      <div class="chrome"><span>REC</span><span>${(s.durationMs / 1000).toFixed(1)}s</span></div>
    </section>`;
  }

  if (s.kind === "reveal") {
    const stats = (s.stats ?? [])
      .map((st) => `<div class="stat"><b data-n="${escapeHtml(st.value)}">0</b><span>${escapeHtml(st.label)}</span></div>`)
      .join("");
    return `<section class="shot reveal" ${attrs}>
      <div class="layer" ${depth(0.3)}>
        ${kicker}
        <h2>${escapeHtml(s.heading)}</h2>
        <div class="stats">${stats}</div>
        <ul class="lines">${s.lines.map((l, li) => `<li style="--d:${0.3 + li * 0.18}s">${escapeHtml(l)}</li>`).join("")}</ul>
      </div>
    </section>`;
  }

  if (s.kind === "metrics") {
    const bars = (s.metrics ?? [])
      .map(
        (m, mi) =>
          `<div class="bar" style="--d:${0.3 + mi * 0.16}s;--w:${Math.round(m.weight * 100)}%">
             <span class="bar-label">${escapeHtml(m.label)}</span>
             <span class="bar-track"><i></i></span>
             <span class="bar-value">${escapeHtml(m.display)}</span>
           </div>`
      )
      .join("");
    return `<section class="shot metrics" ${attrs}>
      <div class="layer" ${depth(0.25)}>
        ${kicker}
        <h2>${escapeHtml(s.heading)}</h2>
        <div class="bars-list">${bars}</div>
      </div>
    </section>`;
  }

  if (s.kind === "artifacts") {
    return `<section class="shot artifacts" ${attrs}>
      <div class="layer" ${depth(0.3)}>
        ${kicker}
        <h2>${escapeHtml(s.heading)}</h2>
        <div class="cards">${s.lines
          .map((l, li) => {
            const [name, kind] = l.split("  ·  ");
            return `<div class="card" style="--d:${0.26 + li * 0.14}s"><b>${escapeHtml(name ?? l)}</b><span>${escapeHtml(kind ?? "")}</span></div>`;
          })
          .join("")}</div>
      </div>
    </section>`;
  }

  if (s.kind === "outro") {
    return `<section class="shot outro" ${attrs}>
      <div class="layer" ${depth(0.3)}>
        ${kicker}
        <h1 class="title ${fill} enter-${enter}"><span class="stack">${titleSpans(s.heading, enter)}</span></h1>
        <div class="rule"></div>
        <p class="sub">${escapeHtml(s.lines[0] ?? "")}</p>
        <p class="sig">${escapeHtml(s.lines[1] ?? "")}</p>
      </div>
      <div class="ring"></div>
    </section>`;
  }

  return `<section class="shot" ${attrs}>
    <div class="layer" ${depth(0.3)}>
      ${kicker}
      <h2>${escapeHtml(s.heading)}</h2>
      <ul class="lines">${s.lines.map((l, li) => `<li style="--d:${0.28 + li * 0.16}s">${escapeHtml(l)}</li>`).join("")}</ul>
    </div>
  </section>`;
}

export interface RenderBriefOptions {
  baseUrl?: string;
  silent?: boolean;
  /** Force a theme id (otherwise chosen deterministically from the mission). */
  themeId?: string;
}

/**
 * Render the storyboard into a standalone HTML file in the artifact store.
 */
export function renderVideoBrief(
  job: AgentJob,
  topic?: string,
  opts: RenderBriefOptions = {}
): { path: string; slides: Slide[]; scenes: VideoScene[]; theme: string; html: string } {
  const theme = pickFreshTheme(job.id || job.goal, opts.themeId);
  const slides = buildSlides(job, topic);

  const baseUrl = opts.baseUrl || process.env.JARVIS_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  // Music: the theme pairs with a track so the vibe is coherent.
  const track = MUSIC_TRACKS[(VIDEO_THEMES.findIndex((t) => t.id === theme.id) + (job.id?.length ?? 0)) % MUSIC_TRACKS.length];
  // Cuts are quantised onto this track's real beat grid.
  const grid = loadBeatGrid(track);
  const scenes = buildScenes(job, topic, theme, grid);
  const total = scenes.reduce((n, s) => n + s.durationMs, 0);
  const beatMarks = grid.beats.filter((t) => t <= total + 400);
  const musicUrl = assetUrl(baseUrl, `music/${track}`);
  const sfxUrls = Object.fromEntries(
    Object.entries(SFX_SETS[theme.audio.sfxSet]).map(([cue, rel]) => [cue, assetUrl(baseUrl, rel)])
  ) as Record<SfxCue, string>;

  const sceneHtml = scenes.map((s, i) => sceneMarkup(s, i, baseUrl, theme)).join("\n");
  const ticker = `${job.goal}   ·   JARVIS MISSION BRIEF   ·   ${theme.name}   ·   ${scenes.length} shots   ·   ${(total / 1000).toFixed(1)}s   ·   `;

  const gridCss =
    theme.texture.grid === "grid"
      ? `background-image:linear-gradient(${theme.texture.gridColor} 1px,transparent 1px),linear-gradient(90deg,${theme.texture.gridColor} 1px,transparent 1px);background-size:72px 72px;opacity:.17`
      : theme.texture.grid === "dots"
        ? `background-image:radial-gradient(${theme.texture.gridColor} 1.4px,transparent 1.5px);background-size:34px 34px;opacity:.5`
        : theme.texture.grid === "scanlines"
          ? `background-image:repeating-linear-gradient(180deg,${theme.texture.gridColor} 0 1px,transparent 1px 3px);opacity:.55`
          : `opacity:0`;

  const hookAlign = theme.hook === "center" ? "center" : theme.hook === "split" ? "flex-start" : "flex-start";

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>JARVIS Mission Brief — ${escapeHtml(job.goal.slice(0, 56))}</title>
<style>
  :root{
    --core:${theme.accents[0][0]};--text:${theme.palette.text};--muted:${theme.palette.muted};
    --a1:${theme.accents[0][0]};--a2:${theme.accents[0][1]};
    --radius:${theme.texture.radius}px;--grain:${theme.texture.grain};--glow:${theme.texture.glow};
    --font-display:${theme.font.display};--font-body:${theme.font.body};--font-kicker:${theme.font.kicker};
    --display-weight:${theme.font.displayWeight};--display-tracking:${theme.font.displayTracking};
    --kicker-tracking:${theme.font.kickerTracking};
    --pulse:0;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#000;color:var(--text);overflow:hidden;
    font-family:var(--font-body);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .bg{position:fixed;inset:-12%;
    background:radial-gradient(58% 52% at 50% 6%,${theme.palette.bg3},transparent 62%),
      radial-gradient(46% 44% at 84% 90%,${theme.palette.bg3},transparent 66%),
      radial-gradient(120% 90% at 50% 50%,${theme.palette.bg1} 0%,${theme.palette.bg2} 72%);
    animation:bgDrift 24s ease-in-out infinite alternate}
  @keyframes bgDrift{to{transform:scale(calc(1.04 + var(--pulse)*.02)) translate3d(-1.4%,-1%,0)}}
  .grid{position:fixed;inset:0;${gridCss};animation:gridDrift 30s linear infinite;
    mask-image:radial-gradient(74% 66% at 50% 46%,#000 18%,transparent 80%)}
  @keyframes gridDrift{to{background-position:72px 144px,144px 72px}}
  .aurora{position:fixed;inset:-20%;opacity:calc(.34 + var(--pulse)*.35);pointer-events:none;
    background:conic-gradient(from 0deg at 30% 30%,transparent 0deg,var(--a1) 90deg,transparent 190deg,var(--a2) 280deg,transparent 360deg);
    filter:blur(70px);animation:spin 46s linear infinite;mix-blend-mode:screen}
  @keyframes spin{to{transform:rotate(360deg)}}
  .grain{position:fixed;inset:0;pointer-events:none;opacity:var(--grain);mix-blend-mode:overlay;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence baseFrequency='.85' numOctaves='4'/></filter><rect width='140' height='140' filter='url(%23n)'/></svg>");
    animation:grainShift .5s steps(3) infinite}
  @keyframes grainShift{0%{transform:translate3d(0,0,0)}33%{transform:translate3d(-3px,2px,0)}66%{transform:translate3d(2px,-3px,0)}}
  .vignette{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 30vw rgba(0,0,0,${theme.texture.vignette})}
  .bars{position:fixed;top:0;left:0;right:0;height:${theme.texture.letterbox};background:#000;z-index:6}
  .bars.b{top:auto;bottom:calc(${theme.texture.letterbox} + 34px)}
  .sweep{position:fixed;left:0;right:0;height:30vh;top:-32vh;pointer-events:none;z-index:2;
    background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--core) 12%,transparent),transparent);
    animation:scan 8.5s linear infinite}
  @keyframes scan{to{top:110vh}}
  .leak{position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(104deg,transparent 36%,color-mix(in srgb,var(--core) 20%,transparent) 50%,transparent 62%);
    transform:translateX(-60%);animation:leak 3.4s .2s ease-out both}
  @keyframes leak{to{transform:translateX(60%)}}

  #reel{position:fixed;inset:0;z-index:3}
  .shot{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;
    padding:12vh 8vw;opacity:0;pointer-events:none;will-change:transform,opacity,filter}
  .shot.hook{align-items:${hookAlign};text-align:${theme.hook === "center" ? "center" : "left"}}
  .layer{transform:translate3d(calc(var(--mx,0) * var(--depth,0) * -26px),calc(var(--my,0) * var(--depth,0) * -18px),0);
    transition:transform .5s cubic-bezier(.2,.8,.2,1)}
  .shot.active{opacity:1}
  .shot.active.t-whip{animation:whipIn .42s cubic-bezier(.16,.84,.24,1) both}
  .shot.active.t-punch{animation:punchIn .36s cubic-bezier(.2,.9,.2,1) both}
  .shot.active.t-glitch{animation:glitchIn .5s steps(2,end) both}
  .shot.active.t-wipe{animation:wipeIn .55s cubic-bezier(.25,.9,.2,1) both}
  .shot.active.t-cut{animation:none}
  .shot.leaving.t-whip{animation:whipOut .32s cubic-bezier(.7,0,.84,.16) both}
  .shot.leaving.t-punch{animation:punchOut .3s ease-in both}
  .shot.leaving.t-glitch{animation:glitchOut .34s steps(2,end) both}
  .shot.leaving.t-wipe{animation:wipeOut .4s cubic-bezier(.7,0,.84,.16) both}
  .shot.leaving.t-cut{animation:fadeOut .3s ease both}
  @keyframes whipIn{from{opacity:0;transform:translate3d(16%,0,0) scale(1.06);filter:blur(12px)}to{opacity:1;transform:none;filter:none}}
  @keyframes whipOut{from{opacity:1;transform:none}to{opacity:0;transform:translate3d(-14%,0,0) scale(1.04);filter:blur(10px)}}
  @keyframes punchIn{from{opacity:0;transform:scale(1.18)}to{opacity:1;transform:scale(1)}}
  @keyframes punchOut{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.94)}}
  @keyframes glitchIn{0%{opacity:0;clip-path:inset(46% 0 46% 0);transform:translate3d(-2%,0,0)}
    45%{opacity:1;clip-path:inset(6% 0 62% 0);transform:translate3d(1.6%,0,0)}
    75%{clip-path:inset(0 0 0 0);transform:translate3d(-.6%,0,0)}100%{opacity:1;transform:none}}
  @keyframes glitchOut{0%{opacity:1;clip-path:inset(0 0 0 0)}60%{opacity:.7;clip-path:inset(58% 0 8% 0)}100%{opacity:0}}
  @keyframes wipeIn{from{clip-path:inset(0 100% 0 0);transform:translate3d(-4%,0,0)}to{clip-path:inset(0 0 0 0);transform:none}}
  @keyframes wipeOut{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 0 100%);opacity:.6}}
  @keyframes fadeOut{to{opacity:0}}

  .shot.active .camera{animation-fill-mode:both;animation-timing-function:linear}
  .shot.active.cam-in .camera{animation-name:camIn}
  .shot.active.cam-out .camera{animation-name:camOut}
  .shot.active.cam-pan-l .camera{animation-name:camPanL}
  .shot.active.cam-pan-r .camera{animation-name:camPanR}
  .shot.active.cam-punch .camera{animation-name:camPunch}
  .camera{animation-duration:var(--dur)}
  @keyframes camIn{from{transform:scale(1)}to{transform:scale(${1 + 0.1 * theme.motion.energy})}}
  @keyframes camOut{from{transform:scale(${1 + 0.1 * theme.motion.energy})}to{transform:scale(1)}}
  @keyframes camPanL{from{transform:translate3d(${2.6 * theme.motion.energy}%,0,0) scale(1.07)}to{transform:translate3d(${-2.6 * theme.motion.energy}%,0,0) scale(1.07)}}
  @keyframes camPanR{from{transform:translate3d(${-2.6 * theme.motion.energy}%,0,0) scale(1.07)}to{transform:translate3d(${2.6 * theme.motion.energy}%,0,0) scale(1.07)}}
  @keyframes camPunch{from{transform:scale(${1 + 0.22 * theme.motion.energy})}to{transform:scale(1)}}

  .kicker{display:flex;align-items:center;gap:12px;font-family:var(--font-kicker);
    font-size:clamp(10px,1.02vw,13px);letter-spacing:var(--kicker-tracking);
    ${theme.font.uppercaseKicker ? "text-transform:uppercase;" : ""}color:var(--a1);margin-bottom:20px;opacity:.92}
  .kicker:after{content:"";width:34px;height:1px;background:var(--a1);box-shadow:0 0 ${12 * theme.texture.glow}px var(--a1)}
  .rec{width:8px;height:8px;border-radius:50%;background:#ff4d6d;box-shadow:0 0 14px #ff4d6d;animation:blink 1.3s steps(2) infinite}
  @keyframes blink{50%{opacity:.25}}
  h1.title{font-family:var(--font-display);font-weight:var(--display-weight);letter-spacing:var(--display-tracking);
    font-size:clamp(38px,7.4vw,116px);line-height:1;margin:0;
    ${theme.font.uppercaseTitle ? "text-transform:uppercase;" : ""}
    background:linear-gradient(108deg,${theme.palette.text} 4%,var(--a1) 48%,var(--a2) 96%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 0 ${60 * theme.texture.glow}px color-mix(in srgb,var(--a1) 28%,transparent))}
  h1 .stack{display:inline-block}
  h1.title.solid{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:var(--text);
    filter:drop-shadow(0 0 ${26 * theme.texture.glow}px color-mix(in srgb,var(--a1) 30%,transparent))}
  /* Title personality: each theme brings its own type on-screen. */
  .shot.active h1.title .w{display:inline-block;opacity:0;animation-fill-mode:both;
    animation-duration:.62s;animation-timing-function:cubic-bezier(.2,.9,.2,1);animation-delay:var(--wd,0s)}
  .enter-slam .w{animation-name:wordSlam;animation-duration:.5s}
  .enter-decode .w{animation-name:wordDecode;animation-duration:.46s;animation-timing-function:steps(4,end)}
  .enter-rise .w{animation-name:wordRise;animation-duration:.85s}
  .enter-dissolve .w{animation-name:wordDissolve;animation-duration:1.2s;animation-timing-function:cubic-bezier(.16,.84,.24,1)}
  .enter-stack .w{animation-name:wordStack;animation-duration:.44s}
  .enter-type .w{opacity:1;animation:none}
  .shot.active h1.title .ch{display:inline-block;opacity:0;animation:charType .01s steps(1,end) both;animation-delay:var(--cd,0s)}
  .caret{display:inline-block;width:.5em;height:.92em;margin-left:.08em;vertical-align:-.06em;background:var(--a1);
    box-shadow:0 0 16px var(--a1);animation:blink .9s steps(2) infinite}
  @keyframes wordIn{to{opacity:1;transform:none}}
  @keyframes wordSlam{0%{opacity:0;transform:scale(1.3) translate3d(0,.16em,0);filter:blur(10px)}
    62%{opacity:1;transform:scale(.985);filter:blur(0)}100%{opacity:1;transform:none;filter:none}}
  @keyframes wordDecode{0%{opacity:0;clip-path:inset(0 0 100% 0);transform:translate3d(-.08em,0,0)}
    40%{opacity:1;clip-path:inset(34% 0 22% 0)}100%{opacity:1;clip-path:inset(0 0 0 0);transform:none}}
  @keyframes wordRise{from{opacity:0;transform:translate3d(0,.55em,0);letter-spacing:.28em}
    to{opacity:1;transform:none;letter-spacing:0}}
  @keyframes wordDissolve{from{opacity:0;filter:blur(22px);transform:scale(1.07)}
    to{opacity:1;filter:blur(0);transform:none}}
  @keyframes wordStack{from{opacity:0;transform:translate3d(0,1.15em,0) rotate(4.5deg)}
    to{opacity:1;transform:none}}
  @keyframes charType{to{opacity:1}}
  h2{font-family:var(--font-display);font-weight:var(--display-weight);font-size:clamp(24px,3.5vw,52px);line-height:1.08;
    margin:0 0 22px;letter-spacing:var(--display-tracking);
    ${theme.font.uppercaseTitle ? "text-transform:uppercase;" : ""}
    text-shadow:0 0 ${48 * theme.texture.glow}px color-mix(in srgb,var(--a1) 22%,transparent)}
  .rule{height:2px;width:min(44vw,520px);margin:24px 0 20px;border-radius:var(--radius);
    background:${theme.palette.rule};box-shadow:0 0 ${26 * theme.texture.glow}px color-mix(in srgb,var(--a1) 55%,transparent);
    transform-origin:left;animation:grow .75s .18s cubic-bezier(.2,.9,.2,1) both}
  @keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  .sub,.sig{font-size:clamp(14px,1.5vw,21px);color:var(--muted);margin:0 0 8px}
  .sig{color:var(--a1);letter-spacing:.26em;text-transform:uppercase;font-family:var(--font-kicker);
    font-size:clamp(10px,1.02vw,13px);margin-top:14px}
  ul.lines{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:14px;max-width:74ch}
  ul.lines li{font-size:clamp(15px,1.58vw,23px);line-height:1.42;padding-left:34px;position:relative}
  ul.lines li:before{content:"";position:absolute;left:0;top:.5em;width:10px;height:10px;border-radius:50%;
    background:var(--a1);box-shadow:0 0 18px var(--a1)}
  .shot.active ul.lines li{opacity:0;animation:slideIn .6s cubic-bezier(.2,.9,.2,1) both;animation-delay:var(--d)}
  @keyframes slideIn{from{opacity:0;transform:translate3d(-24px,0,0)}to{opacity:1;transform:none}}
  .stats{display:flex;gap:16px;margin:6px 0 24px;flex-wrap:wrap}
  .stat{min-width:116px;padding:15px 20px;border-radius:var(--radius);border:1px solid ${theme.palette.border};
    background:linear-gradient(160deg,${theme.palette.panel},rgba(0,0,0,.35));backdrop-filter:blur(10px)}
  .shot.active .stat{opacity:0;animation:slideIn .6s cubic-bezier(.2,.9,.2,1) both;animation-delay:var(--d,0s)}
  .stat b{display:block;font-family:var(--font-display);font-size:clamp(24px,2.8vw,42px);font-weight:var(--display-weight);color:var(--text);letter-spacing:-.02em}
  .stat span{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);font-family:var(--font-kicker)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:15px;max-width:1000px}
  .card{padding:17px 20px;border-radius:var(--radius);border:1px solid ${theme.palette.border};
    background:linear-gradient(160deg,${theme.palette.panel},rgba(0,0,0,.3))}
  .shot.active .card{opacity:0;animation:slideIn .6s cubic-bezier(.2,.9,.2,1) both;animation-delay:var(--d)}
  .card b{display:block;font-size:16px;margin-bottom:6px;color:var(--text)}
  .card span{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--a1);font-family:var(--font-kicker)}
  .ring{position:absolute;right:9vw;top:50%;width:34vh;height:34vh;margin-top:-17vh;border-radius:50%;
    border:1px solid ${theme.palette.border};box-shadow:0 0 ${90 * theme.texture.glow}px color-mix(in srgb,var(--a1) 22%,transparent) inset;
    animation:breathe 3.4s ease-in-out infinite}
  @keyframes breathe{50%{transform:scale(calc(1.06 + var(--pulse)*.05));opacity:.62}}
  .bars-list{display:flex;flex-direction:column;gap:18px;max-width:min(78vw,1000px)}
  .bar{display:grid;grid-template-columns:minmax(140px,26ch) 1fr 96px;align-items:center;gap:16px}
  .shot.active .bar{opacity:0;animation:slideIn .6s cubic-bezier(.2,.9,.2,1) both;animation-delay:var(--d)}
  .bar-label{font-size:clamp(12px,1.16vw,16px);color:var(--text);opacity:.88;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .bar-track{height:12px;border-radius:var(--radius);background:${theme.palette.panel};overflow:hidden}
  .bar-track i{display:block;height:100%;width:0;border-radius:var(--radius);
    background:linear-gradient(90deg,var(--a1),var(--a2));box-shadow:0 0 ${22 * theme.texture.glow}px var(--a1);
    animation:fill 1.1s .35s cubic-bezier(.2,.9,.2,1) both;animation-play-state:paused}
  .shot.active .bar-track i{animation-play-state:running}
  @keyframes fill{from{width:0}to{width:var(--w)}}
  .bar-value{text-align:right;font-family:var(--font-display);font-weight:var(--display-weight);color:var(--text);font-size:clamp(13px,1.3vw,19px)}

  .fullbleed{padding:0;justify-content:flex-end}
  .fullbleed .media{position:absolute;inset:0;overflow:hidden}
  .fullbleed .media img{width:100%;height:100%;object-fit:cover;object-position:top center;animation:kenburns var(--dur) linear both}
  @keyframes kenburns{from{transform:scale(calc(1.02 + var(--pulse)*.01)) translate3d(0,1%,0)}to{transform:scale(1.22) translate3d(-2%,-2%,0)}}
  .fullbleed .scrim{position:absolute;inset:0;
    background:linear-gradient(180deg,color-mix(in srgb,${theme.palette.bg2} 62%,transparent) 0%,transparent 42%,color-mix(in srgb,${theme.palette.bg2} 92%,transparent) 92%)}
  .fullbleed .lower{position:relative;padding:0 8vw 12vh;max-width:80ch}
  .fullbleed .chrome{position:absolute;top:7vh;right:8vw;display:flex;gap:14px;align-items:center;
    font-family:var(--font-kicker);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--text)}
  .fullbleed .chrome span:first-child{color:#ff4d6d}

  .hud{position:fixed;top:${theme.texture.letterbox};left:0;right:0;padding:16px 34px;display:flex;justify-content:space-between;
    align-items:center;font-family:var(--font-kicker);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);z-index:7}
  .brand{display:flex;align-items:center;gap:10px;color:var(--text)}
  .dot{width:8px;height:8px;border-radius:50%;background:var(--core);box-shadow:0 0 14px var(--core);animation:blink 1.8s ease-in-out infinite}
  .eq{position:fixed;left:0;right:0;bottom:calc(${theme.texture.letterbox} + 34px);height:30px;display:flex;align-items:flex-end;gap:2px;
    padding:0 34px;z-index:6;opacity:.5;pointer-events:none}
  .eq i{flex:1;height:3px;border-radius:2px;background:linear-gradient(180deg,var(--a1),var(--a2));
    box-shadow:0 0 10px color-mix(in srgb,var(--a1) 60%,transparent);transition:height .08s linear}
  .ticker{position:fixed;left:0;right:0;bottom:${theme.texture.letterbox};height:34px;overflow:hidden;z-index:7;
    border-top:1px solid ${theme.palette.border};border-bottom:1px solid ${theme.palette.border};
    background:linear-gradient(90deg,${theme.palette.panel},rgba(0,0,0,.55),${theme.palette.panel})}
  .ticker div{white-space:nowrap;font-family:var(--font-kicker);font-size:11px;letter-spacing:.34em;text-transform:uppercase;
    color:var(--muted);line-height:32px;animation:marquee 34s linear infinite}
  @keyframes marquee{to{transform:translateX(-50%)}}
  footer{position:fixed;left:0;right:0;bottom:0;height:${theme.texture.letterbox};background:#000;z-index:8}
  .controls{position:fixed;left:0;right:0;bottom:calc(${theme.texture.letterbox} / 2 - 12px);display:flex;align-items:center;gap:14px;
    padding:0 34px;z-index:9}
  .progress{flex:1;height:3px;border-radius:3px;background:${theme.palette.panel};position:relative;overflow:hidden}
  .progress i{position:absolute;inset:0 auto 0 0;width:0;background:linear-gradient(90deg,var(--a1),var(--a2));box-shadow:0 0 18px var(--a1)}
  .beatmarks{position:absolute;inset:0;pointer-events:none}
  .beatmarks b{position:absolute;top:0;bottom:0;width:1px;background:color-mix(in srgb,var(--text) 26%,transparent)}
  .beatmarks b.strong{width:2px;background:var(--a1);box-shadow:0 0 8px var(--a1)}
  #streak{position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;
    background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--a1) 42%,transparent),transparent);filter:blur(16px)}
  #streak.go{animation:streakSwipe .42s cubic-bezier(.2,.9,.2,1) both}
  @keyframes streakSwipe{0%{opacity:0;transform:translateX(-42%) scaleX(.4)}
    34%{opacity:.85}100%{opacity:0;transform:translateX(42%) scaleX(1.7)}}
  .shot.active.cue .layer{filter:drop-shadow(0 0 ${20 * theme.texture.glow}px color-mix(in srgb,var(--a1) 45%,transparent))}
  .dock{display:flex;align-items:center;gap:10px;font-family:var(--font-kicker);font-size:10px;letter-spacing:.2em;
    text-transform:uppercase;color:var(--muted)}
  button.ctl{background:${theme.palette.panel};border:1px solid ${theme.palette.border};color:var(--text);border-radius:999px;
    padding:5px 11px;font:inherit;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;font-size:10px}
  button.ctl:hover{background:color-mix(in srgb,var(--a1) 22%,transparent)}

  #gate{position:fixed;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:18px;
    background:color-mix(in srgb,${theme.palette.bg2} 74%,transparent);backdrop-filter:blur(4px);z-index:12;cursor:pointer;transition:opacity .5s}
  #gate.gone{opacity:0;pointer-events:none}
  #gate .play{width:96px;height:96px;border-radius:50%;border:1px solid ${theme.palette.border};display:flex;
    align-items:center;justify-content:center;font-size:26px;color:var(--core);
    box-shadow:0 0 ${70 * theme.texture.glow}px color-mix(in srgb,var(--a1) 35%,transparent) inset,0 0 44px color-mix(in srgb,var(--a1) 25%,transparent);
    animation:breathe 2.6s ease-in-out infinite}
  #gate h3{font-family:var(--font-display);font-weight:var(--display-weight);font-size:clamp(18px,2.4vw,32px);margin:6px 0 0;letter-spacing:var(--display-tracking)}
  #gate p{font-family:var(--font-kicker);font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:var(--muted);margin:0}
  #gate small{font-size:10px;letter-spacing:.18em;color:var(--muted);opacity:.85;max-width:70vw;text-align:center}
</style></head>
<body>
<div class="bg"></div><div class="aurora"></div><div class="grid"></div><div class="sweep"></div>
<div class="grain"></div><div class="vignette"></div><div id="streak"></div><div class="bars"></div><div class="bars b"></div>
<header class="hud">
  <div class="brand"><span class="dot"></span> JARVIS · MISSION BRIEF</div>
  <div id="tc">00:00:00 · ${escapeHtml(theme.name)} · ${escapeHtml(String(job.id).slice(0, 8))}</div>
</header>
<main id="reel">${sceneHtml}</main>
<div class="eq" id="eq">${Array.from({ length: 26 }, () => "<i></i>").join("")}</div>
<div class="ticker"><div>${escapeHtml(ticker)}${escapeHtml(ticker)}</div></div>
<div class="controls">
  <div class="progress"><i></i></div>
  <div class="dock">
    <button class="ctl" id="play">❚❚</button>
    <span id="clock">0.0s / ${(total / 1000).toFixed(1)}s</span>
    <button class="ctl" id="sound">🔊</button>
  </div>
</div>
<footer></footer>
<div id="gate">
  <div class="play">▶</div>
  <h3>${escapeHtml(hookLine(topic || job.goal))}</h3>
  <p>${escapeHtml(theme.name)} · ${Math.round(grid.tempo)} bpm · ${scenes.length} cuts on beat · ${(total / 1000).toFixed(1)}s</p>
  <small>space pauses · ← → seek · click to skip · R replays · sound on</small>
</div>
<audio id="bed" src="${escapeHtml(musicUrl)}" loop preload="auto"></audio>
<script>
  const THEME = ${JSON.stringify({ id: theme.id, name: theme.name, volume: theme.audio.volume })};
  const SFX = ${JSON.stringify(sfxUrls)};
  const SILENT = ${opts.silent ? "true" : "false"};
  const shots = Array.from(document.querySelectorAll('.shot'));
  shots.forEach(s => { const c = document.createElement('div'); c.className = 'camera'; s.prepend(c); });
  const bar = document.querySelector('.progress i');
  const clock = document.getElementById('clock');
  const tc = document.getElementById('tc');
  const bed = document.getElementById('bed');
  const eqBars = Array.from(document.querySelectorAll('#eq i'));
  if (SILENT) bed.muted = true;

  // The cut list is quantised onto this track's cue grid, so shots land on beats.
  const TOTAL = ${total};
  const BEATS = ${JSON.stringify(beatMarks)};
  const STRONG = ${JSON.stringify(grid.strong)};
  (function paintBeats(){
    const host = document.getElementById('beats');
    if (!host || !TOTAL) return;
    const strong = new Set(STRONG);
    for (const t of BEATS) {
      if (t > TOTAL) break;
      const m = document.createElement('b');
      m.style.left = ((t / TOTAL) * 100).toFixed(2) + '%';
      if (strong.has(t)) m.className = 'strong';
      host.appendChild(m);
    }
  })();
  function flashStreak(){
    const el = document.getElementById('streak');
    el.classList.remove('go'); void el.offsetWidth; el.classList.add('go');
  }

  let idx = -1, t0 = performance.now(), playing = false, started = false, totalElapsed = 0, ended = false;
  let analyser = null, freq = null, audioCtx = null;

  function cut(sfx){
    if (SILENT) return;
    try { const url = SFX[sfx]; if (!url) return; const a = new Audio(url); a.volume = 0.3; void a.play().catch(()=>{}); } catch(e){}
  }
  function countUp(el, target){
    const num = parseFloat(String(target).replace(/[^0-9.]/g,''));
    if (!isFinite(num)) { el.textContent = target; return; }
    const suffix = String(target).replace(/[0-9.,]/g,'');
    const t = performance.now(), dur = 850;
    const step = (now) => {
      const p = Math.min(1, (now - t) / dur), eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(num * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function enter(i){
    shots.forEach((s, n) => {
      s.classList.remove('active','leaving','cue','t-whip','t-punch','t-glitch','t-wipe','t-cut');
      if (n === i) {
        void s.offsetWidth;
        s.classList.add('active', 't-' + (s.dataset.cut || 'whip'));
        if (s.dataset.strong === '1') s.classList.add('cue');
        if ((s.dataset.cut || '') === 'whip') flashStreak();
        s.querySelectorAll('.stat b[data-n]').forEach(b => countUp(b, b.dataset.n));
      } else if (n === i - 1) {
        s.classList.add('leaving', 't-' + (s.dataset.cut || 'whip'));
      }
    });
    idx = i;
    cut(shots[i].dataset.sfx || 'click');
    if (i >= 0) totalElapsed = shots.slice(0, i).reduce((n, s) => n + Number(s.dataset.dur), 0);
  }
  function advance(dir = 1){
    if (idx + dir < 0) return false;
    if (idx + dir > shots.length - 1) return false;
    t0 = performance.now();
    enter(idx + dir);
    return true;
  }
  function replay(){
    ended = false; playing = true; totalElapsed = 0; t0 = performance.now();
    bar.style.width = '0%'; enter(0);
    document.getElementById('play').textContent = '❚❚';
  }
  function fmt(ms){
    const s = Math.floor(ms / 1000);
    return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0') + ':' + String(Math.floor(ms%1000/10)).padStart(2,'0');
  }
  // WebAudio analyser drives the glow pulse + EQ strip (same-origin audio, so
  // it works). Any failure is silently ignored — visuals just stay calm.
  function wireAudio(){
    if (SILENT || audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
      const src = audioCtx.createMediaElementSource(bed);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .78;
      src.connect(analyser);
      analyser.connect(audioCtx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) { analyser = null; }
  }
  let pulse = 0;
  function audioFrame(){
    if (!analyser || !freq) return;
    try {
      analyser.getByteFrequencyData(freq);
      let bass = 0, sum = 0;
      for (let i = 0; i < 12; i++) bass += freq[i];
      for (let i = 0; i < freq.length; i++) sum += freq[i];
      bass /= (12 * 255);
      const level = sum / (freq.length * 255);
      if (bass > pulse) pulse = bass; else pulse += (bass - pulse) * .12;
      document.documentElement.style.setProperty('--pulse', pulse.toFixed(3));
      for (let i = 0; i < eqBars.length; i++) {
        const v = freq[Math.floor((i / eqBars.length) * (freq.length * .7))] / 255;
        eqBars[i].style.height = (3 + v * 26).toFixed(1) + 'px';
      }
      document.getElementById('eq').style.opacity = (0.25 + level * 0.6).toFixed(2);
    } catch (e) {}
  }
  function tick(now){
    if (playing && idx >= 0){
      const dur = Number(shots[idx].dataset.dur);
      const done = now - t0;
      bar.style.width = Math.min(100, (done / dur) * 100) + '%';
      const elapsed = totalElapsed + Math.min(done, dur);
      clock.textContent = (elapsed/1000).toFixed(1) + 's / ${(total / 1000).toFixed(1)}s';
      tc.textContent = fmt(elapsed) + ' · ' + THEME.name + ' · ${escapeHtml(String(job.id).slice(0, 8))}';
      if (done > dur){
        if (!advance(1)){ playing = false; ended = true; document.getElementById('play').textContent = '↻'; }
      }
    }
    audioFrame();
    requestAnimationFrame(tick);
  }
  function start(withSound){
    document.getElementById('gate').classList.add('gone');
    started = true; playing = true; ended = false;
    document.getElementById('play').textContent = '❚❚';
    if (withSound && !SILENT) { wireAudio(); bed.volume = 0; bed.muted = false; void bed.play().catch(()=>{}); fadeIn(); }
    t0 = performance.now(); enter(0);
  }
  function fadeIn(){
    const t = performance.now();
    const step = (now) => { bed.volume = Math.min(THEME.volume, ((now - t)/1700)*THEME.volume); if (bed.volume < THEME.volume) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  document.getElementById('gate').addEventListener('click', () => start(true));
  document.getElementById('play').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!started) return start(true);
    if (ended) return replay();
    playing = !playing; t0 = performance.now();
    e.currentTarget.textContent = playing ? '❚❚' : '▶';
  });
  document.getElementById('sound').addEventListener('click', (e) => {
    e.stopPropagation();
    bed.muted = !bed.muted;
    if (!bed.muted && bed.paused) void bed.play().catch(()=>{});
    e.currentTarget.textContent = bed.muted ? '🔇' : '🔊';
  });
  document.addEventListener('click', (e) => {
    if (!started || e.target.closest('.controls') || e.target.closest('#gate')) return;
    if (ended) return replay();
    advance(1); playing = true; document.getElementById('play').textContent = '❚❚';
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space'){ e.preventDefault(); if (!started) return start(true); if (ended) return replay(); playing = !playing; t0 = performance.now(); }
    if (e.key === 'ArrowRight'){ if (!started) return start(true); if (ended) return replay(); advance(1); }
    if (e.key === 'ArrowLeft'){ if (!started) return start(true); ended = false; advance(-1); }
    if (e.key === 'r' || e.key === 'R'){ if (!started) return start(true); replay(); }
  });
  // Parallax: the layers drift against the pointer, so nothing ever sits flat.
  document.addEventListener('mousemove', (e) => {
    const mx = (e.clientX / window.innerWidth) * 2 - 1;
    const my = (e.clientY / window.innerHeight) * 2 - 1;
    document.documentElement.style.setProperty('--mx', mx.toFixed(3));
    document.documentElement.style.setProperty('--my', my.toFixed(3));
  });
  requestAnimationFrame(tick);
</script></body></html>`;

  const file = saveArtifact(job.id, `brief_${Date.now()}.html`, html);
  return { path: file, slides, scenes, theme: theme.id, html };
}

/** Summarize the brief for the mission report/feed. */
export function briefSummary(slides: Slide[]): string {
  return `### 🎬 Video brief ready — ${slides.length} shots\n\n` + slides.map((s) => `- **${s.heading}**`).join("\n");
}
