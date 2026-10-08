// Network resilience for JARVIS.
//
// THE PROBLEM THIS SOLVES
// JARVIS fans out to many providers (Groq, Gemini, OpenRouter, NVIDIA…). When
// the machine's DNS resolver hiccups, every one of them fails in the SAME
// instant with `TypeError: fetch failed` — which reads as "all models are down"
// but is actually a single shared failure. Measured on this machine:
//
//   curl https://api.groq.com            -> 200   (OS resolver fine)
//   node fetch("https://api.groq.com")   -> 200   (works when DNS cooperates)
//   dns.resolve4("api.groq.com")         -> ECONNREFUSED  (resolver refuses
//                                          direct queries — a flaky local
//                                          resolver setup)
//
// The provider logs only printed `err.message`, which is literally the string
// "fetch failed" — the real reason lives in `err.cause`. That is why this was
// misdiagnosed as provider outages and rate limits for so long.
//
// A DNS blip is sub-second, so a short delayed retry clears the overwhelming
// majority of them. Installing the wrapper once at boot covers every fetch in
// the server, including code written long before this existed.

const RETRY_DELAY_MS = 350;
const MAX_ATTEMPTS = 3;

/** Error codes worth retrying. These are transient/resolution-level failures. */
const RETRYABLE_CODES = new Set([
  "EAI_AGAIN", // temporary DNS failure — the classic "all providers failed"
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

/** Walk the cause chain, which is where the real error code lives. */
function chain(err: any, limit = 5): any[] {
  const out: any[] = [];
  let e = err;
  for (let d = 0; e && d < limit; d++) {
    out.push(e);
    e = e.cause;
  }
  return out;
}

/**
 * True when a failure is a transient network/DNS problem worth one more try.
 * Never treats a deliberate abort as retryable.
 */
export function isRetryableNetworkError(err: any): boolean {
  if (!err) return false;
  if (err.name === "AbortError") return false;
  for (const e of chain(err)) {
    if (e.code && RETRYABLE_CODES.has(String(e.code))) return true;
    if (e.errno && RETRYABLE_CODES.has(String(e.errno))) return true;
  }
  return false;
}

/**
 * Human-readable error including the underlying cause codes, so a log line can
 * never again say just "fetch failed" when the truth was EAI_AGAIN.
 */
export function describeFetchError(err: any): string {
  const codes = new Set<string>();
  for (const e of chain(err)) {
    if (e.code) codes.add(String(e.code));
    else if (e.errno) codes.add(String(e.errno));
  }
  const base = err?.message || String(err) || "fetch failed";
  return codes.size ? `${base} [cause: ${[...codes].join(" <- ")}]` : base;
}

let installed = false;

/**
 * Wrap globalThis.fetch with a bounded retry on transient network errors.
 * Idempotent and safe to call more than once. Streaming is unaffected: if fetch
 * rejects, no response body was handed to a consumer, so nothing is duplicated.
 */
export function installFetchRetry(): void {
  if (installed) return;
  const original = globalThis.fetch;
  if (typeof original !== "function") return;
  installed = true;

  const retrying = async (input: any, init?: any): Promise<Response> => {
    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await original(input, init);
      } catch (err: any) {
        lastErr = err;
        // A caller-requested abort is intentional — pass it straight through.
        if (init?.signal?.aborted) throw err;
        if (!isRetryableNetworkError(err) || attempt === MAX_ATTEMPTS) throw err;
        if (attempt === 1) {
          console.warn(`[NetGuard] transient failure, retrying: ${describeFetchError(err)}`);
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
    throw lastErr;
  };

  globalThis.fetch = retrying as typeof fetch;
}

/** Exposed for diagnostics/tests. */
export function isFetchRetryInstalled(): boolean {
  return installed;
}
