import { NextRequest, NextResponse } from 'next/server';

// In-memory game sessions (use a database in production)
interface GameSession {
  id: string;
  campaign: string;
  setting: string;
  character: {
    name: string;
    class: string;
    level: number;
    backstory: string;
    stats: {
      strength: number;
      dexterity: number;
      intelligence: number;
      constitution: number;
      wisdom: number;
      charisma: number;
    };
    inventory: string[];
    health: number;
    maxHealth: number;
  };
  story: Array<{
    turn: number;
    narrator: string;
    playerAction?: string;
    timestamp: number;
  }>;
  npcs: Array<{ name: string; description: string; attitude: 'friendly' | 'neutral' | 'hostile' }>;
  quests: Array<{ title: string; description: string; completed: boolean }>;
  currentLocation: string;
  createdAt: number;
  lastPlayed: number;
}

let gameSessions: GameSession[] = [];

const CAMPAIGNS = {
  fantasy: {
    name: 'Fantasy Realm',
    description: 'A world of magic, dragons, and ancient kingdoms',
    classes: ['Warrior', 'Mage', 'Rogue', 'Cleric', 'Ranger', 'Paladin'],
    settings: ['Medieval Kingdom', 'Elven Forest', 'Dwarven Mines', 'Wizard Tower', 'Dragon\'s Lair'],
  },
  cyberpunk: {
    name: 'Cyberpunk City',
    description: 'Neon-lit streets, corporate espionage, and cybernetic enhancements',
    classes: ['Netrunner', 'Street Samurai', 'Fixer', 'Techie', 'Rockerboy', 'Corpo'],
    settings: ['Night City', 'Corporate Plaza', 'Underground Club', 'Slums', 'Rooftop'],
  },
  horror: {
    name: 'Cosmic Horror',
    description: 'Eldritch abominations and forbidden knowledge await',
    classes: ['Detective', 'Professor', 'Journalist', 'Doctor', 'Occultist', 'Veteran'],
    settings: ['Abandoned Mansion', 'Cult Temple', 'Asylum', 'Foggy Harbor', 'Ancient Library'],
  },
  scifi: {
    name: 'Space Opera',
    description: 'Galactic empires, alien worlds, and starship battles',
    classes: ['Pilot', 'Engineer', 'Marine', 'Diplomat', 'Scientist', 'Smuggler'],
    settings: ['Starship Bridge', 'Space Station', 'Alien Planet', 'Asteroid Base', 'Earth Orbit'],
  },
};

// GET /api/dungeon/session - Get all sessions or a specific one
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('id');

    if (sessionId) {
      const session = gameSessions.find(s => s.id === sessionId);
      if (!session) {
        return NextResponse.json(
          { success: false, error: 'Session not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, session });
    }

    // List all sessions
    const sessions = gameSessions.map(s => ({
      id: s.id,
      campaign: s.campaign,
      setting: s.setting,
      character: { name: s.character.name, class: s.character.class },
      lastPlayed: s.lastPlayed,
    }));

    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    console.error('[Dungeon] Get session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

// POST /api/dungeon/session - Create a new game session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { campaign, setting, character } = body;

    if (!campaign || !setting || !character) {
      return NextResponse.json(
        { success: false, error: 'Campaign, setting, and character are required' },
        { status: 400 }
      );
    }

    const session: GameSession = {
      id: Math.random().toString(36).substring(7),
      campaign,
      setting,
      character: {
        name: character.name || 'Unknown Hero',
        class: character.class || 'Adventurer',
        level: 1,
        backstory: character.backstory || '',
        stats: {
          strength: character.stats?.strength || 10,
          dexterity: character.stats?.dexterity || 10,
          intelligence: character.stats?.intelligence || 10,
          constitution: character.stats?.constitution || 10,
          wisdom: character.stats?.wisdom || 10,
          charisma: character.stats?.charisma || 10,
        },
        inventory: character.inventory || ['Basic Supplies'],
        health: 100,
        maxHealth: 100,
      },
      story: [{
        turn: 0,
        narrator: `Welcome to the ${CAMPAIGNS[campaign as keyof typeof CAMPAIGNS]?.name || campaign}. Your adventure begins in ${setting}...`,
        timestamp: Date.now(),
      }],
      currentLocation: setting,
      npcs: [],
      quests: [],
      createdAt: Date.now(),
      lastPlayed: Date.now(),
    };

    gameSessions.unshift(session);

    return NextResponse.json({
      success: true,
      session: {
        id: session.id,
        campaign: session.campaign,
        setting: session.setting,
        character: session.character,
      },
      openingNarration: session.story[0].narrator,
    });
  } catch (error) {
    console.error('[Dungeon] Create session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create session' },
      { status: 500 }
    );
  }
}

// DELETE /api/dungeon/session - Delete a session
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('id');

    if (!sessionId) {
      return NextResponse.json(
        { success: false, error: 'Session ID required' },
        { status: 400 }
      );
    }

    gameSessions = gameSessions.filter(s => s.id !== sessionId);

    return NextResponse.json({
      success: true,
      message: 'Session deleted',
    });
  } catch (error) {
    console.error('[Dungeon] Delete session error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete session' },
      { status: 500 }
    );
  }
}

// Helper to get campaign info (not exported - for internal use only)
function getCampaignInfo() {
  return CAMPAIGNS;
}
