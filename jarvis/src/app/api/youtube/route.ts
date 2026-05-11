import { NextRequest, NextResponse } from "next/server";

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, query, videoId } = body;

    console.log("[YouTube API] Request received:", { action, query });

    if (!YOUTUBE_API_KEY) {
      console.error("[YouTube API] No API key configured");
      return NextResponse.json(
        { error: "YouTube API key not configured" },
        { status: 500 }
      );
    }

    switch (action) {
      case "search": {
        if (!query) {
          return NextResponse.json({ error: "Query required" }, { status: 400 });
        }

        const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=5&key=${YOUTUBE_API_KEY}`;
        const response = await fetch(searchUrl);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error?.message || "Search failed");
        }

        return NextResponse.json({
          success: true,
          videos: data.items?.map((item: { id: { videoId: string }; snippet: { title: string; channelTitle: string } }) => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            url: `https://youtube.com/watch?v=${item.id.videoId}`,
            embedUrl: `https://www.youtube.com/embed/${item.id.videoId}`,
            thumbnail: `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
          })) || [],
        });
      }

      case "trending": {
        const trendingUrl = `${YOUTUBE_API_BASE}/videos?part=snippet&chart=mostPopular&regionCode=US&maxResults=5&key=${YOUTUBE_API_KEY}`;
        const response = await fetch(trendingUrl);
        const data = await response.json();

        return NextResponse.json({
          success: true,
          videos: data.items?.map((item: { id: string; snippet: { title: string; channelTitle: string } }) => ({
            id: item.id,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            url: `https://youtube.com/watch?v=${item.id}`,
            embedUrl: `https://www.youtube.com/embed/${item.id}`,
            thumbnail: `https://img.youtube.com/vi/${item.id}/mqdefault.jpg`,
          })) || [],
        });
      }

      case "videoInfo": {
        if (!videoId) {
          return NextResponse.json({ error: "Video ID required" }, { status: 400 });
        }

        const infoUrl = `${YOUTUBE_API_BASE}/videos?part=snippet,statistics&id=${videoId}&key=${YOUTUBE_API_KEY}`;
        const response = await fetch(infoUrl);
        const data = await response.json();

        if (data.items?.length > 0) {
          const video = data.items[0];
          return NextResponse.json({
            success: true,
            video: {
              title: video.snippet.title,
              channel: video.snippet.channelTitle,
              views: video.statistics.viewCount,
              likes: video.statistics.likeCount,
            },
          });
        }
        return NextResponse.json({ error: "Video not found" }, { status: 404 });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("YouTube API error:", error);
    return NextResponse.json(
      { error: "YouTube command failed", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");

  if (!YOUTUBE_API_KEY) {
    return NextResponse.json(
      { error: "YouTube API key not configured" },
      { status: 500 }
    );
  }

  try {
    if (action === "trending") {
      const trendingUrl = `${YOUTUBE_API_BASE}/videos?part=snippet&chart=mostPopular&regionCode=US&maxResults=5&key=${YOUTUBE_API_KEY}`;
      const response = await fetch(trendingUrl);
      const data = await response.json();

      return NextResponse.json({
        success: true,
        videos: data.items?.map((item: { id: string; snippet: { title: string; channelTitle: string } }) => ({
          id: item.id,
          title: item.snippet.title,
          channel: item.snippet.channelTitle,
        })) || [],
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("YouTube API error:", error);
    return NextResponse.json(
      { error: "YouTube command failed", details: String(error) },
      { status: 500 }
    );
  }
}
