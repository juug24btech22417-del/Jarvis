import { NextRequest, NextResponse } from "next/server";

const NEWS_API_KEY = process.env.NEWS_API_KEY; // Get from newsapi.org

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") || "technology";
    const country = searchParams.get("country") || "us";

    // Use NewsAPI or fallback to mock data for demo
    if (!NEWS_API_KEY) {
      // Demo mode - return mock tech news
      const mockNews = [
        {
          title: "SpaceX Successfully Launches New Satellite Constellation",
          source: "Tech Daily",
          description: "Elon Musk's SpaceX has successfully deployed 50 new Starlink satellites...",
          publishedAt: new Date().toISOString(),
          url: "https://example.com/1"
        },
        {
          title: "AI Breakthrough: New Model Passes Turing Test",
          source: "AI Weekly",
          description: "Researchers announce a major milestone in artificial intelligence development...",
          publishedAt: new Date(Date.now() - 3600000).toISOString(),
          url: "https://example.com/2"
        },
        {
          title: "Quantum Computing Reaches New Milestone",
          source: "Quantum Tech",
          description: "IBM announces 1000-qubit quantum processor breakthrough...",
          publishedAt: new Date(Date.now() - 7200000).toISOString(),
          url: "https://example.com/3"
        }
      ];
      return NextResponse.json({ success: true, articles: mockNews });
    }

    const response = await fetch(
      `https://newsapi.org/v2/top-headlines?country=${country}&category=${category}&apiKey=${NEWS_API_KEY}`,
      { next: { revalidate: 300 } }
    );

    const data = await response.json();

    if (data.status === "ok") {
      return NextResponse.json({
        success: true,
        articles: data.articles.slice(0, 5).map((article: { title: string; source: { name: string }; description: string; publishedAt: string; url: string }) => ({
          title: article.title,
          source: article.source.name,
          description: article.description,
          publishedAt: article.publishedAt,
          url: article.url
        }))
      });
    }

    throw new Error(data.message || "Failed to fetch news");
  } catch (error) {
    console.error("News API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch news", details: String(error) },
      { status: 500 }
    );
  }
}
