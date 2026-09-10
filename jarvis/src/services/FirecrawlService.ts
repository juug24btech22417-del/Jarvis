import FirecrawlApp from '@mendable/firecrawl-js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface FirecrawlScrapeResult {
  success: boolean;
  url: string;
  title: string;
  markdown: string;
  metadata?: Record<string, any>;
  links?: string[];
  error?: string;
  source?: 'cache' | 'api';
}

export interface FirecrawlCrawlResult {
  success: boolean;
  status: string;
  totalPages: number;
  pages: { url: string; title: string; markdown: string }[];
  error?: string;
}

export interface FirecrawlMapResult {
  success: boolean;
  urls: string[];
  total: number;
  error?: string;
}

export interface FirecrawlSearchResult {
  success: boolean;
  results: {
    url: string;
    title: string;
    description: string;
    markdown?: string;
  }[];
  total: number;
  error?: string;
}

export interface FirecrawlExtractResult {
  success: boolean;
  url: string;
  data: Record<string, any>;
  error?: string;
}

export interface FirecrawlCreditInfo {
  success: boolean;
  remainingCredits?: number;
  planCredits?: number;
  error?: string;
}

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

// Firecrawl free tier is ~2-5 credits/min. Every timeout below is generous
// for the work done but tight enough that the panel never spins forever.
const TIMEOUTS = {
  scrape: 45_000,
  crawl: 90_000,
  map: 30_000,
  extract: 60_000,
  search: 45_000,
  batch: 90_000,
} as const;

/** Retry once with backoff on 429/5xx — recovers burst rate-limits. */
const RETRY_DELAY_MS = 5_000;

function isRetryableStatus(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? '');
  // 408 (server-side timeout) is usually transient — worth one retry.
  return /→ 429|→ 5\d\d|status code 408/.test(msg);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Map raw SDK/HTTP errors to plain-language guidance. The panel shows this
 * directly, so "500 Internal Server Error" is never an acceptable answer.
 */
export function friendlyFirecrawlError(err: unknown, action: string): string {
  const msg = String((err as Error)?.message ?? err);
  if (/→ 429|rate.?limit/i.test(msg)) {
    return `Firecrawl rate limit hit — the free tier allows a couple of requests per minute. Wait ~60s and run again.`;
  }
  if (/→ 402|payment|credit/i.test(msg)) {
    return `Firecrawl is out of credits for this billing period. Check your plan at firecrawl.dev (the Credits badge in this panel shows the balance).`;
  }
  if (/→ 40[13]|unauthorized|invalid api key/i.test(msg)) {
    return `Firecrawl rejected the API key. Check FIRECRAWL_API_KEY in .env.local.`;
  }
  if (/timeout|aborted|ETIMEDOUT|ECONNABORTED|status code 408/i.test(msg)) {
    return `The ${action} timed out — the site was too slow to process. Try again, or use a more specific URL.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|getaddrinfo|network/i.test(msg)) {
    return `Network error reaching Firecrawl. Check your internet connection.`;
  }
  return msg;
}

// ─── JUNK STRIPPING (shared post-processing) ────────────────────────────────

const JUNK_PATTERNS = [
  /\[Skip to content\].*?\n/g,
  /You signed in with another tab or window\..*?\n/g,
  /You signed out in another tab or window\..*?\n/g,
  /You switched accounts on another tab or window\..*?\n/g,
  /Dismiss alert/g,
  /You must be signed in to change notification settings/g,
  /\{\{ message \}\}/g,
  /\[github\]\(.*?\)\s*\/\s*\*\*\[.*?\]\(.*?\)\*\*\s*Public/g,
  /\[Go to Branches page\].*?\n/g,
  /\[Go to Tags page\].*?\n/g,
  /Open more actions menu/g,
];

function stripJunk(markdown: string): string {
  if (!markdown) return '';
  let md = markdown;
  for (const p of JUNK_PATTERNS) md = md.replace(p, '');
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

// ─── SERVICE ────────────────────────────────────────────────────────────────

class FirecrawlService {
  private client: FirecrawlApp | null = null;

  private getClient(): FirecrawlApp {
    if (!this.client) {
      const apiKey = process.env.FIRECRAWL_API_KEY;
      if (!apiKey) {
        throw new Error('FIRECRAWL_API_KEY is not set in environment variables. Get one free at https://firecrawl.dev');
      }
      this.client = new FirecrawlApp({ apiKey });
    }
    return this.client;
  }

  // ─── CACHE ──────────────────────────────────────────────────────────────

  private getCachePath(url: string): string {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const dir = path.join(process.cwd(), 'scratch', 'scrape_cache');
    return path.join(dir, `${hash}.json`);
  }

  private getFromCache(url: string, maxAgeMs = 24 * 60 * 60 * 1000): FirecrawlScrapeResult | null {
    try {
      const cachePath = this.getCachePath(url);
      if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        const age = Date.now() - stat.mtimeMs;
        if (age < maxAgeMs) {
          const content = fs.readFileSync(cachePath, 'utf8');
          console.log(`[Firecrawl Cache] Hit for: ${url}`);
          return JSON.parse(content);
        }
      }
    } catch (err) {
      console.error(`[Firecrawl Cache] Read error for ${url}:`, err);
    }
    return null;
  }

  private saveToCache(url: string, result: FirecrawlScrapeResult) {
    try {
      const dir = path.join(process.cwd(), 'scratch', 'scrape_cache');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.getCachePath(url), JSON.stringify(result), 'utf8');
      console.log(`[Firecrawl Cache] Saved: ${url}`);
    } catch (err) {
      console.error(`[Firecrawl Cache] Write error for ${url}:`, err);
    }
  }

  isAvailable(): boolean {
    return !!process.env.FIRECRAWL_API_KEY;
  }

  // ─── CREDITS (P0: visible balance = no cryptic failures) ────────────────

  async getCredits(): Promise<FirecrawlCreditInfo> {
    try {
      const client = this.getClient();
      const usage = (await client.v1.getCreditUsage()) as any;
      // v4 shape: { success, data: { remaining_credits, plan_credits } } —
      // normalize snake_case/camelCase under both `data` and the root.
      const d = usage?.data ?? usage ?? {};
      return {
        success: true,
        remainingCredits: d.remaining_credits ?? d.remainingCredits ?? null,
        planCredits: d.plan_credits ?? d.planCredits ?? null,
      };
    } catch (err) {
      return { success: false, error: friendlyFirecrawlError(err, 'credits') };
    }
  }

  // ─── SCRAPE ─────────────────────────────────────────────────────────────

  async scrapeUrl(
    url: string,
    options?: {
      formats?: ('markdown' | 'html' | 'links')[];
      onlyMainContent?: boolean;
      waitFor?: number;
      refreshCache?: boolean;
      timeoutMs?: number;
    }
  ): Promise<FirecrawlScrapeResult> {
    // Cache first (unless a refresh is forced — P0: stale-cache trap).
    if (!options?.refreshCache) {
      const cached = this.getFromCache(url);
      if (cached) return { ...cached, source: 'cache' };
    }

    const run = async (): Promise<FirecrawlScrapeResult> => {
      const client = this.getClient();
      console.log(`[Firecrawl] Scraping: ${url}`);

      // v4 typed entry point. timeoutMs drives the SDK's HTTP timeout —
      // the old code left the SDK's 5-minute default in place.
      const response = (await client.v1.scrapeUrl(url, {
        formats: options?.formats || ['markdown'],
        onlyMainContent: options?.onlyMainContent ?? true,
        waitFor: options?.waitFor ?? 1000,
        timeout: options?.timeoutMs ?? TIMEOUTS.scrape,
        excludeTags: ['nav', 'footer', 'header', 'script', 'style', 'noscript', 'aside'],
      } as any)) as any;

      if (response?.success === false) {
        return { success: false, url, title: '', markdown: '', error: response.error || 'Scrape failed' };
      }

      const doc = response?.data ?? response ?? {};
      const title = doc.metadata?.title || doc.title || '';
      const markdown = stripJunk(doc.markdown || doc.content || '');

      console.log(`[Firecrawl] Scraped "${title}" (${markdown.length} chars)`);

      const result: FirecrawlScrapeResult = {
        success: markdown.length > 0,
        url,
        title,
        markdown,
        metadata: doc.metadata || {},
        links: Array.isArray(doc.links) ? doc.links.slice(0, 100) : undefined,
      };
      if (result.success) this.saveToCache(url, result);
      else result.error = result.error || 'Page returned no readable content';
      return result;
    };

    try {
      try {
        return await run();
      } catch (e) {
        if (isRetryableStatus(e)) {
          console.warn(`[Firecrawl] Rate-limited, retrying once in ${RETRY_DELAY_MS}ms…`);
          await sleep(RETRY_DELAY_MS);
          return await run();
        }
        throw e;
      }
    } catch (e: any) {
      console.error('[Firecrawl] Scrape error:', e.message);
      return { success: false, url, title: '', markdown: '', error: friendlyFirecrawlError(e, 'scrape') };
    }
  }

  // ─── CRAWL (P0: bounded time, working depth control) ────────────────────

  async crawlWebsite(
    url: string,
    options?: {
      maxPages?: number;
      maxDepth?: number;
      includePaths?: string[];
      excludePaths?: string[];
      timeoutMs?: number;
    }
  ): Promise<FirecrawlCrawlResult> {
    try {
      const client = this.getClient();
      const maxPages = Math.min(options?.maxPages || 10, 50);
      const maxDepth = Math.min(options?.maxDepth || 2, 5);
      console.log(`[Firecrawl] Crawling: ${url} (max ${maxPages} pages, depth ${maxDepth})`);

      const params = {
        limit: maxPages,
        // v4 renamed maxDepth → maxDiscoveryDepth; the old code passed
        // maxDepth, which the API silently ignored.
        maxDiscoveryDepth: maxDepth,
        includePaths: options?.includePaths,
        excludePaths: options?.excludePaths,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
          timeout: 30_000,
          excludeTags: ['nav', 'footer', 'header', 'script', 'style', 'noscript', 'aside'],
        },
      } as any;

      // The v2 crawl body rejects a `timeout` key, so: start the job,
      // then poll manually under our own deadline. On deadline we return
      // the pages finished SO FAR — partial results beat a dead spinner.
      const startJob = () => client.v1.asyncCrawlUrl(url, params);
      let job: any;
      try {
        job = await startJob();
      } catch (e) {
        if (isRetryableStatus(e)) {
          await sleep(RETRY_DELAY_MS);
          job = await startJob();
        } else throw e;
      }
      if (!job?.id) {
        return { success: false, status: 'failed', totalPages: 0, pages: [], error: job?.error || 'Crawl job could not be started' };
      }

      const deadline = Date.now() + (options?.timeoutMs ?? TIMEOUTS.crawl);
      let status: any = null;
      while (Date.now() < deadline) {
        await sleep(2_000);
        try {
          status = await client.v1.checkCrawlStatus(job.id);
        } catch {
          continue; // transient poll error — keep going until deadline
        }
        if (status?.status === 'completed' || status?.status === 'failed' || status?.status === 'cancelled') break;
      }

      const docs: any[] = status?.data ?? [];
      const pages = docs.map((page) => ({
        url: page.metadata?.sourceURL || page.metadata?.url || page.url || '',
        title: page.metadata?.title || 'Untitled',
        markdown: stripJunk(page.markdown || page.content || ''),
      }));

      const timedOut = status?.status !== 'completed' && status?.status !== 'failed' && status?.status !== 'cancelled';
      console.log(`[Firecrawl] Crawled ${pages.length} pages from ${url}${timedOut ? ' (partial — deadline hit)' : ''}`);
      if (pages.length === 0) {
        return { success: false, status: timedOut ? 'timeout' : (status?.status || 'failed'), totalPages: 0, pages: [], error: timedOut ? 'The crawl ran out of time before any page finished. Try fewer pages or a shallower depth.' : 'Crawl finished with no pages.' };
      }
      return {
        success: true,
        status: timedOut ? 'partial' : (status?.status || 'completed'),
        totalPages: pages.length,
        pages,
      };
    } catch (e: any) {
      console.error('[Firecrawl] Crawl error:', e.message);
      return { success: false, status: 'error', totalPages: 0, pages: [], error: friendlyFirecrawlError(e, 'crawl') };
    }
  }

  // ─── MAP (P0: the panel's search filter is actually applied now) ────────

  async mapWebsite(
    url: string,
    options?: { search?: string; limit?: number; includeSubdomains?: boolean; timeoutMs?: number }
  ): Promise<FirecrawlMapResult> {
    try {
      const client = this.getClient();
      console.log(`[Firecrawl] Mapping: ${url}${options?.search ? ` (filter: ${options.search})` : ''}`);

      // NOTE: the v2 map body REJECTS a `timeout` key — it doesn't 400 like
      // crawl/batch, it fails with 408 every time. Deadline is enforced
      // client-side with Promise.race instead.
      const budgetMs = options?.timeoutMs ?? TIMEOUTS.map;
      const run = () =>
        Promise.race([
          client.v1.mapUrl(url, {
            search: options?.search || undefined,
            limit: Math.min(options?.limit || 100, 500),
            includeSubdomains: options?.includeSubdomains ?? false,
          } as any),
          new Promise((_, rej) => setTimeout(() => rej(new Error(`map aborted after ${budgetMs}ms`)), budgetMs)),
        ]);

      let response: any;
      try {
        response = await run();
      } catch (e) {
        if (isRetryableStatus(e)) {
          await sleep(RETRY_DELAY_MS);
          response = await run();
        } else throw e;
      }

      if (response?.success === false) {
        return { success: false, urls: [], total: 0, error: friendlyFirecrawlError(response.error || 'Map failed', 'map') };
      }

      const rawUrls = response?.links ?? response?.urls ?? (Array.isArray(response) ? response : []);
      const urls = (rawUrls as any[])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.url || String(entry)))
        .filter(Boolean);
      console.log(`[Firecrawl] Found ${urls.length} URLs on ${url}`);
      return { success: true, urls, total: urls.length };
    } catch (e: any) {
      console.error('[Firecrawl] Map error:', e.message);
      return { success: false, urls: [], total: 0, error: friendlyFirecrawlError(e, 'map') };
    }
  }

  // ─── SEARCH (P1: new action — web search with optional scrape) ──────────

  async searchWeb(
    query: string,
    options?: { limit?: number; scrapeResults?: boolean; timeoutMs?: number }
  ): Promise<FirecrawlSearchResult> {
    try {
      const client = this.getClient();
      const limit = Math.min(options?.limit || 5, 10);
      console.log(`[Firecrawl] Searching: "${query}" (limit ${limit}, scrape: ${!!options?.scrapeResults})`);

      const run = () =>
        client.v1.search(query, {
          limit,
          timeout: Math.round((options?.timeoutMs ?? TIMEOUTS.search) / 1000),
          scrapeOptions: options?.scrapeResults
            ? { formats: ['markdown'], onlyMainContent: true, timeout: 30_000 }
            : undefined,
        } as any);

      let response: any;
      try {
        response = await run();
      } catch (e) {
        if (isRetryableStatus(e)) {
          await sleep(RETRY_DELAY_MS);
          response = await run();
        } else throw e;
      }

      if (response?.success === false) {
        return { success: false, results: [], total: 0, error: friendlyFirecrawlError(response.error || 'Search failed', 'search') };
      }

      const docs: any[] = response?.data ?? [];
      const results = docs
        .map((d) => ({
          url: d.metadata?.sourceURL || d.metadata?.url || d.url || '',
          title: d.metadata?.title || d.title || d.url || 'Untitled',
          description: (d.description || d.metadata?.description || (d.markdown || '').slice(0, 200)).trim(),
          markdown: d.markdown ? stripJunk(d.markdown) : undefined,
        }))
        .filter((r) => r.url);

      console.log(`[Firecrawl] Search returned ${results.length} results`);
      return { success: results.length > 0, results, total: results.length };
    } catch (e: any) {
      console.error('[Firecrawl] Search error:', e.message);
      return { success: false, results: [], total: 0, error: friendlyFirecrawlError(e, 'search') };
    }
  }

  // ─── EXTRACT (P1: the real thing — schema-driven LLM extraction) ────────

  async extractData(
    url: string,
    schema: Record<string, any>,
    prompt?: string,
    options?: { timeoutMs?: number }
  ): Promise<FirecrawlExtractResult> {
    try {
      const client = this.getClient();
      console.log(`[Firecrawl] Extracting structured data from: ${url}`);

      // The 'json' scrape format does server-side LLM extraction — the
      // prompt/schema live under jsonOptions (v2 API shape).
      // An empty schema {} breaks extraction — only send a real one.
      const hasSchema = schema && Object.keys(schema).length > 0;
      const response = (await client.v1.scrapeUrl(url, {
        formats: ['json'],
        jsonOptions: {
          prompt: prompt || 'Extract the requested data from this page',
          ...(hasSchema ? { schema } : {}),
        },
        onlyMainContent: true,
        timeout: options?.timeoutMs ?? TIMEOUTS.extract,
      } as any)) as any;

      if (response?.success === false) {
        return { success: false, url, data: {}, error: friendlyFirecrawlError(response.error || 'Extraction failed', 'extract') };
      }

      const doc = response?.data ?? response ?? {};
      // json format lands in doc.json (top level; older builds nest under data).
      const extracted = doc.json ?? doc.data?.json ?? null;

      if (!extracted) {
        return {
          success: false,
          url,
          data: {},
          error: 'The page did not yield structured data. Try a clearer prompt, a schema with explicit field names, or a page that actually contains the data.',
        };
      }

      return {
        success: true,
        url,
        data: {
          extracted,
          _meta: {
            title: doc.metadata?.title || '',
            prompt: prompt || null,
            schema,
          },
        },
      };
    } catch (e: any) {
      console.error('[Firecrawl] Extract error:', e.message);
      return { success: false, url, data: {}, error: friendlyFirecrawlError(e, 'extract') };
    }
  }

  // ─── BATCH (P1: native server-side batch, not 3-at-a-time chunks) ───────

  async batchScrape(urls: string[], options?: { timeoutMs?: number }): Promise<FirecrawlScrapeResult[]> {
    console.log(`[Firecrawl] Batch scraping ${urls.length} URLs (native batch)…`);
    try {
      const client = this.getClient();

      // v2 batch body takes scrape params flattened (an `options` wrapper
      // is a v1 shape and gets rejected with 400).
      const params = {
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 30_000,
        excludeTags: ['nav', 'footer', 'header', 'script', 'style', 'noscript', 'aside'],
        ignoreInvalidURLs: true,
      } as any;

      // Async job + manual polling under our own deadline — partial
      // results on timeout instead of an endless SDK waiter.
      const startJob = () => client.v1.asyncBatchScrapeUrls(urls, params);
      let job: any;
      try {
        job = await startJob();
      } catch (e) {
        if (isRetryableStatus(e)) {
          await sleep(RETRY_DELAY_MS);
          job = await startJob();
        } else throw e;
      }
      if (!job?.id) {
        return urls.map((u) => ({ success: false, url: u, title: '', markdown: '', error: job?.error || 'Batch job could not be started' }));
      }

      const deadline = Date.now() + (options?.timeoutMs ?? TIMEOUTS.batch);
      let status: any = null;
      while (Date.now() < deadline) {
        await sleep(2_000);
        try {
          status = await client.v1.checkBatchScrapeStatus(job.id);
        } catch {
          continue; // transient poll error — keep going until deadline
        }
        if (status?.status === 'completed' || status?.status === 'failed' || status?.status === 'cancelled') break;
      }

      const docs: any[] = status?.data ?? [];

      const byUrl = new Map<string, any>();
      for (const doc of docs) {
        const u = doc.metadata?.sourceURL || doc.metadata?.url || doc.url;
        if (u) byUrl.set(u, doc);
      }

      // Preserve the caller's URL order; match loosely (ignore trailing slashes).
      const results = urls.map((u) => {
        const doc = byUrl.get(u) ?? byUrl.get(u.replace(/\/$/, '')) ?? byUrl.get(`${u}/`);
        if (!doc) {
          return { success: false, url: u, title: '', markdown: '', error: 'No result returned for this URL' };
        }
        const markdown = stripJunk(doc.markdown || doc.content || '');
        return {
          success: markdown.length > 0,
          url: u,
          title: doc.metadata?.title || 'Untitled',
          markdown,
          metadata: doc.metadata || {},
          error: markdown.length > 0 ? undefined : 'Page returned no readable content',
        };
      });

      const ok = results.filter((r) => r.success).length;
      console.log(`[Firecrawl] Batch complete: ${ok}/${urls.length} succeeded`);
      return results;
    } catch (e: any) {
      console.error('[Firecrawl] Batch error:', e.message);
      // Whole-batch failure → per-URL failures so the UI still renders rows.
      return urls.map((u) => ({
        success: false,
        url: u,
        title: '',
        markdown: '',
        error: friendlyFirecrawlError(e, 'batch'),
      }));
    }
  }
}

export const firecrawlService = new FirecrawlService();
