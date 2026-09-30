"use client";

// Shared sender for /api/os/input — the anti-lag, anti-replay layer for
// every vision-driven cursor (air-mouse, eye control, gestures).
//
// Three mechanisms:
//
// 1. LATEST-WINS COALESCING — `move` requests are capped in flight; a new
//    move aborts superseded ones still on the wire. Without this, a tab or
//    server hiccup queues hundreds of stale positions that the server then
//    executes in order LATER — the "I left it for a while and it did every
//    action I had done" bug.
//
// 2. STALENESS SEQUENCE — every request carries a monotonically increasing
//    seq + session id. The server drops anything older than the newest seq
//    it has applied, so even requests that already left the browser can't
//    replay stale input out of order.
//
// 3. DEADLINE ABORTS — every request self-destructs after 1.5s instead of
//    hanging forever and holding a browser socket.

let seq = 0;
const SESSION_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

const DEADLINE_MS = 1500;

// ONE slot for moves — a new move ABORTS the one still on the wire. The old
// "2 inflight" coalescer aborted the NEWEST request when the slots filled,
// so the stalest position always finished executing and the cursor arrived
// at outdated coordinates late ("laggy live mode, smooth practice mode":
// practice never touches this path). With one slot + latest-wins, exactly
// the freshest position is ever in flight — trivially the right one.
let newestMove: AbortController | null = null;

type OsInputBody = { action: string } & Record<string, unknown>;

function post(body: OsInputBody, signal: AbortSignal) {
  return fetch("/api/os/input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      sid: SESSION_ID,
      seq: ++seq,
    }),
    signal,
  }).catch(() => {
    // Network errors are expected while the tab throttles — never bubble.
  });
}

export function sendOsInput(body: OsInputBody) {
  if (body.action === "move" || body.action === "move-rel") {
    // Latest-wins: kill the previous move (stale by definition) and take
    // the slot. The server's seq guard still drops anything that already
    // left before the abort landed.
    newestMove?.abort();
    const ac = new AbortController();
    newestMove = ac;
    const timer = setTimeout(() => ac.abort(), DEADLINE_MS);
    void post(body, ac.signal).finally(() => {
      clearTimeout(timer);
      if (newestMove === ac) newestMove = null;
    });
    return;
  }

  // Discrete actions (click / down / up / scroll / key / type) are rare —
  // just send with a deadline so they can never hang a socket.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEADLINE_MS);
  void post(body, ac.signal).finally(() => clearTimeout(timer));
}
