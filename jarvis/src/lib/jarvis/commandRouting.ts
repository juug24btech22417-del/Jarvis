/**
 * Shared command-routing predicates.
 *
 * These decide which engine a spoken/typed command belongs to. They live here
 * rather than inline in the command bar so the rules have one source of truth
 * and can be unit-tested without mounting the React tree.
 */

/** Destinations that are explicitly NOT the local Spotify client. */
const OTHER_MEDIA_TARGET_RE =
  /\b(youtube|yt|instagram|reels?|shorts?|soundcloud|gaana|jiosaavn|apple music|browser|chrome|firefox|edge|safari)\b/i;

/**
 * Whether the Spotify transport shortcuts (play / pause / next / previous) may
 * handle this command.
 *
 * Those shortcuts act on the LOCAL Spotify client, so a command that names a
 * different destination must never trigger them — otherwise
 * "play back-to-back songs on youtube" is hijacked into a Spotify "previous
 * track" call and fails with the nonsense "time travel" error. Naming Spotify
 * explicitly always wins, so "pause spotify" still works while YouTube is open.
 */
export function allowsSpotifyTransport(command: string): boolean {
  if (!command) return false;
  return !OTHER_MEDIA_TARGET_RE.test(command) || /\bspotify\b/i.test(command);
}

/**
 * Scrollable social feeds and where they live.
 *
 * Shorts, Reels and TikTok's For-You page are snap-scroll feeds: they advance
 * with the arrow keys (or a dedicated next control), NOT with ordinary window
 * scrolling — so a plain "open X" just lands on the first video and stalls.
 */
export const FEED_TARGETS: Record<string, { url: string; label: string }> = {
  youtube: { url: "https://www.youtube.com/shorts", label: "YouTube Shorts" },
  instagram: { url: "https://www.instagram.com/reels/", label: "Instagram Reels" },
  tiktok: { url: "https://www.tiktok.com/foryou", label: "TikTok For You" },
  facebook: { url: "https://www.facebook.com/reel/", label: "Facebook Reels" },
  snapchat: { url: "https://www.snapchat.com/spotlight", label: "Snapchat Spotlight" },
};

/**
 * Detect "open <site> and scroll shorts / reels" style goals and resolve them to
 * a concrete feed. Returns null for anything else, so plain "open youtube" and
 * "play X on youtube" are untouched.
 */
export function feedScrollIntent(goal: string): { site: string; url: string; label: string } | null {
  const g = goal || "";
  const wantsFeed = /\b(shorts?|reels?|foryou|for\s?you|fyp|spotlight)\b/i.test(g);
  // Suffix-tolerant on purpose: people type "scrolling" / "swiping" / "browsing".
  // (`browse\w*`, not `brows\w*`, so "in the browser" doesn't count as a verb.)
  const wantsScroll = /\b(?:scroll\w*|swip\w*|browse\w*|flip\w*|go through)\b/i.test(g);
  if (!wantsFeed && !wantsScroll) return null;

  let site = Object.keys(FEED_TARGETS).find((s) => new RegExp(`(^|[^a-z0-9])${s}([^a-z0-9]|$)`, "i").test(g));
  // Bare "scroll shorts" / "scroll reels" default to the obvious feed.
  if (!site) {
    if (/\bshorts?\b/i.test(g)) site = "youtube";
    else if (/\breels?\b/i.test(g)) site = "instagram";
  }
  if (!site) return null;

  // A scroll verb alone is too vague ("scroll youtube comments"). It counts as a
  // feed request when a feed noun is named, when the sentence chains the scroll
  // onto opening the site ("… and scroll"), or when it says to keep going.
  const chainedScroll = /\b(?:and|then)\s+(?:keep\s+)?(?:scroll\w*|swip\w*|browse\w*|flip\w*)\b/i.test(g);
  const keepScrolling = /\bkeep\s+(?:scroll\w*|swip\w*)\b/i.test(g);
  if (!wantsFeed && !chainedScroll && !keepScrolling) return null;

  const { url, label } = FEED_TARGETS[site];
  return { site, url, label };
}

/** A concrete destination as a dotted host, e.g. github.com, amazon.in, nasa.gov. */
const LIVE_HOST_RE =
  /\b((?:[a-z0-9-]+\.)+(?:com|in|org|net|io|dev|co|gov|edu|ai|me|app|shop|store|tv|xyz))\b/i;

/**
 * Well-known destination BRANDS, the way people actually say them ("go to
 * amazon", "head to spotify"). Kept as one list so any spoken brand reaches the
 * live agent instead of a hardcoded handler.
 *
 * Deliberately EXCLUDES media/social sites that already have purpose-built
 * engines — youtube, instagram, facebook, tiktok — so their feed and playback
 * handlers keep priority. Naming one of those with an explicit navigation verb
 * still works whenever it is written as a real host.
 */
const LIVE_BRAND_RE =
  /\b(?:amazon|flipkart|myntra|ajio|meesho|snapdeal|ebay|aliexpress|swiggy|zomato|bookmyshow|makemytrip|goibibo|reddit|quora|stack ?overflow|geeksforgeeks|linkedin|naukri|indeed|nasa|wikipedia|imdb|hacker\s?news|github|gmail)\b/i;

/** Verbs that mean "take the browser there". */
const LIVE_NAV_RE = /\b(?:go|head|navigate|browse|take me)\s+(?:over\s+)?(?:to|into)\b/i;

/** "open <site>" also aims the browser at a destination. */
const LIVE_OPEN_RE = /\bopen\b/i;

/**
 * Media/social brands that have their own local handlers (desktop app open,
 * feed scrolling, playback). A bare "open spotify" or "open youtube and play X"
 * must stay with those; only an explicit navigation verb ("go to spotify and …")
 * hands them to the live agent.
 */
const LIVE_MEDIA_BRAND_RE =
  /\b(?:spotify|youtube|yt|netflix|prime video|hotstar|soundcloud|instagram|facebook|tiktok|snapchat)\b/i;

/**
 * Commerce / form actions that only make sense ON the named site. This is what
 * lets "add this to the cart on amazon" (no "go to") still reach the live
 * agent. Deliberately narrow — it must NOT include "search" or "play", or it
 * would steal "play X on spotify" from the local Spotify client.
 */
const LIVE_ACTION_RE =
  /\b(?:add\b[^.]{0,50}?\bto\s+(?:the\s+|my\s+)?(?:cart|bag|basket)\b|buy|purchase|order|check ?out|proceed to (?:buy|checkout|pay|payment)|place an? order|fill)\b/i;

/** The https URL for the first dotted host named in the text, or undefined. */
export function namedSiteUrl(text: string): string | undefined {
  const m = String(text || "").match(LIVE_HOST_RE);
  return m ? `https://${m[1].toLowerCase()}` : undefined;
}

/** Whether the text names a real site, by host or by well-known brand. */
export function mentionsLiveSite(text: string): boolean {
  const t = String(text || "");
  return LIVE_HOST_RE.test(t) || LIVE_BRAND_RE.test(t);
}

/**
 * Detect an unmistakable LIVE BROWSING errand — "go to <site> … and tell me X".
 *
 * This has to be decided before every other keyword handler, because the ones
 * that run first are greedy and swallow these commands:
 *   - the word "playwright" opened the Browser Automation PANEL ("…open the
 *     microsoft/playwright repository…"),
 *   - "price of" was eaten as a Mission Control research run,
 *   - and the generic `search|google|look up|find` matcher opened google.com in
 *     a new tab, so nothing was ever browsed live.
 *
 * Deliberately high-precision: it needs an explicit navigation verb aimed at a
 * real site (or a bare URL). "find the best free react course" and "research
 * X and open the best one" stay with Mission Control, and "open youtube"
 * stays with the existing media handlers.
 *
 * Returns the goal to hand the generic browser agent, or null.
 */
export function liveBrowseIntent(command: string): { task: string; url?: string } | null {
  const raw = (command || "")
    .trim()
    .replace(/^(?:hey\s+)?jarvis[,:]?\s*/i, "")
    .trim();
  if (!raw || raw.length > 400) return null;

  // A pasted URL is always a browse job.
  const urlMatch = raw.match(/https?:\/\/[^\s]+/i);
  const pasted = urlMatch ? urlMatch[0].replace(/[.,;)]+$/, "") : undefined;
  if (pasted) return { task: raw, url: pasted };

  // Spotify / YouTube / Instagram … have LOCAL handlers (the desktop app, the
  // Web API, feed scrolling). "go to spotify and play my liked songs" must use
  // the installed app, not a browser tab — so when a media brand is the only
  // thing named, stand aside and let those handlers take it.
  if (
    LIVE_MEDIA_BRAND_RE.test(raw) &&
    !LIVE_HOST_RE.test(raw) &&
    !LIVE_BRAND_RE.test(raw)
  ) {
    return null;
  }

  // Otherwise it must name a real site (host or brand) AND aim the browser at
  // it. "go to nasa.gov" and "open wikipedia" count; "open chrome" does not.
  if (!mentionsLiveSite(raw)) return null;

  const aims =
    LIVE_NAV_RE.test(raw) ||
    LIVE_ACTION_RE.test(raw) ||
    // "open" counts for ordinary sites, but a media brand needs a real
    // navigation verb so its own app/feed/playback handler keeps priority.
    (LIVE_OPEN_RE.test(raw) && !LIVE_MEDIA_BRAND_RE.test(raw));
  if (!aims) return null;

  // A bare host becomes a concrete start URL so the agent can never mistake
  // nasa.gov for nasa.com — the window opens on the site the user actually said.
  return { task: raw, url: namedSiteUrl(raw) };
}

/**
 * "Open mission control" → bring the deck up WITHOUT starting a run.
 *
 * The mission matcher only fires when the sentence carries an actual goal, so a
 * bare panel request used to fall through every handler and end up in chat.
 * A goal attached after a colon is still a mission, not a panel open.
 */
export function isMissionControlOpen(command: string): boolean {
  const t = (command || "")
    .trim()
    .replace(/^(?:hey\s+)?jarvis[,:]?\s*/i, "")
    .trim();
  if (!/\bmission\s*control\b/i.test(t)) return false;
  // "mission control: find the best react course" is a mission.
  if (/^mission\s*control\s*[:\u2014-]\s*\S/i.test(t)) return false;
  if (/^(?:the\s+)?mission\s*control$/i.test(t)) return true;
  return /^(?:please\s+)?(?:open|show|launch|bring\s+up|pull\s+up|view|display|go\s+to|take\s+me\s+to|start)\b/i.test(t);
}

/** The feed URL for an explicitly named site, or null when we have none. */
export function feedTargetForSite(site: string): { site: string; url: string; label: string } | null {
  const key = (site || "").toLowerCase().trim();
  const hit = FEED_TARGETS[key];
  return hit ? { site: key, url: hit.url, label: hit.label } : null;
}
