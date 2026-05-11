import { NextRequest, NextResponse } from 'next/server';

interface Habit {
  id: string;
  name: string;
  description: string;
  target: string; // e.g., "daily", "5x per week", "once"
  category: 'health' | 'productivity' | 'learning' | 'social' | 'fitness' | 'custom';
  streak: number;
  completedToday: boolean;
  completions: number[]; // timestamps of completions
  createdAt: number;
  lastCompleted?: number;
  failedAttempts: number;
}

interface Goal {
  id: string;
  name: string;
  deadline?: number;
  progress: number; // 0-100
  milestones: Array<{ name: string; completed: boolean }>;
}

// In-memory storage (use a database in production)
let habits: Habit[] = [];
let goals: Goal[] = [];

// Sarcastic comments for various situations
const SARCASTIC_COMMENTS = {
  streak: [
    "Look at you, actually keeping a streak going. Color me impressed.",
    "Another day, another checkmark. Your productivity is almost as impressive as your ability to waste time.",
    "You're on a roll. Don't let it go to your head.",
  ],
  missed: [
    "Ah, so you've decided to abandon your goals again. Bold strategy.",
    "Your streak died. I'm sure there will be a touching memorial.",
    "I see consistency is still your nemesis.",
    "The habit you neglected: {habit}. The excuse you'll use: 'I'll start tomorrow'.",
  ],
  completed: [
    "Task complete. Your reward? The crushing realization that you have to do it again tomorrow.",
    "Congratulations. You did the thing. Want a cookie or shall I just mock you gently?",
    "One small step for you, one giant leap for your self-esteem.",
  ],
  contradiction: [
    "You said you wanted to {goal}, yet here you are {action}. Fascinating.",
    "Your actions contradict your goals so perfectly it's almost artistic.",
    "I'm tracking your progress. And by tracking, I mean documenting your failures.",
  ],
};

// GET /api/habits - Get all habits
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (action === 'stats') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayTs = today.getTime();

      const totalHabits = habits.length;
      const completedToday = habits.filter(h => h.completedToday).length;
      const activeStreaks = habits.filter(h => h.streak > 0).length;
      const longestStreak = habits.reduce((max, h) => Math.max(max, h.streak), 0);

      return NextResponse.json({
        success: true,
        stats: {
          totalHabits,
          completedToday,
          completionRate: totalHabits > 0 ? Math.round((completedToday / totalHabits) * 100) : 0,
          activeStreaks,
          longestStreak,
        },
      });
    }

    return NextResponse.json({
      success: true,
      habits,
      goals,
    });
  } catch (error) {
    console.error('[Habits] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get habits' },
      { status: 500 }
    );
  }
}

// POST /api/habits - Create or update habit
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, habit, goal } = body;

    // Create habit
    if (action === 'create') {
      const newHabit: Habit = {
        id: Math.random().toString(36).substring(7),
        name: habit.name,
        description: habit.description || '',
        target: habit.target || 'daily',
        category: habit.category || 'custom',
        streak: 0,
        completedToday: false,
        completions: [],
        createdAt: Date.now(),
        failedAttempts: 0,
      };

      habits.push(newHabit);

      return NextResponse.json({
        success: true,
        habit: newHabit,
        sarcasticComment: "A new habit. How optimistic. Let's see how long this one lasts.",
      });
    }

    // Complete habit
    if (action === 'complete') {
      const habitId = body.habitId;
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        return NextResponse.json(
          { success: false, error: 'Habit not found' },
          { status: 404 }
        );
      }

      if (habit.completedToday) {
        return NextResponse.json(
          { success: false, error: 'Already completed today' },
          { status: 400 }
        );
      }

      habit.completedToday = true;
      habit.streak++;
      habit.completions.push(Date.now());
      habit.lastCompleted = Date.now();

      const comment = SARCASTIC_COMMENTS.completed[Math.floor(Math.random() * SARCASTIC_COMMENTS.completed.length)];

      return NextResponse.json({
        success: true,
        habit,
        sarcasticComment: comment,
      });
    }

    // Create goal
    if (action === 'createGoal') {
      const newGoal: Goal = {
        id: Math.random().toString(36).substring(7),
        name: goal.name,
        deadline: goal.deadline,
        progress: 0,
        milestones: goal.milestones || [],
      };

      goals.push(newGoal);

      return NextResponse.json({
        success: true,
        goal: newGoal,
        sarcasticComment: "A goal. Ambitious. I'll be here when you inevitably need moral support.",
      });
    }

    // Check for contradictions
    if (action === 'checkContradiction') {
      const { habitName, userAction } = body;

      // Find related habits
      const relatedHabit = habits.find(h =>
        h.name.toLowerCase().includes(habitName.toLowerCase())
      );

      if (relatedHabit && !relatedHabit.completedToday && userAction.includes('skip')) {
        const comment = SARCASTIC_COMMENTS.contradiction[
          Math.floor(Math.random() * SARCASTIC_COMMENTS.contradiction.length)
        ].replace('{goal}', relatedHabit.name).replace('{action}', userAction);

        return NextResponse.json({
          success: true,
          contradiction: true,
          comment,
        });
      }

      return NextResponse.json({
        success: true,
        contradiction: false,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Unknown action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('[Habits] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to process habit' },
      { status: 500 }
    );
  }
}

// DELETE /api/habits - Delete a habit
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const habitId = searchParams.get('id');

    if (!habitId) {
      return NextResponse.json(
        { success: false, error: 'Habit ID required' },
        { status: 400 }
      );
    }

    habits = habits.filter(h => h.id !== habitId);

    return NextResponse.json({
      success: true,
      message: 'Habit deleted. One less thing to feel guilty about.',
    });
  } catch (error) {
    console.error('[Habits] Delete error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete habit' },
      { status: 500 }
    );
  }
}

// Helper to reset daily completions (not exported - internal use only)
function resetDailyHabits() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  habits.forEach(habit => {
    if (!habit.completedToday && habit.streak > 0) {
      // Streak broken
      habit.streak = 0;
      habit.failedAttempts++;
    }
    habit.completedToday = false;
  });
}
