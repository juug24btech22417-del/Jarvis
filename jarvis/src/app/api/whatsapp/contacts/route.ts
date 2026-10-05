import { NextResponse } from 'next/server';

const WHATSAPP_SERVER = process.env.WHATSAPP_SERVER_URL || 'http://localhost:3100';

// GET /api/whatsapp/contacts - List saved WhatsApp contacts (for name-based send)
export async function GET() {
  try {
    const res = await fetch(`${WHATSAPP_SERVER}/contacts`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[WhatsApp Contacts] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'WhatsApp server not running. Start it with: npm run whatsapp:server',
      },
      { status: 500 }
    );
  }
}
