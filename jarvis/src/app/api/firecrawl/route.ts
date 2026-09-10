import { NextRequest, NextResponse } from 'next/server';
import { firecrawlService } from '@/services/FirecrawlService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, url, urls, options = {} } = body;

    if (!firecrawlService.isAvailable()) {
      return NextResponse.json({
        success: false,
        error: 'Firecrawl is not configured. Add FIRECRAWL_API_KEY to your .env.local file. Get a free key at https://firecrawl.dev',
      }, { status: 503 });
    }

    switch (action) {
      // ─── SCRAPE: Single URL → Markdown ──────────────────────────────
      case 'scrape': {
        if (!url) {
          return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
        }
        const result = await firecrawlService.scrapeUrl(url, {
          onlyMainContent: options.onlyMainContent,
          waitFor: options.waitFor,
          refreshCache: options.refreshCache,
          formats: options.formats,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 502 });
      }

      // ─── CRAWL: Entire website → Multiple pages of Markdown ─────────
      case 'crawl': {
        if (!url) {
          return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
        }
        const result = await firecrawlService.crawlWebsite(url, {
          maxPages: options.maxPages,
          maxDepth: options.maxDepth,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 502 });
      }

      // ─── MAP: Discover all URLs on a domain ─────────────────────────
      case 'map': {
        if (!url) {
          return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
        }
        const result = await firecrawlService.mapWebsite(url, {
          search: options.search,
          limit: options.limit,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 502 });
      }

      // ─── SEARCH: Web search with optional page scrape ────────────────
      case 'search': {
        if (!url && !options.query) {
          return NextResponse.json({ success: false, error: 'A search query is required (put it in the url field or options.query)' }, { status: 400 });
        }
        const query = options.query || url;
        const result = await firecrawlService.searchWeb(query, {
          limit: options.limit,
          scrapeResults: options.scrapeResults,
        });
        return NextResponse.json(result, { status: result.success ? 200 : 502 });
      }

      // ─── EXTRACT: Pull structured data from a page (native LLM) ─────
      case 'extract': {
        if (!url) {
          return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
        }
        const { schema, prompt } = options;
        if (!prompt && (!schema || Object.keys(schema).length === 0)) {
          return NextResponse.json(
            { success: false, error: 'Provide a prompt or a schema describing what to extract' },
            { status: 400 }
          );
        }
        const result = await firecrawlService.extractData(url, schema || {}, prompt);
        return NextResponse.json(result, { status: result.success ? 200 : 502 });
      }

      // ─── BATCH: Scrape multiple URLs at once ────────────────────────
      case 'batch': {
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return NextResponse.json({ success: false, error: 'urls array is required' }, { status: 400 });
        }
        const results = await firecrawlService.batchScrape(urls.slice(0, 20));
        const ok = results.filter((r) => r.success).length;
        return NextResponse.json({
          success: ok > 0,
          total: results.length,
          succeeded: ok,
          results,
        }, { status: ok > 0 ? 200 : 502 });
      }

      // ─── CREDITS: remaining balance ─────────────────────────────────
      case 'credits': {
        const info = await firecrawlService.getCredits();
        return NextResponse.json(info, { status: info.success ? 200 : 502 });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: "${action}". Valid actions: scrape, crawl, map, search, extract, batch, credits`,
        }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[Firecrawl API] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function GET() {
  const available = firecrawlService.isAvailable();
  return NextResponse.json({
    service: 'Firecrawl',
    available,
    actions: ['scrape', 'crawl', 'map', 'search', 'extract', 'batch', 'credits'],
    usage: {
      scrape: { action: 'scrape', url: 'https://example.com', options: { refreshCache: false } },
      crawl: { action: 'crawl', url: 'https://example.com', options: { maxPages: 10, maxDepth: 2 } },
      map: { action: 'map', url: 'https://example.com', options: { search: 'docs' } },
      search: { action: 'search', options: { query: 'best noise cancelling headphones', limit: 5, scrapeResults: false } },
      extract: { action: 'extract', url: 'https://example.com/product', options: { prompt: 'Extract the product name and price' } },
      batch: { action: 'batch', urls: ['https://example.com', 'https://example2.com'] },
      credits: { action: 'credits' },
    },
  });
}
