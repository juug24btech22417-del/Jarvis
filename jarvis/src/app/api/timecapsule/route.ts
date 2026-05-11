import { NextRequest, NextResponse } from 'next/server';

interface TimeCapsuleEntry {
  id: string;
  type: 'voice' | 'text' | 'photo' | 'location';
  content: string;
  mood?: string;
  weather?: string;
  location?: string;
  tags: string[];
  createdAt: number;
  resurfacedAt?: number;
}

// In-memory storage (use a database in production)
let entries: TimeCapsuleEntry[] = [];

// Moods for tracking
const MOODS = ['happy', 'sad', 'anxious', 'excited', 'tired', 'motivated', 'stressed', 'calm', 'angry', 'neutral'];

// GET /api/timecapsule - Get entries
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    // Get all entries
    if (!action || action === 'list') {
      const limit = parseInt(searchParams.get('limit') || '50');
      const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
      return NextResponse.json({
        success: true,
        entries: sorted.slice(0, limit),
        total: entries.length,
      });
    }

    // Get "on this day" entries from previous years
    if (action === 'onthisday') {
      const today = new Date();
      const month = today.getMonth();
      const date = today.getDate();

      const onThisDay = entries.filter(entry => {
        const entryDate = new Date(entry.createdAt);
        return entryDate.getMonth() === month && entryDate.getDate() === date;
      });

      return NextResponse.json({
        success: true,
        entries: onThisDay,
        message: `Memories from ${onThisDay.length} previous year(s) on this day.`,
      });
    }

    // Get mood patterns
    if (action === 'patterns') {
      const moodCounts: Record<string, number> = {};
      const dayOfWeekMoods: Record<number, string[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

      entries.forEach(entry => {
        if (entry.mood) {
          moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
          const dayOfWeek = new Date(entry.createdAt).getDay();
          dayOfWeekMoods[dayOfWeek].push(entry.mood);
        }
      });

      // Find dominant mood per day
      const dayPatterns: Record<string, string> = {};
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      Object.entries(dayOfWeekMoods).forEach(([day, moods]) => {
        if (moods.length > 0) {
          const moodCounts: Record<string, number> = {};
          moods.forEach(m => { moodCounts[m] = (moodCounts[m] || 0) + 1; });
          const dominant = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
          dayPatterns[dayNames[parseInt(day)]] = dominant || 'neutral';
        }
      });

      // Find overall dominant mood
      const overallMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

      return NextResponse.json({
        success: true,
        patterns: {
          overallMood,
          dayPatterns,
          totalEntries: entries.length,
        },
      });
    }

    // Search entries
    if (action === 'search') {
      const query = searchParams.get('q')?.toLowerCase() || '';
      const filtered = entries.filter(entry =>
        entry.content.toLowerCase().includes(query) ||
        entry.tags.some(tag => tag.toLowerCase().includes(query)) ||
        entry.mood?.toLowerCase().includes(query)
      );

      return NextResponse.json({
        success: true,
        entries: filtered,
      });
    }

    return NextResponse.json({
      success: true,
      entries: [],
    });
  } catch (error) {
    console.error('[TimeCapsule] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get entries' },
      { status: 500 }
    );
  }
}

// POST /api/timecapsule - Create entry
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, content, mood, weather, location, tags } = body;

    if (!content) {
      return NextResponse.json(
        { success: false, error: 'Content is required' },
        { status: 400 }
      );
    }

    const entry: TimeCapsuleEntry = {
      id: Math.random().toString(36).substring(7),
      type: type || 'text',
      content,
      mood: mood || undefined,
      weather: weather || undefined,
      location: location || undefined,
      tags: tags || [],
      createdAt: Date.now(),
    };

    entries.unshift(entry);

    // Generate insight
    const entryCount = entries.length;
    const insight = entryCount % 10 === 0
      ? `You've captured ${entryCount} moments. Time is passing, Boss.`
      : entryCount === 1
      ? "Your first memory. I'll be here to remind you of this moment."
      : null;

    return NextResponse.json({
      success: true,
      entry,
      insight,
    });
  } catch (error) {
    console.error('[TimeCapsule] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create entry' },
      { status: 500 }
    );
  }
}

// DELETE /api/timecapsule - Delete entry
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const entryId = searchParams.get('id');

    if (!entryId) {
      return NextResponse.json(
        { success: false, error: 'Entry ID required' },
        { status: 400 }
      );
    }

    entries = entries.filter(e => e.id !== entryId);

    return NextResponse.json({
      success: true,
      message: 'Memory deleted. Some things are better forgotten.',
    });
  } catch (error) {
    console.error('[TimeCapsule] Delete error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete entry' },
      { status: 500 }
    );
  }
}
