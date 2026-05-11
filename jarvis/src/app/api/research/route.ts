import { NextRequest, NextResponse } from 'next/server';
import { researchService } from '@/services/ResearchService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query } = body;
    console.log(`[Research API] Request received for query: ${query}`);

    if (!query) {
      return NextResponse.json({ error: 'Research query is required' }, { status: 400 });
    }

    // We run this as a background task because deep research takes minutes
    // In a production app, we'd use a queue (like BullMQ) and return a jobId.
    // For now, we trigger it and return immediately to avoid timeout.
    researchService.startResearch(query).catch(err =>
      console.error("Background research failed:", err)
    );

    return NextResponse.json({
      success: true,
      message: `JARVIS is now conducting deep research on "${query}". You'll find the report in your Notion once complete.`
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
