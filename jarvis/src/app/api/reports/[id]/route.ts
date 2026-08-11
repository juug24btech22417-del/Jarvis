import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reports/[id] — fetch a single report by its id.
 * Returns the raw row; the panel parses structuredBlocks back to
 * JSON for rendering.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const report = await prisma.report.findUnique({
      where: { id: params.id },
    });
    if (!report) {
      return NextResponse.json(
        { success: false, error: 'Report not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/reports/[id] — remove a report from the library.
 * Doesn't touch the Notion page (caller can do that separately).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.report.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
