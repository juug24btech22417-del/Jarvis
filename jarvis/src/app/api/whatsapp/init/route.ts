import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVER = process.env.WHATSAPP_SERVER_URL || 'http://localhost:3100';

// POST /api/whatsapp/init - Initialize WhatsApp
export async function POST(req: NextRequest) {
  try {
    const res = await fetch(`${WHATSAPP_SERVER}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[WhatsApp Init] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'WhatsApp server not running',
      },
      { status: 500 }
    );
  }
}

// GET /api/whatsapp/init - Get status
export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${WHATSAPP_SERVER}/status`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'WhatsApp server not running',
      },
      { status: 500 }
    );
  }
}
