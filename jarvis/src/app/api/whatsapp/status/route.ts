import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVER = 'http://localhost:3001';

// GET /api/whatsapp/status - Check WhatsApp connection status
export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${WHATSAPP_SERVER}/status`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[WhatsApp Status] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'WhatsApp server not running. Please start it with: node whatsapp-server.js',
      },
      { status: 500 }
    );
  }
}
