// Pure sign-in detection logic — no Playwright, no network.
//
// The previous browser_login heuristic declared success the moment ANY cookie
// matched /session|token|auth|sid|login|jwt/, which fires for anonymous
// visitors (LinkedIn sets session-ish cookies before you type anything). The
// mission then closed the window the user was supposed to sign in through.
//
// This module makes the decision explicit and testable:
//   • a cookie only counts when it is NEW (or its value CHANGED) versus the
//     baseline captured right after the page first loaded
//   • a URL only counts when we STARTED on an auth page and have since left it,
//     stayed away for two consecutive polls, and a minimum dwell has passed
//   • nothing counts inside the dwell window, so an instant redirect (or the
//     login page bouncing to itself) can never be mistaken for a sign-in

export interface CookieLike {
  name: string;
  value: string;
}

/** URLs that mean "you are still on a sign-in / challenge screen". */
export const AUTH_URL_RE =
  /(login|sign-?in|sign_?in|auth|register|signup|sign-?up|otp|challenge|checkpoint|two-?factor|2fa|verify|sso)/i;

/** Cookie names that only appear once a real session exists. */
const STRONG_AUTH_COOKIE_RE =
  /(^|[._-])(li_at|auth_token|access_?token|refresh_?token|id_?token|jwt|session_?id|sessionid|jsessionid|sid|logged_?in|auth_?user|user_?session|bearer|token)([._-]|$)/i;

/** Minimum time on the page before ANY signal is believable. */
export const LOGIN_MIN_DWELL_MS = 4_000;

export function isAuthUrl(url: string): boolean {
  return AUTH_URL_RE.test(url || "");
}

/**
 * Find a cookie that proves a session exists: its name must look like a real
 * auth token AND it must be absent from (or changed since) the baseline.
 */
export function findStrongAuthCookie(
  current: CookieLike[],
  baseline: CookieLike[]
): { name: string } | null {
  const before = new Map(baseline.map((c) => [c.name, c.value]));
  for (const c of current) {
    if (!c.name || !c.value) continue;
    if (!STRONG_AUTH_COOKIE_RE.test(c.name)) continue;
    const prev = before.get(c.name);
    if (prev === undefined || prev !== c.value) return { name: c.name };
  }
  return null;
}

export interface LoginSignalInput {
  /** ms timestamp when the login page finished loading. */
  startedAt: number;
  /** ms timestamp of this evaluation. */
  now: number;
  /** URL right after the initial navigation. */
  baselineUrl: string;
  /** URL at this evaluation. */
  currentUrl: string;
  /** True when currentUrl was also seen in the previous poll. */
  urlStable: boolean;
  baselineCookies: CookieLike[];
  currentCookies: CookieLike[];
}

export interface LoginSignalResult {
  signedIn: boolean;
  reason: "cookie" | "url" | "none";
  detail: string;
}

/**
 * Decide whether the user has actually signed in. Conservative by design:
 * every path requires the dwell timer, and the URL path additionally requires
 * that we started on an auth page and have left it *stably*.
 */
export function evaluateLoginSignal(input: LoginSignalInput): LoginSignalResult {
  const { startedAt, now, baselineUrl, currentUrl, urlStable } = input;

  if (now - startedAt < LOGIN_MIN_DWELL_MS) {
    return { signedIn: false, reason: "none", detail: "still inside the settle window" };
  }

  const cookie = findStrongAuthCookie(input.currentCookies, input.baselineCookies);
  if (cookie) {
    return { signedIn: true, reason: "cookie", detail: `session cookie "${cookie.name}" was set` };
  }

  // Only meaningful when the flow started on an auth screen: leaving it and
  // staying away is the classic "you're now logged in" signal.
  if (isAuthUrl(baselineUrl) && !isAuthUrl(currentUrl) && urlStable && currentUrl !== baselineUrl) {
    return { signedIn: true, reason: "url", detail: `left the sign-in page for ${currentUrl.slice(0, 90)}` };
  }

  return { signedIn: false, reason: "none", detail: "no positive sign-in signal yet" };
}

/** Human message for the report; never claims success unless it happened. */
export function loginMessage(opts: {
  site: string;
  success: boolean;
  reason?: "cookie" | "url" | "none";
  detail?: string;
  closedByUser?: boolean;
  cancelled?: boolean;
}): string {
  const site = opts.site || "the site";
  if (opts.success) {
    return `Signed in to ${site} — the session is saved to your profile and will be reused automatically by future missions.`;
  }
  if (opts.cancelled) {
    return `The ${site} sign-in was aborted before you finished, so nothing was saved.`;
  }
  if (opts.closedByUser) {
    return `The ${site} sign-in window was closed before a session was detected, so nothing was saved. Run it again and finish signing in, then close the window.`;
  }
  return `No sign-in was detected for ${site} within the time limit — nothing was saved. Run it again and finish signing in inside the window (it stays open until you close it).`;
}
