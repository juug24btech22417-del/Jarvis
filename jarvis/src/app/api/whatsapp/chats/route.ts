import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVER = 'http://localhost:3001';

// GET /api/whatsapp/chats - Get all WhatsApp chats
export async function GET(req: NextRequest) {
  try {
    const res = await fetch(`${WHATSAPP_SERVER}/chats`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[WhatsApp Chats] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get chats',
      },
      { status: 500 }
    );
  }
}
