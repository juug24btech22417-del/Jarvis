import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";

interface ScrapedData {
  title: string;
  description: string;
  price?: string;
  availability?: string;
  image?: string;
  text: string;
  links: { text: string; href: string }[];
  tables: any[];
}

async function scrapeUrl(url: string): Promise<ScrapedData> {
  // Ensure URL has protocol
  const fullUrl = url.startsWith("http") ? url : `https://${url}`;

  const response = await fetch(fullUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove script and style elements
  $("script, style, nav, footer, header, aside").remove();

  // Extract common data
  const title = $("title").text().trim() || $("h1").first().text().trim() || "No title";
  const description =
    $('meta[name="description"]').attr("content") ||
    $("p").first().text().slice(0, 200) ||
    "";

  // Try to find price (common patterns)
  const priceSelectors = [
    '[class*="price"]',
    '[class*="cost"]',
    '[class*="amount"]',
    ".a-price-whole",
    ".a-offscreen",
    '[data-testid="price"]',
  ];
  let price = "";
  for (const selector of priceSelectors) {
    const el = $(selector).first();
    if (el.length) {
      price = el.text().trim();
      if (price.match(/[\$€£¥₹]\s*[\d,]+\.?\d*/)) break;
    }
  }

  // Try to find availability
  const availabilitySelectors = [
    '[class*="availability"]',
    '[class*="stock"]',
    "#availability",
    '[data-testid="availability"]',
  ];
  let availability = "";
  for (const selector of availabilitySelectors) {
    const el = $(selector).first();
    if (el.length) {
      availability = el.text().trim();
      if (availability) break;
    }
  }

  // Get main image
  const image =
    $('meta[property="og:image"]').attr("content") ||
    $("img").first().attr("src") ||
    "";

  // Get all text content
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, 5000);

  // Get links
  const links: { text: string; href: string }[] = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (href && text && links.length < 20) {
      links.push({ text: text.slice(0, 100), href: href.slice(0, 500) });
    }
  });

  // Extract tables
  const tables: any[] = [];
  $("table").each((_, table) => {
    const rows: string[][] = [];
    $(table)
      .find("tr")
      .each((_, row) => {
        const cells: string[] = [];
        $(row)
          .find("td, th")
          .each((_, cell) => {
            cells.push($(cell).text().trim());
          });
        if (cells.length) rows.push(cells);
      });
    if (rows.length) tables.push(rows);
  });

  return {
    title,
    description,
    price: price || undefined,
    availability: availability || undefined,
    image: image || undefined,
    text,
    links,
    tables,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { url, type } = body;

    if (!url) {
      return NextResponse.json({ error: "URL required" }, { status: 400 });
    }

    const data = await scrapeUrl(url);

    // Format response based on type
    switch (type) {
      case "flight": {
        // Extract flight info patterns
        const flightMatch = data.text.match(
          /(Flight\s+)?([A-Z]{2,3}\s*\d{1,4})|(\d{1,2}:\d{2})|(delayed|on\s+time|cancelled)|(gate\s+[A-Z]?\d{1,3})/gi
        );
        return NextResponse.json({
          success: true,
          type: "flight",
          data: {
            ...data,
            flightInfo: flightMatch || [],
          },
        });
      }

      case "product": {
        return NextResponse.json({
          success: true,
          type: "product",
          data: {
            title: data.title,
            description: data.description,
            price: data.price,
            availability: data.availability,
            image: data.image,
          },
        });
      }

      case "news": {
        const paragraphs = data.text
          .split("\n")
          .filter((p) => p.length > 50 && p.length < 500)
          .slice(0, 5);
        return NextResponse.json({
          success: true,
          type: "news",
          data: {
            title: data.title,
            summary: paragraphs.join(" "),
          },
        });
      }

      default:
        return NextResponse.json({
          success: true,
          type: "general",
          data,
        });
    }
  } catch (error) {
    console.error("Scraping error:", error);
    return NextResponse.json(
      { error: "Failed to scrape URL", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q");

    if (!query) {
      return NextResponse.json({
        success: true,
        usage: {
          endpoint: "/api/scrape",
          method: "POST",
          body: {
            url: "https://example.com",
            type: "flight|product|news|general",
          },
        },
      });
    }

    // Simple search scraping
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    const data = await scrapeUrl(searchUrl);

    return NextResponse.json({
      success: true,
      query,
      results: data.links.slice(0, 5),
    });
  } catch (error) {
    console.error("Search error:", error);
    return NextResponse.json(
      { error: "Search failed", details: String(error) },
      { status: 500 }
    );
  }
}
