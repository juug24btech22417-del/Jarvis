import { NextRequest, NextResponse } from 'next/server';
import { meetingBot } from '@/services/MeetingBotService';

export async function POST(request: NextRequest) {
  try {
    const { action, url, credentials, message } = await request.json();

    if (action === 'join') {
      if (!url && !credentials?.id) {
        return NextResponse.json({ success: false, error: 'Meeting URL or Meeting ID is required' }, { status: 400 });
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

    if (action === 'open-google-login') {
      const result = await meetingBot.openGoogleSignInWindow();
      return NextResponse.json(result);
    }

    if (action === 'bring-to-front') {
      const result = await meetingBot.bringWindowToFront();
      return NextResponse.json(result);
    }

    if (action === 'debug') {
      const debugInfo = await meetingBot.getPageDebugInfo();
      return NextResponse.json({ success: true, ...debugInfo });
    }

    if (action === 'screenshot') {
      const result = await meetingBot.takeScreenshot();
      return NextResponse.json(result);
    }

    if (action === 'toggle-captions') {
      if (meetingBot.state?.page) {
        await (meetingBot as any).enableZoomCaptions(meetingBot.state.page);
        return NextResponse.json({ success: true, message: 'Toggled Zoom captions' });
      }
      return NextResponse.json({ success: false, error: 'No active page' });
    }

    if (action === 'inspect-subtitle') {
      if (!meetingBot.state?.page) return NextResponse.json({ error: 'No page' });
      const frames = meetingBot.state.page.frames();
      const results: any[] = [];
      for (const frame of frames) {
        try {
          const res = await frame.evaluate(() => {
            const els: any[] = [];
            document.querySelectorAll('[class*="live-transcription"], [class*="subtitle"], [class*="caption"]').forEach(el => {
              els.push({
                tagName: el.tagName,
                className: el.className,
                text: el.textContent?.trim(),
                outerHTML: el.outerHTML.substring(0, 300),
              });
            });
            return els;
          });
          results.push({ frameUrl: frame.url(), els: res });
        } catch (e: any) {
          results.push({ error: e.message });
        }
      }
      return NextResponse.json({ success: true, results });
    }

    if (action === 'restart-caption-engine') {
      const result = meetingBot.restartCaptionEngine();
      return NextResponse.json(result);
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
