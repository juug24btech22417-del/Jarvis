// Routine prediction — what is the user about to do, and when do they do it?
//
// `patterns.ts` answers "what has been happening a lot" with raw counts and a
// confidence of `n / 10`. That is a description, not a prediction: it cannot say
// WHICH thing comes next, and it has no notion of time beyond the single busiest
// hour bucket. This module answers the two questions a proactive assistant
// actually needs:
//
//   1. WHAT  — the most likely next action, given the current hour and what the
//              user just did (an interpolated first-order Markov model).
//   2. WHEN  — for actions that recur, the circular mean time-of-day and a
//              REGULARITY score saying how much of a routine it really is.
//
// ─── The model ────────────────────────────────────────────────────────────
// Interpolated (a.k.a. Jelinek-Mercer) smoothing over three experts:
//
//   P(a | now, prev) ≈ w_time · P̂(a | hourBucket, weekend)
//                    + w_prev · P̂(a | previous action)
//                    + w_glob · P̂(a)                      (base rate)
//
// Each P̂ is DECAYED counts — every observation is weighted by
// 0.5^(age / HALF_LIFE_DAYS) — so the model tracks a changing routine instead of
// averaging the last two months into mush. Experts with no data for the current
// context drop out and the remaining weights are renormalized, which is what
// keeps a first-week user (no history at all) from producing confident nonsense.
//
// ─── Why not a neural net / a trained classifier ──────────────────────────
// This runs inside the desktop app over one SQLite table and must be
// explainable in the UI ("you open Spotify around 09:58, 14 of the last 17
// weekdays"). A decayed count model trains incrementally, in microseconds,
// with zero dependencies, and every number it reports can be shown to the user.
// The learning problem is also tiny and extremely non-stationary — a heavy
// model would overfit a fortnight of behaviour and then be wrong.
//
// ─── Time as a CIRCLE, not a number ───────────────────────────────────────
// 23:50 and 00:10 are 20 minutes apart and 1420 minutes apart arithmetically.
// Routines straddle midnight, so every time computation here is circular
// (unit-vector mean): mean direction θ = atan2(Σw·sinθ, Σw·cosθ), and the mean
// resultant length R = |Σ unit vectors| / Σw is the REGULARITY — R → 1 is a
// metronome, R → 0 is scattered across the day. R also converts to a circular
// standard deviation, which becomes the prediction window.

export interface RoutineEvent {
  kind: string;
  payload: Record<string, unknown>;
  at: Date;
}

export interface Action {
  /** Stable identity, e.g. "panel:spotify", "contact:Ada@whatsapp". */
  key: string;
  /** Human label, e.g. "open Spotify". */
  label: string;
  at: Date;
  /**
   * Whether this can be RECOMMENDED, as opposed to merely predicted.
   *
   * Generic, unbounded actions ("ask me something") are invaluable CONTEXT —
   * they are what usually precedes a real action, so the previous-action expert
   * needs them — but they must never be the answer. On a real 60-day history the
   * asks outnumber everything else by an order of magnitude (821 rows here), so
   * "you usually ask me something around 20:01" was the top prediction every
   * time, burying every genuine routine underneath a suggestion the user cannot
   * act on. Absent means actionable.
   */
  actionable?: boolean;
}

export interface RoutinePrediction {
  key: string;
  label: string;
  /** Mixture probability of being the next action, 0..1. */
  probability: number;
  /** Decayed number of observations backing this action. */
  weight: number;
  /** Raw occurrence count in the lookback window. */
  occurrences: number;
  /** Circular mean time-of-day, in minutes since midnight (0..1439). */
  meanMinuteOfDay: number;
  /** Regularity R ∈ [0,1] — 1 = same time every time. */
  regularity: number;
  /** Expected occurrence time (± windowMinutes), normally the next one. */
  expectedAt: Date;
  /** Minutes of slack around expectedAt. */
  windowMinutes: number;
  /** How far the expected time is from "now", in minutes (next occurrence). */
  minutesAway: number;
  /** Combined rank score used for ordering (probability × timing fit). */
  score: number;
}

export interface RoutineOptions {
  /** Observations older than this stop contributing. */
  lookbackDays?: number;
  /** Experts' recency half-life, in days. */
  halfLifeDays?: number;
  /** Minimum occurrences before an action is predictable at all. */
  minOccurrences?: number;
  /** Minimum mixture probability to report. */
  minProbability?: number;
  /** How many predictions to return. */
  limit?: number;
}

const DEFAULTS = {
  lookbackDays: 60,
  halfLifeDays: 10,
  minOccurrences: 3,
  minProbability: 0.12,
  limit: 3,
};

// Expert weights. Time-of-day is the strongest signal for a desktop assistant
// (people are creatures of schedule), the previous action is the strongest
// signal for a TASK CHAIN ("opened the repo → next opens the terminal").
const W_TIME = 0.45;
const W_PREV = 0.35;
const W_GLOBAL = 0.2;

const MINUTES_PER_DAY = 1440;
/** Floor on the timing spread so a 0.99-regularity routine is not ±0 minutes. */
const MIN_STD_MINUTES = 12;
/** Hour bucket width used as the time-conditioning context. */
const BUCKET_HOURS = 3;

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime());
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function hourBucket(d: Date): string {
  const bucket = Math.floor(d.getHours() / BUCKET_HOURS);
  const day = d.getDay();
  const weekend = day === 0 || day === 6 ? "we" : "wd";
  return `${weekend}:${bucket}`;
}

/**
 * Turn raw memory events into a chronological action stream.
 *
 * Only events that represent a deliberate user action are predictable; a
 * "panel" event with no name, a malformed payload or a bad timestamp carries no
 * signal and is dropped rather than guessed at.
 */
export function toActions(events: RoutineEvent[]): Action[] {
  const actions: Action[] = [];

  for (const e of events) {
    if (!isFiniteDate(e.at)) continue;
    const payload = e.payload || {};
    const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

    if (e.kind === "panel") {
      const panel = str(payload.panel);
      if (!panel) continue;
      actions.push({ key: `panel:${panel.toLowerCase()}`, label: `open ${panel}`, at: e.at });
    } else if (e.kind === "search" || e.kind === "chat") {
      // Search/ask intent is a useful signal about WHAT (topic) but far too
      // sparse per-topic to predict; what it predicts well is the FOLLOW-UP.
      // Because queries are unbounded, they are labelled generically so a run of
      // them still chains into the action that follows.
      const q = str(payload.q) || str(payload.query);
      if (!q) continue;
      actions.push({ key: "ask", label: "ask me something", at: e.at, actionable: false });
    } else if (e.kind === "contact") {
      const name = str(payload.name);
      if (!name) continue;
      const platform = str(payload.platform);
      const suffix = platform ? `@${platform.toLowerCase()}` : "";
      actions.push({
        key: `contact:${name.toLowerCase()}${suffix}`,
        label: `message ${name}${platform ? ` on ${platform}` : ""}`,
        at: e.at,
      });
    } else if (e.kind === "action") {
      // Generic action channel (used by mission runs / command deck).
      const name = str(payload.name) || str(payload.action);
      if (!name) continue;
      actions.push({ key: `action:${name.toLowerCase()}`, label: name, at: e.at });
    }
  }

  actions.sort((a, b) => a.at.getTime() - b.at.getTime());
  return actions;
}

/** 0.5^(age / halfLife) — the recency weight of one observation. */
function decay(ageMs: number, halfLifeDays: number): number {
  const days = Math.max(0, ageMs) / 86_400_000;
  return Math.pow(0.5, days / halfLifeDays);
}

interface TimeStats {
  weight: number;
  occurrences: number;
  /** Circular mean, minutes since midnight. */
  meanMinute: number;
  /** Mean resultant length — regularity, 0..1. */
  regularity: number;
  /** Circular standard deviation, in minutes. */
  stdMinutes: number;
}

/** Circular statistics over weighted times-of-day. */
function timeStats(times: number[], weights: number[]): TimeStats {
  let sumW = 0;
  let c = 0;
  let s = 0;
  for (let i = 0; i < times.length; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w <= 0) continue;
    const theta = (times[i] / MINUTES_PER_DAY) * 2 * Math.PI;
    c += w * Math.cos(theta);
    s += w * Math.sin(theta);
    sumW += w;
  }
  if (sumW <= 0) {
    return { weight: 0, occurrences: 0, meanMinute: 0, regularity: 0, stdMinutes: MINUTES_PER_DAY / 4 };
  }
  const R = Math.hypot(c, s) / sumW;
  let meanAngle = Math.atan2(s, c);
  if (meanAngle < 0) meanAngle += 2 * Math.PI;
  const meanMinute = (meanAngle / (2 * Math.PI)) * MINUTES_PER_DAY;
  // Circular std: σ = sqrt(-2 ln R). R = 1 → 0; R → 0 → unbounded, so clamp.
  const regularity = clamp(R, 0, 1);
  const stdRad = regularity >= 0.999 ? 0 : Math.sqrt(-2 * Math.log(Math.max(regularity, 1e-6)));
  const stdMinutes = (stdRad / (2 * Math.PI)) * MINUTES_PER_DAY;
  return { weight: sumW, occurrences: times.length, meanMinute, regularity, stdMinutes };
}

/** Shortest circular distance between two minute-of-day values. */
export function circularMinuteDistance(a: number, b: number): number {
  const d = Math.abs(((a - b) % MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  return Math.min(d, MINUTES_PER_DAY - d);
}

/**
 * Predict the most likely next actions from an action stream.
 *
 * @param actions chronological actions (see toActions)
 * @param now     the moment to predict FOR (defaults to the newest action time)
 */
export function predictRoutine(
  actions: Action[],
  now: Date = new Date(),
  options: RoutineOptions = {}
): RoutinePrediction[] {
  const opts = { ...DEFAULTS, ...options };
  const nowMs = isFiniteDate(now) ? now.getTime() : Date.now();
  const windowStart = nowMs - opts.lookbackDays * 86_400_000;

  // ── Trim to the lookback window; everything older is noise for a routine ──
  const inWindow: Action[] = [];
  for (const a of actions) {
    const t = a.at.getTime();
    if (!Number.isFinite(t)) continue;
    if (t < windowStart || t > nowMs + 60_000) continue; // future events can't inform
    inWindow.push(a);
  }
  if (inWindow.length === 0) return [];

  // ── Aggregates ───────────────────────────────────────────────────────────
  const globalCounts = new Map<string, number>();
  const byContext = new Map<string, Map<string, number>>(); // hourBucket → key → w
  const byPrev = new Map<string, Map<string, number>>(); // prev key → key → w
  const timesByKey = new Map<string, { times: number[]; weights: number[] }>();
  const rawCounts = new Map<string, number>();
  const labels = new Map<string, string>();
  const nonActionable = new Set<string>();

  for (let i = 0; i < inWindow.length; i++) {
    const a = inWindow[i];
    const w = decay(nowMs - a.at.getTime(), opts.halfLifeDays);
    labels.set(a.key, a.label);
    const actionable = a.actionable !== false;
    if (!actionable) {
      // Non-actionable actions still count as CONTEXT — the action before the
      // next one — but they are excluded from every DISTRIBUTION. Including
      // them normalizes against a mass of events nobody can act on: on a real
      // history, 840 generic asks against 21 Spotify opens drove Spotify's
      // probability to 0.013, i.e. the genuine 09:00 routine was filtered out
      // entirely while the asks topped every list.
      //
      // After this, `probability` means "given that the next thing you do is
      // something I can surface, this is it" — which is the question a
      // proactive assistant is actually asking, and the one its UI can answer.
      nonActionable.add(a.key);
      continue;
    }

    globalCounts.set(a.key, (globalCounts.get(a.key) ?? 0) + w);
    rawCounts.set(a.key, (rawCounts.get(a.key) ?? 0) + 1);

    const ctx = hourBucket(a.at);
    let ctxMap = byContext.get(ctx);
    if (!ctxMap) byContext.set(ctx, (ctxMap = new Map()));
    ctxMap.set(a.key, (ctxMap.get(a.key) ?? 0) + w);

    const prev = i > 0 ? inWindow[i - 1].key : null;
    if (prev) {
      let prevMap = byPrev.get(prev);
      if (!prevMap) byPrev.set(prev, (prevMap = new Map()));
      prevMap.set(a.key, (prevMap.get(a.key) ?? 0) + w);
    }

    let times = timesByKey.get(a.key);
    if (!times) timesByKey.set(a.key, (times = { times: [], weights: [] }));
    times.times.push(minutesOfDay(a.at));
    times.weights.push(w);
  }

  // ── Context of the prediction moment ─────────────────────────────────────
  const nowDate = new Date(nowMs);
  const nowCtx = byContext.get(hourBucket(nowDate)) ?? null;
  const prevKey = inWindow[inWindow.length - 1]?.key ?? null;
  const prevCtx = prevKey ? byPrev.get(prevKey) ?? null : null;

  /** P̂(a | expert) with the expert's own normalization. */
  const expertProb = (map: Map<string, number> | null, key: string): number => {
    if (!map) return 0;
    let total = 0;
    for (const v of map.values()) total += v;
    if (total <= 0) return 0;
    return (map.get(key) ?? 0) / total;
  };

  // Renormalize the expert weights over whichever experts have evidence —
  // a brand-new user has no context maps at all and must still get an answer.
  let wTime = W_TIME;
  let wPrev = W_PREV;
  let wGlobal = W_GLOBAL;
  if (!nowCtx) {
    wGlobal += wTime;
    wTime = 0;
  }
  if (!prevCtx) {
    wGlobal += wPrev;
    wPrev = 0;
  }
  const totalW = wTime + wPrev + wGlobal || 1;
  wTime /= totalW;
  wPrev /= totalW;
  wGlobal /= totalW;

  // ── Score every candidate ────────────────────────────────────────────────
  const rankings: RoutinePrediction[] = [];
  const nowMinute = minutesOfDay(nowDate);

  for (const [key, times] of timesByKey) {
    const occurrences = rawCounts.get(key) ?? 0;
    if (occurrences < opts.minOccurrences) continue;
    // Predictable context, but not a recommendation — see Action.actionable.
    if (nonActionable.has(key)) continue;

    // Circular statistics over this action's own occurrence times.
    const stats = timeStats(times.times, times.weights);

    const probability =
      wTime * expertProb(nowCtx, key) +
      wPrev * expertProb(prevCtx, key) +
      wGlobal * expertProb(globalCounts, key);
    if (!Number.isFinite(probability) || probability < opts.minProbability) continue;

    const windowMinutes = clamp(Math.round(Math.max(MIN_STD_MINUTES, stats.stdMinutes)), MIN_STD_MINUTES, 180);

    // Timing fit: how plausible is NOW as an occurrence time for this action?
    const dist = circularMinuteDistance(nowMinute, stats.meanMinute);
    const proximity = Math.exp(-0.5 * Math.pow(dist / Math.max(MIN_STD_MINUTES, stats.stdMinutes), 2));

    // Rank by probability, with the timing fit as a MODEST modifier.
    //
    // The weights here are deliberately lopsided. A first attempt used
    // 0.35 + 0.65·proximity, which lets a well-timed action outrank one that is
    // twice as likely — and it broke exactly the case chains exist for: after
    // "open vscode", "open terminal" has ~2× the probability of "open vscode"
    // again, but it is five minutes in the FUTURE, so timing buried it and the
    // model recommended repeating the action you just took. The next step in a
    // task chain is by definition not due yet.
    //
    // At 0.7/0.3 the clock can still promote a strong-but-distant candidate over
    // a marginally likelier one (≈1.4× swing, never enough to invert a clear
    // probability lead), while WHAT comes next stays a probability decision.
    const score = probability * (0.7 + 0.3 * proximity);

    // Next occurrence: today at the mean minute, or tomorrow if that has passed
    // beyond the window.
    const expected = new Date(nowDate);
    expected.setHours(0, 0, 0, 0);
    expected.setMinutes(stats.meanMinute);
    const targetMs = expected.getTime();
    const minutesAway =
      targetMs >= nowMs - windowMinutes
        ? Math.round((targetMs - nowMs) / 60_000)
        : Math.round((targetMs + 86_400_000 - nowMs) / 60_000);
    if (targetMs < nowMs - windowMinutes) expected.setTime(targetMs + 86_400_000);

    rankings.push({
      key,
      label: labels.get(key) ?? key,
      probability: clamp(probability, 0, 1),
      weight: stats.weight,
      occurrences,
      meanMinuteOfDay: Math.round(stats.meanMinute),
      regularity: Number(stats.regularity.toFixed(3)),
      expectedAt: expected,
      windowMinutes,
      minutesAway,
      score: Number(score.toFixed(4)),
    });
  }

  rankings.sort((a, b) => b.score - a.score || b.probability - a.probability);
  return rankings.slice(0, Math.max(1, opts.limit));
}

/**
 * The single next thing worth surfacing, or null when the evidence is too thin
 * to be worth interrupting the user for.
 */
export function nextPrediction(
  actions: Action[],
  now: Date = new Date(),
  options: RoutineOptions = {}
): RoutinePrediction | null {
  const ranked = predictRoutine(actions, now, { ...options, limit: 1 });
  const top = ranked[0];
  if (!top) return null;
  // Only proactive when the timing actually lines up: a 55% chance of a habit
  // that isn't due for three hours is not a prompt, it's a distraction.
  if (Math.abs(top.minutesAway) > Math.max(top.windowMinutes * 3, 90)) return null;
  return top;
}

/** Human sentence for a prediction — used by the UI and by JARVIS's briefing. */
export function describePrediction(p: RoutinePrediction): string {
  const hh = String(Math.floor(p.meanMinuteOfDay / 60)).padStart(2, "0");
  const mm = String(Math.round(p.meanMinuteOfDay % 60)).padStart(2, "0");
  const strength =
    p.regularity >= 0.7 ? "a solid routine" : p.regularity >= 0.45 ? "a habit" : "a loose pattern";
  return `You usually ${p.label} around ${hh}:${mm} (${strength}, ${p.occurrences}× recently).`;
}

/**
 * Load the recent action stream from the DB.
 *
 * Returns [] rather than throwing: pattern-of-life is advisory, and a missing
 * or migrating database must never take down whatever surface asked for it.
 */
export async function loadRecentRoutineActions(
  now: Date = new Date(),
  lookbackDays: number = DEFAULTS.lookbackDays
): Promise<Action[]> {
  try {
    const { prisma } = await import("@/lib/db/queries");
    const since = new Date(now.getTime() - lookbackDays * 86_400_000);
    const rows = await prisma.memoryEvent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });

    const events: RoutineEvent[] = rows.map((r) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(r.payload) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      return { kind: r.kind, payload, at: r.createdAt };
    });

    return toActions(events);
  } catch (err) {
    console.warn("[Routine] could not load actions:", err);
    return [];
  }
}

/** Convenience: load and predict in one call. Never throws. */
export async function loadAndPredictRoutine(
  now: Date = new Date(),
  options: RoutineOptions = {}
): Promise<RoutinePrediction[]> {
  const opts = { ...DEFAULTS, ...options };
  const actions = await loadRecentRoutineActions(now, opts.lookbackDays);
  return predictRoutine(actions, now, options);
}
