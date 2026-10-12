// Voice activity detection for the stealth overlay — runs on the audio thread.
//
// WHY A FILE AND NOT A BLOB
// -------------------------
// AudioWorklet modules are fetched as SCRIPTS, so the app's Content Security
// Policy applies. The policy is `script-src 'self' 'unsafe-inline' 'unsafe-eval'`
// — no `blob:` — so `addModule(URL.createObjectURL(...))` was rejected with
// "AbortError: The user aborted a request." and the overlay silently fell back
// to polling an AnalyserNode on the render thread. Same-origin file: allowed,
// and it keeps the CSP as tight as it was.
//
// All this does is measure energy and post it ~12 times a second. Deciding what
// counts as speech (and the noise floor it is measured against) happens on the
// main thread, where the tuning is visible and testable.

class JarvisVad extends AudioWorkletProcessor {
  constructor() {
    super();
    this.acc = 0;
    this.n = 0;
    this.count = 0;
    // ~80ms windows: long enough that a consonant survives, short enough that
    // the speech/silence dot feels instant.
    this.blocks = Math.max(1, Math.round((sampleRate * 0.08) / 128));
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (ch && ch.length) {
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      this.acc += sum;
      this.n += ch.length;
      this.count++;
      if (this.count >= this.blocks) {
        this.port.postMessage(this.n ? Math.sqrt(this.acc / this.n) : 0);
        this.acc = 0;
        this.n = 0;
        this.count = 0;
      }
    }
    // Keep the processor alive even while the input is silent.
    return true;
  }
}

registerProcessor("jarvis-vad", JarvisVad);
