import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query) {
      return NextResponse.json(
        { error: "Query parameter required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.SERPER_API_KEY;

    if (!apiKey || apiKey.trim() === "" || apiKey === "your-api-key-here") {
      return NextResponse.json(
        { error: "Serper.dev API key not configured" },
        { status: 503 }
      );
    }

    // Serper.dev (Google Search API)
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        q: query,
        num: 5,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Serper.dev API error:", response.status, errorText);
      return NextResponse.json(
        { error: "Failed to fetch search results" },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Format the results from Serper.dev
    interface SearchResultItem {
      title: string;
      link: string;
      snippet: string;
    }

    const results = data.organic?.slice(0, 5).map((result: SearchResultItem) => ({
      title: result.title,
      url: result.link,
      description: result.snippet,
    })) || [];

    return NextResponse.json({
      query,
      results,
      totalResults: data.searchInformation?.totalResults || results.length,
    });
  } catch (error) {
    console.error("Error searching:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
