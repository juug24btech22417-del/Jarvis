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
