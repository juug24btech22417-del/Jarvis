import { NextRequest, NextResponse } from 'next/server';

// AI-powered narrative engine using Claude API
const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;

interface GameSession {
  id: string;
  campaign: string;
  setting: string;
  character: any;
  story: any[];
  currentLocation: string;
  npcs: any[];
  quests: any[];
}

// System prompts for different campaigns
const CAMPAIGN_PROMPTS: Record<string, string> = {
  fantasy: `You are a Dungeon Master for a fantasy RPG. Your style is:
- Vivid, immersive descriptions of medieval fantasy settings
- Create interesting NPCs with distinct personalities
- Balance combat, exploration, and roleplay
- Use Tolkien/GRRM-inspired prose for important moments
- Keep tension high but allow for moments of levity
- Describe sensory details: sights, sounds, smells
- Never break character - you are the narrator/DM`,

  cyberpunk: `You are a Dungeon Master for a cyberpunk RPG. Your style is:
- Neon-soaked, gritty descriptions of dystopian cityscapes
- Corporate intrigue, street gangs, and cybernetic enhancements
- Channel William Gibson's Neuromancer and Cyberpunk 2077
- Focus on themes: transhumanism, corporate power, rebellion
- Use tech jargon: nets, ICE, cyberdecks, augmentations
- Noir-inspired narration with dark humor
- Never break character - you are the narrator/DM`,

  horror: `You are a Dungeon Master for a cosmic horror RPG. Your style is:
- Lovecraftian atmosphere with mounting dread
- Unreliable narration, questioning reality
- Forbidden knowledge comes at a terrible price
- Describe the indescribable with unsettling metaphors
- Sanity is fragile - hint at lurking horrors
- Slow build of tension, sudden terrifying reveals
- Never break character - you are the narrator/DM`,

  scifi: `You are a Dungeon Master for a space opera RPG. Your style is:
- Epic scale: starships, alien worlds, galactic empires
- Sense of wonder at the cosmos
- Mix of hard sci-fi concepts and adventure
- Diverse alien species and cultures
- Political intrigue between factions
- Channel Star Trek, Mass Effect, The Expanse
- Never break character - you are the narrator/DM`,
};

// POST /api/dungeon/play - Process player action and generate narrative
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, action, fullContext } = body;

    if (!sessionId || !action) {
      return NextResponse.json(
        { success: false, error: 'Session ID and action required' },
        { status: 400 }
      );
    }

    // Build the prompt for Claude
    const campaignPrompt = CAMPAIGN_PROMPTS[fullContext?.campaign] || CAMPAIGN_PROMPTS.fantasy;

    const systemPrompt = `${campaignPrompt}

CURRENT GAME STATE:
- Setting: ${fullContext?.setting || 'Unknown'}
- Character: ${fullContext?.character?.name} (${fullContext?.character?.class}, Level ${fullContext?.character?.level})
- Location: ${fullContext?.currentLocation}
- Health: ${fullContext?.character?.health}/${fullContext?.character?.maxHealth}
- Inventory: ${fullContext?.character?.inventory?.join(', ') || 'Empty'}
- Active Quests: ${fullContext?.quests?.filter((q: any) => !q.completed).map((q: any) => q.title).join(', ') || 'None'}

RECENT STORY:
${fullContext?.story?.slice(-3).map((s: any) => `[Turn ${s.turn}]: ${s.narrator}`).join('\n') || 'New adventure'}

The player's action is: "${action}"

Respond with:
1. A narrative paragraph (2-4 sentences) describing what happens
2. If there are choices, present 2-3 options naturally in the narrative
3. End with what the player perceives next
4. Keep it immersive and in character

Your response:`;

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          { role: 'user', content: systemPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[Dungeon] Claude API error:', error);
      throw new Error('AI narration failed');
    }

    const data = await response.json();
    const narration = data.content?.[0]?.text || 'The story continues...';

    return NextResponse.json({
      success: true,
      narration,
      turn: (fullContext?.story?.length || 0) + 1,
    });
  } catch (error) {
    console.error('[Dungeon] Play error:', error);

    // Fallback narration if AI fails
    const fallbackNarrations = [
      "You pause for a moment, considering your next move. The adventure awaits.",
      "The world around you seems to hold its breath, waiting for what comes next.",
      "Your journey continues through this strange and wondrous land.",
      "Something stirs in the distance. Your adventure takes an unexpected turn.",
    ];

    return NextResponse.json({
      success: true,
      narration: fallbackNarrations[Math.floor(Math.random() * fallbackNarrations.length)],
      fallback: true,
    });
  }
}

