// Live browser view — frames streamed out of a running mission.
//
// While an autonomous browser_act step is driving Chromium it publishes a JPEG
// frame (plus the page URL/title and the action it just took) here. The
// Mission Control panel polls /api/agent/live?jobId=… to show the run live,
// which is how you "watch" an autonomous mission without the browser window
// needing to be visible on screen.

export interface LiveFrame {
  jobId: string;
  stepId: string;
  /** Last action the agent took, e.g. `click [12]`. */
  action: string;
  url: string;
  title: string;
  /** data:image/jpeg;base64,… */
  frame: string;
  /** Monotonic counter so the panel can tell frames apart. */
  seq: number;
  at: number;
}

interface LiveGlobal {
  __jarvisLiveView?: Map<string, LiveFrame>;
  __jarvisLiveViewEnabled?: Set<string>;
  __jarvisLiveViewSeq?: number;
}

const g = globalThis as unknown as LiveGlobal;

function frames(): Map<string, LiveFrame> {
  if (!g.__jarvisLiveView) g.__jarvisLiveView = new Map();
  return g.__jarvisLiveView;
}

function enabled(): Set<string> {
  if (!g.__jarvisLiveViewEnabled) g.__jarvisLiveViewEnabled = new Set();
  return g.__jarvisLiveViewEnabled;
}

/** Opt a job in (or out) of frame streaming. Streaming is on by default. */
export function setLiveViewEnabled(jobId: string, on: boolean): void {
  if (on) enabled().add(jobId);
  else enabled().delete(jobId);
}

export function isLiveViewEnabled(jobId: string): boolean {
  return enabled().has(jobId);
}

/** Publish the newest frame for a job (previous frame is dropped — latest wins). */
export function publishLiveFrame(input: {
  jobId: string;
  stepId: string;
  action: string;
  url: string;
  title: string;
  frame: string;
}): void {
  const seq = (g.__jarvisLiveViewSeq = (g.__jarvisLiveViewSeq ?? 0) + 1);
  frames().set(input.jobId, { ...input, seq, at: Date.now() });
}

export function getLiveFrame(jobId: string): LiveFrame | null {
  return frames().get(jobId) ?? null;
}

/** Frame metadata without the (large) image payload. */
export function getLiveMeta(jobId: string): Omit<LiveFrame, "frame"> & { hasFrame: boolean } | null {
  const f = frames().get(jobId);
  if (!f) return null;
  const { frame, ...meta } = f;
  return { ...meta, hasFrame: !!frame };
}

/** Decode the stored frame to bytes for an HTTP image response. */
export function getLiveFrameBuffer(jobId: string): Buffer | null {
  const f = frames().get(jobId);
  if (!f?.frame) return null;
  const b64 = f.frame.split(",")[1];
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

export function clearLiveView(jobId: string): void {
  frames().delete(jobId);
  enabled().delete(jobId);
}

export function isLiveViewActive(jobId: string): boolean {
  const f = frames().get(jobId);
  return !!f && Date.now() - f.at < 15_000;
}

/** Drop frames for jobs that finished long ago (cheap memory hygiene). */
export function pruneLiveViews(maxAgeMs = 10 * 60_000): void {
  const now = Date.now();
  for (const [jobId, f] of frames()) if (now - f.at > maxAgeMs) clearLiveView(jobId);
}
