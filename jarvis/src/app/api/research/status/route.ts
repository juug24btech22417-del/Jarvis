import { NextRequest, NextResponse } from 'next/server';
import { oracleResearchService } from '@/services/OracleResearchService';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      const allTasks = oracleResearchService.getAllTasks();
      return NextResponse.json({ success: true, tasks: allTasks });
    }

    const status = oracleResearchService.getStatus(id);
    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Research task not found' },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, task: status });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
