import { NextRequest, NextResponse } from 'next/server';
import { sendInstagramMessage, getInstagramThreads, getThreadMessages } from '@/lib/instagram';

// GET /api/instagram/threads - Get all Instagram DM threads
export async function GET(req: NextRequest) {
  try {
    const threads = await getInstagramThreads();

    return NextResponse.json({
      success: true,
      threads,
    });
  } catch (error) {
    console.error('[Instagram Threads] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get threads',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// POST /api/instagram/send - Send Instagram DM
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { recipient, message } = body;

    if (!recipient || !message) {
      return NextResponse.json(
        {
          success: false,
          error: 'Recipient and message are required'
        },
        { status: 400 }
      );
    }

    const result = await sendInstagramMessage(recipient, message);

    if (result.success) {
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        message: `Message sent to ${recipient}`,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[Instagram Send] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to send message',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
