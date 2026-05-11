import { NextRequest, NextResponse } from 'next/server';

// POST /api/dungeon/roll - Roll dice with advantage/disadvantage
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sides = 20, modifier = 0, advantage = false, disadvantage = false, context } = body;

    let rolls = [Math.floor(Math.random() * sides) + 1];

    if (advantage) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    } else if (disadvantage) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }

    let result = advantage ? Math.max(...rolls) : disadvantage ? Math.min(...rolls) : rolls[0];
    const total = result + modifier;

    // Generate dramatic narration
    let narration = '';
    if (result === 20 && sides === 20) {
      narration = "NATURAL 20! The dice tumble perfectly - a critical success!";
    } else if (result === 1 && sides === 20) {
      narration = "NATURAL 1! The dice clatter miserably - a critical failure!";
    } else if (total >= 20) {
      narration = "A magnificent roll! Success is within your grasp.";
    } else if (total <= 5) {
      narration = "The dice betray you. Failure looms.";
    } else {
      narration = `You roll a ${result}${modifier !== 0 ? ` (${modifier >= 0 ? '+' : ''}${modifier})` : ''}. The total is ${total}.`;
    }

    return NextResponse.json({
      success: true,
      rolls,
      result,
      modifier,
      total,
      narration,
    });
  } catch (error) {
    console.error('[Dungeon] Roll error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to roll dice' },
      { status: 500 }
    );
  }
}
