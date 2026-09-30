import { NextRequest, NextResponse } from "next/server";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, mode = "full" } = body;

    if (!image) {
      return NextResponse.json({ error: "Image data is required" }, { status: 400 });
    }

    // Detect mime type from data URI prefix
    const mimeMatch = image.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");

    // Reject clearly broken/placeholder images
    if (base64Data.length < 500) {
      return NextResponse.json(
        {
          success: false,
          error: "Image too small or invalid. Please point camera at the document and try again.",
        },
        { status: 422 }
      );
    }

    let markdown = "";
    let mermaidCode = "";
    let actionItems: string[] = [];
    let summary = "";
    let rawText = "";

    const clientKey = body.apiKey || req.headers.get("x-gemini-key");
    const activeKey = clientKey || GEMINI_API_KEY;

    if (activeKey) {
      try {
        const candidateModels = ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-flash-latest"];
        let lastErrorText = "";
        let succeeded = false;

        const modePrompts: Record<string, string> = {
          full: `You are the Stark Industries Whiteboard & Schematic Digitizer AI.
Analyze this image of a physical whiteboard, paper note, diagram, or notebook.
Extract and structure everything you can see:

1. **Transcribe ALL text** - handwritten notes, printed text, equations, code snippets, lists, headings. Do not invent or assume. Only write what you actually see.
2. **Diagrams/Flowcharts** - if there are drawings, boxes, arrows, flowcharts, or mind maps, convert them to a Mermaid.js diagram.
3. **Action items** - extract any to-do items, checkboxes, bullet tasks.
4. **Summary** - one sentence describing what this document is about.

Return STRICTLY valid JSON (no markdown fences, no extra text):
{
  "summary": "One sentence describing the document",
  "rawText": "Exact verbatim transcription of all visible text, preserving line breaks",
  "markdown": "Clean structured markdown with headers and bullets based on the content",
  "mermaidCode": "graph TD\\n  A[...] --> B[...]  (or empty string if no diagram)",
  "actionItems": ["task 1", "task 2"]
}`,
          "text-only": `Transcribe all visible text from this image exactly as written. Return JSON: {"rawText": "...", "markdown": "...", "summary": "...", "mermaidCode": "", "actionItems": []}`,
          diagram: `Convert any visible diagrams, flowcharts, or sketches in this image to Mermaid.js notation. Return JSON: {"rawText": "", "markdown": "", "summary": "...", "mermaidCode": "graph TD\\n  A[...] --> B[...]", "actionItems": []}`,
        };

        const prompt = modePrompts[mode] || modePrompts.full;

        for (const model of candidateModels) {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${activeKey}`;
          const res = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mimeType, data: base64Data } },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
              },
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const jsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (jsonText) {
              try {
                const parsed = JSON.parse(jsonText);
                summary = parsed.summary || "";
                rawText = parsed.rawText || "";
                markdown = parsed.markdown || rawText;
                mermaidCode = parsed.mermaidCode || "";
                actionItems = parsed.actionItems || [];
              } catch {
                rawText = jsonText;
                markdown = jsonText;
                summary = "Text extracted from document";
              }
              succeeded = true;
              break;
            }
          } else {
            lastErrorText = await res.text();
            console.warn(`[WhiteboardOCR] ${model} returned HTTP ${res.status}:`, lastErrorText.slice(0, 100));
          }
        }

        if (!succeeded) {
          return NextResponse.json(
            { success: false, error: `Vision API error: ${lastErrorText || "Model unavailable"}` },
            { status: 502 }
          );
        }
      } catch (geminiError) {
        console.warn("[WhiteboardOCR] Gemini analysis error:", geminiError);
        return NextResponse.json(
          { success: false, error: "Vision analysis failed. Check your connection and try again." },
          { status: 500 }
        );
      }
    } else {
      // No API key configured — tell user clearly
      return NextResponse.json(
        {
          success: false,
          error: "GEMINI_API_KEY not configured. Add it to .env.local to enable real OCR.",
        },
        { status: 503 }
      );
    }

    // If Gemini returned empty content (blank page or unreadable)
    if (!markdown && !rawText) {
      summary = "No readable text detected";
      markdown = "_No text or diagrams could be extracted from the image. Try better lighting or hold the document closer to the camera._";
    }

    return NextResponse.json({
      success: true,
      summary,
      rawText,
      markdown,
      mermaidCode,
      actionItems,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to process whiteboard image", details: String(error) },
      { status: 500 }
    );
  }
}
