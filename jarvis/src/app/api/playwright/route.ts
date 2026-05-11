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
      
      case "buy":
        const buyResult = await playwrightService.automateCheckout(url, selector);
        return NextResponse.json(buyResult);
      
      case "flights":
        const { from, to, date } = body;
        const flightResult = await playwrightService.searchFlights(from, to, date);
        return NextResponse.json(flightResult);
      
      case "food":
        const { query: foodQuery, platform } = body;
        const foodResult = await playwrightService.searchFood(foodQuery, platform);
        return NextResponse.json(foodResult);
      
      case "whatsapp":
        const { contact, message: whatsappMsg } = body;
        const whatsappResult = await playwrightService.sendWhatsApp(contact, whatsappMsg);
        return NextResponse.json(whatsappResult);
      
      case "compare":
        const { product: compareProduct } = body;
        const compareResult = await playwrightService.comparePrices(compareProduct);
        return NextResponse.json(compareResult);
      
      case "news":
        const { topic } = body;
        const newsResult = await playwrightService.scrapeNews(topic);
        return NextResponse.json(newsResult);
      
      case "youtube":
        const { query: ytQuery } = body;
        const ytResult = await playwrightService.playYouTube(ytQuery);
        return NextResponse.json(ytResult);
      
      case "directions":
        const { from: dirFrom, to: dirTo } = body;
        const dirResult = await playwrightService.getDirections(dirFrom, dirTo);
        return NextResponse.json(dirResult);
      
      case "jobs":
        const { query: jobQuery, location: jobLoc } = body;
        const jobResult = await playwrightService.searchJobs(jobQuery, jobLoc);
        return NextResponse.json(jobResult);
      
      case "email":
        const { to: emailTo, subject: emailSub, body: emailBody } = body;
        const emailResult = await playwrightService.composeEmail(emailTo, emailSub, emailBody);
        return NextResponse.json(emailResult);
      
      case "movies":
        const { query: movieQuery, city } = body;
        const movieResult = await playwrightService.searchMovies(movieQuery, city);
        return NextResponse.json(movieResult);
      
      case "scrape":
        const { url: scrapeUrl, whatToFind } = body;
        const scrapeResult = await playwrightService.scrapeWebsite(scrapeUrl, whatToFind);
        return NextResponse.json(scrapeResult);
      
      case "track":
        const { trackingId, courier } = body;
        const trackResult = await playwrightService.trackPackage(trackingId, courier);
        return NextResponse.json(trackResult);

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error: any) {
    console.error("[Playwright API] Error:", error);
    return NextResponse.json({ error: "Internal server error", details: error.message }, { status: 500 });
  }
}
