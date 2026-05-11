import { NextRequest, NextResponse } from "next/server";
import { YoutubeTranscript } from "youtube-transcript";
import * as cheerio from "cheerio";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

async function summarizeWithNVIDIA(text: string, maxLength: number = 200): Promise<string> {
  if (!NVIDIA_API_KEY) {
    // Fallback: simple extraction-based summary
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);
    return sentences.slice(0, 3).join(". ") + ".";
  }

  const response = await fetch(
    "https://integrate.api.nvidia.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta/llama-3.1-8b-instruct",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that summarizes content concisely. Provide bullet-point summaries capturing key points.",
          },
          {
            role: "user",
            content: `Summarize the following text in ${maxLength} words or less with bullet points:\n\n${text}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`NVIDIA API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "Summary unavailable";
}

async function extractArticleText(url: string): Promise<{ title: string; text: string; author?: string; date?: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Remove non-content elements
  $("script, style, nav, footer, header, aside, .advertisement, .ads").remove();

  const title = $("title").text().trim() || $("h1").first().text().trim() || "Untitled";
  const author =
    $('meta[name="author"]').attr("content") ||
    $("[class*='author'], [class*='byline']").first().text().trim() ||
    undefined;

  const date =
    $('meta[property="article:published_time"]').attr("content") ||
    $("time").first().attr("datetime") ||
    undefined;

  // Extract main content
  let text = "";
  const contentSelectors = [
    "article",
    "[class*='content']",
    "[class*='article']",
    "main",
    ".post",
    "#content",
    "main div",
  ];

  for (const selector of contentSelectors) {
    const element = $(selector).first();
    if (element.length) {
      text = element.text().trim();
      if (text.length > 500) break;
    }
  }

  // Fallback to body text
  if (text.length < 500) {
    text = $("body").text().trim();
  }

  // Clean up text
  text = text.replace(/\s+/g, " ").replace(/\n+/g, "\n").slice(0, 10000);

  return { title, text, author, date };
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, url, text, maxLength = 200 } = body;

    if (!type) {
      return NextResponse.json(
        { error: "Type required: 'youtube' or 'article'" },
        { status: 400 }
      );
    }

    let content: string;
    let metadata: Record<string, string> = {};

    switch (type) {
      case "youtube": {
        if (!url) {
          return NextResponse.json(
            { error: "URL required for YouTube" },
            { status: 400 }
          );
        }

        const videoId = extractYouTubeId(url);
        if (!videoId) {
          return NextResponse.json(
            { error: "Invalid YouTube URL" },
            { status: 400 }
          );
        }

        try {
          const transcript = await YoutubeTranscript.fetchTranscript(videoId);
          content = transcript.map((t) => t.text).join(" ");
          metadata = {
            videoId,
            transcriptLength: String(transcript.length),
          };
        } catch (err) {
          return NextResponse.json(
            {
              error: "Could not fetch transcript",
              details: "Video may not have captions available",
            },
            { status: 400 }
          );
        }
        break;
      }

      case "article": {
        if (!url) {
          return NextResponse.json(
            { error: "URL required for article" },
            { status: 400 }
          );
        }

        const article = await extractArticleText(url);
        content = article.text;
        metadata = {
          title: article.title,
          author: article.author || "Unknown",
          date: article.date || "Unknown",
        };
        break;
      }

      case "text": {
        if (!text) {
          return NextResponse.json(
            { error: "Text required" },
            { status: 400 }
          );
        }
        content = text;
        break;
      }

      default:
        return NextResponse.json(
          { error: "Invalid type. Use: youtube, article, or text" },
          { status: 400 }
        );
    }

    // Truncate if too long
    if (content.length > 8000) {
      content = content.slice(0, 8000) + "...";
    }

    const summary = await summarizeWithNVIDIA(content, maxLength);

    return NextResponse.json({
      success: true,
      type,
      summary,
      originalLength: content.length,
      summaryLength: summary.length,
      metadata,
    });
  } catch (error) {
    console.error("Summarization error:", error);
    return NextResponse.json(
      { error: "Failed to summarize", details: String(error) },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({
    success: true,
    usage: {
      endpoint: "/api/summarize",
      method: "POST",
      types: {
        youtube: "Summarize YouTube video from URL",
        article: "Summarize article from URL",
        text: "Summarize provided text",
      },
      body: {
        type: "youtube|article|text",
        url: "https://... (for youtube/article)",
        text: "text to summarize (for text type)",
        maxLength: 200,
      },
    },
  });
}
