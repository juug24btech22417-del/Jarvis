import * as cheerio from "cheerio";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

if (!(chromium as any)._plugins?.some((p: any) => p.name === "stealth")) {
  chromium.use(stealthPlugin());
}

export interface SearchHit {
  url: string;
  title: string;
  description: string;
}

/**
 * URLs that are never useful mission targets: block-page help threads,
 * search engine shells, and anti-bot interstitials.
 */
const BAD_URL_RE =
  /(reddit\.com\/r\/(help|modsupport|bugs)|support\.google\.|google\.com\/(search|url)|duckduckgo\.com|bing\.com\/search|\/search\?|captcha|blocked|banned)/i;

/** Titles/snippets that reveal the page is a block/captcha screen, not content. */
 const BAD_TEXT_RE =
  /\b(you('|r|'re|ve)?\s+(been\s+)?(blocked|banned|rate.?limited)|blocked by|access denied|unusual traffic|verify (you are|that you are) human|are you a robot|confirm (you are|that you are) human|just a moment|attention required|permission denied|403 forbidden)\b/i;

/**
 * Drop block/captcha/help pages, dedupe identical URLs, and cap 2 results
 * per host — without this, Firecrawl happily returns 3 copies of Reddit's
 * "you've been blocked" help thread and the mission opens garbage.
 */
export function sanitizeHits(hits: SearchHit[]): SearchHit[] {
  const seenUrls = new Set<string>();
  const hostCount = new Map<string, number>();
  const out: SearchHit[] = [];
  for (const h of hits) {
    let url = h.url;
    if (!url || !url.startsWith("http")) continue;
    try {
      const u = new URL(url);
      u.hash = "";
      url = u.toString().replace(/\/$/, "");
    } catch {
      continue;
    }
    const key = url.toLowerCase();
    if (seenUrls.has(key)) continue;
    if (BAD_URL_RE.test(url) || BAD_TEXT_RE.test(`${h.title} ${h.description}`)) continue;
    let host = "";
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    const n = hostCount.get(host) ?? 0;
    if (n >= 2) continue; // max 2 per host — diversity over repetition
    seenUrls.add(key);
    hostCount.set(host, n + 1);
    out.push({ ...h, url });
  }
  return out;
}

/**
 * Clean DuckDuckGo redirect link: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
 */
function cleanDuckDuckGoUrl(rawUrl: string): string {
  try {
    if (rawUrl.startsWith("//")) rawUrl = "https:" + rawUrl;
    if (rawUrl.includes("duckduckgo.com/l/?")) {
      const parsed = new URL(rawUrl);
      const target = parsed.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * Tier 1: Search via Firecrawl (Fast search without heavy synchronous scraping)
 */
async function searchWithFirecrawl(query: string, limit: number): Promise<SearchHit[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return [];

  const { FirecrawlApp } = await import("@mendable/firecrawl-js").then((m) => ({
    FirecrawlApp: (m.default || m) as any,
  }));

  const client = new FirecrawlApp({ apiKey });

  // 12-second abort timeout so Firecrawl never hangs the user
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Firecrawl search 12s timeout")), 12_000)
  );

  const searchPromise = (async () => {
    const res = await client.v1.search(query, {
      limit,
      // Do NOT pass scrapeOptions to avoid slow synchronous full-page crawls
    });
    const docs = res?.data ?? [];
    return docs
      .map((d: any) => ({
        url: String(d.metadata?.sourceURL || d.metadata?.url || d.url || ""),
        title: String(d.metadata?.title || d.title || "Untitled"),
        description: String(d.description || d.metadata?.description || (d.markdown || "").slice(0, 250)).trim(),
      }))
      .filter((h: SearchHit) => h.url && h.url.startsWith("http"));
  })();

  return await Promise.race([searchPromise, timeoutPromise]);
}

/**
 * Tier 2: Instant public search via DuckDuckGo HTML (zero API keys, 0 rate limits, <1s)
 */
async function searchWithDuckDuckGo(query: string, limit: number): Promise<SearchHit[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
    const html = await res.text();
    const $ = cheerio.load(html);
    const hits: SearchHit[] = [];

    $(".result").each((_, el) => {
      if (hits.length >= limit) return;
      const titleEl = $(el).find(".result__title a, .result__a");
      const title = titleEl.text().trim();
      const rawHref = titleEl.attr("href") || "";
      const cleanUrl = cleanDuckDuckGoUrl(rawHref);
      const snippet = $(el).find(".result__snippet").text().trim();

      if (cleanUrl && cleanUrl.startsWith("http") && !cleanUrl.includes("duckduckgo.com")) {
        hits.push({
          url: cleanUrl,
          title: title || cleanUrl,
          description: snippet || title,
        });
      }
    });

    return hits;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tier 3: Headless Playwright DuckDuckGo Search (Stealth Chromium browser fallback)
 */
async function searchWithPlaywright(query: string, limit: number): Promise<SearchHit[]> {
  let browser: any = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });

    const results = await page.evaluate((maxResults: number) => {
      const items: Array<{ url: string; title: string; description: string }> = [];
      const links = document.querySelectorAll(".result");
      for (const el of Array.from(links)) {
        if (items.length >= maxResults) break;
        const a = el.querySelector(".result__title a, .result__a") as HTMLAnchorElement | null;
        const snip = el.querySelector(".result__snippet")?.textContent?.trim() || "";
        if (a && a.href) {
          items.push({
            url: a.href,
            title: a.textContent?.trim() || a.href,
            description: snip,
          });
        }
      }
      return items;
    }, limit);

    return results
      .map((r: any) => ({
        url: cleanDuckDuckGoUrl(r.url),
        title: r.title,
        description: r.description,
      }))
      .filter((r: SearchHit) => r.url.startsWith("http") && !r.url.includes("duckduckgo.com"));
  } catch (e: any) {
    console.warn("[WebSearch] Playwright fallback failed:", e.message);
    return [];
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Curated smart heuristic fallbacks for popular queries (movies, flights, recipes, tech)
 * to guarantee that a downstream step never crashes if web search is completely offline.
 */
function getCuratedFallbacks(query: string): SearchHit[] {
  const q = query.toLowerCase();
  if (q.includes("movie") || q.includes("watch")) {
    return [
      {
        title: "Tubi TV — Free Movies & TV Shows",
        url: "https://tubitv.com",
        description: "Watch free movies and TV shows online in HD on Tubi. 100% legal streaming, no credit card required.",
      },
      {
        title: "YouTube Free Movies & TV",
        url: "https://www.youtube.com/feed/storefront?bp=4gImCBwSAggDEgIIBBIECgIIAhoQCgIIARIKCghmb3JfdW5kZXISAggE",
        description: "Browse the collection of free full-length movies available legally on YouTube.",
      },
      {
        title: "Pluto TV — Drop In. Watch Free.",
        url: "https://pluto.tv",
        description: "Watch free movies and live TV channels online streaming 24/7.",
      },
    ];
  }

  if (q.includes("flight") || q.includes("ticket") || q.includes("bengaluru") || q.includes("delhi")) {
    return [
      {
        title: "Google Flights — Flight Search & Price Comparison",
        url: `https://www.google.com/travel/flights?q=${encodeURIComponent(query)}`,
        description: "Find cheap flights and track airline ticket prices with Google Flights.",
      },
      {
        title: "Skyscanner — Cheap Flights Comparison",
        url: `https://www.skyscanner.co.in/transport/flights-from/blr/?adultsv2=1`,
        description: "Compare low cost airline tickets and find the best flight deals.",
      },
    ];
  }

  if (q.includes("pizza") || q.includes("restaurant") || q.includes("food") || q.includes("near me")) {
    return [
      {
        title: "Google Maps — Nearby Places Search",
        url: `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
        description: `Explore ratings, reviews, and opening hours on Google Maps for ${query}.`,
      },
      {
        title: "Zomato — Restaurant Finder",
        url: `https://www.zomato.com/bangalore`,
        description: "Find the best restaurants, cafes and bars in Bengaluru.",
      },
    ];
  }

  // Generic Google Search link fallback
  return [
    {
      title: `Google Search: "${query}"`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      description: `Search results and links for ${query}`,
    },
  ];
}

/**
 * Universal Zero-Failure Web Search
 * Waterfall: Firecrawl -> DuckDuckGo HTML -> Playwright Stealth -> Smart Heuristics
 */
export async function searchWebWithFallback(
  query: string,
  limit: number = 5,
  log?: (msg: string) => void
): Promise<SearchHit[]> {
  const l = (m: string) => {
    console.log(`[WebSearch] ${m}`);
    if (log) log(m);
  };

  // Tier 1: Firecrawl
  try {
    l(`Querying primary search engine: "${query}"`);
    const hits = sanitizeHits(await searchWithFirecrawl(query, limit));
    if (hits.length > 0) {
      l(`Primary search returned ${hits.length} verified results`);
      return hits;
    }
    l(`Primary search results unusable after quality filter — trying secondary...`);
  } catch (err: any) {
    l(`Primary search unavailable (${err.message}). Engaging secondary real-time search...`);
  }

  // Tier 2: DuckDuckGo HTML
  try {
    const hits = sanitizeHits(await searchWithDuckDuckGo(query, limit));
    if (hits.length > 0) {
      l(`Secondary search returned ${hits.length} web results`);
      return hits;
    }
  } catch (err: any) {
    l(`Secondary search error (${err.message}). Activating browser automation search...`);
  }

  // Tier 3: Playwright Stealth Chromium
  try {
    const hits = sanitizeHits(await searchWithPlaywright(query, limit));
    if (hits.length > 0) {
      l(`Browser automation search found ${hits.length} live results`);
      return hits;
    }
  } catch (err: any) {
    l(`Browser search failed: ${err.message}`);
  }

  // Tier 4: Guaranteed Curated Fallback
  l(`Applying contextual web references for "${query}"`);
  return getCuratedFallbacks(query);
}
