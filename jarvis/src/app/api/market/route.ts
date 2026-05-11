import { NextRequest, NextResponse } from "next/server";

// Using Yahoo Finance API (free, no key required)
const YAHOO_FINANCE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

// Popular stock/crypto mappings
const SYMBOLS: Record<string, string> = {
  // Stocks
  "apple": "AAPL",
  "microsoft": "MSFT",
  "tesla": "TSLA",
  "google": "GOOGL",
  "amazon": "AMZN",
  "meta": "META",
  "facebook": "META",
  "nvidia": "NVDA",
  "netflix": "NFLX",
  "amd": "AMD",
  "intel": "INTC",
  "bitcoin": "BTC-USD",
  "ethereum": "ETH-USD",
  "solana": "SOL-USD",
  "cardano": "ADA-USD",
  "dogecoin": "DOGE-USD",
  "doge": "DOGE-USD",
  // Indices
  "sp500": "^GSPC",
  "nasdaq": "^IXIC",
  "dow": "^DJI",
};

async function getStockPrice(symbol: string) {
  try {
    const ticker = SYMBOLS[symbol.toLowerCase()] || symbol.toUpperCase();

    const response = await fetch(
      `${YAHOO_FINANCE_URL}/${ticker}?interval=1d&range=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        next: { revalidate: 60 }, // Cache for 1 minute
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch data for ${ticker}`);
    }

    const data = await response.json();

    const result = data.chart?.result?.[0];
    if (!result) {
      throw new Error("No data available");
    }

    const meta = result.meta;
    const current = meta.regularMarketPrice;
    const previous = meta.previousClose || meta.chartPreviousClose;
    const change = current - previous;
    const changePercent = (change / previous) * 100;

    return {
      symbol: ticker,
      name: meta.shortName || meta.longName || ticker,
      price: current,
      currency: meta.currency,
      change: change,
      changePercent: changePercent,
      previousClose: previous,
      isCrypto: ticker.includes("-USD"),
    };
  } catch (error) {
    console.error("Stock price error:", error);
    throw error;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol");

    if (!symbol) {
      return NextResponse.json(
        { error: "Symbol required" },
        { status: 400 }
      );
    }

    const data = await getStockPrice(symbol);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Market API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch price data", details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const { symbol } = await req.json();

    if (!symbol) {
      return NextResponse.json(
        { error: "Symbol required" },
        { status: 400 }
      );
    }

    const data = await getStockPrice(symbol);

    return NextResponse.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Market API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch price data", details: String(error) },
      { status: 500 }
    );
  }
}
