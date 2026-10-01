// Shared "find my phone" ping state.
//
// The phone can be looking at one of two pages, and they discover the ping
// differently:
//   • /teleport (the QR teleport page) polls /api/teleport?pingCheck=1
//   • /remote   (the broker's remote page) polls the broker's /api/ping
//
// Both must fire, so a single raise lives here and each surface reads it.
// A ping is STICKY: it keeps ringing until the phone acknowledges or the
// window expires, because Android suspends background tabs.

const g = globalThis as unknown as {
  __jarvisPhonePingActive?: number;
  __jarvisPhoneContactAt?: number;
};

export const PHONE_PING_WINDOW_MS = 120_000;

/** Raise the ping and return the timestamp it was raised at. */
export function raisePhonePing(): number {
  const at = Date.now();
  g.__jarvisPhonePingActive = at;
  return at;
}

/** True while a ping is still inside its window. */
export function phonePingActive(): boolean {
  return Date.now() - (g.__jarvisPhonePingActive || 0) < PHONE_PING_WINDOW_MS;
}

/** When the last ping was raised (0 = never). */
export function phonePingAt(): number {
  return g.__jarvisPhonePingActive || 0;
}

/**
 * True for loopback addresses AND for the "localhost" host header.
 *
 * Used to tell "this PC" apart from "the phone": the phone always reaches the
 * dev server through the LAN IP, while the desktop uses localhost.
 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return true;
  const bare = host.split(":")[0].trim().toLowerCase();
  return (
    bare === "localhost" ||
    bare === "::1" ||
    bare === "127.0.0.1" ||
    bare.startsWith("127.") ||
    bare.startsWith("::ffff:127.")
  );
}

/** Remember that a real phone touched one of the phone surfaces just now. */
export function notePhoneContact(at: number = Date.now()): void {
  g.__jarvisPhoneContactAt = at;
}

/**
 * How long ago a phone last checked in (from EITHER surface), or null if none
 * has been seen since the server started.
 */
export function phoneContactAgeMs(): number | null {
  return g.__jarvisPhoneContactAt ? Date.now() - g.__jarvisPhoneContactAt : null;
}
