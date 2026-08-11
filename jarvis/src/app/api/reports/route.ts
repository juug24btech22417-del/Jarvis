import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports — list past reports (newest first), with optional
 * filters. Used by the panel's history sidebar.
 *
 *   ?limit=N       cap result count (default 50, max 200)
 *   ?type=...      filter by report type
 *   ?parentId=...  list only follow-ups of a given report
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 200);
    const type = searchParams.get('type');
    const parentId = searchParams.get('parentId');

    const where: any = {};
    if (type) where.reportType = type;
    if (parentId) where.parentReportId = parentId;

    const reports = await prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ success: true, reports });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/reports — create or update a report row. Called by the
 * Oracle research pipeline at completion (and on failure) so the
 * library has a row for every run.
 *
 *   { taskId, query, reportType, status, progress, structuredReport,
 *     reportMarkdown, notionUrl, subjects, factsCount, sourcesCount,
 *     parentReportId }
 *
 * Idempotency: the first POST for a given taskId creates a row; later
 * POSTs with the same taskId update the existing row in place.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      taskId,
      query,
      reportType,
      status,
      progress,
      structuredReport,
      reportMarkdown,
      notionUrl,
      subjects,
      factsCount,
      sourcesCount,
      parentReportId,
    } = body;

    if (!query || !reportType) {
      return NextResponse.json(
        { error: 'query and reportType are required' },
        { status: 400 }
      );
    }

    const completedAt = status === 'completed' ? new Date() : null;
    const data = {
      query,
      reportType,
      status: status || 'completed',
      progress: progress ?? 100,
      reportMarkdown: reportMarkdown || null,
      notionUrl: notionUrl || null,
      subjects: Array.isArray(subjects) ? JSON.stringify(subjects) : null,
      structuredBlocks: structuredReport ? JSON.stringify(structuredReport) : null,
      factsCount: factsCount || 0,
      sourcesCount: sourcesCount || 0,
      taskId: taskId || null,
      parentReportId: parentReportId || null,
      ...(completedAt ? { completedAt } : {}),
    };

    // Find existing row by taskId, then update or create.
    const existing = taskId
      ? await prisma.report.findFirst({ where: { taskId } })
      : null;

    const report = existing
      ? await prisma.report.update({ where: { id: existing.id }, data })
      : await prisma.report.create({
          data: {
            id: `task_${taskId || `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`}`,
            ...data,
          },
        });

    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
