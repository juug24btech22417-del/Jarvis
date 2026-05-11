import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVER = 'http://localhost:3001';

// POST /api/whatsapp/logout - Logout from WhatsApp
export async function POST(req: NextRequest) {
  try {
    // Forward to Express server
    const res = await fetch(`${WHATSAPP_SERVER}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[WhatsApp Logout] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to logout',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
