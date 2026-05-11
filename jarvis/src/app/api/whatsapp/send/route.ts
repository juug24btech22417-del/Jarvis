import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVER = 'http://localhost:3001';

// POST /api/whatsapp/send - Send a WhatsApp message
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { number, message } = body;

    if (!number || !message) {
      return NextResponse.json(
        {
          success: false,
          error: 'Phone number and message are required'
        },
        { status: 400 }
      );
    }

    // Forward to Express server
    const res = await fetch(`${WHATSAPP_SERVER}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, message }),
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[WhatsApp Send] Error:', error);
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
