import { NextRequest, NextResponse } from 'next/server';

const WHATSAPP_SERVER = 'http://localhost:3001';

// POST /api/whatsapp/reconnect - Force reconnect when stuck
export async function POST(req: NextRequest) {
  try {
    console.log('[WhatsApp Reconnect] Force reconnecting...');

    // Call logout then init on Express server
    await fetch(`${WHATSAPP_SERVER}/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    // Wait a moment then get new status
    await new Promise(resolve => setTimeout(resolve, 1000));

    const res = await fetch(`${WHATSAPP_SERVER}/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    return NextResponse.json({
      success: true,
      message: 'Reconnecting...',
      ...data,
    });
  } catch (error) {
    console.error('[WhatsApp Reconnect] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to reconnect',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
