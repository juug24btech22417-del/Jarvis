import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVER = process.env.WHATSAPP_SERVER_URL || 'http://localhost:3100';

// POST /api/whatsapp/send - Send a WhatsApp message
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // `number` is optional now: a `contact`/`name` lets the daemon resolve
    // the recipient from the user's real contact list.
    const { number, message } = body;
    const contact = body.contact ?? body.name ?? body.recipientName;

    if ((!number && !contact) || !message) {
      return NextResponse.json(
        {
          success: false,
          error: 'A recipient (contact name or phone number) and message are required'
        },
        { status: 400 }
      );
    }

    // Forward to Express server
    const res = await fetch(`${WHATSAPP_SERVER}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, name: contact, message }),
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
