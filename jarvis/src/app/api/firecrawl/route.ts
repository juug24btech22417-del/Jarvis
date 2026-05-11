import { NextRequest, NextResponse } from 'next/server';
import { firecrawlService } from '@/services/FirecrawlService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, url, urls, options } = body;

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
        const result = await firecrawlService.scrapeUrl(url, options);
        return NextResponse.json(result);
      }

      // ─── CRAWL: Entire website → Multiple pages of Markdown ─────────
      case 'crawl': {
        if (!url) {
          return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
        }
        const result = await firecrawlService.crawlWebsite(url, options);
        return NextResponse.json(result);
      }

      // ─── MAP: Discover all URLs on a domain ─────────────────────────
      case 'map': {
        if (!url) {
          return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
        }
        const result = await firecrawlService.mapWebsite(url, options);
        return NextResponse.json(result);
      }

      // ─── EXTRACT: Pull structured data from a page ──────────────────
      case 'extract': {
        if (!url) {
          return NextResponse.json({ success: false, error: 'URL is required' }, { status: 400 });
        }
        const { schema, prompt } = options || {};
        const result = await firecrawlService.extractData(url, schema || {}, prompt);
        return NextResponse.json(result);
      }

      // ─── BATCH: Scrape multiple URLs at once ────────────────────────
      case 'batch': {
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return NextResponse.json({ success: false, error: 'urls array is required' }, { status: 400 });
        }
        const results = await firecrawlService.batchScrape(urls);
        return NextResponse.json({
          success: true,
          total: results.length,
          succeeded: results.filter(r => r.success).length,
          results,
        });
      }

      default:
        return NextResponse.json({
          success: false,
          error: `Unknown action: "${action}". Valid actions: scrape, crawl, map, extract, batch`,
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
    actions: ['scrape', 'crawl', 'map', 'extract', 'batch'],
    usage: {
      scrape: { action: 'scrape', url: 'https://example.com' },
      crawl: { action: 'crawl', url: 'https://example.com', options: { maxPages: 10 } },
      map: { action: 'map', url: 'https://example.com' },
      extract: { action: 'extract', url: 'https://example.com', options: { schema: {}, prompt: '' } },
      batch: { action: 'batch', urls: ['https://example.com', 'https://example2.com'] },
    },
  });
}
