import { NextRequest, NextResponse } from 'next/server';
import { loginInstagram, getInstagramStatus, logoutInstagram } from '@/lib/instagram';

// GET /api/instagram/status - Check Instagram login status
export async function GET(req: NextRequest) {
  try {
    const status = getInstagramStatus();

    return NextResponse.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('[Instagram Status] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get Instagram status',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

// POST /api/instagram/login - Login to Instagram
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        {
          success: false,
          error: 'Username and password are required'
        },
        { status: 400 }
      );
    }

    const result = await loginInstagram(username, password);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Logged in successfully',
        username: result.error ? undefined : username,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error
        },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('[Instagram Login] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Login failed',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

