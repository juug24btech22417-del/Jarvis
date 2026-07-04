import { NextRequest, NextResponse } from 'next/server';
import { researchService } from '@/services/ResearchService';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, depth = 'standard' } = body;
    console.log(`[Research API] Request received — depth: ${depth}, query: ${query}`);

    if (!query) {
      return NextResponse.json({ error: 'Research query is required' }, { status: 400 });
    }

    const researchId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Fire background research with selected depth
    researchService.startResearch(researchId, query, depth as 'quick' | 'standard' | 'deep').catch(err =>
      console.error("Background research failed:", err)
    );

    return NextResponse.json({
      success: true,
      researchId,
      message: `JARVIS is now conducting ${depth} research on "${query}".`
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
