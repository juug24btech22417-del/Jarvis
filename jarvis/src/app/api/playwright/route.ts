import { NextRequest, NextResponse } from "next/server";
import { playwrightService } from "@/services/PlaywrightService";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, url, selector } = body;

    console.log(`[Playwright API] Action: ${action}, URL: ${url}`);

    switch (action) {
      case "screenshot":
        const screenshotResult = await playwrightService.takeScreenshot(url);
        return NextResponse.json(screenshotResult);

      case "extract":
        const extractResult = await playwrightService.extractText(url, selector);
        return NextResponse.json(extractResult);

      case "click":
        const clickResult = await playwrightService.clickElement(url, selector);
        return NextResponse.json(clickResult);

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[Playwright API] Error:", error);
    return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 });
  }
}
