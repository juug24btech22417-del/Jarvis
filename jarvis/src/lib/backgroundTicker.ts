"use client";

// Background ticker and keepalive system.
//
// Browsers (Chrome / Edge / Firefox) aggressively throttle background tabs:
//   - window.setTimeout / setInterval is clamped to 1000ms (1 fps)
//   - requestAnimationFrame is paused completely (0 fps)
// This breaks system-wide air-mouse and eye control when the user switches to
// other desktop applications (Word, Chrome, games, Notepad, Discord, etc.).
//
// Solutions combined here:
//   1. Web Worker ticker: Workers run in a separate OS thread and their
//      setInterval is NOT throttled by Chrome when the tab loses focus.
//      Each tick posts a message to the main thread, triggering inference & cursor drive at ~60Hz.
//   2. Silent WebAudio node: Running a silent audio loop flags the browser tab
//      as active multimedia, exempting it from process suspension.

type TickCallback = (now: number) => void;

class BackgroundTickerManager {
  private worker: Worker | null = null;
  private audioCtx: AudioContext | null = null;
  private silentGain: GainNode | null = null;
  private oscillator: OscillatorNode | null = null;
  private listeners = new Set<TickCallback>();
  private holders = new Set<string>();
  private running = false;

  private initWorker(): Worker | null {
    if (typeof window === "undefined") return null;
    try {
      const code = `
        let timer = null;
        self.onmessage = function(e) {
          if (e.data === 'start') {
            if (!timer) {
              timer = setInterval(function() {
                self.postMessage(performance.now());
              }, 16);
            }
          } else if (e.data === 'stop') {
            if (timer) {
              clearInterval(timer);
              timer = null;
            }
          }
        };
      `;
      const blob = new Blob([code], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      const w = new Worker(url);
      w.onmessage = (e: MessageEvent<number>) => {
        const now = typeof e.data === "number" ? e.data : performance.now();
        for (const cb of this.listeners) {
          try {
            cb(now);
          } catch {
            /* ignore individual errors */
          }
        }
      };
      return w;
    } catch (err) {
      console.warn("[BackgroundTicker] Worker creation failed, fallback to timers:", err);
      return null;
    }
  }

  private initAudio() {
    if (typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!this.audioCtx) {
        this.audioCtx = new AudioCtx();
      }
      if (this.audioCtx.state === "suspended") {
        void this.audioCtx.resume();
      }
      if (!this.oscillator) {
        // Silent constant oscillator keeps Chrome's audio clock running indefinitely
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        gain.gain.value = 0.00001; // virtually silent
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        this.oscillator = osc;
        this.silentGain = gain;
      }
    } catch {
      /* AudioContext policy may wait for interaction */
    }
  }

  private stopAudio() {
    try {
      if (this.oscillator) {
        this.oscillator.stop();
        this.oscillator.disconnect();
        this.oscillator = null;
      }
      if (this.silentGain) {
        this.silentGain.disconnect();
        this.silentGain = null;
      }
    } catch {
      /* ignore */
    }
  }

  public acquire(reason: string): () => void {
    this.holders.add(reason);
    if (!this.running) {
      this.running = true;
      if (!this.worker) {
        this.worker = this.initWorker();
      }
      this.worker?.postMessage("start");
      this.initAudio();
    }

    return () => {
      this.holders.delete(reason);
      if (this.holders.size === 0 && this.running) {
        this.running = false;
        this.worker?.postMessage("stop");
        this.stopAudio();
      }
    };
  }

  public subscribe(cb: TickCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public isRunning(): boolean {
    return this.running;
  }
}

export const backgroundTicker = new BackgroundTickerManager();
