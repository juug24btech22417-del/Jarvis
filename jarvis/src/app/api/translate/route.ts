import { NextRequest, NextResponse } from "next/server";

// Free translation using MyMemory API (free tier)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, from = "en", to = "es" } = body;

    if (!text) {
      return NextResponse.json({ error: "Text required" }, { status: 400 });
    }

    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${from}|${to}`
    );

    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status}`);
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      original: text,
      translated: data.responseData.translatedText,
      from,
      to,
      matches: data.matches?.length || 0,
    });
  } catch (error) {
    console.error("Translation error:", error);
    return NextResponse.json(
      { error: "Translation failed", details: String(error) },
      { status: 500 }
    );
  }
}

// Available languages
export async function GET() {
  const languages = [
    { code: "en", name: "English" },
    { code: "es", name: "Spanish" },
    { code: "fr", name: "French" },
    { code: "de", name: "German" },
    { code: "it", name: "Italian" },
    { code: "pt", name: "Portuguese" },
    { code: "ru", name: "Russian" },
    { code: "ja", name: "Japanese" },
    { code: "ko", name: "Korean" },
    { code: "zh", name: "Chinese" },
    { code: "ar", name: "Arabic" },
    { code: "hi", name: "Hindi" },
  ];

  return NextResponse.json({ languages });
}
