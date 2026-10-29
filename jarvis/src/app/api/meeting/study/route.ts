import { NextRequest, NextResponse } from 'next/server';
import { meetingBot } from '@/services/MeetingBotService';
import { flashcardsToCsv, studyKitSlug, studyKitToMarkdown } from '@/lib/meeting/studyKit';

/**
 * Revision kit for the last meeting.
 *
 * POST { action: 'generate' } builds flashcards + a formula sheet from the
 * finished session's transcript. GET ?format=csv|md streams the exports: CSV is
 * Anki's import format, markdown is a printable sheet. Both are generated from
 * the same cached kit, so a download never re-runs the model.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.action && body.action !== 'generate') {
      return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
    }

    // A second click while a kit exists should be instant, not a second model call.
    const existing = meetingBot.getStudyKit();
    if (existing && !body?.refresh) {
      return NextResponse.json({
        success: true,
        cached: true,
        flashcards: existing.kit.flashcards.length,
        formulas: existing.kit.formulas.length,
        generatedAt: existing.kit.generatedAt,
        preview: {
          cards: existing.kit.flashcards.slice(0, 4),
          formulas: existing.kit.formulas.slice(0, 4),
        },
      });
    }

    const result = await meetingBot.buildStudyKit();
    if (!result.success || !result.kit) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      cached: false,
      flashcards: result.kit.flashcards.length,
      formulas: result.kit.formulas.length,
      generatedAt: result.kit.generatedAt,
      preview: {
        cards: result.kit.flashcards.slice(0, 4),
        formulas: result.kit.formulas.slice(0, 4),
      },
    });
  } catch (error: any) {
    console.error('Study kit error:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Could not build the revision kit.' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const data = meetingBot.getStudyKit();
  if (!data) {
    return NextResponse.json(
      { success: false, error: 'No revision kit yet — generate one first.' },
      { status: 404 }
    );
  }

  const format = (request.nextUrl.searchParams.get('format') || 'md').toLowerCase();
  const slug = studyKitSlug(data.source.title);

  if (format === 'csv') {
    return new NextResponse(flashcardsToCsv(data.kit.flashcards), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-flashcards.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  if (format === 'md' || format === 'markdown') {
    return new NextResponse(studyKitToMarkdown(data.kit, data.source), {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}-revision.md"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Plain JSON so the panel can preview a kit without downloading it first.
  if (format === 'json') {
    return NextResponse.json({ success: true, kit: data.kit, source: data.source });
  }

  return NextResponse.json({ success: false, error: 'Unknown format' }, { status: 400 });
}
