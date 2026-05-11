import FirecrawlApp from '@mendable/firecrawl-js';

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface FirecrawlScrapeResult {
  success: boolean;
  url: string;
  title: string;
  markdown: string;
  metadata?: Record<string, any>;
  error?: string;
}

export interface FirecrawlCrawlResult {
  success: boolean;
  jobId?: string;
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

export interface FirecrawlExtractResult {
  success: boolean;
  url: string;
  data: Record<string, any>;
  error?: string;
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

  /**
   * Check if Firecrawl is configured and available
   */
  isAvailable(): boolean {
    return !!process.env.FIRECRAWL_API_KEY;
  }

  // ─── SCRAPE: Convert a single URL into clean Markdown ──────────────────

  async scrapeUrl(url: string, options?: {
    formats?: ('markdown' | 'html' | 'links')[];
    onlyMainContent?: boolean;
    waitFor?: number;
  }): Promise<FirecrawlScrapeResult> {
    try {
      const client = this.getClient();
      console.log(`[Firecrawl] Scraping: ${url}`);

      const response = await client.scrape(url, {
        formats: options?.formats || ['markdown'],
        onlyMainContent: options?.onlyMainContent ?? true,
        waitFor: options?.waitFor || 1000,
        excludeTags: ['nav', 'footer', 'header', 'script', 'style', 'noscript', 'aside'],
      }) as any;

      console.log(`[Firecrawl] Raw response keys:`, Object.keys(response || {}));

      // v4 SDK: response might have success=true or just return data directly
      if (response.success === false) {
        return {
          success: false,
          url,
          title: '',
          markdown: '',
          error: response.error || 'Scrape failed',
        };
      }

      const title = response.metadata?.title || response.title || '';
      let markdown = response.markdown || response.content || '';

      // --- Post-processing: Strip common junk that escapes the scraper ---
      if (markdown) {
        const junkPatterns = [
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
          /Open more actions menu/g
        ];
        
        junkPatterns.forEach(pattern => {
          markdown = markdown.replace(pattern, '');
        });
        
        // Clean up leading/trailing whitespace and multiple newlines
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();
      }

      const metadata = response.metadata || {};

      console.log(`[Firecrawl] Scraped "${title}" (${markdown.length} chars)`);

      return {
        success: true,
        url,
        title,
        markdown,
        metadata,
      };
    } catch (e: any) {
      console.error('[Firecrawl] Scrape error:', e.message);
      return {
        success: false,
        url,
        title: '',
        markdown: '',
        error: e.message,
      };
    }
  }

  // ─── CRAWL: Recursively scrape an entire website ───────────────────────

  async crawlWebsite(url: string, options?: {
    maxPages?: number;
    maxDepth?: number;
    includePaths?: string[];
    excludePaths?: string[];
  }): Promise<FirecrawlCrawlResult> {
    try {
      const client = this.getClient();
      const maxPages = options?.maxPages || 10;
      console.log(`[Firecrawl] Crawling: ${url} (max ${maxPages} pages)`);

      const response = await client.crawl(url, {
        limit: maxPages,
        maxDepth: options?.maxDepth || 3,
        includePaths: options?.includePaths,
        excludePaths: options?.excludePaths,
        scrapeOptions: {
          formats: ['markdown'],
          onlyMainContent: true,
          excludeTags: ['nav', 'footer', 'header', 'script', 'style', 'noscript', 'aside'],
        },
      }) as any;

      console.log(`[Firecrawl] Crawl response keys:`, Object.keys(response || {}));
      console.log(`[Firecrawl] Crawl response.success:`, response?.success);
      console.log(`[Firecrawl] Crawl response.status:`, response?.status);

      if (response.success === false) {
        return {
          success: false,
          status: 'failed',
          totalPages: 0,
          pages: [],
          error: response.error || 'Crawl failed',
        };
      }

      // v4 SDK: data may be in response.data, response.results, or response itself as array
      const rawData = response.data || response.results || (Array.isArray(response) ? response : []);
      const pages = rawData.map((page: any) => {
        let markdown = page.markdown || page.content || '';
        
        // --- Post-processing: Strip common junk ---
        if (markdown) {
          const junkPatterns = [
            /\[Skip to content\].*?\n/g,
            /You signed in with another tab or window\..*?\n/g,
            /You signed out in another tab or window\..*?\n/g,
            /You switched accounts on another tab or window\..*?\n/g,
            /Dismiss alert/g,
            /You must be signed in to change notification settings/g
          ];
          
          junkPatterns.forEach(pattern => {
            markdown = markdown.replace(pattern, '');
          });
          markdown = markdown.trim();
        }

        return {
          url: page.metadata?.sourceURL || page.metadata?.url || page.url || '',
          title: page.metadata?.title || 'Untitled',
          markdown,
        };
      });

      console.log(`[Firecrawl] Crawled ${pages.length} pages from ${url}`);

      return {
        success: true,
        status: 'completed',
        totalPages: pages.length,
        pages,
      };
    } catch (e: any) {
      console.error('[Firecrawl] Crawl error:', e.message);
      return {
        success: false,
        status: 'error',
        totalPages: 0,
        pages: [],
        error: e.message,
      };
    }
  }

  // ─── MAP: Discover all URLs on a website ───────────────────────────────

  async mapWebsite(url: string, options?: {
    search?: string;
    limit?: number;
  }): Promise<FirecrawlMapResult> {
    try {
      const client = this.getClient();
      console.log(`[Firecrawl] Mapping: ${url}`);

      const response = await client.map(url, {
        search: options?.search,
        limit: options?.limit || 100,
      }) as any;

      console.log(`[Firecrawl] Map response keys:`, Object.keys(response || {}));
      console.log(`[Firecrawl] Map response type:`, typeof response);
      console.log(`[Firecrawl] Map response.success:`, response?.success);
      console.log(`[Firecrawl] Map is array:`, Array.isArray(response));
      if (response?.links) console.log(`[Firecrawl] Map links count:`, response.links.length);
      if (response?.urls) console.log(`[Firecrawl] Map urls count:`, response.urls.length);

      if (response.success === false) {
        return {
          success: false,
          urls: [],
          total: 0,
          error: response.error || 'Map failed',
        };
      }

      // v4 SDK: urls may be in response.links, response.urls, or response itself as array
      const rawUrls = response.links || response.urls || (Array.isArray(response) ? response : []);
      // Normalize: entries can be plain strings or objects like {url: "...", title: "..."}
      const urls = rawUrls.map((entry: any) => typeof entry === 'string' ? entry : entry?.url || String(entry));
      console.log(`[Firecrawl] Found ${urls.length} URLs on ${url}`);

      return {
        success: true,
        urls,
        total: urls.length,
      };
    } catch (e: any) {
      console.error('[Firecrawl] Map error:', e.message);
      return {
        success: false,
        urls: [],
        total: 0,
        error: e.message,
      };
    }
  }

  // ─── EXTRACT: Pull structured data from a page using LLM ──────────────

  async extractData(url: string, schema: Record<string, any>, prompt?: string): Promise<FirecrawlExtractResult> {
    try {
      const client = this.getClient();
      console.log(`[Firecrawl] Extracting structured data from: ${url}`);

      // Scrape the page first, then use the markdown for extraction
      const scrapeResult = await this.scrapeUrl(url);
      if (!scrapeResult.success) {
        return {
          success: false,
          url,
          data: {},
          error: scrapeResult.error,
        };
      }

      // Return the raw markdown along with metadata for the caller to parse
      return {
        success: true,
        url,
        data: {
          title: scrapeResult.title,
          markdown: scrapeResult.markdown,
          metadata: scrapeResult.metadata,
          prompt: prompt || 'Extract the following data from this page',
          schema,
        },
      };
    } catch (e: any) {
      console.error('[Firecrawl] Extract error:', e.message);
      return {
        success: false,
        url,
        data: {},
        error: e.message,
      };
    }
  }

  // ─── BATCH SCRAPE: Scrape multiple URLs at once ────────────────────────

  async batchScrape(urls: string[]): Promise<FirecrawlScrapeResult[]> {
    console.log(`[Firecrawl] Batch scraping ${urls.length} URLs...`);
    const results: FirecrawlScrapeResult[] = [];

    // Process in parallel with a concurrency limit of 3
    const chunks = [];
    for (let i = 0; i < urls.length; i += 3) {
      chunks.push(urls.slice(i, i + 3));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(url => this.scrapeUrl(url))
      );
      results.push(...chunkResults);
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[Firecrawl] Batch complete: ${successCount}/${urls.length} succeeded`);
    return results;
  }
}

export const firecrawlService = new FirecrawlService();
