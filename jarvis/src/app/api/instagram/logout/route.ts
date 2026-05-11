import { NextRequest, NextResponse } from 'next/server';
import { logoutInstagram } from '@/lib/instagram';

// POST /api/instagram/logout - Logout from Instagram
export async function POST(req: NextRequest) {
  try {
    const success = await logoutInstagram();

    if (success) {
      return NextResponse.json({
        success: true,
        message: 'Logged out successfully',
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: 'Logout failed'
        },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[Instagram Logout] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Logout failed',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
