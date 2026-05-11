import { NextRequest, NextResponse } from 'next/server';

// In-memory store for motion events (in production, use a database)
interface MotionEvent {
  id: string;
  timestamp: number;
  screenshot?: string;
  confidence: number;
}

let motionEvents: MotionEvent[] = [];
const MAX_EVENTS = 100;

// GET /api/security/motion - Get motion events
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '20');
    const since = searchParams.get('since');

    let events = motionEvents;

    if (since) {
      const sinceTime = parseInt(since);
      events = events.filter(e => e.timestamp > sinceTime);
    }

    events = events.slice(0, limit);

    return NextResponse.json({
      success: true,
      events,
      total: motionEvents.length,
    });
  } catch (error) {
    console.error('[Security Motion] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get motion events',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// POST /api/security/motion - Record a motion event
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { screenshot, confidence } = body;

    const event: MotionEvent = {
      id: Math.random().toString(36).substring(7),
      timestamp: Date.now(),
      screenshot: screenshot || undefined,
      confidence: confidence || 0,
    };

    // Add to beginning of array
    motionEvents.unshift(event);

    // Trim to max events
    if (motionEvents.length > MAX_EVENTS) {
      motionEvents = motionEvents.slice(0, MAX_EVENTS);
    }

    return NextResponse.json({
      success: true,
      event,
    });
  } catch (error) {
    console.error('[Security Motion] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to record motion event',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// DELETE /api/security/motion - Clear motion events
export async function DELETE(req: NextRequest) {
  try {
    motionEvents = [];

    return NextResponse.json({
      success: true,
      message: 'Motion events cleared',
    });
  } catch (error) {
    console.error('[Security Motion] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to clear events',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
