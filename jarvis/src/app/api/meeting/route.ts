import { NextRequest, NextResponse } from 'next/server';
import { meetingBot } from '@/services/MeetingBotService';

export async function POST(request: NextRequest) {
  try {
    const { action, url, credentials, message } = await request.json();

    if (action === 'join') {
      if (!url) {
        return NextResponse.json({ success: false, error: 'Meeting URL is required' }, { status: 400 });
      }
      const result = await meetingBot.joinMeeting(url, credentials);
      return NextResponse.json(result);
    }

    if (action === 'leave') {
      const result = await meetingBot.leaveMeeting();
      return NextResponse.json(result);
    }

    if (action === 'chat') {
      if (!message) {
        return NextResponse.json({ success: false, error: 'Message is required' }, { status: 400 });
      }
      const result = await meetingBot.sendChatMessage(message);
      return NextResponse.json(result);
    }

    if (action === 'status') {
      const status = meetingBot.getStatus();
      return NextResponse.json({ success: true, ...status });
    }

    if (action === 'debug') {
      const debugInfo = await meetingBot.getPageDebugInfo();
      return NextResponse.json({ success: true, ...debugInfo });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Meeting Bot API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const status = meetingBot.getStatus();
  return NextResponse.json({ success: true, ...status });
}
