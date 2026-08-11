import { NextRequest, NextResponse } from 'next/server';
import { oracleResearchService } from '@/services/OracleResearchService';
import type { ReportType } from '@/services/ResearchTypes';
import { ALL_REPORT_TYPES } from '@/services/ResearchTypes';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { query, depth = 'standard', reportType, parentReportId } = body;

    if (!query) {
      return NextResponse.json({ error: 'Research query is required' }, { status: 400 });
    }

    if (reportType && !ALL_REPORT_TYPES.includes(reportType)) {
      return NextResponse.json(
        { error: `Unknown report type "${reportType}". Valid: ${ALL_REPORT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const researchId = `oracle_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    oracleResearchService
      .startOracleResearch({
        id: researchId,
        query,
        depth,
        reportType: reportType as ReportType | undefined,
        parentReportId,
      })
      .catch((err) => console.error('Background Oracle research failed:', err));

    return NextResponse.json({
      success: true,
      researchId,
      message: `JARVIS Oracle is now running on "${query}".`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
