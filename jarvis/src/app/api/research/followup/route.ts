import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { prisma } from '@/lib/db/queries';
import { oracleResearchService } from '@/services/OracleResearchService';
import { RESEARCH_PROMPTS } from '@/services/ResearchPrompts';
import { ALL_REPORT_TYPES, type ReportType } from '@/services/ResearchTypes';

const API_BASE = process.env.INTERNAL_API_URL || 'http://localhost:3000';

/**
 * POST /api/research/followup — start a new research task that builds
 * on a previously completed report. The Oracle rewrites the user's
 * follow-up question into a standalone query, classifies it, and
 * runs a fresh research task. The new task is linked back to the
 * parent via parentReportId so the report library can show the chain.
 *
 *   { parentReportId, followup }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { parentReportId, followup } = body;

    if (!parentReportId || !followup) {
      return NextResponse.json(
        { error: 'parentReportId and followup are required' },
        { status: 400 }
      );
    }

    const parent = await prisma.report.findUnique({ where: { id: parentReportId } });
    if (!parent) {
      return NextResponse.json(
        { error: `Parent report ${parentReportId} not found` },
        { status: 404 }
      );
    }

    // Pull the parent's executive summary so the LLM has context.
    let summary = '';
    try {
      if (parent.structuredBlocks) {
        const parsed = JSON.parse(parent.structuredBlocks);
        summary = parsed?.summary || '';
      }
    } catch {
      // ignore — we'll just use the query as context
    }
    if (!summary && parent.reportMarkdown) {
      summary = parent.reportMarkdown.split('\n').slice(0, 5).join(' ').trim();
    }

    // Ask the LLM to rewrite the follow-up as a standalone query.
    const prompt = RESEARCH_PROMPTS.FOLLOWUP.replace('{REPORT_QUERY}', parent.query)
      .replace('{REPORT_SUMMARY}', summary.slice(0, 2000))
      .replace('{FOLLOWUP}', followup);

    let rewrittenQuery = `${parent.query} — ${followup}`;
    let reportType: ReportType = 'deep_research';
    try {
      const res = await axios.post(`${API_BASE}/api/research-llm`, {
        prompt: `${prompt}\n\nReturn ONLY JSON: { "query": "...", "type": "..." }`,
      });
      const parsed = JSON.parse(res.data.content || '{}');
      if (typeof parsed.query === 'string' && parsed.query.trim()) {
        rewrittenQuery = parsed.query.trim();
      }
      if (ALL_REPORT_TYPES.includes(parsed.type)) {
        reportType = parsed.type;
      }
    } catch (e: any) {
      console.error('[followup] rewrite failed, using naive fallback:', e?.message);
    }

    const researchId = `oracle_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    oracleResearchService
      .startOracleResearch({
        id: researchId,
        query: rewrittenQuery,
        reportType,
        parentReportId: parent.id,
      })
      .catch((err) => console.error('Background follow-up research failed:', err));

    return NextResponse.json({
      success: true,
      researchId,
      query: rewrittenQuery,
      type: reportType,
      message: `Starting follow-up research: "${rewrittenQuery}"`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
