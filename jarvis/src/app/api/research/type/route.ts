import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { RESEARCH_PROMPTS } from '@/services/ResearchPrompts';
import { ALL_REPORT_TYPES, type ReportType } from '@/services/ResearchTypes';

const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3000';

/**
 * Pre-flight classifier endpoint. Called by the panel as the user
 * types a query so we can show the inferred report type and subject
 * list before the user commits to running it. Does NOT start a
 * research task.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query } = body;
    if (!query) {
      return NextResponse.json({ error: 'query is required' }, { status: 400 });
    }

    const prompt = `${RESEARCH_PROMPTS.CLASSIFIER}\n\nQuery: ${query}\n\nReturn ONLY JSON: { "type": "...", "subjects": ["..."], "reasoning": "..." }`;

    try {
      const res = await axios.post(`${API_BASE}/api/research-llm`, { prompt });
      const parsed = JSON.parse(res.data.content || '{}');
      const type = (ALL_REPORT_TYPES.includes(parsed.type)
        ? parsed.type
        : 'deep_research') as ReportType;
      return NextResponse.json({
        success: true,
        type,
        subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
        reasoning: parsed.reasoning || '',
      });
    } catch (e: any) {
      // Classification is best-effort. If the LLM is rate-limited or
      // the call fails, fall back to deep_research silently.
      console.error('[research/type] classifier failed:', e?.message);
      return NextResponse.json({
        success: true,
        type: 'deep_research' as ReportType,
        subjects: [],
        reasoning: 'Classifier unavailable; defaulting to deep research.',
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
