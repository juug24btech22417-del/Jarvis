// Capture + voice activity detection for the overlay.
//
// THREE THINGS THIS FIXES
// -----------------------
// 1. PROCESS SEPARATION. Every sample of the call used to be walked on the
//    React thread (level meters, chunking, and a 5s upload timer). Now the
//    energy measurement happens in an AudioWorklet — a real-time thread of its
//    own — which posts ~12 numbers a second. The renderer only ever sees
//    level, "speaking", and a finished Blob.
//
// 2. VAD. Five seconds of silence used to be recorded and uploaded to Whisper
//    like any other chunk: money, latency, and a queue that fills up. Now each
//    round reports how many milliseconds were actual speech and silent rounds
//    are never uploaded at all. Speech is detected against a SELF-MEASURING
//    noise floor, because a fixed dB threshold that works in a quiet office
//    fails in a cafe.
//
// 3. TWO EARS, LABELLED. System audio (the other side of the call) and the
//    microphone (you) are captured as separate streams and transcribed
//    separately, so the transcript can say who said it. Rounds stay in sync
//    because each ear has its own recorder running on its own clock.

export type CaptureKind = "system" | "mic";

export interface CaptureState {
  system: boolean;
  mic: boolean;
}

export interface ChunkInfo {
  /** Milliseconds of detected speech inside this round. */
  speechMs: number;
  /** Total length of the round. */
  roundMs: number;
  /** Average level across the round, 0..1. */
  level: number;
}

export interface CaptureHandlers {
  /** Human-readable line for the status bar. */
  onStatus?: (text: string, tone?: "info" | "warn") => void;
  /** Which ears are open — fires again when one dies mid-session. */
  onEars?: (state: CaptureState) => void;
  /** ~12/s per source. `level` is 0..1 for a meter, `speaking` drives the VAD dot. */
  onLevel?: (kind: CaptureKind, level: number, speaking: boolean) => void;
  /** A round that contained speech — upload it. */
  onChunk?: (kind: CaptureKind, blob: Blob, info: ChunkInfo) => void;
  /** A round that was silence (skipped) — only useful for the UI counter. */
  onSkipped?: (kind: CaptureKind, info: ChunkInfo) => void;
  onStarted?: (state: CaptureState) => void;
  onError?: (message: string) => void;
}

export interface CaptureOptions {
  handlers: CaptureHandlers;
  /** Length of one recorded round. */
  chunkMs?: number;
  /** Speech required in a round before it is worth transcribing. */
  minSpeechMs?: number;
  /** Force the microphone even when system audio works (for a room meeting). */
  preferMicOnly?: boolean;
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

/** Record exactly one self-contained chunk. With `timeslice` every chunk after
 * the first lacks the container header and Whisper rejects it, so a round is
 * its own start→stop recording. */
export function recordRound(stream: MediaStream, ms: number, mime?: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      resolve(null);
      return;
    }
    const parts: Blob[] = [];
    let done = false;
    const finish = (v: Blob | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) parts.push(e.data);
    };
    rec.onerror = () => finish(null);
    rec.onstop = () => finish(parts.length ? new Blob(parts, { type: mime || "audio/webm" }) : null);
    try {
      rec.start();
    } catch {
      finish(null);
      return;
    }
    window.setTimeout(() => {
      try {
        if (rec.state !== "inactive") rec.stop();
        else finish(parts.length ? new Blob(parts, { type: mime || "audio/webm" }) : null);
      } catch {
        finish(null);
      }
    }, ms);
  });
}

/**
 * The voice-activity worklet, served from /public.
 *
 * It cannot be a blob: the app's CSP is `script-src 'self' 'unsafe-inline'
 * 'unsafe-eval'` (public/overlay/vad-worklet.js explains why), and a worklet
 * module is fetched as a script — so the blob URL was rejected with AbortError
 * and the overlay silently fell back to an AnalyserNode on the render thread.
 */
const VAD_WORKLET_URL = "/overlay/vad-worklet.js";

/** Tunables for the self-measuring speech detector. */
const MIN_THRESHOLD = 0.006; // quieter than this is never speech, whatever the room does
const HANGOVER_MS = 420; // a pause inside a sentence is not the end of it
const NOISE_ADAPT = 0.06; // how fast the floor follows the room

interface SourceRuntime {
  kind: CaptureKind;
  /** What was opened — for display capture this still carries its video track. */
  stream: MediaStream;
  /**
   * What is RECORDED: the audio tracks only.
   *
   * A display-capture stream always has a video track attached, and
   * `MediaRecorder.start()` on it throws NotSupportedError — which is why the
   * system-audio ear never produced a single transcript. The video track also
   * has to stay on `stream` and stay live: stopping it ends the whole capture.
   */
  audio: MediaStream;
  failures: number;
  speechMs: number;
  levelSum: number;
  levelCount: number;
  peak: number;
  noiseFloor: number;
  lastVoiceAt: number;
  speaking: boolean;
  stop: () => void;
}

export class CaptureSession {
  private handlers: CaptureHandlers;
  private chunkMs: number;
  private minSpeechMs: number;
  private preferMicOnly: boolean;
  private sources: SourceRuntime[] = [];
  private ctx: AudioContext | null = null;
  private running = false;
  private mutedFlag = false;
  private workletUrl: string | null = null;
  private workletFailed = false;

  constructor(opts: CaptureOptions) {
    this.handlers = opts.handlers;
    this.chunkMs = opts.chunkMs ?? 5000;
    this.minSpeechMs = opts.minSpeechMs ?? 400;
    this.preferMicOnly = !!opts.preferMicOnly;
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  get active(): boolean {
    return this.running;
  }

  /**
   * Open every ear that exists and start the VAD + recording loops.
   *
   * Prefer system audio — it hears the OTHER side of the call, which a
   * microphone only ever picks up second-hand through the speakers — and open
   * the microphone alongside it when the machine has one, so the user's own
   * answers are in the transcript too.
   */
  async start(): Promise<CaptureState & { errors: string[] }> {
    if (this.running) return { ...this.presence(), errors: [] };
    this.running = true;
    const errors: string[] = [];
    const opens: Promise<void>[] = [];

    if (!this.preferMicOnly) {
      opens.push(
        this.openEar("system").catch((e) => {
          errors.push(`system audio: ${describeMediaError(e)}`);
        })
      );
    }
    opens.push(
      this.openEar("mic").catch((e) => {
        errors.push(`microphone: ${describeMediaError(e)}`);
      })
    );
    await Promise.all(opens);

    const state = this.presence();
    if (!state.system && !state.mic) {
      this.running = false;
      return { ...state, errors };
    }

    this.handlers.onStarted?.(state);
    this.handlers.onStatus?.(
      state.system && state.mic
        ? "listening to the call and the mic"
        : state.system
        ? "listening to system audio"
        : "listening to the mic",
      "info"
    );

    for (const s of this.sources) {
      void this.loop(s);
      void this.meter(s);
    }
    return { ...state, errors };
  }

  /** Mute is instant and reversible: the tracks stop feeding, nothing is
   * uploaded, and the streams stay open so unmute costs nothing. */
  setMuted(muted: boolean): void {
    this.mutedFlag = muted;
    for (const s of this.sources) {
      for (const t of s.stream.getTracks()) {
        try {
          t.enabled = !muted;
        } catch {
          /* track already ended */
        }
      }
      if (muted) {
        s.speaking = false;
        s.speechMs = 0;
        this.handlers.onLevel?.(s.kind, 0, false);
      }
    }
    this.handlers.onStatus?.(muted ? "muted — nothing is being captured" : "unmuted — capturing again", muted ? "warn" : "info");
  }

  stop(): void {
    this.running = false;
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already gone */
      }
      s.stream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {
          /* already stopped */
        }
      });
    }
    this.sources = [];
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
  }

  private presence(): CaptureState {
    return {
      system: this.sources.some((s) => s.kind === "system"),
      mic: this.sources.some((s) => s.kind === "mic"),
    };
  }

  private async openEar(kind: CaptureKind): Promise<void> {
    const md = navigator.mediaDevices;
    if (!md) throw new Error("no mediaDevices");

    let stream: MediaStream;
    if (kind === "system") {
      if (!md.getDisplayMedia) throw new Error("getDisplayMedia unavailable");
      // getDisplayMedia always wants a video track; in the Electron shell the
      // display-media handler answers with the primary screen plus loopback
      // audio. The video track is never rendered and never recorded — stopping
      // it can end the capture, so it is simply left running.
      const s = await md.getDisplayMedia({ video: true, audio: true });
      if (!s.getAudioTracks().length) {
        s.getTracks().forEach((t) => t.stop());
        throw new Error("no system audio track");
      }
      stream = s;
    } else {
      stream = await md.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    }

    const runtime: SourceRuntime = {
      kind,
      stream,
      audio: new MediaStream(stream.getAudioTracks()),
      failures: 0,
      speechMs: 0,
      levelSum: 0,
      levelCount: 0,
      peak: 0,
      noiseFloor: 0.002,
      lastVoiceAt: 0,
      speaking: false,
      stop: () => {},
    };
    this.sources.push(runtime);
    await this.attachVad(runtime).catch((e) => {
      // VAD is an optimisation, not a requirement: without it every round is
      // uploaded (the old behaviour) instead of the session dying.
      this.handlers.onStatus?.(`voice detection unavailable (${String(e).slice(0, 60)}) — uploading every round`, "warn");
    });
  }

  /** Measure energy off the render thread, with an AnalyserNode fallback for
   * the (rare) case where AudioWorklet cannot be created. */
  private async attachVad(s: SourceRuntime): Promise<void> {
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) this.ctx = new Ctx();
    const ctx = this.ctx;
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const node = ctx.createMediaStreamSource(s.stream);

    try {
      if (!ctx.audioWorklet) throw new Error("no audioWorklet");
      await ctx.audioWorklet.addModule(this.workletUrl || VAD_WORKLET_URL);
      const vad = new AudioWorkletNode(ctx, "jarvis-vad", { numberOfOutputs: 1, channelCount: 1 });
      vad.port.onmessage = (e) => this.ingest(s, Number(e.data) || 0);
      node.connect(vad);
      // Pull the graph with silence: a worklet with no destination may not run.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      vad.connect(sink);
      sink.connect(ctx.destination);
      s.stop = () => {
        try {
          vad.port.onmessage = null;
          node.disconnect();
          vad.disconnect();
          sink.disconnect();
        } catch {
          /* already detached */
        }
      };
      return;
    } catch (e) {
      // Once is enough: retrying addModule per ear only spams the console. The
      // analyser gives the same signal, measured on the render thread.
      if (!this.workletFailed) {
        this.workletFailed = true;
        console.warn(`[overlay] audio worklet unavailable (${String(e).slice(0, 80)}) — using an AnalyserNode`);
      }
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    node.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      if (!this.running) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      this.ingest(s, Math.sqrt(sum / buf.length));
    }, 80);
    s.stop = () => {
      window.clearInterval(timer);
      try {
        node.disconnect();
      } catch {
        /* already detached */
      }
    };
  }

  /** One energy sample → speech/no-speech, accumulated for the current round. */
  private ingest(s: SourceRuntime, rms: number): void {
    if (!this.running) return;
    if (this.mutedFlag) return;
    const now = Date.now();
    const threshold = Math.max(MIN_THRESHOLD, s.noiseFloor * 3);
    const speaking = rms > threshold;

    if (speaking) {
      s.lastVoiceAt = now;
      // While someone is talking the room is not being measured, so the floor
      // stays put instead of climbing over the voice itself.
      s.speechMs += 80;
    } else {
      s.noiseFloor = s.noiseFloor * (1 - NOISE_ADAPT) + rms * NOISE_ADAPT;
    }
    // Hangover: keep counting a short pause as part of the utterance.
    if (!speaking && now - s.lastVoiceAt < HANGOVER_MS) s.speechMs += 80;

    s.levelSum += rms;
    s.levelCount++;
    s.peak = Math.max(s.peak * 0.92, rms);
    s.speaking = speaking;
    this.handlers.onLevel?.(s.kind, normalise(rms), speaking || now - s.lastVoiceAt < HANGOVER_MS);
  }

  /** Push the meter at a human frame rate instead of once per worklet message. */
  private async meter(s: SourceRuntime): Promise<void> {
    while (this.running && this.sources.includes(s)) {
      await sleep(90);
      if (!this.running) return;
      if (this.mutedFlag) {
        this.handlers.onLevel?.(s.kind, 0, false);
        continue;
      }
      this.handlers.onLevel?.(s.kind, normalise(s.peak), s.speaking);
    }
  }

  /** Record this ear in rounds; upload the ones that contained speech. */
  private async loop(s: SourceRuntime): Promise<void> {
    const mime = pickMime();
    while (this.running && this.sources.includes(s)) {
      s.speechMs = 0;
      s.levelSum = 0;
      s.levelCount = 0;
      const blob = await recordRound(s.audio, this.chunkMs, mime);
      if (!this.running || !this.sources.includes(s)) return;

      // A MACROTASK yield between rounds, always.
      //
      // A round that fails instantly (a stream MediaRecorder refuses, a device
      // unplugged mid-call) used to resolve immediately, and awaiting an
      // already-resolved promise only drains the microtask queue — so the loop
      // spun forever without ever letting the renderer run. That is the freeze:
      // timers stop, the window stops repainting, nothing responds. The sleep
      // guarantees a turn for everything else, whatever the round did.
      await sleep(40);
      if (this.mutedFlag) continue;

      const info: ChunkInfo = {
        speechMs: s.speechMs,
        roundMs: this.chunkMs,
        level: s.levelCount ? s.levelSum / s.levelCount : 0,
      };

      if (!blob) {
        s.failures++;
        if (s.failures >= 3) {
          this.disableEar(s, `${s.kind === "mic" ? "microphone" : "system audio"} stopped producing audio`);
          return;
        }
        continue;
      }
      s.failures = 0;

      if (blob.size <= 2048 || info.speechMs < this.minSpeechMs) {
        this.handlers.onSkipped?.(s.kind, info);
        continue;
      }
      this.handlers.onChunk?.(s.kind, blob, info);
    }
  }

  /** An ear that can no longer record is closed and reported, instead of
   * silently doing nothing for the rest of the call. */
  private disableEar(s: SourceRuntime, reason: string): void {
    if (!this.sources.includes(s)) return;
    this.sources = this.sources.filter((x) => x !== s);
    try {
      s.stop();
    } catch {
      /* already detached */
    }
    s.stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* already stopped */
      }
    });
    const state = this.presence();
    this.handlers.onEars?.(state);
    this.handlers.onStatus?.(
      `${reason} — ${state.system || state.mic ? "still listening on the other ear" : "nothing is being captured"}`,
      "warn"
    );
  }
}

/** Map an RMS value onto 0..1 for a meter. Speech sits around 0.02-0.15 RMS, so
 * a linear scale would look dead; this is roughly logarithmic. */
export function normalise(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

export function describeMediaError(e: unknown): string {
  const err = e as Error & { name?: string };
  switch (err?.name) {
    case "NotFoundError":
      return "no device found (no microphone on this machine?)";
    case "NotAllowedError":
      return "permission denied";
    case "NotReadableError":
      return "device is busy in another app";
    case "AbortError":
      return "cancelled";
    default:
      return err?.message ? String(err.message).slice(0, 80) : String(e).slice(0, 80);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
